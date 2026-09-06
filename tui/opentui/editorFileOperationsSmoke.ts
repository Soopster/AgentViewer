import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEditorFile, deleteEditorFile, renameEditorFile } from './editorFileOperations'

const root = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-files-'))
const outside = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-outside-'))
try {
  const created = await createEditorFile(root, 'nested/new.ts')
  if (created !== 'nested/new.ts' || await readFile(join(root, created), 'utf8') !== '') throw new Error('Create file failed')
  await writeFile(join(root, created), 'export const safe = true\n', 'utf8')
  const renamed = await renameEditorFile(root, created, 'nested/renamed.ts')
  if (renamed.to !== 'nested/renamed.ts' || !(await readFile(join(root, renamed.to), 'utf8')).includes('safe')) throw new Error('Rename file failed')

  await writeFile(join(root, 'occupied.ts'), 'keep\n', 'utf8')
  let overwriteRejected = false
  try { await renameEditorFile(root, renamed.to, 'occupied.ts') } catch { overwriteRejected = true }
  if (!overwriteRejected || await readFile(join(root, 'occupied.ts'), 'utf8') !== 'keep\n') throw new Error('Rename overwrote an existing file')

  await symlink(outside, join(root, 'escape'))
  let symlinkRejected = false
  try { await createEditorFile(root, 'escape/leak.ts') } catch { symlinkRejected = true }
  if (!symlinkRejected) throw new Error('Create followed a directory symlink outside the workspace')

  let traversalRejected = false
  try { await createEditorFile(root, '../escape.ts') } catch { traversalRejected = true }
  if (!traversalRejected) throw new Error('Create accepted a workspace traversal path')

  const deleted = await deleteEditorFile(root, renamed.to)
  if (deleted !== renamed.to) throw new Error(`Delete returned the wrong path: ${deleted}`)
  let missing = false
  try { await readFile(join(root, deleted), 'utf8') } catch { missing = true }
  if (!missing) throw new Error('Delete left the file on disk')

  console.log('Editor safe create/rename/delete/no-overwrite/symlink smoke passed')
} finally {
  await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
}
