import { NextResponse } from 'next/server'
import {
  claimExternalProtocolTask,
  completeExternalProtocolTask,
  createExternalProtocolRun,
  createExternalProtocolTask,
  failExternalProtocolTask,
  finalizeExternalProtocolRun,
  handoffExternalProtocolTask,
  joinExternalProtocolRun,
  listRunPlaybooks,
  loadRunPlaybook,
  publishExternalProtocolFinding,
  readExternalProtocolInbox,
  readExternalProtocolStatus,
  releaseExternalProtocolTask,
  reportExternalProtocolProgress,
  requestExternalProtocolLocks,
  resumeExternalProtocolParticipant,
  reviewExternalProtocolPlan,
  runExternalProtocolIdempotent,
  saveExternalProtocolPlaybook,
  sendExternalProtocolMessage,
  submitExternalProtocolPlan,
  waitForExternalProtocolChange,
} from '@/lib/agentCoordination'
import {
  EXTERNAL_COORD_PROTOCOL_VERSION,
  parseRunPlaybook,
  type ExternalProtocolCapabilities,
  type ExternalProtocolClient,
  type ExternalProtocolIdentity,
  type ProtocolFailureClass,
  type ProtocolMessageKind,
  type ProtocolMessagePriority,
} from '@/lib/agentProtocol'
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

