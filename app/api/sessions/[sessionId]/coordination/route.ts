import { readCoordinatorCapabilities } from '@/lib/coordinatorCapabilities'
import { answerCoordinatorNativePermission } from '@/lib/coordinatorNativePermissionServer'
import { readCoordinatorNativeAnswerReceipt } from '@/lib/agentCoordination'
import { inspectCoordinatorRecovery } from '@/lib/coordinatorRecoveryServer'
import { integrateCoordinatorResult } from '@/lib/coordinatorResultReviewServer'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { extractPendingPermissions } from '@/lib/permissions'
import { isAgentProvider } from '@/lib/provider'
import { coordinatorBackgroundAgents } from '@/lib/coordinatorInteractiveState'
import { listWaitingSessions } from '@/lib/sessionRuntime'
import { readViewSessionInfo, readViewSessionRunning } from '@/lib/sessionBackend'
import { readSettledInteractiveExecutions, reconcileSettledInteractiveExecution, startInteractiveWorkflow, adoptOrphanedInteractiveHost, cancelInteractiveTask, interruptInteractiveAgent, setInteractiveCoordinatorEnabled, configureInteractiveCoordinator, readInteractiveCoordinator, readInteractiveRecoveries, reconcileInteractiveDelivery, resumeInteractiveAgent, createExternalProtocolTask, readSessionCoordinator, reviewExternalProtocolPlan, runExternalProtocolIdempotent, sendExternalProtocolMessage, sessionCoordinatorIdentity, resolveProtocolDecisionAdmin } from '@/lib/agentCoordination'

const schema = z.object({
  provider: z.string().refine(isAgentProvider),
  requestId: z.string().min(1).max(160),
  expectedRunId: z.string().min(1).optional(),
  expectedAgent: z.object({ id: z.string().min(1), sessionId: z.string().min(1), provider: z.string().refine(isAgentProvider) }).optional(),
  action: z.enum(['native-answer', 'start-workflow', 'integrate-result', 'disable', 'enable', 'settings', 'reconcile', 'resume-agent', 'reconcile-agent', 'interrupt-agent', 'cancel-task', 'delegate', 'message', 'review-plan', 'decision']),
  permissionId: z.string().min(1).max(512).optional(),
  permissionToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  response: z.enum(['once', 'always', 'reject']).optional(),
  answers: z.record(z.string(), z.array(z.string().max(8000)).max(100)).optional(),
  permissionMode: z.enum(['default', 'acceptEdits']).optional(),
  playbook: z.unknown().optional(), workflowArgs: z.unknown().optional(),
  token: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  detail: z.string().trim().min(1).max(8000),
  cwd: z.string().trim().min(1).optional(),
  maxAgents: z.number().int().min(2).max(16).optional(),
  budget: z.strictObject({ maxTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(), maxCostUsd: z.number().positive().optional(), maxDurationMinutes: z.number().positive().optional() }).nullable().optional(),
  autoContinue: z.boolean().optional(), useWorktrees: z.boolean().optional(), batchId: z.string().optional(), received: z.boolean().optional(),
  to: z.string().min(1).max(160).optional(),
  paths: z.array(z.string().trim().min(1)).max(100).optional(),
  /** Provider for a NEW teammate; an existing one keeps its own. */
  teammateProvider: z.string().refine(isAgentProvider).optional(),
  /** Name for a NEW teammate (herdr's `agent start <name>`). */
  teammateName: z.string().trim().min(1).max(32).optional(),
  requestedModel: z.string().trim().min(1).max(200).optional(),
  requestedEffort: z.string().trim().min(1).max(100).optional(),
  taskId: z.string().min(1).optional(), decisionId: z.string().min(1).optional(),
  approved: z.boolean().optional(), inReplyTo: z.string().min(1).optional(),
})

