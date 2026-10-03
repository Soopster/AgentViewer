// Live check: an approval asked by a Codex SUB-AGENT (a thread the chat's turn
// spawned with spawn_agent) reaches the chat's stream, and approving it there
// lets the command run.
//
// A sub-agent asks under its own thread id. Before the client learned thread
// parentage, the chat's turn did not claim that request, it fell through to
// the "method not supported" reply, and Codex refused the command without the
// user ever being asked. Needs a working `codex` with credentials; reports
// SKIP without one.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

try {
  execFileSync('codex', ['--version'], { stdio: 'ignore' })
} catch {
  console.log('SKIP codex sub-agent approval smoke: no codex on PATH')
  process.exit(0)
}

const dir = mkdtempSync(path.join(tmpdir(), 'agent-viewer-codex-subagent-'))
execFileSync('git', ['init', '-q'], { cwd: dir })
process.chdir(dir)

const { createNewViewSession, runViewSessionAction, streamViewSessionTurn } = await import('../lib/sessionBackend')

const created = await createNewViewSession({ provider: 'codex', cwd: dir })
let chatThreadId = created.sessionId
const controller = new AbortController()
const response = await streamViewSessionTurn({
  sessionId: chatThreadId,
  signal: controller.signal,
  provider: 'codex',
  body: {
    message: 'Spawn exactly one sub-agent (with your spawn_agent tool) whose only job is to run the shell command `touch made-by-subagent.txt` and report back. Do not run any command yourself. Wait for it to finish.',
    cwd: dir,
    approvalPolicy: 'untrusted',
  },
})
assert.equal(response.status, 200)

const approvals: Array<{ requestId: string; threadId: string }> = []
let raw = ''
const reader = response.body!.getReader()
const decoder = new TextDecoder()
const deadline = Date.now() + 240_000
while (Date.now() < deadline) {
  const next = await Promise.race([
    reader.read(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()))),
  ])
  if (!next || next.done) break
  raw += decoder.decode(next.value, { stream: true })
  const accepted = raw.match(/"sessionId":"([0-9a-f-]{36})"/)
  if (accepted) chatThreadId = accepted[1]!
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ') || !line.includes('"codex_approval"')) continue
    const frame = JSON.parse(line.slice(6)) as { event?: { type?: string; requestId?: string; params?: { threadId?: string } } }
    const requestId = frame.event?.requestId
    if (frame.event?.type !== 'approval.requested' || !requestId || approvals.some((entry) => entry.requestId === requestId)) continue
    approvals.push({ requestId, threadId: frame.event.params?.threadId ?? '' })
    await runViewSessionAction({ sessionId: chatThreadId, provider: 'codex', body: { action: 'respondPermission', permissionId: requestId, response: 'once' } })
  }
}
controller.abort()

assert.ok(approvals.length > 0, `the sub-agent's approval never reached the chat's stream:\n${raw.slice(-1500)}`)
assert.ok(approvals.some((entry) => entry.threadId && entry.threadId !== chatThreadId),
  'no approval came from a sub-agent thread — the model ran the command itself, so this run proves nothing')
assert.ok(existsSync(path.join(dir, 'made-by-subagent.txt')), 'the approved sub-agent command did not run')
console.log('Codex sub-agent approval smoke passed')
process.exit(0)
