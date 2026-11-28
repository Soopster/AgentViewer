import assert from 'node:assert/strict'
import type { TuiTranscriptCard } from '../format'
import type { ManagedProcess } from './processStore'
import { addProcess, removeProcess } from './processStore'
import {
  acknowledgeWorkSnapshot, checkVerification, compareWorkSnapshots, completedCheckResult, editTaskBrief,
  emptyTaskBrief, ENGINEERING_RUNTIME_ID, findCheckProcess, indexChangeEvidence, taskBriefMarkdown,
  workRelativePath, workSnapshot, type EngineeringCheck,
} from './engineering/workbenchModel'

let brief = editTaskBrief(emptyTaskBrief(), 'criteria', '- Handles retry\n- Handles retry\n* Keeps evidence', 1)
assert.equal(new Set(brief.criteria.map(item => item.id)).size, 3, 'Identical criteria remain distinct')
const first = brief.criteria[0]!
brief = { ...brief, criteria: brief.criteria.map(item => item.id === first.id ? { ...item, review: 'accepted' } : item), evidence: [{ id: 'pin', criterionId: first.id, session: { key: 'claude:one', title: 'Source' }, cardKey: 'edit', preview: 'Recorded edit', files: ['a.ts'] }] }
const reordered = editTaskBrief(brief, 'criteria', 'Keeps evidence\nHandles retry\nHandles retry', 2)
assert.equal(reordered.criteria[1]?.id, first.id)
assert.equal(reordered.criteria[1]?.review, 'accepted')
assert.equal(reordered.evidence.length, 1)
const replaced = editTaskBrief(brief, 'criteria', 'A different requirement', 3)
assert.equal(replaced.criteria[0]?.review, 'pending', 'Rewording a requirement does not inherit acceptance')
assert.equal(replaced.evidence.length, 0, 'Removed requirements do not leave evidence attached to unrelated criteria')
assert.equal(editTaskBrief(brief, 'title', 'One\n task').title, 'One task')
assert.match(taskBriefMarkdown(brief), /manual review decisions/)
assert.match(taskBriefMarkdown(brief), /claude:one \/ edit/)

const card = (key: string, role: 'user' | 'assistant', path?: string): TuiTranscriptCard => ({
  key, role, category: path ? 'technical' : 'conversation', label: key, compactSummary: 'Identical text', autoFold: false,
  lines: [], expandedLines: [], searchText: '', searchHaystackLower: '',
  ...(path ? { fileEdits: [{ path, added: 1, removed: 0 }] } : {}),
})
const sources = indexChangeEvidence([card('p1', 'user'), card('e1', 'assistant', '/repo/a.ts'), card('r1', 'assistant'), card('p2', 'user'), card('e2', 'assistant', './a.ts'), card('r2', 'assistant')], '/repo')
assert.deepEqual(sources.get('a.ts')?.map(item => [item.request?.key, item.edit.key, item.response?.key]), [['p1', 'e1', 'r1'], ['p2', 'e2', 'r2']])
assert.equal(workRelativePath('/elsewhere/a.ts', '/repo'), null)
assert.equal(workRelativePath('../a.ts', '/repo'), null)
assert.equal(workRelativePath('/repository/a.ts', '/repo'), null, 'A path-prefix sibling is not this repository')
assert.equal(workRelativePath('C:\\repo\\src\\a.ts', 'C:\\repo'), 'src/a.ts')
assert.equal(workRelativePath('D:\\elsewhere\\a.ts', 'C:\\repo'), null)
assert.equal(indexChangeEvidence([{ ...card('pending', 'assistant', 'a.ts'), pending: true }], '/repo').size, 0)

const process: ManagedProcess = { id: 'proc-1', name: 'Check', command: 'check', cwd: '/repo', status: 'exited', exitCode: 0, signal: null, pid: null, startedAt: 10, endedAt: 20, lines: ['passed'], droppedLines: 0 }
const check: EngineeringCheck = { id: 'check-uuid', processId: process.id, runtimeId: ENGINEERING_RUNTIME_ID, command: process.command, cwd: '/repo', fingerprint: 'tree-a', session: null }
assert.equal(findCheckProcess(check, [process])?.id, process.id)
assert.equal(findCheckProcess({ ...check, runtimeId: 'previous-runtime' }, [process]), undefined, 'Restarted process IDs cannot overwrite archived outcomes')
assert.equal(findCheckProcess({ ...check, command: 'different' }, [process]), undefined)
assert.equal(checkVerification(check, process, 'tree-a').state, 'passed')
assert.equal(checkVerification(check, process, 'tree-b').state, 'stale')
assert.equal(checkVerification(check, { ...process, status: 'running', endedAt: null }, 'tree-a').state, 'running')
const archived = { ...check, result: completedCheckResult(process) }
assert.equal(checkVerification(JSON.parse(JSON.stringify(archived)) as EngineeringCheck, undefined, 'tree-a').state, 'passed', 'Serialized observed results survive process disappearance')
assert.equal(checkVerification(check, undefined, 'tree-a').state, 'unavailable', 'Legacy records do not invent a pass')
assert.equal(checkVerification(archived, undefined, null).state, 'stale', 'Unknown current state cannot prove freshness')
assert.equal(completedCheckResult({ ...process, signal: 'SIGTERM' })?.outcome, 'stopped')
assert.equal(completedCheckResult({ ...process, status: 'failed', exitCode: 1 })?.outcome, 'failed')

const repo = { root: '/repo', branch: 'main', fingerprint: 'tree-a', files: [{ path: 'a.ts', status: ' M', additions: '1', deletions: '1', version: 'one' }] }
const before = workSnapshot(repo, [{ key: 'claude:one', title: 'First', version: '1' }], [], [], 1)
const after = workSnapshot({ ...repo, branch: 'feature', files: [{ ...repo.files[0]!, version: 'two' }, { path: 'b.ts', status: '??', additions: '?', deletions: '?', version: 'new' }] }, [{ key: 'codex:one', title: 'Other provider', version: '1' }], [{ id: check.id, verification: checkVerification(archived, undefined, 'tree-a') }], ['question'], 2)
const delta = compareWorkSnapshots(before, after)
assert.deepEqual(delta.files.map(item => item.change), ['updated', 'new'], 'Same-size edits still appear when their filesystem version changes')
assert.equal(delta.sessions[0]?.change, 'newly observed')
assert.equal(delta.branchChanged, true)
assert.equal(compareWorkSnapshots(before, workSnapshot({ ...repo, files: [] }, [], [], [], 3)).files[0]?.change, 'no longer changed')
assert.equal(compareWorkSnapshots(null, after).count, 0, 'A first visit does not claim unseen changes')
const reviewed = acknowledgeWorkSnapshot(before, after)
assert.equal(reviewed.reviewed, true)
assert.ok(reviewed.sessions['claude:one'], 'Acknowledging another provider preserves earlier observations')
assert.equal(compareWorkSnapshots(reviewed, after).count, 0)
assert.equal(before.reviewed, false, 'Reviewing a new snapshot does not mutate the previous checkpoint')

const definition = { name: 'Reuse test', command: 'not-started', cwd: '/repo' }
const shared = addProcess(definition)
assert.equal(addProcess(definition), shared, 'Existing process callers retain deduplication')
const independent = addProcess({ ...definition, reuse: false })
assert.notEqual(independent, shared, 'Repeated verification commands get distinct process identities')
removeProcess(shared); removeProcess(independent)
console.log('Engineering task criteria, source identities, durable verification, catch-up checkpoints and independent runs smoke passed')