async function readState(sessionId: string, provider: Parameters<typeof readSessionCoordinator>[1]) {
  await adoptOrphanedInteractiveHost(sessionId, provider).catch(() => {})
  const snapshot = await readSessionCoordinator(sessionId, provider)
  const interactive = await readInteractiveCoordinator(sessionId)
  const recoveries = snapshot ? await readInteractiveRecoveries(snapshot.run.id) : []
  const settledExecutions = snapshot ? await readSettledInteractiveExecutions(snapshot.run.id) : []
  const runningAgentIds: string[] = []
  const permissions = snapshot?.agents.flatMap(agent => {
    const info = readViewSessionRunning(agent.sessionId)
    if (info.running) runningAgentIds.push(agent.id)
    return extractPendingPermissions(info.pendingPermissions, { sessionId: agent.sessionId, provider: agent.provider })
      .map(permission => ({ agentId: agent.id, agentName: agent.name, permission }))
  }) ?? []
  const backgroundAgents = snapshot ? coordinatorBackgroundAgents(snapshot.agents, listWaitingSessions()) : []
  return { snapshot, interactive, recoveries, settledExecutions, permissions, runningAgentIds, backgroundAgents }
}

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const provider = new URL(request.url).searchParams.get('provider')
  if (!isAgentProvider(provider)) return NextResponse.json({ error: 'provider is required' }, { status: 400 })
  const { sessionId } = await params
  if (new URL(request.url).searchParams.get('inspect') === 'capabilities') {
    const target = new URL(request.url).searchParams.get('targetProvider') ?? provider
    if (!isAgentProvider(target)) return NextResponse.json({ error: 'Invalid target provider' }, { status: 400 })
    const snapshot = await readSessionCoordinator(sessionId, provider)
    if (!snapshot) return NextResponse.json({ error: 'Enable Coordinator first' }, { status: 409 })
    return NextResponse.json(await readCoordinatorCapabilities(target, snapshot.run.baseCwd), { headers: { 'Cache-Control': 'no-store' } })
  }
  const state = await readState(sessionId, provider)
  if (new URL(request.url).searchParams.get('inspect') === 'recovery') {
    const inspection = state.snapshot ? await inspectCoordinatorRecovery(state.snapshot) : null
    return NextResponse.json({ inspection }, { headers: { 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Provide an action, task text, provider, and stable request ID' }, { status: 400 })
  const body = parsed.data
  const { sessionId } = await params
  try {
    if (body.expectedRunId) {
      const snapshot = await readSessionCoordinator(sessionId, body.provider)
      if (snapshot?.run.id !== body.expectedRunId) throw new Error('Coordinator team changed; refresh before sending to this conversation')
      if (body.expectedAgent && !snapshot.agents.some(agent => agent.id === body.expectedAgent!.id && agent.sessionId === body.expectedAgent!.sessionId && agent.provider === body.expectedAgent!.provider)) {
        throw new Error('Teammate identity changed; refresh before sending')
      }
    }
    if (body.action === 'native-answer') {
      if (!body.expectedRunId) throw new Error('Bind the team before answering a native request')
      const receipt = await readCoordinatorNativeAnswerReceipt(sessionId, body.provider, body.expectedRunId, body.requestId)
      if (receipt) return NextResponse.json({ result: receipt, ...await readState(sessionId, body.provider) }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (body.action === 'integrate-result') {
      if (!body.taskId || !body.token) throw new Error('Review the result before integrating')
      const result = await integrateCoordinatorResult(sessionId, body.provider, body.taskId, body.token, body.requestId)
      return NextResponse.json({ result, ...await readState(sessionId, body.provider) })
    }
    if (body.action === 'disable' || body.action === 'enable') {
      const info = body.action === 'enable' ? await readViewSessionInfo(sessionId, body.provider).catch(() => null) : null
      await setInteractiveCoordinatorEnabled({ sessionId, provider: body.provider, requestId: body.requestId, enabled: body.action === 'enable', cwd: info?.cwd || body.cwd, autoContinue: body.autoContinue })
      return NextResponse.json({ result: { configured: true }, ...await readState(sessionId, body.provider) }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (body.action === 'start-workflow' || body.action === 'delegate' || body.action === 'settings') {
      const info = await readViewSessionInfo(sessionId, body.provider).catch(() => null)
      const cwd = info?.cwd || body.cwd
      if (!cwd) throw new Error('Open a local project conversation before delegating')
      await configureInteractiveCoordinator({ sessionId, provider: body.provider, cwd })
    }
    const identity = await sessionCoordinatorIdentity(sessionId, body.provider, body.expectedRunId)
    if (body.action === 'start-workflow') {
      const result = await startInteractiveWorkflow(identity, { requestId: body.requestId, playbook: body.playbook, args: body.workflowArgs })
      return NextResponse.json({ result, ...await readState(sessionId, body.provider) }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const result = await runExternalProtocolIdempotent(identity, `chat_${body.action}`, body.requestId, async () => {
      if (body.action === 'native-answer') {
        if (!body.expectedRunId) throw new Error('Bind the team before answering a native request')
        return answerCoordinatorNativePermission(identity, body)
      }
      if (body.action === 'settings') {
        const snapshot = await readSessionCoordinator(sessionId, body.provider)
        await configureInteractiveCoordinator({ sessionId, provider: body.provider, cwd: snapshot!.run.baseCwd, autoContinue: body.autoContinue, useWorktrees: body.useWorktrees, maxAgents: body.maxAgents, budget: body.budget })
        return { configured: true }
      }
      if (body.action === 'reconcile') {
        if (!body.batchId || body.received === undefined) throw new Error('Select the delivery batch and its observed outcome')
        await reconcileInteractiveDelivery(sessionId, body.batchId, body.received)
        return { reconciled: true }
      }
      if (body.action === 'interrupt-agent') {
        if (!body.to) throw new Error('Choose the teammate to interrupt')
        await interruptInteractiveAgent(identity, body.to)
        return { interrupted: true }
      }
      if (body.action === 'cancel-task') {
        if (!body.taskId) throw new Error('Choose the task to cancel')
        return cancelInteractiveTask(identity, body.taskId, body.detail)
      }
      if (body.action === 'reconcile-agent') {
        if (!body.to) throw new Error('Choose the settled teammate execution')
        await reconcileSettledInteractiveExecution(identity, body.to)
        return { acknowledged: true }
      }
      if (body.action === 'resume-agent') {
        if (!body.to) throw new Error('Choose the teammate to resume')
        await resumeInteractiveAgent(identity, body.to)
        return { resumed: true }
      }
      if (body.action === 'delegate') return createExternalProtocolTask(identity, {
        assignTo: body.to ?? 'auto', title: body.detail.split('\n')[0]!.slice(0, 160), detail: body.detail, paths: body.paths,
        requestedProvider: body.teammateProvider,
        requestedModel: body.requestedModel, requestedEffort: body.requestedEffort,
        teammateName: body.teammateName,
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
