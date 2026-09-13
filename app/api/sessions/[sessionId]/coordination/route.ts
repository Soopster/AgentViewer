import { NextResponse } from 'next/server'
import { z } from 'zod'
import { extractPendingPermissions } from '@/lib/permissions'
import { isAgentProvider } from '@/lib/provider'
import { readViewSessionInfo, readViewSessionRunning } from '@/lib/sessionBackend'
import { disableInteractiveCoordinator, configureInteractiveCoordinator, readInteractiveCoordinator, readInteractiveRecoveries, reconcileInteractiveDelivery, resumeInteractiveAgent, createExternalProtocolTask, readSessionCoordinator, reviewExternalProtocolPlan, runExternalProtocolIdempotent, sendExternalProtocolMessage, sessionCoordinatorIdentity, resolveProtocolDecisionAdmin } from '@/lib/agentCoordination'

const schema = z.object({
  provider: z.string().refine(isAgentProvider),
  requestId: z.string().min(1).max(160),
  action: z.enum(['disable', 'enable', 'settings', 'reconcile', 'resume-agent', 'delegate', 'message', 'review-plan', 'decision']),
  detail: z.string().trim().min(1).max(8000),
  cwd: z.string().trim().min(1).optional(),
  autoContinue: z.boolean().optional(), batchId: z.string().optional(), received: z.boolean().optional(),
  to: z.string().min(1).max(160).optional(),
  paths: z.array(z.string().trim().min(1)).max(100).optional(),
  taskId: z.string().min(1).optional(), decisionId: z.string().min(1).optional(),
  approved: z.boolean().optional(), inReplyTo: z.string().min(1).optional(),
})

async function readState(sessionId: string, provider: Parameters<typeof readSessionCoordinator>[1]) {
  const snapshot = await readSessionCoordinator(sessionId, provider)
  const interactive = await readInteractiveCoordinator(sessionId)
  const recoveries = snapshot ? await readInteractiveRecoveries(snapshot.run.id) : []
  const runningAgentIds: string[] = []
  const permissions = snapshot?.agents.flatMap(agent => {
    const info = readViewSessionRunning(agent.sessionId)
    if (info.running) runningAgentIds.push(agent.id)
    return extractPendingPermissions(info.pendingPermissions, { sessionId: agent.sessionId, provider: agent.provider })
      .map(permission => ({ agentId: agent.id, agentName: agent.name, permission }))
  }) ?? []
  return { snapshot, interactive, recoveries, permissions, runningAgentIds }
}

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const provider = new URL(request.url).searchParams.get('provider')
  if (!isAgentProvider(provider)) return NextResponse.json({ error: 'provider is required' }, { status: 400 })
  const { sessionId } = await params
  return NextResponse.json(await readState(sessionId, provider), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Provide an action, task text, provider, and stable request ID' }, { status: 400 })
  const body = parsed.data
  const { sessionId } = await params
  try {
    if (body.action === 'disable') {
      // Terminal stop is naturally idempotent, including a retry after the identity has ended.
      await disableInteractiveCoordinator(sessionId, body.provider)
      return NextResponse.json({ result: { disabled: true }, ...await readState(sessionId, body.provider) }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (body.action === 'delegate' || body.action === 'enable' || body.action === 'settings') {
      const info = await readViewSessionInfo(sessionId, body.provider).catch(() => null)
      const cwd = info?.cwd || body.cwd
      if (!cwd) throw new Error('Open a local project conversation before delegating')
      await configureInteractiveCoordinator({ sessionId, provider: body.provider, cwd })
    }
    const identity = await sessionCoordinatorIdentity(sessionId, body.provider)
    const result = await runExternalProtocolIdempotent(identity, `chat_${body.action}`, body.requestId, async () => {
      if (body.action === 'enable' || body.action === 'settings') {
        const snapshot = await readSessionCoordinator(sessionId, body.provider)
        await configureInteractiveCoordinator({ sessionId, provider: body.provider, cwd: snapshot!.run.baseCwd, autoContinue: body.autoContinue })
        return { configured: true }
      }
      if (body.action === 'reconcile') {
        if (!body.batchId || body.received === undefined) throw new Error('Select the delivery batch and its observed outcome')
        await reconcileInteractiveDelivery(sessionId, body.batchId, body.received)
        return { reconciled: true }
      }
      if (body.action === 'resume-agent') {
        if (!body.to) throw new Error('Choose the teammate to resume')
        await resumeInteractiveAgent(identity, body.to)
        return { resumed: true }
      }
      if (body.action === 'delegate') return createExternalProtocolTask(identity, {
        assignTo: body.to ?? 'auto', title: body.detail.split('\n')[0]!.slice(0, 160), detail: body.detail, paths: body.paths,
      })
      if (body.action === 'message') {
        if (!body.to) throw new Error('Choose a teammate')
        return sendExternalProtocolMessage(identity, { to: body.to, body: body.detail, inReplyTo: body.inReplyTo, kind: body.inReplyTo ? 'response' : 'request' })
      }
      if (!body.taskId) throw new Error('taskId is required')
      if (body.action === 'review-plan') {
        if (body.approved === undefined) throw new Error('Choose approve or reject')
        return reviewExternalProtocolPlan(identity, { taskId: body.taskId, approved: body.approved, summary: body.detail })
      }
      if (!body.decisionId) throw new Error('decisionId is required')
      return resolveProtocolDecisionAdmin(identity.runId, { taskId: body.taskId, decisionId: body.decisionId, answer: body.detail })
    })
    return NextResponse.json({ result, ...await readState(sessionId, body.provider) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Coordination request failed' }, { status: 409 })
  }
}
