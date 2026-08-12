// Remote Coordinator transport smoke. An attached TUI must leave the active
// controller in the daemon process so agent turns, inbox delivery, and task
// dispatch survive a TUI detach or restart.
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentProtocolEvent, ProtocolRunSnapshot } from '../../lib/agentProtocol'

const smokeCwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-coord-remote-'))
process.chdir(smokeCwd)
process.env.AGENT_VIEWER_ATTACH = 'http://daemon.example.test/'

const snapshot: ProtocolRunSnapshot = {
  run: {
    id: 'run / remote',
    prompt: 'keep working',
    status: 'running',
    provider: 'codex',
    baseCwd: smokeCwd,
    maxAgents: 3,
    leadAgentId: 'lead',
    autonomy: 'medium',
    acceptanceContract: {
      goal: 'keep working',
      nonGoals: [],
      userVisibleAcceptance: [],
      filesLikelyTouched: [],
      verificationCommands: [],
      manualQa: [],
      escalationTriggers: [],
      assumptions: [],
      lockedDecisions: [],
    },
    requireReview: false,
    requireReceipts: false,
    review: { status: 'not_required' },
    phaseReports: [],
    learningCandidates: [],
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
  },
  agents: [],
  tasks: [],
  locks: [],
  messages: [],
  events: [],
}

type SeenRequest = { url: string; method: string; body: unknown }
const requests: SeenRequest[] = []
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
  const method = init?.method ?? 'GET'
  requests.push({ url, method, body })

  if (url.endsWith('/api/agent-protocol/runs/changes')) {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`: connected\n\ndata: ${JSON.stringify({ runId: snapshot.run.id })}\n\n`))
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  const payload = url.endsWith('/api/agent-protocol/runs?limit=7')
    ? { runs: [snapshot.run] }
    : method === 'DELETE'
      ? { deleted: true, keptWorktrees: [] }
      : url.endsWith('/cleanup')
        ? { results: [], snapshot }
        : url.endsWith('/api/agent-protocol/runs') && method === 'POST'
          ? { snapshot, sessions: [] }
          : snapshot
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}) as typeof fetch

try {
  const {
    appendTuiProtocolEvent,
    cleanupTuiProtocolRunWorktrees,
    deleteTuiProtocolRun,
    listTuiProtocolRuns,
    prewarmTuiSession,
    readTuiProtocolRun,
    startTuiProtocolRun,
    stopTuiProtocolRun,
    subscribeTuiProtocolRunChanges,
  } = await import('../../lib/tui/service')

  await startTuiProtocolRun({
    prompt: 'keep working',
    baseCwd: smokeCwd,
    provider: 'codex',
    teammateProviders: ['codex'],
    maxAgents: 3,
  })
  await prewarmTuiSession(
    { sessionId: 'session / remote', provider: 'pi', cwd: smokeCwd, isPending: true },
    { model: 'anthropic/claude', effort: 'high', isPending: true },
  )
  await listTuiProtocolRuns(7)
  await readTuiProtocolRun(snapshot.run.id)
  const event: AgentProtocolEvent = {
    version: '1.0',
    runId: snapshot.run.id,
    agentId: 'lead',
    type: 'message',
    to: 'all',
    summary: 'continue',
  }
  await appendTuiProtocolEvent(event)
  await stopTuiProtocolRun(snapshot.run.id)
  await cleanupTuiProtocolRunWorktrees(snapshot.run.id, { force: true })
  await deleteTuiProtocolRun(snapshot.run.id)
  const pushedRunIds: Array<string | null> = []
  const unsubscribe = subscribeTuiProtocolRunChanges((runId) => { pushedRunIds.push(runId) })
  await new Promise((resolve) => setTimeout(resolve, 50))
  unsubscribe?.()
  if (JSON.stringify(pushedRunIds) !== JSON.stringify([null, snapshot.run.id])) {
    throw new Error(`Remote Coordinator change stream did not reconcile then push: ${JSON.stringify(pushedRunIds)}`)
  }

  const base = 'http://daemon.example.test/api/agent-protocol/runs'
  const encodedRun = 'run%20%2F%20remote'
  const expected: SeenRequest[] = [
    { url: base, method: 'POST', body: { prompt: 'keep working', baseCwd: smokeCwd, provider: 'codex', teammateProviders: ['codex'], maxAgents: 3 } },
    {
      url: 'http://daemon.example.test/api/sessions/session%20%2F%20remote/composer',
      method: 'POST',
      body: { provider: 'pi', cwd: smokeCwd, model: 'anthropic/claude', effort: 'high', isPending: true },
    },
    { url: `${base}?limit=7`, method: 'GET', body: null },
    { url: `${base}/${encodedRun}`, method: 'GET', body: null },
    { url: `${base}/${encodedRun}/events`, method: 'POST', body: event },
    { url: `${base}/${encodedRun}/stop`, method: 'POST', body: null },
    { url: `${base}/${encodedRun}/cleanup`, method: 'POST', body: { force: true } },
    { url: `${base}/${encodedRun}`, method: 'DELETE', body: null },
    { url: `${base}/changes`, method: 'GET', body: null },
  ]
  if (JSON.stringify(requests) !== JSON.stringify(expected)) {
    throw new Error(`Coordinator calls did not stay on the daemon:\n${JSON.stringify(requests, null, 2)}`)
  }
  if (existsSync(path.join(smokeCwd, '.agent-viewer-data'))) {
    throw new Error('Attached Coordinator calls created local state instead of remaining daemon-owned')
  }

  console.log('Remote Coordinator lifecycle smoke passed')
} finally {
  globalThis.fetch = originalFetch
}
