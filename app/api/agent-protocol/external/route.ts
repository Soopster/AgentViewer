import { NextResponse } from 'next/server'
import {
  claimExternalProtocolTask,
  completeExternalProtocolTask,
  createExternalProtocolRun,
  createExternalProtocolTask,
  failExternalProtocolTask,
  finalizeExternalProtocolRun,
  joinExternalProtocolRun,
  publishExternalProtocolFinding,
  readExternalProtocolInbox,
  readExternalProtocolRun,
  reportExternalProtocolProgress,
  requestExternalProtocolLocks,
  resumeExternalProtocolParticipant,
  reviewExternalProtocolPlan,
  sendExternalProtocolMessage,
  submitExternalProtocolPlan,
} from '@/lib/agentCoordination'
import type { ExternalProtocolIdentity } from '@/lib/agentProtocol'
import { isAgentProvider } from '@/lib/provider'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown): string | undefined {
  const result = text(value)
  return result || undefined
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
    : []
}

function identity(body: Record<string, unknown>): ExternalProtocolIdentity {
  const runId = text(body.runId)
  const agentId = text(body.agentId)
  const token = text(body.token)
  if (!runId || !agentId || !token) throw new Error('Coordinator participant capability is required')
  return { runId, agentId, token }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'JSON body is required' }, { status: 400 })
  const action = text(body.action)
  try {
    let result: unknown
    if (action === 'create_run') {
      if (!isAgentProvider(body.provider)) throw new Error('Valid provider is required')
      result = await createExternalProtocolRun({
        prompt: text(body.prompt),
        baseCwd: text(body.cwd) || process.cwd(),
        provider: body.provider,
        participantName: text(body.name),
        maxAgents: Number(body.maxAgents) || undefined,
        gateCommand: optionalText(body.gateCommand),
        requirePlanApproval: body.requirePlanApproval === true,
      })
    } else if (action === 'join_run') {
      if (!isAgentProvider(body.provider)) throw new Error('Valid provider is required')
      result = await joinExternalProtocolRun({
        runId: text(body.runId),
        provider: body.provider,
        participantName: text(body.name),
        cwd: text(body.cwd) || process.cwd(),
      })
    } else if (action === 'resume') {
      result = await resumeExternalProtocolParticipant(identity(body))
    } else if (action === 'status') {
      result = await readExternalProtocolRun(identity(body))
    } else if (action === 'create_task') {
      result = await createExternalProtocolTask(identity(body), {
        title: text(body.title),
        detail: text(body.detail),
        paths: strings(body.paths),
        dependsOn: strings(body.dependsOn),
      })
    } else if (action === 'claim_task') {
      result = await claimExternalProtocolTask(identity(body), optionalText(body.taskId))
    } else if (action === 'read_inbox') {
      result = await readExternalProtocolInbox(identity(body), {
        after: optionalText(body.after),
        limit: Number(body.limit) || undefined,
        acknowledge: body.acknowledge !== false,
      })
    } else if (action === 'send_message') {
      result = await sendExternalProtocolMessage(identity(body), {
        to: text(body.to),
        body: text(body.message),
      })
    } else if (action === 'request_locks') {
      result = await requestExternalProtocolLocks(identity(body), strings(body.paths))
    } else if (action === 'progress') {
      const status = text(body.status)
      if (!['ready', 'working', 'idle', 'blocked', 'heartbeat'].includes(status)) {
        throw new Error('Invalid progress status')
      }
      result = await reportExternalProtocolProgress(identity(body), {
        status: status as 'ready' | 'working' | 'idle' | 'blocked' | 'heartbeat',
        taskId: optionalText(body.taskId),
        summary: optionalText(body.summary),
        detail: optionalText(body.detail),
      })
    } else if (action === 'finding') {
      const kind = text(body.kind)
      if (!['finding', 'learning', 'handoff', 'review.requested'].includes(kind)) throw new Error('Invalid finding kind')
      result = await publishExternalProtocolFinding(identity(body), {
        kind: kind as 'finding' | 'learning' | 'handoff' | 'review.requested',
        summary: text(body.summary),
        detail: optionalText(body.detail),
        taskId: optionalText(body.taskId),
      })
    } else if (action === 'submit_plan') {
      result = await submitExternalProtocolPlan(identity(body), {
        taskId: text(body.taskId),
        summary: text(body.summary),
        detail: optionalText(body.detail),
      })
    } else if (action === 'review_plan') {
      result = await reviewExternalProtocolPlan(identity(body), {
        taskId: text(body.taskId),
        approved: body.approved === true,
        summary: optionalText(body.summary),
        detail: optionalText(body.detail),
      })
    } else if (action === 'complete_task') {
      result = await completeExternalProtocolTask(identity(body), {
        taskId: text(body.taskId),
        summary: text(body.summary),
        detail: optionalText(body.detail),
      })
    } else if (action === 'fail_task') {
      result = await failExternalProtocolTask(identity(body), {
        taskId: text(body.taskId),
        summary: text(body.summary),
        detail: optionalText(body.detail),
      })
    } else if (action === 'finalize_run') {
      result = await finalizeExternalProtocolRun(identity(body), text(body.summary))
    } else {
      return NextResponse.json({ error: `Unknown external Coordinator action: ${action || '(missing)'}` }, { status: 400 })
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Coordinator action failed'
    const status = /capability/i.test(message) ? 403 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
