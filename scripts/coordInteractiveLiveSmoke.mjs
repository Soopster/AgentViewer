// Live-provider validation against an isolated read-only project. No capability tokens are logged.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const provider = process.env.COORD_SMOKE_PROVIDER ?? 'codex'
assert.ok(['codex', 'claude'].includes(provider))
const rounds = Number(process.env.COORD_LIVE_ROUNDS ?? 1)
const idleSeconds = Number(process.env.COORD_LIVE_IDLE_SECONDS ?? 10)
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 10)
assert.ok(Number.isFinite(idleSeconds) && idleSeconds >= 0 && idleSeconds <= 300)
const origin = process.env.COORD_SMOKE_ORIGIN ?? 'http://127.0.0.1:3210'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
const cwd = mkdtempSync(path.join(tmpdir(), 'coord-live-'))
execFileSync('git', ['init', '-q', cwd])
const codes = Array.from({ length: rounds }, (_, index) => {
  const pair = [randomUUID().slice(0, 8), randomUUID().slice(0, 8)]
  for (const [lane, code] of pair.entries()) writeFileSync(path.join(cwd, `round-${index + 1}-${lane}.txt`), `Review code: ${code}\n`)
  return pair
})
execFileSync('git', ['-C', cwd, 'add', '.'])
execFileSync('git', ['-C', cwd, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
async function request(url, body) {
  const response = await fetch(`${origin}${url}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  const data = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${data.error ?? 'request failed'}`)
  return data
}
const pause = () => new Promise(resolve => setTimeout(resolve, 2000))
let runId
let endpoint
const started = Date.now()
try {
  const created = await request('/api/sessions/new', { provider, cwd, title: `Interactive coordinator live smoke (${provider})` })
  const sessionId = created.sessionId
  assert.ok(sessionId)
  endpoint = `/api/sessions/${encodeURIComponent(sessionId)}/coordination`
  const enabled = await request(endpoint, { provider, cwd, action: 'enable', requestId: randomUUID(), detail: 'Enable isolated live smoke', autoContinue: true })
  runId = enabled.snapshot.run.id
  console.log(JSON.stringify({ stage: 'enabled', provider, sessionId, runId, cwd, rounds, idleSeconds }))
  for (let round = 1; round <= rounds; round++) {
    const before = await request(`${endpoint}?provider=${provider}`)
    const oldIds = new Set(before.snapshot.tasks.map(task => task.id))
    const response = await fetch(`${origin}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, cwd,
        isPendingSession: round === 1 && created.isPending, detachOnClientAbort: true,
        message: `Round ${round}: bounded read-only coordination test. Use coord_delegate twice to assign two independent tasks before doing anything else. Reuse the existing two teammates if they exist; do not create extra agents. First teammate: read round-${round}-0.txt and report its review code. Second teammate: read round-${round}-1.txt and report its review code. Neither teammate may edit files or perform other work. Do not read these files yourself. After assigning both tasks, return a brief acknowledgement and leave the room open. When teammates report results, summarize both new codes. Do not finalize the run.` }),
    })
    if (!response.ok) throw new Error(`Lead submission failed: ${response.status} ${await response.text()}`)
    let initialSettled = false
    let initialError
    void response.body.pipeTo(new WritableStream({ write() {} })).catch(error => { initialError = error }).finally(() => { initialSettled = true })
    const deadline = Date.now() + 300_000
    let data
    let last = ''
    let verified = false
    const approved = new Set()
    while (Date.now() < deadline) {
      data = await request(`${endpoint}?provider=${provider}`)
      const tasks = data.snapshot.tasks.filter(task => !oldIds.has(task.id))
      const report = JSON.stringify({ stage: 'working', provider, round, tasks: tasks.map(task => ({ id: task.id, owner: task.ownerAgentId, status: task.status })), delivery: data.interactive.delivery?.state, remainingTurns: data.interactive.remainingTurns, nativeQuestions: data.permissions.length })
      if (report !== last) { console.log(report); last = report }
      if (initialError) throw initialError
      if (data.interactive.delivery && !data.interactive.delivery.active) throw new Error('Lead delivery became uncertain; inspect the fixture transcript')
      if (tasks.some(task => task.status === 'failed') || data.recoveries.length) {
        const failure = data.snapshot.events.findLast(event => event.type === 'agent.blocked')
        throw new Error(`Live teammate requires recovery: ${failure?.detail ?? failure?.summary ?? data.recoveries.join(', ')}`)
      }
      assert.ok(tasks.length <= 2, 'duplicate task creation')
      if (approved.size && !tasks.some(task => task.status === 'completed')) {
        assert.equal(data.interactive.remainingTurns, 4, 'approved plans must not wake the lead before results')
      }
      for (const task of tasks.filter(task => task.status === 'planned' && !approved.has(task.id))) {
        const budget = data.interactive.remainingTurns
        await pause()
        const held = await request(`${endpoint}?provider=${provider}`)
        assert.equal(held.snapshot.tasks.find(item => item.id === task.id)?.status, 'planned', 'plan must wait for human approval')
        assert.equal(held.interactive.remainingTurns, budget, 'plan gate cannot wake the lead')
        await request(endpoint, { provider, action: 'review-plan', taskId: task.id, approved: true, detail: 'Approved bounded read-only fixture plan', requestId: randomUUID() })
        approved.add(task.id)
      }
      if (tasks.length === 2 && tasks.every(task => task.status === 'completed') && initialSettled && !data.interactive.delivery && data.interactive.remainingTurns < 4) {
        const results = tasks.map(task => `${task.resultSummary ?? ''}\n${task.resultDetail ?? ''}`).join('\n')
        const transcript = await request(`/api/sessions/${encodeURIComponent(sessionId)}/messages?provider=${provider}&tail=1&limit=100`)
        const text = JSON.stringify(transcript.messages.filter(message => message.type === 'assistant'))
        if (codes[round - 1].every(code => results.includes(code) && text.includes(code))) {
          assert.equal(new Set(tasks.map(task => task.ownerAgentId)).size, 2, 'two distinct teammates must participate')
          assert.equal(data.snapshot.agents.filter(agent => agent.role === 'teammate').length, 2, 'follow-up must reuse the team')
          verified = true; break
        }
      }
      await pause()
    }
    assert.ok(verified, `round ${round} did not produce both new codes in the lead transcript`)
    assert.ok(!data.snapshot.events.some(event => event.summary?.startsWith('Supervision checkpoint:')), 'healthy work must not request a lead supervision turn')
    const remaining = data.interactive.remainingTurns
    const idleUntil = Date.now() + idleSeconds * 1000
    while (Date.now() < idleUntil) {
      await pause()
      const idle = await request(`${endpoint}?provider=${provider}`)
      assert.equal(idle.snapshot.tasks.length, round * 2, 'idle created duplicate work')
      assert.equal(idle.interactive.remainingTurns, remaining, 'idle spent an extra lead turn')
      assert.equal(idle.interactive.delivery, null, 'idle started a delivery')
      assert.equal(idle.runningAgentIds.length, 0, 'work continued after completed results')
    }
    console.log(JSON.stringify({ stage: 'round-passed', provider, round, automaticTurns: 4 - remaining, plansApproved: approved.size, idleSeconds }))
  }
  assert.equal(execFileSync('git', ['-C', cwd, 'status', '--porcelain'], { encoding: 'utf8' }), '')
  console.log(JSON.stringify({ stage: 'passed', provider, rounds, tasks: rounds * 2, elapsedSeconds: Math.round((Date.now() - started) / 1000), fixtureUnchanged: true }))
} finally {
  if (runId) await request(`/api/agent-protocol/runs/${runId}/stop`, {}).catch(error => console.error(`Cleanup failed: ${error.message}`))
}
