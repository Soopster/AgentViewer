// Live check: a permission asked by an OpenCode SUBAGENT reaches the chat's
// turn stream, and answering it from there lets the turn finish.
//
// A subagent runs in a child session, so its ask arrives under the child's id.
// Before the harness forwarded requests to ancestors, the chat's stream never
// saw it and a reply keyed by the chat's id failed, so the turn hung with
// nothing on screen to answer. Needs a working `opencode` with model
// credentials; reports SKIP without one.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

try {
  execFileSync('opencode', ['--version'], { stdio: 'ignore' })
} catch {
  console.log('SKIP opencode subagent permission smoke: no opencode on PATH')
  process.exit(0)
}

const dir = mkdtempSync(path.join(tmpdir(), 'agent-viewer-oc-subagent-'))
execFileSync('git', ['init', '-q'], { cwd: dir })
writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', permission: { bash: 'ask' } }))
process.chdir(dir)

const { createNewViewSession, runViewSessionAction, streamViewSessionTurn } = await import('../lib/sessionBackend')

const created = await createNewViewSession({ provider: 'opencode', cwd: dir })
const controller = new AbortController()
const response = await streamViewSessionTurn({
  sessionId: created.sessionId,
  signal: controller.signal,
  provider: 'opencode',
  body: {
    message: 'Use the task tool to launch a general subagent whose only job is to run the bash command `echo hello-from-subagent` and report its output. Do not run bash yourself.',
    cwd: dir,
  },
})
assert.equal(response.status, 200)

let raw = ''
let answered: string | null = null
let chatSessionId = created.sessionId
const reader = response.body!.getReader()
const decoder = new TextDecoder()
const deadline = Date.now() + 150_000
let ended = false
while (Date.now() < deadline) {
  const next = await Promise.race([
    reader.read(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()))),
  ])
  if (!next) break
  if (next.done) { ended = true; break }
  raw += decoder.decode(next.value, { stream: true })
  const accepted = raw.match(/"sessionId":"(ses_[A-Za-z0-9]+)"/)
  if (accepted) chatSessionId = accepted[1]!
  if (!answered) {
    const ask = raw.match(/"type":"permission\.updated","properties":\{"id":"([^"]+)"[^}]*"sessionID":"([^"]+)"/)
    if (ask) {
      answered = ask[1]!
      assert.notEqual(ask[2], chatSessionId, 'the ask came from the subagent, not the chat — otherwise this proves nothing')
      await runViewSessionAction({ sessionId: chatSessionId, provider: 'opencode', body: { action: 'respondPermission', permissionId: answered, response: 'once' } })
    }
  }
}
controller.abort()

assert.ok(answered, `the subagent's permission ask never reached the chat's stream:\n${raw.slice(-1500)}`)
assert.ok(ended, `the turn did not finish after the subagent's permission was answered:\n${raw.slice(-1500)}`)
assert.ok(raw.includes('permission.replied'), 'the answer was not acknowledged by OpenCode')
console.log('OpenCode subagent permission smoke passed')
process.exit(0)
