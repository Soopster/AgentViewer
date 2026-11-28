// Tool noise and turn overview: shell wrappers, result rows, sub-agent records,
// the turn digest, the outline's keys and the "since you left" divider.
import assert from 'node:assert/strict'
import { mapCodexThreadToMessages, unwrapCodexShellCommand } from '../../lib/codexMapper'
import { buildThreadedMessages } from '../../lib/threading'
import type { CodexThread, CodexThreadItem } from '../../lib/codexProtocol'
import { formatTranscriptCards } from '../format'
import { hidesOkRow, renderedBodyLines } from './app/transcriptRows'
import { latestTurnSubagents, mergeSubagentCards } from './app/subagentCards'
import { turnDigest, turnDigestText } from './app/turnDigest'
import { handleTurnOutlineKey, openTurnOutline, turnOutlineRows } from './app/turnOutline'
import { sinceYouLeft } from './app/useSinceYouLeft'

// ── the shell wrapper ──
const long = `git diff -- ${'a/very/long/path '.repeat(30)}`.trim()
assert.equal(unwrapCodexShellCommand(`/bin/zsh -lc '${long}'`), long)
assert.equal(unwrapCodexShellCommand(`/bin/zsh -lc "tail -8 a.log; rg -n 'x|y' \\"b c\\""`), `tail -8 a.log; rg -n 'x|y' "b c"`)
assert.equal(unwrapCodexShellCommand(`bash -lc 'echo '\\''hi'\\'''`), `echo 'hi'`)
assert.equal(unwrapCodexShellCommand('sh -c ls'), 'ls')
for (const untouched of [`zsh -lc 'a' && rm b`, `python -c 'print(1)'`, `zsh -lc a b`, 'git status']) assert.equal(unwrapCodexShellCommand(untouched), untouched)

// ── a Codex turn ──
const command = (id: string, text: string, output: string, exitCode: number, durationMs: number) => ({
  type: 'commandExecution', id, command: `/bin/zsh -lc '${text}'`, cwd: '/repo', status: exitCode ? 'failed' : 'completed',
  aggregatedOutput: output, exitCode, durationMs, source: 'agent', commandActions: [], processId: null,
}) as unknown as CodexThreadItem
const agent = (id: string, name: string, kind: string) => ({ type: 'subAgentActivity', id, kind, agentThreadId: `thread-${name}`, agentPath: `/root/${name}` }) as unknown as CodexThreadItem
const prompt = (id: string, text: string) => ({ type: 'userMessage', id, content: [{ type: 'text', text }] }) as unknown as CodexThreadItem
const thread = {
  id: 't', createdAt: 1_700_000_000, updatedAt: 1_700_000_100, status: { type: 'idle' }, cwd: '/repo', preview: 'go', path: '/x',
  turns: [{ id: 'turn', status: 'completed', startedAt: 1_700_000_000, items: [
    prompt('u1', 'go'), command('c1', 'ls', 'a.txt', 0, 12_000), command('c2', 'false', '', 1, 9996),
    agent('s1', 'task_plugin', 'interacted'), agent('s2', 'bridge_plugin', 'interacted'), agent('s3', 'task_plugin', 'completed'),
  ] }],
} as unknown as CodexThread
const cards = formatTranscriptCards(buildThreadedMessages(mapCodexThreadToMessages(thread)))
const text = cards.flatMap(card => card.expandedLines.map(line => line.text)).join('\n')
assert(!text.includes('zsh -lc') && !text.includes('exit_code') && !text.includes('duration_ms'), text)
assert(!text.includes('thread-task_plugin'), 'a sub-agent row showed its thread id')

const ok = cards.find(card => card.lines.some(line => line.text.includes('$ ls')))!
const okBody = renderedBodyLines(ok, true, 8)
assert(!okBody.some(line => line.text === '✓ OK'), 'a plain success kept its OK row')
assert(okBody.some(line => line.text === 'a.txt'))
assert(hidesOkRow(ok, okBody))
const failed = cards.find(card => card.lines.some(line => line.text.includes('$ false')))!
assert(failed.expandedLines.some(line => line.tone === 'result_error' && line.text === '✗ exit 1 · 10.0s · no output'), text)
assert(failed.lines.some(line => line.tone === 'result_error' && line.text.startsWith('✗ exit 1')))

// ── sub-agents ──
const merged = mergeSubagentCards(cards)
assert.equal(merged.length, cards.length - 2)
assert.deepEqual(merged.at(-1)!.lines.map(line => line.text), ['⤷ task_plugin completed', '⤷ bridge_plugin interacted'])
assert.equal(mergeSubagentCards(cards).at(-1), merged.at(-1), 'an unchanged run was rebuilt')
assert.equal(mergeSubagentCards(merged), merged)
assert.deepEqual(latestTurnSubagents(merged, true).map(entry => [entry.name, entry.state]), [['task_plugin', 'completed'], ['bridge_plugin', 'running']])
assert.deepEqual(latestTurnSubagents(merged, false).map(entry => entry.state), ['completed', 'unknown'])

// ── digest and outline ──
const digest = turnDigest(merged, 0, merged.length, 90_000)
assert.equal(digest.calls, 2, 'sub-agent records are not tool calls')
assert.equal(digest.failures, 1)
assert.equal(digest.firstFailureKey, failed.key)
assert(turnDigestText(digest)!.includes('2 tool calls · 1 failed'))

const twoTurns = [...merged, { ...merged[0]!, key: 'u2' }]
const rows = turnOutlineRows(twoTurns, card => card.lines[0]?.text ?? '')
assert.deepEqual(rows.map(row => [row.number, row.failed]), [[1, true], [2, false]])
const jumps: string[] = []
openTurnOutline({ owner: 'w', rows, index: 1, partial: false, onJump: key => jumps.push(key) })
assert(handleTurnOutlineKey({ name: 'up' }))
assert(handleTurnOutlineKey({ name: 'x' }), 'an open outline let a key through')
assert(handleTurnOutlineKey({ name: 'return' }))
assert.deepEqual(jumps, [merged[0]!.key])
assert(!handleTurnOutlineKey({ name: 'down' }), 'a closed outline kept the keys')

// ── since you left ──
const at = merged.findIndex(card => card.key === ok.key)
assert.equal(sinceYouLeft(twoTurns, null, 0), null, 'a first visit marked something new')
assert.equal(sinceYouLeft(twoTurns, { cardKey: 'u2', at: Date.now() }, 0), null)
assert.equal(sinceYouLeft(twoTurns, { cardKey: 'gone', at: Date.now() }, 0), null)
const since = sinceYouLeft(twoTurns, { cardKey: merged[at]!.key, at: Date.now() }, 0)!
assert.equal(since.cardKey, merged[at + 1]!.key)
assert.equal(since.label, 'NEW SINCE YOU LEFT · 1 turn · 1 failed')

console.log('turnOverviewSmoke: OK')
process.exit(0)
