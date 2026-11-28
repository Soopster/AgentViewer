// Isolated daemon process: real routes, proxy, auth and ledger; scripted provider reads.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { NextRequest } from 'next/server'

process.chdir(mkdtempSync(path.join(tmpdir(), 'coord-remote-daemon-')))
execFileSync('git', ['init', '-q'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '--allow-empty', '-qm', 'fixture'])
const label = process.env.REMOTE_FIXTURE_LABEL || 'machine'
let providerTurns = 0
let nativePayloads: unknown[] = []
const nativeActions: { sessionId: string; provider: string; body: Record<string, unknown> }[] = []
const runtime = await import('../lib/sessionRuntime')
const { mock } = await (0, eval)('import("bun:test")')
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  maxDuration: 300,
  readViewSessionInfo: async (sessionId: string) => ({ sessionId, provider: 'codex', cwd: process.cwd() }),
  readViewSessionRunning: (sessionId: string) => ({ ...runtime.getRunningSessionInfo(sessionId), pendingPermissions: sessionId === 'shared-session' ? nativePayloads : [], pendingPrompts: [] }),
  runViewSessionAction: async (request: { sessionId: string; provider: string; body: Record<string, unknown> }) => {
    if (request.sessionId !== 'shared-session' || request.provider !== 'codex' || !nativePayloads.length) throw new Error('Wrong native request target')
    nativeActions.push(request); nativePayloads = []; return { ok: true }
  },
  listViewSessionMessageWindow: async (sessionId: string) => ({ messages: [{ type: 'assistant', uuid: 'shared-message', session_id: sessionId, parent_tool_use_id: null, provider: 'codex', message: { role: 'assistant', content: `${label} transcript` } }], total: 1, offset: 0 }),
  streamViewSessionTurn: async () => { providerTurns++; return new Response('data: {"type":"assistant","text":"scripted"}\n\n') },
  createNewViewSession: async () => { throw new Error('No provider sessions may be spawned by this fixture') },
}))
const coord = await import('../lib/agentCoordination')
const auth = await import('../lib/remoteAuth')
const full = (await auth.consumePairing((await auth.mintPairing({ scope: 'full' })).token))!
const readOnly = (await auth.consumePairing((await auth.mintPairing({ scope: 'read-only' })).token))!
await coord.createExternalProtocolRun({ runId: 'shared-run', prompt: label, provider: 'codex', baseCwd: process.cwd(), participantName: 'lead' })
// Deterministic ids intentionally collide on two independent machine ledgers.
const { Database } = await (0, eval)('import("bun:sqlite")')
const { COORDINATION_DB_FILE } = await import('../lib/coordinatorLedger')
const db = new Database(COORDINATION_DB_FILE)
db.prepare("UPDATE protocol_agents SET session_id = 'shared-lead-session' WHERE run_id = 'shared-run' AND role = 'lead'").run()
const joined = await coord.joinSessionToCoordinatorRun({ runId: 'shared-run', sessionId: 'shared-session', name: 'reviewer', provider: 'codex', cwd: process.cwd() })
db.prepare("UPDATE protocol_agents SET id = 'shared-agent' WHERE id = ?").run(joined.agentId)
db.close()
await coord.recordProtocolEvent({ version: '1.0', runId: 'shared-run', agentId: 'shared-agent', type: 'message', to: 'lead', summary: `${label} question`, payload: { replyRequired: true } })

const { proxy } = await import('../proxy')
const runRoute = await import('../app/api/agent-protocol/runs/[runId]/route')
const listRoute = await import('../app/api/agent-protocol/runs/route')
const messagesRoute = await import('../app/api/sessions/[sessionId]/messages/route')
const coordinationRoute = await import('../app/api/sessions/[sessionId]/coordination/route')
const versionRoute = await import('../app/api/version/route')
let mode = 'normal'
let mutationRequests = 0
let interrupts = 0
const { serve } = await (0, eval)('import("bun")')
const server = serve({ port: 0, hostname: '127.0.0.1', async fetch(raw: Request) {
  const request = new NextRequest(raw)
  const gate = await proxy(request)
  if (!gate.headers.get('x-middleware-next')) return gate
  const pathname = request.nextUrl.pathname
  if (pathname === '/fixture') {
    if (request.method === 'POST') {
      const body = await request.json()
      mode = body.mode ?? mode
      if (body.native) nativePayloads = [{ type: 'codex_approval', event: { type: 'approval.requested', threadId: 'shared-session', requestId: 'shared-permission', method: body.native === 'question' ? 'item/tool/requestUserInput' : 'item/commandExecution/requestApproval', params: body.native === 'question' ? { questions: [{ id: 'policy', question: 'Which policy?', options: [{ label: 'Strict' }, { label: 'Legacy' }] }] } : { command: `${label} ${body.native === 'changed' ? 'changed-command' : 'review-command'}`, reason: 'Confirm the exact remote command' } } }]
      if (body.finishRun) {
        const terminalDb = new Database(COORDINATION_DB_FILE)
        terminalDb.prepare("UPDATE protocol_runs SET status = 'completed' WHERE id = 'shared-run'").run(); terminalDb.close()
      }
      if (body.revoke) await auth.revokeRemoteSession(full.session.id)
      if (body.planTaskId) await coord.recordProtocolEvent({ version: '1.0', runId: 'shared-run', agentId: 'shared-agent', taskId: body.planTaskId, type: 'task.planned', summary: 'Remote review plan', detail: 'Inspect the parser, then test the selected policy.' })
      if (body.armTurn) runtime.setRunningSession('shared-session', { provider: 'codex', interrupt: async () => { interrupts++; runtime.clearRunningSession('shared-session') } })
    }
    return Response.json({ snapshot: await coord.readProtocolRun('shared-run'), mutationRequests, interrupts, providerTurns, nativeActions })
  }
  if (mode === 'offline') await new Promise(resolve => setTimeout(resolve, 6000))
  if (pathname === '/api/version') return versionRoute.GET()
  if (pathname === '/api/agent-protocol/runs') return listRoute.GET(request)
  if (pathname === '/api/agent-protocol/runs/shared-run') return runRoute.GET(request, { params: Promise.resolve({ runId: 'shared-run' }) })
  const match = pathname.match(/^\/api\/sessions\/([^/]+)\/(messages|coordination)$/)
  if (!match) return new Response('Not found', { status: 404 })
  const context = { params: Promise.resolve({ sessionId: decodeURIComponent(match[1]) }) }
  if (match[2] === 'messages') return messagesRoute.GET(request, context)
  if (request.method === 'GET') return coordinationRoute.GET(request, context)
  mutationRequests++
  const response = await coordinationRoute.POST(request, context)
  if (mode === 'lost') { mode = 'normal'; await new Promise(resolve => setTimeout(resolve, 6000)) }
  return response
} })
console.log(JSON.stringify({ baseUrl: `http://127.0.0.1:${server.port}`, full: full.credential, readOnly: readOnly.credential }))
