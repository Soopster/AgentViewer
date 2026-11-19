// Other machines' teams in the coordinator rail (herdr's combined agent list
// across machines), against a fake daemon that enforces the device credential
// the way proxy.ts does for a remote request.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'agent-viewer-machines-smoke-'))
process.chdir(root)

const CREDENTIAL = 'device-1.secret-abc'
const now = new Date().toISOString()
const run = { id: 'run-remote', prompt: 'Remote team', status: 'running', provider: 'claude', baseCwd: '/srv', maxAgents: 3, leadAgentId: 'lead-r', autonomy: 'medium', acceptanceContract: {}, requireReview: false, requireReceipts: false, review: { status: 'none' }, phaseReports: [], learningCandidates: [], createdAt: now, updatedAt: now }
const agent = (id: string, name: string, role: string, extra: Record<string, unknown> = {}) => ({ id, runId: run.id, name, role, provider: 'claude', sessionId: `s-${id}`, worktreePath: '', worktreeBranch: '', status: 'ready', createdAt: now, updatedAt: now, ...extra })
const snapshot = {
  run,
  agents: [agent('lead-r', 'remote-lead', 'lead'), agent('t-ask', 'asker', 'teammate'), agent('t-work', 'worker', 'teammate', { status: 'working', turnActive: true })],
  tasks: [],
  messages: [{ id: 'm1', runId: run.id, fromAgentId: 't-ask', toAgentId: 'lead-r', body: 'Which parser?', replyRequired: true, createdAt: now }],
  events: [], locks: [], findings: [], decisions: [],
}

let pairingsLeft = 1
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://x')
  if (url.pathname === '/api/remote/handshake' && request.method === 'POST') {
    if (request.headers.authorization !== 'Bearer pair-token' || pairingsLeft-- <= 0) {
      response.writeHead(401, { 'Content-Type': 'application/json' })
      return response.end(JSON.stringify({ error: 'Pairing token is invalid, expired, or already used' }))
    }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `agent_viewer_remote_token=${encodeURIComponent(CREDENTIAL)}; Path=/; HttpOnly; SameSite=Lax` })
    return response.end(JSON.stringify({ ok: true, scope: 'read-only' }))
  }
  if (request.headers.cookie !== `agent_viewer_remote_token=${encodeURIComponent(CREDENTIAL)}`) {
    response.writeHead(401, { 'Content-Type': 'application/json' })
    return response.end(JSON.stringify({ error: 'unauthorized' }))
  }
  if (url.pathname === '/api/agent-protocol/runs') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    return response.end(JSON.stringify({ runs: [run] }))
  }
  if (url.pathname === `/api/agent-protocol/runs/${run.id}`) {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    return response.end(JSON.stringify(snapshot))
  }
  if (url.pathname === '/api/agent-protocol/runs/changes') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    return
  }
  response.writeHead(404)
  response.end()
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

// A machine that accepts the connection and never answers.
const hung = http.createServer(() => {})
await new Promise<void>((resolve) => hung.listen(0, '127.0.0.1', resolve))
const hungBase = `http://127.0.0.1:${(hung.address() as AddressInfo).port}`

const machines = await import('../lib/machines.mjs')
const { readMachineRoster } = await import('../lib/tui/machines')
const { buildCoordinatorEntries } = await import('../tui/opentui/coordinatorStore')

// Pairing: the token is redeemed once, the credential lands 0600 and is never returned.
const added = await machines.addMachine({ name: 'build-box', pairingUrl: `${base}/pair#token=pair-token` })
assert.deepEqual(added, { name: 'build-box', baseUrl: base, scope: 'read-only' })
assert.ok(!JSON.stringify(added).includes('secret'), 'adding a machine must not hand the credential back')
assert.equal(statSync(machines.machinesFile()).mode & 0o777, 0o600, 'the machines file holds credentials and must be 0600')
assert.equal(machines.readMachines()[0]?.credential, CREDENTIAL)
await assert.rejects(machines.addMachine({ name: 'again', pairingUrl: `${base}/pair#token=pair-token` }), /already used/, 'a spent pairing token must be refused')
await assert.rejects(machines.addMachine({ name: 'build-box', pairingUrl: `${base}/pair#token=x` }), /already added/)
assert.throws(() => machines.parsePairingUrl(`${base}/pair`), /no pairing token/)
assert.throws(() => machines.validateMachineName('Build Box'), /lowercase/)

// Reading: the stored credential authenticates; a wrong one reads as revoked, not as empty.
const stored = machines.readMachines()[0]!
const roster = await readMachineRoster(stored, 20)
assert.equal(roster.error, null)
assert.equal(roster.snapshots.get(run.id)?.agents.length, 3)
const revoked = await readMachineRoster({ ...stored, credential: 'device-1.wrong' }, 20)
assert.match(revoked.error ?? '', /credential revoked or expired/)

// A machine that never answers is cut off at its deadline rather than holding the rail.
const startedAt = Date.now()
const stalled = await readMachineRoster({ name: 'slow-box', baseUrl: hungBase, credential: 'x' }, 20, 400)
assert.match(stalled.error ?? '', /no answer/)
assert.ok(Date.now() - startedAt < 2_000, 'a stalled machine must not block past its deadline')

// The rail: remote agents under their machine's heading, with herdr's states,
// keys scoped by machine, and an unreadable machine always shown.
const noReviews = () => []
const all = buildCoordinatorEntries([], new Map(), 'all', noReviews, [roster, stalled])
const heading = all.find((entry) => entry.type === 'machine' && entry.machine.name === 'build-box')
assert.ok(heading && heading.type === 'machine' && heading.agentCount === 3)
const asker = all.find((entry) => entry.type === 'agent' && entry.agent.name === 'asker')
assert.ok(asker && asker.type === 'agent' && asker.state === 'blocked' && asker.machine?.name === 'build-box', 'a remote teammate asking its lead reads as needing the user')
assert.ok(asker.key.includes('build-box/'), 'remote keys must be scoped by machine — run ids are only unique within one ledger')
const blockedOnly = buildCoordinatorEntries([], new Map(), 'blocked', noReviews, [roster, stalled])
assert.deepEqual(blockedOnly.filter((entry) => entry.type === 'agent').map((entry) => entry.type === 'agent' && entry.agent.name), ['asker'])
assert.ok(blockedOnly.some((entry) => entry.type === 'machine' && entry.machine.name === 'slow-box' && entry.error), 'an unreadable machine must stay visible under a filter')

assert.equal(machines.removeMachine('build-box'), true)
assert.equal(machines.readMachines().length, 0)
assert.ok(!readFileSync(machines.machinesFile(), 'utf8').includes(CREDENTIAL), 'removing a machine must drop its credential from disk')

server.close()
hung.closeAllConnections()
hung.close()
console.log('machines smoke passed (pairing, 0600 credential, revoked vs empty, stalled deadline, rail grouping and filter)')
process.exit(0)
