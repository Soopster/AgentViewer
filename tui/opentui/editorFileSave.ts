import { open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { resolveSafeEditorFile } from './editorFileOperations'

let saveCounter = 0

export class EditorDiskConflictError extends Error {
  readonly path: string

  constructor(path: string) {
    super(`${path} changed on disk; reload or reconcile it before saving`)
    this.name = 'EditorDiskConflictError'
    this.path = path
  }
}

export async function saveEditorFileSafely(
  root: string,
  path: string,
  content: string,
  savedContent: string,
): Promise<void> {
  const target = await resolveSafeEditorFile(root, path)
  const current = await readFile(target.absolute, 'utf8')
  if (current !== savedContent) throw new EditorDiskConflictError(target.path)
  const info = await stat(target.absolute)
  saveCounter += 1
  const temporary = join(dirname(target.absolute), `.${basename(target.absolute)}.agent-viewer-save-${process.pid}-${saveCounter}`)
  let handle
  try {
    handle = await open(temporary, 'wx', info.mode & 0o777)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    // Recheck immediately before replacement so an edit that landed while the
    // temporary file was being flushed is never silently overwritten.
    if (await readFile(target.absolute, 'utf8') !== savedContent) throw new EditorDiskConflictError(target.path)
    const latestTarget = await resolveSafeEditorFile(root, path)
    if (latestTarget.absolute !== target.absolute) throw new EditorDiskConflictError(target.path)
    await rename(temporary, target.absolute)
    // Windows cannot open a directory handle for fsync (EPERM); the rename
    // is already durable there without this POSIX directory-fsync step.
    if (process.platform !== 'win32') {
      const directoryHandle = await open(dirname(target.absolute), 'r')
      try { await directoryHandle.sync() } finally { await directoryHandle.close() }
    }
  } catch (error) {
    await handle?.close().catch(() => {})
    await unlink(temporary).catch(() => {})
    throw error
  }
}
