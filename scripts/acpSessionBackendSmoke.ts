// Phase 6 E2E smoke: exercises lib/sessionBackend.ts's claude-acp/codex-acp
// branches end to end — create, send, poll messages, interrupt, close — and
// confirms no orphaned subprocess survives closeViewSession.
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import {
  closeViewSession,
  createNewViewSession,
  listViewSessionMessageWindow,
  streamViewSessionTurn,
} from '../lib/sessionBackend'

function psCount(pattern: string): number {
  try {
    // Exclude this harness's own process tree — its argv contains the
    // provider id (e.g. "codex-acp") as a CLI arg, which self-matches a
    // naive pattern search and produces false-positive "orphan" counts.
    const out = execSync(
      `ps aux | grep -F '${pattern}' | grep -v grep | grep -v 'acpSessionBackendSmoke'`,
    ).toString().trim()
    return out ? out.split('\n').length : 0
  } catch {
    return 0
  }
}

async function readSse(response: Response, onEvent: (chunk: string) => void): Promise<void> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    onEvent(decoder.decode(value, { stream: true }))
  }
}

async function runProviderSmoke(provider: 'claude-acp' | 'codex-acp'): Promise<void> {
  console.log(`\n=== ${provider} ===`)
  const binPattern = provider === 'claude-acp' ? 'claude-agent-acp' : 'codex-acp'

  const created = await createNewViewSession({ provider, cwd: process.cwd() })
  assert.equal(created.provider, provider)
  assert.equal(created.isPending, true)
  console.log('created', created.sessionId)

  const controller = new AbortController()
  const response = await streamViewSessionTurn({
    sessionId: created.sessionId,
    signal: controller.signal,
    provider,
    body: { message: 'Reply with the single word: pong. Do not use any tools.', cwd: process.cwd() },
  })
  assert.equal(response.status, 200)

  let sawTurnAccepted = false
  let sawAnyMessage = false
  let raw = ''
  const readPromise = readSse(response, (chunk) => {
    raw += chunk
    if (chunk.includes('turn-accepted')) sawTurnAccepted = true
    if (chunk.includes('acp_message')) sawAnyMessage = true
  })

  await Promise.race([
    readPromise,
    new Promise((resolve) => setTimeout(resolve, 45_000)),
  ])
  controller.abort()

  assert.ok(sawTurnAccepted, `expected turn-accepted event, got: ${raw.slice(0, 500)}`)
  assert.ok(sawAnyMessage, `expected at least one acp_message event, got: ${raw.slice(0, 500)}`)
  console.log('turn streamed ok, sawAnyMessage =', sawAnyMessage)

  const window = await listViewSessionMessageWindow(
    created.sessionId,
    { offset: 0, limit: 1000 },
    provider,
  )
  assert.ok(window.messages.length > 0, 'expected buffered messages via listViewSessionMessageWindow')
  console.log('message window length', window.messages.length)

  await closeViewSession(created.sessionId, provider)
  let survivors = Infinity
  for (let i = 0; i < 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    survivors = psCount(binPattern)
    console.log(`  t+${i + 1}s: ${survivors} matching process(es)`)
    if (survivors === 0) break
  }
  assert.equal(survivors, 0, `expected no surviving ${binPattern} process after close, found ${survivors}`)
  console.log('closeViewSession ok, no orphaned process')
}

const target = process.argv[2] as 'claude-acp' | 'codex-acp' | undefined
if (target) {
  await runProviderSmoke(target)
} else {
  await runProviderSmoke('claude-acp')
  await runProviderSmoke('codex-acp')
}
console.log('\nACP session backend smoke: PASS')
