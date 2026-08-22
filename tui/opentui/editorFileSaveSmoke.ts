import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EditorDiskConflictError, saveEditorFileSafely } from './editorFileSave'

const root = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-save-'))
const outside = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-save-outside-'))
const path = join(root, 'safe.ts')
try {
  await writeFile(path, 'const value = 1\n', 'utf8')
  await chmod(path, 0o640)
  await saveEditorFileSafely(root, 'safe.ts', 'const value = 2\n', 'const value = 1\n')
  if (await readFile(path, 'utf8') !== 'const value = 2\n' || ((await stat(path)).mode & 0o777) !== 0o640) {
    throw new Error('Atomic save did not preserve content and file mode')
  }

  await writeFile(path, 'const external = 3\n', 'utf8')
  let conflict: unknown
  try { await saveEditorFileSafely(root, 'safe.ts', 'const stale = 4\n', 'const value = 2\n') } catch (error) { conflict = error }
  if (!(conflict instanceof EditorDiskConflictError) || await readFile(path, 'utf8') !== 'const external = 3\n') {
    throw new Error(`External edit was not protected from a stale save: ${String(conflict)}`)
  }

  const linkedTarget = join(root, 'linked-target.ts')
  const linkedPath = join(root, 'linked.ts')
  await writeFile(linkedTarget, 'const linked = 1\n', 'utf8')
  await symlink(linkedTarget, linkedPath)
  await saveEditorFileSafely(root, 'linked.ts', 'const linked = 2\n', 'const linked = 1\n')
  if (!(await lstat(linkedPath)).isSymbolicLink() || await readFile(linkedTarget, 'utf8') !== 'const linked = 2\n') {
    throw new Error('Safe save replaced an internal symlink instead of its workspace target')
  }

  const outsideTarget = join(outside, 'outside.ts')
  await writeFile(outsideTarget, 'const outside = 1\n', 'utf8')
  await symlink(outsideTarget, join(root, 'outside-link.ts'))
  let outsideRejected = false
  try { await saveEditorFileSafely(root, 'outside-link.ts', 'const outside = 2\n', 'const outside = 1\n') } catch { outsideRejected = true }
  if (!outsideRejected || await readFile(outsideTarget, 'utf8') !== 'const outside = 1\n') {
    throw new Error('Safe save followed a symbolic link outside the workspace')
  }

  console.log('Editor durable atomic save/external-conflict/mode smoke passed')
} finally {
  await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
}
