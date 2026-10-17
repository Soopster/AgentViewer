// Opt-in live diagnostic: one ephemeral, read-only Codex turn; prints event
// types and timings only. Does not inspect or resume an existing user thread.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getCodexClient } from '../lib/codexClient'
import { markCodexThreadResumed } from '../lib/codexThreads'
import { streamViewSessionTurn } from '../lib/sessionBackend'

const began = performance.now()
const log = (message: string) => console.log(`${Math.round(performance.now() - began)}ms ${message}`)
const timer = setTimeout(() => { log('TIMEOUT'); process.exit(1) }, 90_000)
const client = getCodexClient()
client.subscribe(notification => log(`native ${notification.method}`))
try {
  const started = await client.request('thread/start', {
    cwd: mkdtempSync(path.join(tmpdir(), 'codex-stream-smoke-')),
    ephemeral: true,
    sandbox: 'read-only',
    approvalPolicy: 'never',
  })
  markCodexThreadResumed(started.thread.id, started.model)
  log('thread ready')
  const response = await streamViewSessionTurn({
    sessionId: started.thread.id,
    provider: 'codex',
    signal: new AbortController().signal,
    body: { message: 'Do not use tools. Write the numbers 1 through 80, one number per line.', effort: 'low' },
  })
  log(`response ${response.status}`)
  if (!response.ok || !response.body) throw new Error('No live stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let deltas = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    const kinds = [...chunk.matchAll(/"type":"([^"]+)"/g)].map(match => match[1])
    deltas += kinds.filter(kind => kind === 'codex_agent_message_delta').length
    log(`SSE ${kinds.join(',') || 'control'} (${value.length} bytes)`)
  }
  if (!deltas) throw new Error('No live assistant delta reached SSE')
  log(`PASS ${deltas} assistant delta frames`)
  clearTimeout(timer)
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  clearTimeout(timer)
  process.exit(1)
}
