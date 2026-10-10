import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearEditorRecovery,
  editorRecoveryPath,
  readEditorRecovery,
  writeEditorRecovery,
  type EditorRecoverySnapshot,
} from './editorRecovery'

const root = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-recovery-'))
const firstPath = join(root, 'first.ts')
const conflictPath = join(root, 'conflict.ts')

try {
  await writeFile(firstPath, 'const first = 1\n', 'utf8')
  await writeFile(conflictPath, 'const disk = 1\n', 'utf8')
  const snapshot: EditorRecoverySnapshot = {
    version: 1,
    savedAt: Date.now(),
    activePath: 'first.ts',
    cursor: { line: 0, character: 9 },
    buffers: [
      { path: 'first.ts', savedContent: 'const first = 1\n', content: 'const first = 2\n' },
      { path: 'conflict.ts', savedContent: 'const disk = 1\n', content: 'const recovered = 2\n' },
    ],
  }
  await writeEditorRecovery(root, snapshot)
  await writeFile(conflictPath, 'const disk = 3\n', 'utf8')

  const recovery = await readEditorRecovery(root)
  if (recovery.snapshot?.buffers[0]?.content !== 'const first = 2\n'
    || recovery.snapshot.cursor.character !== 9
    || recovery.conflicts[0]?.path !== 'conflict.ts') {
    throw new Error(`Recovery did not separate safe buffers from disk conflicts: ${JSON.stringify(recovery)}`)
  }

  const newer = { ...snapshot, savedAt: snapshot.savedAt + 1, buffers: [snapshot.buffers[0]!] }
  await Promise.all([writeEditorRecovery(root, snapshot), writeEditorRecovery(root, newer)])
  const latest = JSON.parse(await readFile(editorRecoveryPath(root), 'utf8')) as EditorRecoverySnapshot
  if (latest.savedAt !== newer.savedAt || latest.buffers.length !== 1) {
    throw new Error(`Queued atomic recovery writes did not preserve the latest snapshot: ${JSON.stringify(latest)}`)
  }

  await clearEditorRecovery(root)
  const cleared = await readEditorRecovery(root)
  if (cleared.snapshot || cleared.conflicts.length) throw new Error('Clearing recovery left a readable snapshot')

  await writeFile(firstPath, 'const first = 1\r\n', 'utf8')
  await writeEditorRecovery(root, {
    ...snapshot,
    buffers: [{ ...snapshot.buffers[0]!, lineEnding: '\r\n' }],
  })
  const crlf = await readEditorRecovery(root)
  if (crlf.conflicts.length || crlf.snapshot?.buffers[0]?.lineEnding !== '\r\n'
    || crlf.snapshot.buffers[0]?.content !== 'const first = 2\n') {
    throw new Error('Unchanged CRLF file must recover with its original line ending')
  }
  await writeFile(firstPath, 'const first = 9\r\n', 'utf8')
  const changedCrlf = await readEditorRecovery(root)
  if (changedCrlf.snapshot || changedCrlf.conflicts.length !== 1) {
    throw new Error('Changed CRLF file must still report a recovery conflict')
  }

  console.log('Editor atomic recovery/restore/conflict/clear smoke passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
