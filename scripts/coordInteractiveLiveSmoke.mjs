// Opt-in live-provider validation. Creates only a temporary read-only fixture and its test sessions.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const provider = process.env.COORD_SMOKE_PROVIDER ?? 'codex'
assert.ok(['codex', 'claude'].includes(provider))
const origin = process.env.COORD_SMOKE_ORIGIN ?? 'http://127.0.0.1:3210'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
const cwd = mkdtempSync(path.join(tmpdir(), 'coord-live-'))
execFileSync('git', ['init', '-q', cwd])
writeFileSync(path.join(cwd, 'alpha.txt'), 'Alpha review code: APPLE-17\n')
writeFileSync(path.join(cwd, 'beta.txt'), 'Beta review code: BIRCH-29\n')
execFileSync('git', ['-C', cwd, 'add', '.'])
execFileSync('git', ['-C', cwd, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
async function request(url, body) {
  const response = await fetch(`${origin}${url}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  const data = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${data.error ?? 'request failed'}`)
  return data
}
let runId
try {
  const created = await request('/api/sessions/new', { provider, cwd, title: `Interactive coordinator live smoke (${provider})` })
  const sessionId = created.sessionId
  assert.ok(sessionId)
  const endpoint = `/api/sessions/${encodeURIComponent(sessionId)}/coordination`
  const enabled = await request(endpoint, { provider, cwd, action: 'enable', requestId: crypto.randomUUID(), detail: 'Enable isolated live smoke', autoContinue: true })
  runId = enabled.snapshot.run.id
  console.log(JSON.stringify({ stage: 'enabled', sessionId, runId, cwd }))
  const response = await fetch(`${origin}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, cwd, isPendingSession: created.isPending, detachOnClientAbort: true,
      message: 'This is a bounded read-only coordination test. Use coord_delegate twice to assign two independent tasks to two teammates before doing anything else. First teammate: read alpha.txt and report its review code. Second teammate: read beta.txt and report its review code. Neither teammate may edit any files or perform any other work. Do not read the files yourself. After assigning both tasks, return a brief acknowledgement and leave the room open. When the teammates report results, summarize the two codes. Do not finalize the run or spawn additional agents.' }),
  })
  if (!response.ok) throw new Error(`Lead submission failed: ${response.status} ${await response.text()}`)
  // Drain live output without printing potentially sensitive provider metadata.
  let streamBuffer = ''
  const decoder = new TextDecoder()
  const drained = response.body.pipeTo(new WritableStream({ write(chunk) {
    streamBuffer += decoder.decode(chunk, { stream: true })
    const lines = streamBuffer.split('\n'); streamBuffer = lines.pop() ?? ''
    for (const line of lines) if (line.startsWith('data:')) {
      try { const frame = JSON.parse(line.slice(5)); if (frame.error) console.error(JSON.stringify({ stage: 'provider-error', error: frame.error })) } catch {}
    }
  } }))
  const deadline = Date.now() + 180_000
  let last = ''
  let snapshot
  while (Date.now() < deadline) {
    const data = await request(`${endpoint}?provider=${provider}`)
    snapshot = data.snapshot
    const report = JSON.stringify({ stage: 'working', tasks: snapshot.tasks.map(task => ({ id: task.id, owner: task.ownerAgentId, status: task.status })),
      delivery: data.interactive.delivery?.state, remainingTurns: data.interactive.remainingTurns, nativeQuestions: data.permissions.length })
    if (report !== last) { console.log(report); last = report }
    if (snapshot.tasks.length >= 2 && snapshot.tasks.every(task => task.status === 'completed') && !data.interactive.delivery && data.interactive.remainingTurns < 4) break
    if (data.interactive.delivery && !data.interactive.delivery.active) throw new Error('Lead delivery became uncertain; inspect the live fixture transcript')
    if (snapshot.tasks.some(task => task.status === 'failed') || data.recoveries.length) throw new Error('Live teammate requires recovery')
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  await Promise.race([drained, new Promise((_, reject) => setTimeout(() => reject(new Error('Lead stream did not settle')), 1000))])
  assert.equal(snapshot.tasks.filter(task => task.status === 'completed').length, 2, 'both real teammates must complete')
  const results = snapshot.tasks.map(task => task.resultSummary ?? '').join('\n')
  assert.match(results, /APPLE-17/); assert.match(results, /BIRCH-29/)
  const transcript = await request(`/api/sessions/${encodeURIComponent(sessionId)}/messages?provider=${provider}&tail=1&limit=50`)
  const text = JSON.stringify(transcript.messages.filter(message => message.type === 'assistant'))
  assert.match(text, /APPLE-17/); assert.match(text, /BIRCH-29/)
  assert.equal(execFileSync('git', ['-C', cwd, 'status', '--porcelain'], { encoding: 'utf8' }), '')
  console.log(`Live ${provider}: two teammate results and automatic lead synthesis passed; fixture unchanged`)
} finally {
  if (runId) await request(`/api/agent-protocol/runs/${runId}/stop`, {}).catch(error => console.error(`Cleanup failed: ${error.message}`))
}
