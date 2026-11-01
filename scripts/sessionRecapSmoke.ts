// Pins the session recap pieces that fail silently: what the prompt keeps and
// drops, how model output is normalized, when a stored recap stops being shown,
// and that a write from another process reaches this one's cached reader.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type { SessionMessage } from '../lib/types'

const failures: string[] = []
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures.push(detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`)
}

const dir = mkdtempSync(path.join(tmpdir(), 'recap-smoke-'))
process.chdir(dir)

const {
  buildRecapPrompt, isSessionRecapFresh, parseSessionRecapOutput, recapTurns, sanitizeSessionRecap, sessionRecapKey,
} = await import('../lib/sessionRecap')
const store = await import('../lib/sessionRecapStore')

function msg(type: 'user' | 'assistant', content: unknown, n: number): SessionMessage {
  return { type, uuid: `u${n}`, session_id: 's', message: { role: type, content }, parent_tool_use_id: null } as unknown as SessionMessage
}
const text = (t: string) => [{ type: 'text', text: t }]

// ── prompt ───────────────────────────────────────────────────────────────────
const transcript: SessionMessage[] = [
  msg('user', text('first ask'), 1), msg('assistant', text('first answer'), 2),
  msg('user', text('second ask'), 3),
  msg('assistant', [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'SECRET_TOOL_PAYLOAD' } }], 4),
  msg('user', [{ type: 'tool_result', tool_use_id: 't', content: 'SECRET_TOOL_RESULT' }], 5),
  msg('assistant', text('second answer'), 6),
  msg('user', text('[goal] automated continuation'), 7),
  msg('user', text('third ask'), 8), msg('assistant', text('third answer'), 9),
  msg('user', text('fourth ask'), 10), msg('assistant', text('fourth answer'), 11),
]
const turns = recapTurns(transcript)
check('keeps the last three user turns', turns.length === 3 && turns[0].user === 'second ask', turns)
check('assistant text attaches to its own turn', turns[0].assistant === 'second answer', turns[0])
const prompt = buildRecapPrompt(transcript) ?? ''
check('prompt omits tool payloads', !prompt.includes('SECRET_TOOL'))
check('prompt omits goal continuations', !prompt.includes('automated continuation'))
check('prompt omits the turn before the window', !prompt.includes('first ask'))
check('no prompt for an empty transcript', buildRecapPrompt([]) === null)

const huge = 'x'.repeat(40_000)
const bigPrompt = buildRecapPrompt([
  msg('user', text(`old ${huge}`), 1), msg('assistant', text(huge), 2),
  msg('user', text('newest ask'), 3), msg('assistant', text('newest answer'), 4),
]) ?? ''
check('budget drops the oldest turn first', bigPrompt.includes('newest ask') && !bigPrompt.includes('old x'), bigPrompt.length)

// ── output normalization ─────────────────────────────────────────────────────
const now = new Date('2026-11-01T00:00:00Z')
const parsed = parseSessionRecapOutput({ recap: '  Fixed   the\nlogin bug ', suggestion: ' Run the tests ' }, now)
check('collapses whitespace and trims', parsed?.text === 'Fixed the login bug' && parsed.suggestion === 'Run the tests', parsed)
check('empty suggestion is absent', parseSessionRecapOutput({ recap: 'Done', suggestion: '' }, now)?.suggestion === undefined)
check('no recap text is unusable', parseSessionRecapOutput({ suggestion: 'x' }, now) === null)
check('non-object is unusable', parseSessionRecapOutput('nope', now) === null)
check('rejects a recap with no timestamp', sanitizeSessionRecap({ text: 'x' }) === null)

// ── freshness ────────────────────────────────────────────────────────────────
const recap = { text: 'x', at: '2026-11-01T00:01:00Z' }
const at = Date.parse(recap.at)
check('fresh when the transcript predates the recap', isSessionRecapFresh(recap, at - 1))
check('stale once the transcript moved on', !isSessionRecapFresh(recap, at + 1))
check('missing recap is not fresh', !isSessionRecapFresh(null, at))

// ── store, across processes ──────────────────────────────────────────────────
const target = { provider: 'claude' as const, sessionId: 'abc' }
check('off by default', (await store.readSessionRecapsEnabled()) === false)
await store.writeSessionRecap(target, { text: 'first', at: '2026-11-01T00:00:00Z' })
check('round trip', (await store.readSessionRecap(target))?.text === 'first')

const childScript = path.join(dir, 'child.ts')
writeFileSync(childScript, `
  import * as store from ${JSON.stringify(new URL('../lib/sessionRecapStore.ts', import.meta.url).pathname)}
  await store.writeSessionRecap({ provider: 'claude', sessionId: 'abc' }, { text: 'from child', at: '2026-11-01T00:02:00Z' })
  await store.setSessionRecapsEnabled(true)
`)
const child = spawnSync(process.execPath, [childScript], { cwd: dir, encoding: 'utf8' })
check('child process ran', child.status === 0, child.stderr)
check('sees another process\'s write', (await store.readSessionRecap(target))?.text === 'from child')
check('sees another process\'s switch', (await store.readSessionRecapsEnabled()) === true)

// Keys are scoped by account.
check('instance scopes the key', sessionRecapKey('claude', 'work', 'abc') !== sessionRecapKey('claude', undefined, 'abc'))
check('default instance equals the provider', sessionRecapKey('claude', 'claude', 'abc') === sessionRecapKey('claude', undefined, 'abc'))

// Oldest recaps are evicted past the cap.
for (let i = 0; i < 505; i += 1) {
  await store.writeSessionRecap({ provider: 'codex', sessionId: `s${i}` }, { text: 'r', at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString() })
}
const all = await store.readSessionRecaps()
check('cap holds', Object.keys(all).length === 500, Object.keys(all).length)
check('eviction removes the oldest', !(sessionRecapKey('codex', undefined, 's0') in all) && sessionRecapKey('codex', undefined, 's504') in all)

rmSync(dir, { recursive: true, force: true })
if (failures.length) {
  console.error(`Session recap smoke: FAIL\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log('Session recap smoke: PASS')
process.exit(0)
