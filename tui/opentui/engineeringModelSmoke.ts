import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../../lib/git/command'
import { ENGINEERING_DEFAULTS, engineeringGeometry, engineeringFocusMode, engineeringSessionTitle, engineeringSelectedFile, engineeringFileEvidence, engineeringHandoff, engineeringSessionFiles, engineeringSessionInRepo } from './engineering/model'
import { createEngineeringRepositoryClient } from './engineeringRepositoryWorkerClient'
import { readEngineeringRepository } from './engineering/repository'
import type { TuiTranscriptCard } from '../format'

assert.equal(engineeringGeometry(80, 24, ENGINEERING_DEFAULTS).inspectorWidth, 0)
assert.equal(engineeringGeometry(200, 40, ENGINEERING_DEFAULTS).inspectorWidth, 48)
assert.equal(engineeringGeometry(200, 40, { ...ENGINEERING_DEFAULTS, focusMode: true }).inspectorWidth, 0)
assert.equal(engineeringGeometry(80, 24, { ...ENGINEERING_DEFAULTS, drawerOpen: true }).drawerRows, 0)
assert.equal(engineeringFocusMode(ENGINEERING_DEFAULTS), false)
for (const preset of ['build', 'review', 'multi-agent'] as const) {
  assert.deepEqual(engineeringGeometry(200, 40, { ...ENGINEERING_DEFAULTS, preset }), engineeringGeometry(200, 40, ENGINEERING_DEFAULTS), 'Old workspace modes share one layout')
}
assert.equal(engineeringFocusMode({ ...ENGINEERING_DEFAULTS, focusMode: undefined, preset: 'focus' }), true, 'Old Focus preference remains readable')
{
  const cards = [{ key: 'd', fileEdits: [{ path: '/repo/src/a.ts' }, { path: './b.ts' }] }] as unknown as TuiTranscriptCard[]
  assert.deepEqual([...engineeringSessionFiles(cards, '/repo/')], ['src/a.ts', 'b.ts'])
  assert.ok(engineeringSessionInRepo({ sessionId: 's', cwd: '/repo/sub' } as never, '/repo'))
  assert.ok(!engineeringSessionInRepo({ sessionId: 's', cwd: '/repository' } as never, '/repo'))
}
const changedFiles = [{ path: 'a.ts' }, { path: 'b.ts' }]
assert.equal(engineeringSelectedFile(changedFiles, null)?.path, 'a.ts', 'First changed file previews automatically')
assert.equal(engineeringSelectedFile(changedFiles, 'b.ts')?.path, 'b.ts', 'Keep an explicit selection through a refresh')
assert.equal(engineeringSelectedFile(changedFiles.slice(0, 1), 'b.ts')?.path, 'a.ts', 'Fall back when the selected change disappears')
assert.equal(engineeringSelectedFile([], 'a.ts'), null, 'A clean repository has no preview selection')
assert.equal(engineeringSessionTitle({ sessionId: 'a', summary: '/goal', firstPrompt: 'Fix reconnect', lastModified: 0 }), 'Fix reconnect')
const edit: TuiTranscriptCard = { key: 'edit-source', role: 'assistant', label: 'Edit', category: 'diff', autoFold: true, compactSummary: 'Edited a.ts', lines: [], expandedLines: [], searchText: '', searchHaystackLower: '', fileEdits: [{ path: '/repo/a.ts', added: 1, removed: 0 }] }
assert.deepEqual(engineeringFileEvidence([edit], 'a.ts', '/repo').map(card => card.key), ['edit-source'])
assert.deepEqual(engineeringFileEvidence([{ ...edit, category: 'technical' }], 'a.ts', '/repo'), [], 'Shell summaries must not establish edit provenance')
const handoff = engineeringHandoff({ title: 'Fix reconnect', identity: 'codex:instance-b:session-a', cwd: '/repo', cards: [], files: [], checks: [], attention: [] })
assert.match(handoff, /codex:instance-b:session-a/)
assert.match(handoff, /No application-recorded checks/)

const cwd = await mkdtemp(join(tmpdir(), 'engineering-model-'))
try {
  await git(cwd, ['init', '-q'])
  await writeFile(join(cwd, 'a.ts'), 'before\n')
  await git(cwd, ['add', '--', 'a.ts'])
  await git(cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'])
  await writeFile(join(cwd, 'a.ts'), 'after\n')
  const first = await readEngineeringRepository(cwd)
  assert.equal(first.files[0]?.path, 'a.ts')
  assert.equal(first.files[0]?.additions, '1')
  await writeFile(join(cwd, 'a.ts'), 'another change\n')
  const changed = await readEngineeringRepository(cwd)
  assert.notEqual(first.fingerprint, changed.fingerprint, 'Same-status edits invalidate checks')
  await git(cwd, ['add', '--', 'a.ts'])
  assert.notEqual(changed.fingerprint, (await readEngineeringRepository(cwd)).fingerprint, 'Index changes invalidate checks')
  await mkdir(join(cwd, 'new directory'))
  const unusual = 'new directory/file\twith\nseparators.ts'
  await writeFile(join(cwd, unusual), 'untracked\n')
  const untracked = await readEngineeringRepository(cwd)
  assert.ok(untracked.files.some(file => file.path === unusual), 'NUL porcelain preserves unusual paths')
  await writeFile(join(cwd, unusual), 'updated untracked\n')
  assert.notEqual(untracked.fingerprint, (await readEngineeringRepository(cwd)).fingerprint, 'Untracked contents invalidate checks')
  await git(cwd, ['mv', '--', 'a.ts', 'renamed file.ts'])
  assert.ok((await readEngineeringRepository(cwd)).files.some(file => file.path === 'renamed file.ts'))
  const client = createEngineeringRepositoryClient()
  try {
    const fromWorker = await client.read(cwd)
    assert.deepEqual(fromWorker, await readEngineeringRepository(cwd), 'Worker returns the same repository state')
    const pending = client.read(cwd)
    client.dispose()
    await assert.rejects(pending, /observer closed/, 'Leaving the view cancels its pending observer')
  } finally { client.dispose() }
  await assert.rejects(readEngineeringRepository(tmpdir()), /git repository/)
} finally { await rm(cwd, { recursive: true, force: true }) }
console.log('Engineering geometry, evidence, handoff, working-state and unusual-path smoke passed')