function negotiation(body: Record<string, unknown>): {
  client: ExternalProtocolClient
  capabilities: ExternalProtocolCapabilities
} {
  const clientRecord = body.client && typeof body.client === 'object' && !Array.isArray(body.client)
    ? body.client as Record<string, unknown>
    : {}
  const capabilityRecord = body.capabilities && typeof body.capabilities === 'object' && !Array.isArray(body.capabilities)
    ? body.capabilities as Record<string, unknown>
    : {}
  return {
    client: {
      name: text(clientRecord.name) || 'legacy-mcp-client',
      version: optionalText(clientRecord.version),
      protocolVersion: Number(clientRecord.protocolVersion) || 1,
    },
    capabilities: {
      unattended: capabilityRecord.unattended === true || undefined,
      sessionResume: capabilityRecord.sessionResume === true || undefined,
      midTurnSteer: capabilityRecord.midTurnSteer === true || undefined,
      filesystemWrite: capabilityRecord.filesystemWrite === true || undefined,
      git: capabilityRecord.git === true || undefined,
      browser: capabilityRecord.browser === true || undefined,
      maxParallelTasks: Number(capabilityRecord.maxParallelTasks) || undefined,
      tools: strings(capabilityRecord.tools),
    },
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'JSON body is required' }, { status: 400 })
  const action = text(body.action)
  try {
    let result: unknown
    const requestId = optionalText(body.requestId)
    const participantIdentity = ['create_run', 'join_run', 'list_playbooks'].includes(action) ? null : identity(body)
    const mutate = <T>(operation: () => Promise<T>) => {
      if (!participantIdentity) return operation()
      return runExternalProtocolIdempotent(participantIdentity, action, requestId, operation)
    }
    if (action === 'create_run') {
      if (!isAgentProvider(body.provider)) throw new Error('Valid provider is required')
      const cwd = text(body.cwd) || process.cwd()
      const playbookName = optionalText(body.playbookName)
      const playbook = playbookName
        ? await loadRunPlaybook(cwd, playbookName)
        : body.playbook !== undefined
          ? parseRunPlaybook(body.playbook)
          : undefined
      result = await createExternalProtocolRun({
        prompt: text(body.prompt) || (playbook ? `Playbook run: ${playbook.name}` : ''),
        baseCwd: cwd,
        provider: body.provider,
        participantName: text(body.name),
        ...negotiation(body),
        maxAgents: Number(body.maxAgents) || undefined,
        gateCommand: optionalText(body.gateCommand),
        requirePlanApproval: body.requirePlanApproval === true ? true : undefined,
        playbook,
        playbookArgs: body.args,
      })
    } else if (action === 'join_run') {
      if (!isAgentProvider(body.provider)) throw new Error('Valid provider is required')
      result = await joinExternalProtocolRun({
        runId: optionalText(body.runId),
        provider: body.provider,
        participantName: text(body.name),
        cwd: text(body.cwd) || process.cwd(),
        ...negotiation(body),
      })
    } else if (action === 'resume') {
      result = await resumeExternalProtocolParticipant(participantIdentity!, negotiation(body))
    } else if (action === 'status') {
      result = await readExternalProtocolStatus(participantIdentity!)
    } else if (action === 'wait') {
      result = await waitForExternalProtocolChange(participantIdentity!, {
        cursor: optionalText(body.cursor),
        timeoutMs: typeof body.timeoutMs === 'number' && Number.isFinite(body.timeoutMs)
          ? body.timeoutMs
          : undefined,
      })
    } else if (action === 'create_task') {
      result = await mutate(() => createExternalProtocolTask(participantIdentity!, {
        title: text(body.title),
        detail: text(body.detail),
        paths: strings(body.paths),
        dependsOn: strings(body.dependsOn),
        phase: optionalText(body.phase),
      }))
    } else if (action === 'claim_task') {
      result = await mutate(() => claimExternalProtocolTask(participantIdentity!, optionalText(body.taskId)))
    } else if (action === 'release_task') {
      result = await mutate(() => releaseExternalProtocolTask(participantIdentity!, {
        taskId: text(body.taskId),
        reason: optionalText(body.reason),
      }))
    } else if (action === 'read_inbox') {
      result = await readExternalProtocolInbox(identity(body), {
        after: optionalText(body.after),
        limit: Number(body.limit) || undefined,
        acknowledge: body.acknowledge !== false,
      })
    } else if (action === 'send_message') {
      const kind = text(body.kind) || 'request'
      const priority = text(body.priority) || (kind === 'status' ? 'status' : 'normal')
      if (!['request', 'response', 'status', 'finding', 'handoff', 'review_request', 'review_result'].includes(kind)) {
        throw new Error('Invalid message kind')
      }
      if (!['urgent', 'normal', 'status'].includes(priority)) throw new Error('Invalid message priority')
      result = await mutate(() => sendExternalProtocolMessage(participantIdentity!, {
        to: text(body.to),
        body: text(body.message),
        kind: kind as ProtocolMessageKind,
        priority: priority as ProtocolMessagePriority,
        replyRequired: body.replyRequired === true,
        correlationId: optionalText(body.correlationId),
        inReplyTo: optionalText(body.inReplyTo),
      }))
    } else if (action === 'handoff_task') {
      const failureClass = text(body.failureClass)
      if (!['rate_limited', 'authentication_failed', 'context_exhausted', 'approval_blocked', 'cli_missing', 'transient_transport', 'provider_failure'].includes(failureClass)) {
        throw new Error('Invalid provider failure class')
      }
      result = await mutate(() => handoffExternalProtocolTask(participantIdentity!, {
        taskId: text(body.taskId),
        summary: text(body.summary),
        detail: optionalText(body.detail),
        failureClass: failureClass as ProtocolFailureClass,
      }))
    } else if (action === 'request_locks') {
      result = await mutate(() => requestExternalProtocolLocks(participantIdentity!, strings(body.paths)))
    } else if (action === 'progress') {
      const status = text(body.status)
      if (!['ready', 'working', 'idle', 'blocked', 'heartbeat'].includes(status)) {
        throw new Error('Invalid progress status')
      }
      result = await mutate(() => reportExternalProtocolProgress(participantIdentity!, {
        status: status as 'ready' | 'working' | 'idle' | 'blocked' | 'heartbeat',
        taskId: optionalText(body.taskId),
        summary: optionalText(body.summary),
        detail: optionalText(body.detail),
      }))
    } else if (action === 'finding') {
      const kind = text(body.kind)
      if (!['finding', 'learning', 'handoff', 'review.requested'].includes(kind)) throw new Error('Invalid finding kind')
      result = await mutate(() => publishExternalProtocolFinding(participantIdentity!, {
        kind: kind as 'finding' | 'learning' | 'handoff' | 'review.requested',
        summary: text(body.summary),
        detail: optionalText(body.detail),
        taskId: optionalText(body.taskId),
      }))
    } else if (action === 'submit_plan') {
      result = await mutate(() => submitExternalProtocolPlan(participantIdentity!, {
        taskId: text(body.taskId),
        summary: text(body.summary),
        detail: optionalText(body.detail),
      }))
    } else if (action === 'review_plan') {
      result = await mutate(() => reviewExternalProtocolPlan(participantIdentity!, {
        taskId: text(body.taskId),
        approved: body.approved === true,
        summary: optionalText(body.summary),
        detail: optionalText(body.detail),
      }))
    } else if (action === 'complete_task') {
      result = await mutate(() => completeExternalProtocolTask(participantIdentity!, {
        taskId: text(body.taskId),
        summary: text(body.summary),
        detail: optionalText(body.detail),
      }))
    } else if (action === 'fail_task') {
      result = await mutate(() => failExternalProtocolTask(participantIdentity!, {
        taskId: text(body.taskId),
        summary: text(body.summary),
        detail: optionalText(body.detail),
      }))
    } else if (action === 'finalize_run') {
      result = await mutate(() => finalizeExternalProtocolRun(participantIdentity!, text(body.summary)))
    } else if (action === 'save_playbook') {
      result = await mutate(() => saveExternalProtocolPlaybook(participantIdentity!, {
        name: text(body.playbookName),
        description: optionalText(body.description),
        argsHint: optionalText(body.argsHint),
      }))
    } else if (action === 'list_playbooks') {
      result = { playbooks: await listRunPlaybooks(text(body.cwd) || process.cwd()) }
    } else {
      return NextResponse.json({ error: `Unknown external Coordinator action: ${action || '(missing)'}` }, { status: 400 })
    }
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Agent-Viewer-Coord-Protocol': String(EXTERNAL_COORD_PROTOCOL_VERSION),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Coordinator action failed'
    const status = /capability/i.test(message) ? 403 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
