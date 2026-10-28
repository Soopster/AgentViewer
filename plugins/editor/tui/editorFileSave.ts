import { open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { resolveSafeEditorFile } from './editorFileOperations'
import {
  decodeEditorFileText,
  editorTextFromDisk,
  editorTextToDisk,
  type EditorLineEnding,
} from './editorLineEndings'

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
  lineEnding: EditorLineEnding = '\n',
  byteOrderMark = false,
): Promise<void> {
  const target = await resolveSafeEditorFile(root, path)
  // `content` and `savedContent` are the editor's LF-normalized text, so the
  // disk is compared in the same terms; the file's own ending is restored only
  // on the bytes actually written.
  // Read bytes, not a lossy 'utf8' string: a file whose bytes the editor cannot
  // reproduce is refused here rather than rewritten with U+FFFD in place of them.
  const current = editorTextFromDisk(decodeEditorFileText(await readFile(target.absolute), target.path)).content
  if (current !== savedContent) throw new EditorDiskConflictError(target.path)
  const info = await stat(target.absolute)
  saveCounter += 1
  const temporary = join(dirname(target.absolute), `.${basename(target.absolute)}.agent-viewer-save-${process.pid}-${saveCounter}`)
  let handle
  try {
    // Created private, then chmod'd to the original mode. `open`'s mode argument
    // is masked by the process umask, so passing the file's mode there silently
    // dropped bits (0o666 became 0o644 under the usual 0o022) — a save quietly
    // narrowed the file's permissions. fchmod is not masked.
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(editorTextToDisk(content, { lineEnding, byteOrderMark }), 'utf8')
    if (process.platform !== 'win32') await handle.chmod(info.mode & 0o777)
    await handle.sync()
    await handle.close()
    handle = undefined
    // Recheck immediately before replacement so an edit that landed while the
    // temporary file was being flushed is never silently overwritten.
    if (editorTextFromDisk(decodeEditorFileText(await readFile(target.absolute), target.path)).content !== savedContent) throw new EditorDiskConflictError(target.path)
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
