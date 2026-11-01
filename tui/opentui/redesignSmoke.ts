import assert from 'node:assert/strict'
import { groupSidebarDates } from './app/sessionList'
import { transcriptMeasure } from './engineeringLayout'
import { resolveExpandedCardKeys, agentToolCardIsExpanded } from './app/transcriptRows'
import type { SidebarEntry } from './app/types'
import type { TuiTranscriptCard } from '../format'
const now = new Date(2026, 10, 1, 12)
const entries: SidebarEntry[] = [{ type: 'project', key: 'project:test', projectName: 'test', count: 3 }, ...[0, 1, 5].map(days => ({ type: 'session' as const, key: `s${days}`, absoluteIndex: days, session: { sessionId: `s${days}`, provider: 'codex' as const, cwd: '/tmp', lastModified: new Date(2026, 10, 1 - days, 10).getTime() } }))]
const grouped = groupSidebarDates(entries, new Set(), now)
assert.deepEqual(grouped.filter(e => e.type === 'project').map(e => e.projectName), ['test', 'Today', 'Yesterday', 'Older'])
assert.equal(grouped.filter(e => e.type === 'session').length, 3)
const folded = groupSidebarDates(entries, new Set(['project:test:date:Older']), now)
assert.equal(folded.filter(e => e.type === 'session').length, 2)
assert.equal(entries.length, 4)
assert.equal(transcriptMeasure(200, 'readable'), 104)
assert.equal(transcriptMeasure(70, 'readable'), 70)
assert.equal(transcriptMeasure(200, 'full'), 200)
const card = { key: 'activity', autoFold: true, thinkingTranscript: true } as TuiTranscriptCard
assert(resolveExpandedCardKeys([card], 'conversation', false, new Set(), new Set()).has(card.key))
assert(!resolveExpandedCardKeys([card], 'conversation', false, new Set(), new Set([card.key])).has(card.key))
assert(agentToolCardIsExpanded(card, new Set(), new Set()))
console.log('Redesign rules passed: calendar grouping, folding, reading width, expanded activity defaults.')
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
