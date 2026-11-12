import assert from 'node:assert/strict'
import { groupSidebarDates, liftNeedsInput, mergeCoordinatorGroups } from './app/sessionList'
import { transcriptMeasure } from './engineeringLayout'
import { resolveExpandedCardKeys } from './app/transcriptRows'
import type { SidebarEntry } from './app/types'
import type { TuiTranscriptCard } from '../format'
const now = new Date(2026, 10, 1, 12)
const entries: SidebarEntry[] = [{ type: 'project', key: 'project:test', projectName: 'test', count: 3 }, ...[0, 1, 5].map(days => ({ type: 'session' as const, key: `s${days}`, absoluteIndex: days, session: { sessionId: `s${days}`, provider: 'codex' as const, cwd: '/tmp', lastModified: new Date(2026, 10, 1 - days, 10).getTime() } }))]
const grouped = groupSidebarDates(entries, new Set(), now)
assert.deepEqual(grouped.filter(e => e.type === 'project').map(e => e.projectName), ['test', 'Today', 'Yesterday', 'This week'])
assert.equal(grouped.filter(e => e.type === 'session').length, 3)
const folded = groupSidebarDates(entries, new Set(['project:test:date:This week']), now)
assert.equal(folded.filter(e => e.type === 'session').length, 2)
assert.equal(entries.length, 4)
const sess = (id: string): SidebarEntry => ({ type: 'session', key: id, absoluteIndex: 0, session: { sessionId: id, provider: 'codex' as const, cwd: '/tmp', lastModified: 1 } })
const mergedCoord = mergeCoordinatorGroups([
  { type: 'project', key: 'project:COORD-ORION', projectName: 'COORD-ORION', count: 1 }, sess('c1'),
  { type: 'project', key: 'project:app', projectName: 'APP', count: 1 }, sess('a1'),
  { type: 'project', key: 'project:COORD-NOVA', projectName: 'COORD-NOVA', count: 2 }, sess('c2'), sess('c3'),
])
assert.deepEqual(mergedCoord.map(e => e.type === 'project' ? `${e.projectName}/${e.count}` : e.key), ['APP/1', 'a1', 'COORDINATOR RUNS/3', 'c1', 'c2', 'c3'], 'coordinator projects share one trailing group')
assert.equal(groupSidebarDates(mergedCoord, new Set(), now).filter(e => e.type === 'session').length, 1, 'the merged group starts folded')
const lifted = liftNeedsInput(entries, session => session.sessionId === 's1')
assert.deepEqual(lifted.map(e => e.type === 'project' ? `${e.projectName}/${e.count}` : e.key), ['NEEDS YOU/1', 's1', 'test/2', 's0', 's5'], 'a waiting session moves to its own group, once')
assert.deepEqual(liftNeedsInput(entries, () => false), entries, 'nothing waiting leaves the list alone')
assert.deepEqual(liftNeedsInput(entries, () => true).map(e => e.type), ['project', 'session', 'session', 'session'], 'an emptied project loses its header')
const coordHeader = { type: 'project' as const, key: 'project:COORD-ORION', projectName: 'COORD-ORION', count: 3 }
const coordEntries: SidebarEntry[] = [coordHeader, ...entries.slice(1)]
const coordFolded = groupSidebarDates(coordEntries, new Set(), now)
assert.deepEqual(coordFolded.map(e => e.type), ['project'], 'coordinator groups start folded')
assert.equal(coordFolded[0].type === 'project' && coordFolded[0].collapsed, true)
const coordOpen = groupSidebarDates(coordEntries, new Set([coordHeader.key]), now)
assert.equal(coordOpen.filter(e => e.type === 'session').length, 3, 'a toggle opens a coordinator group')
assert.equal(groupSidebarDates(entries, new Set(['project:test']), now).filter(e => e.type === 'session').length, 0, 'a toggle folds an ordinary group')
assert.equal(transcriptMeasure(200, 'readable'), 104)
assert.equal(transcriptMeasure(70, 'readable'), 70)
assert.equal(transcriptMeasure(200, 'full'), 200)
const card = { key: 'activity', autoFold: true, thinkingTranscript: true, lines: [] } as unknown as TuiTranscriptCard
// Tool and thinking cards start folded; the reader opens them.
assert(!resolveExpandedCardKeys([card], 'conversation', false, new Set(), new Set()).has(card.key))
assert(resolveExpandedCardKeys([card], 'conversation', false, new Set([card.key]), new Set()).has(card.key))
console.log('Redesign rules passed: calendar grouping, folding, reading width, folded activity defaults.')
const { foldTurnActivity } = await import('./app/turnActivity')
const prompt = { key: 'prompt', role: 'user', timestampMs: 1000, lines: [], searchText: '' } as unknown as TuiTranscriptCard
const tool = { ...card, thinkingTranscript: undefined, category: 'technical', lines: [{ text: 'ran', tone: 'tool' }], timestampMs: 2000 } as TuiTranscriptCard
const failure = { ...tool, key: 'failure', lines: [{ text: 'failed', tone: 'result_error' }] } as TuiTranscriptCard
const answer = { ...tool, key: 'answer', category: 'conversation', lines: [{ text: 'Answer', tone: 'default' }], timestampMs: 3000 } as TuiTranscriptCard
const turn = [prompt, tool, failure, answer]
assert.equal(foldTurnActivity(turn, new Set(), false), turn)
const foldedTurn = foldTurnActivity(turn, new Set(['prompt']), false)
assert.deepEqual(foldedTurn.map(card => card.key), ['prompt', 'activity-summary:prompt', 'failure', 'answer'])
assert(foldedTurn[1].compactSummary.includes('2 tool calls'))
assert.deepEqual(foldTurnActivity(turn, new Set(['prompt']), true), turn)
console.log('Turn folding passed: answers and failures retained, active turns never folded.')
{
  // The date buckets both rails use: a month of sessions no longer lands in one 30-row group.
  const { sidebarDateBucket } = await import('../../lib/sessionSidebarModel')
  const at = (days: number) => new Date(2026, 10, 20 - days, 10).getTime()
  const today = new Date(2026, 10, 20, 12)
  assert.deepEqual([0, 1, 4, 6, 7, 13, 14, 29, 30].map((days) => sidebarDateBucket(at(days), today)),
    ['Today', 'Yesterday', 'This week', 'This week', 'Last week', 'Last week', 'This month', 'This month', 'Older'])
}
{
  // This month and Older start folded; a toggle opens them (the key flips the default).
  const now = new Date(2026, 10, 30, 12)
  const old: SidebarEntry[] = [{ type: 'project', key: 'project:p', projectName: 'p', count: 2 }, ...[1, 20].map(days => ({ type: 'session' as const, key: `o${days}`, absoluteIndex: days, session: { sessionId: `o${days}`, provider: 'codex' as const, cwd: '/tmp', lastModified: new Date(2026, 10, 30 - days, 10).getTime() } }))]
  const folded = groupSidebarDates(old, new Set(), now)
  assert.ok(folded.some(e => e.type === 'project' && e.projectName === 'This month' && e.collapsed), 'This month starts folded')
  assert.ok(!folded.some(e => e.type === 'session' && e.key === 'o20'), 'a folded bucket hides its sessions')
  assert.ok(folded.some(e => e.type === 'session' && e.key === 'o1'), 'Yesterday stays open')
  const opened = groupSidebarDates(old, new Set(['project:p:date:This month']), now)
  assert.ok(opened.some(e => e.type === 'session' && e.key === 'o20'), 'a toggle opens This month')
}
