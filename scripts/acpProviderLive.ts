// The `acp` provider against a REAL agent, where acpProviderSmoke.ts uses a
// hand-written one. Not part of any suite: it needs an installed, signed-in
// agent and spends a model turn or two.
//
//   ACP_LIVE_COMMAND="opencode acp" ACP_LIVE_MODEL=opencode/big-pickle npm run acp:live
//
// It runs a plain turn, lists the agent's saved sessions, then staffs the agent
// as a teammate and waits for it to reach the Coordinator through the MCP
// server it was handed. A permission request that would have reached a person is
// printed and approved. ACP_LIVE_MODEL names a model when the agent's default is
// not usable. The sessions it starts stay in the agent's own store.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const command = process.env.ACP_LIVE_COMMAND?.trim()
if (!command) {
  console.error('Set ACP_LIVE_COMMAND to a real ACP agent command, for example "opencode acp".')
  process.exit(2)
}

if (process.argv[2] !== 'child') {
  const dir = mkdtempSync(path.join(tmpdir(), 'acp-live-'))
  spawnSync('git', ['init', '-q'], { cwd: dir })
  spawnSync('git', ['-c', 'user.name=live', '-c', 'user.email=live@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir })
  const env: NodeJS.ProcessEnv = { ...process.env, AGENT_VIEWER_COORD_HOME: path.join(dir, 'coord-home'), AGENT_VIEWER_ACP_COMMAND: command }
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child', dir], { stdio: 'inherit', env, timeout: 300_000 })
  process.exit(child.status ?? 1)
}

const dir = process.argv[3]!
// Some agents start on a model the account cannot use; name one it offers.
const model = process.env.ACP_LIVE_MODEL?.trim() || undefined
process.chdir(dir)
const backend = await import('../lib/sessionBackend')
const instances = await import('../lib/providerInstances')
const { getSessionAdapter } = await import('../lib/adapters/registry')
const pool = await import('../lib/acpClientPool')

function replyText(stream: string): string {
  const texts: string[] = []
  for (const line of stream.split('\n')) {
    if (!line.startsWith('data:')) continue
    try {
      const frame = JSON.parse(line.slice(5)) as { message?: { type?: string; message?: { content?: unknown } } }
      const content = frame.message?.type === 'assistant' ? frame.message.message?.content : undefined
      if (Array.isArray(content)) for (const block of content) if (block?.type === 'text') texts.push(String(block.text))
    } catch { /* not a JSON frame */ }
  }
  return texts.join('').trim()
}

async function turn(sessionId: string, message: string): Promise<string> {
  const response = await instances.withProviderInstance('acp', 'acp', () => backend.streamViewSessionTurn({
    sessionId, provider: 'acp', signal: new AbortController().signal, body: { message, cwd: dir, ...(model ? { model } : {}) },
  }))
  return await new Response(response.body).text()
}

// --- A plain turn.
const started = Date.now()
const created = await backend.createNewViewSession({ provider: 'acp', cwd: dir })
const stream = await turn(created.sessionId, 'Reply with exactly the word PONG and nothing else. Do not use any tools.')
const reply = replyText(stream)
console.log(`turn        ${Date.now() - started}ms  reply=${JSON.stringify(reply.slice(0, 120))}`)
assert.ok(/PONG/i.test(reply), `the agent did not answer the turn:\n${stream.slice(0, 2000)}`)

// --- What it says it can do, and what listing does with that.
const adapter = await getSessionAdapter('acp')
const models = await instances.withProviderInstance('acp', 'acp', () => adapter.readModels!(created.sessionId))
console.log(`models      ${models.models.length} offered, current ${models.currentModel}`)
const diagnostics = await instances.withProviderInstance('acp', 'acp', () => adapter.readDiagnostics!(created.sessionId))
for (const section of diagnostics.sections) for (const item of section.items) console.log(`diagnostics ${item}`)
const listed = await instances.withProviderInstance('acp', 'acp', () => adapter.listSessions!({ limit: 10, offset: 0 } as never))
console.log(`listing     ${listed.length} session(s)${listed[0] ? `, newest ${JSON.stringify(listed[0].summary)}` : ''}`)

// --- Staffed as a teammate: it must reach the Coordinator as itself.
const coord = await import('../lib/agentCoordination')
await coord.configureInteractiveCoordinator({ sessionId: created.sessionId, provider: 'acp', cwd: dir })
const lead = await coord.sessionCoordinatorIdentity(created.sessionId, 'acp')
const delegated = await coord.createExternalProtocolTask(lead, {
  assignTo: 'auto', requestedProvider: 'acp', requestedModel: model, title: 'Report the board',
  detail: 'Call coord_status once, then complete this task with coord_complete_task, giving a one-line summary of how many tasks the board holds. Change no files.',
})
const agentId = delegated.delegation!.agentId
console.log(`teammate    ${delegated.delegation!.name} (${agentId}) staffed from ${delegated.delegation!.provider}`)

const asked = new Map<string, string>()
const deadline = Date.now() + 240_000
let outcome = 'timed out'
while (Date.now() < deadline) {
  const snapshot = (await coord.readProtocolRun(lead.runId))!
  const teammate = snapshot.agents.find((agent) => agent.id === agentId)
  if (teammate?.sessionId) {
    for (const pending of pool.acpPendingRequests(teammate.sessionId)) {
      if (asked.has(pending.id) || pending.method !== 'session/request_permission') continue
      const toolCall = (pending.params as { toolCall?: unknown }).toolCall
      asked.set(pending.id, JSON.stringify(toolCall))
      console.log(`permission  REACHED A PERSON: ${JSON.stringify(toolCall).slice(0, 400)} — approving so the run can finish`)
      pool.respondAcpPermissionDecision(teammate.sessionId, pending.id, 'once')
    }
  }
  const task = snapshot.tasks.find((candidate) => candidate.id === delegated.task!.id)
  if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) { outcome = `${task.status}: ${task.resultSummary ?? ''}`; break }
  await new Promise((resolve) => setTimeout(resolve, 500))
}
console.log(`task        ${outcome}`)
console.log(`asked       ${asked.size} permission request(s) reached a person`)
await coord.stopProtocolRun(lead.runId).catch(() => {})
process.exit(outcome.startsWith('completed') ? 0 : 1)
