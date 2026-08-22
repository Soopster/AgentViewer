import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { resolveSafeEditorFile } from './editorFileOperations'

export type EditorRecoveryBuffer = {
  path: string
  content: string
  savedContent: string
}

export type EditorRecoverySnapshot = {
  version: 1
  savedAt: number
  activePath: string | null
  cursor: { line: number; character: number }
  buffers: EditorRecoveryBuffer[]
}

export type EditorRecoveryReadResult = {
  snapshot: EditorRecoverySnapshot | null
  conflicts: EditorRecoveryBuffer[]
}

const MAX_RECOVERY_BYTES = 128 * 1024 * 1024
const writeQueues = new Map<string, Promise<void>>()
let temporaryCounter = 0

function recoveryDirectory(root: string): string {
  return join(root, '.agent-viewer-data', 'editor-recovery')
}

export function editorRecoveryPath(root: string): string {
  return join(recoveryDirectory(root), 'workspace-v1.json')
}

function parseSnapshot(value: unknown): EditorRecoverySnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.version !== 1 || typeof record.savedAt !== 'number' || !Array.isArray(record.buffers)) return null
  const cursor = record.cursor as Record<string, unknown> | undefined
  if (!cursor || typeof cursor.line !== 'number' || typeof cursor.character !== 'number') return null
  const buffers = record.buffers.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const buffer = entry as Record<string, unknown>
    return typeof buffer.path === 'string' && typeof buffer.content === 'string' && typeof buffer.savedContent === 'string'
      ? [{ path: buffer.path, content: buffer.content, savedContent: buffer.savedContent }]
      : []
  })
  if (buffers.length !== record.buffers.length) return null
  return {
    version: 1,
    savedAt: record.savedAt,
    activePath: typeof record.activePath === 'string' ? record.activePath : null,
    cursor: { line: cursor.line, character: cursor.character },
    buffers,
  }
}

function enqueue(root: string, operation: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(root) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(operation)
  writeQueues.set(root, next)
  void next.then(() => {
    if (writeQueues.get(root) === next) writeQueues.delete(root)
  }, () => {
    if (writeQueues.get(root) === next) writeQueues.delete(root)
  })
  return next
}

export async function writeEditorRecovery(root: string, snapshot: EditorRecoverySnapshot): Promise<void> {
  await enqueue(root, async () => {
    const serialized = `${JSON.stringify(snapshot)}\n`
    if (Buffer.byteLength(serialized) > MAX_RECOVERY_BYTES) {
      throw new Error('Editor recovery snapshot exceeds 128 MB')
    }
    const directory = recoveryDirectory(root)
    const target = editorRecoveryPath(root)
    temporaryCounter += 1
    const temporary = `${target}.${process.pid}.${temporaryCounter}.tmp`
    await mkdir(directory, { recursive: true })
    let handle
    try {
      handle = await open(temporary, 'w', 0o600)
      await handle.writeFile(serialized, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporary, target)
      const directoryHandle = await open(directory, 'r')
      try { await directoryHandle.sync() } finally { await directoryHandle.close() }
    } catch (error) {
      await handle?.close().catch(() => {})
      await unlink(temporary).catch(() => {})
      throw error
    }
  })
}

export async function clearEditorRecovery(root: string): Promise<void> {
  await enqueue(root, async () => {
    await unlink(editorRecoveryPath(root)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  })
}

export async function readEditorRecovery(root: string): Promise<EditorRecoveryReadResult> {
  await writeQueues.get(root)?.catch(() => {})
  const target = editorRecoveryPath(root)
  let info
  try {
    info = await stat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { snapshot: null, conflicts: [] }
    throw error
  }
  if (info.size > MAX_RECOVERY_BYTES) throw new Error('Editor recovery snapshot exceeds 128 MB')
  const snapshot = parseSnapshot(JSON.parse(await readFile(target, 'utf8')))
  if (!snapshot) throw new Error('Editor recovery snapshot is invalid')
  const recoverable: EditorRecoveryBuffer[] = []
  const conflicts: EditorRecoveryBuffer[] = []
  for (const buffer of snapshot.buffers) {
    const absolute = resolve(root, buffer.path)
    const rel = relative(root, absolute)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) {
      conflicts.push(buffer)
      continue
    }
    let diskContent: string | null = null
    try {
      const safeFile = await resolveSafeEditorFile(root, buffer.path)
      diskContent = await readFile(safeFile.absolute, 'utf8')
    } catch { /* missing/unreadable/outside-workspace is a conflict */ }
    if (diskContent === buffer.savedContent) recoverable.push(buffer)
    else conflicts.push(buffer)
  }
  return {
    snapshot: recoverable.length > 0 ? { ...snapshot, buffers: recoverable } : null,
    conflicts,
  }
}
