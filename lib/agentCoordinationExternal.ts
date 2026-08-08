import {
  claimExternalProtocolTask,
  completeExternalProtocolTask,
  createExternalProtocolRun,
  createExternalProtocolTask,
  failExternalProtocolTask,
  finalizeExternalProtocolRun,
  handoffExternalProtocolTask,
  joinExternalProtocolRun,
  leaveExternalProtocolRun,
  listProtocolRuns,
  listRunPlaybooks,
  loadRunPlaybook,
  listExternalProtocolRoles,
  publishExternalProtocolFinding,
  queryExternalProtocolContext,
  readExternalProtocolInbox,
  readExternalProtocolStatus,
  releaseExternalProtocolTask,
  rememberExternalProtocolMemory,
  reportExternalProtocolProgress,
  requestExternalProtocolLocks,
  resumeExternalProtocolParticipant,
  reviewExternalProtocolPlan,
  runExternalProtocolIdempotent,
  saveExternalProtocolPlaybook,
  saveExternalProtocolRole,
  sendExternalProtocolMessage,
  submitExternalProtocolPlan,
  waitForExternalProtocolChange,
} from './agentCoordination'
import {
  PROTOCOL_FAILURE_CLASSES,
  parseRunPlaybook,
  type ExternalProtocolCapabilities,
  type ExternalProtocolClient,
  type ExternalProtocolIdentity,
  type ProtocolFailureClass,
  type ProtocolMessageKind,
  type ProtocolMessagePriority,
  type ProtocolTaskTargetRole,
} from './agentProtocol'
import { isAgentProvider } from './provider'
import type { AgentProvider } from './types'

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
  provider?: AgentProvider
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
      ahpClientId: optionalText(capabilityRecord.ahpClientId),
      unattended: capabilityRecord.unattended === true || undefined,
      sessionResume: capabilityRecord.sessionResume === true || undefined,
      midTurnSteer: capabilityRecord.midTurnSteer === true || undefined,
      filesystemWrite: capabilityRecord.filesystemWrite === true || undefined,
      git: capabilityRecord.git === true || undefined,
      browser: capabilityRecord.browser === true || undefined,
      maxParallelTasks: Number(capabilityRecord.maxParallelTasks) || undefined,
      tools: strings(capabilityRecord.tools),
    },
    provider: isAgentProvider(body.provider) ? body.provider : undefined,
  }
}

export async function executeExternalCoordinatorAction(body: Record<string, unknown>): Promise<unknown> {
  const action = text(body.action)
  const requestId = optionalText(body.requestId)
  const participantIdentity = ['create_run', 'join_run', 'list_playbooks', 'list_runs'].includes(action) ? null : identity(body)
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
    return createExternalProtocolRun({
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
  }
  if (action === 'join_run') {
    if (!isAgentProvider(body.provider)) throw new Error('Valid provider is required')
    return joinExternalProtocolRun({
      runId: optionalText(body.runId),
      provider: body.provider,
      participantName: text(body.name),
      cwd: text(body.cwd) || process.cwd(),
      ...negotiation(body),
    })
  }
  if (action === 'resume') return resumeExternalProtocolParticipant(participantIdentity!, negotiation(body))
  if (action === 'leave_run') return mutate(() => leaveExternalProtocolRun(participantIdentity!, optionalText(body.reason)))
  if (action === 'status') return readExternalProtocolStatus(participantIdentity!)
  if (action === 'wait') {
    return waitForExternalProtocolChange(participantIdentity!, {
      cursor: optionalText(body.cursor),
      timeoutMs: typeof body.timeoutMs === 'number' && Number.isFinite(body.timeoutMs)
        ? body.timeoutMs
        : undefined,
    })
  }
  if (action === 'create_task') {
    const targetRole = text(body.targetRole) || 'teammate'
    if (!['lead', 'teammate', 'any'].includes(targetRole)) throw new Error('Invalid task target role')
    return mutate(() => createExternalProtocolTask(participantIdentity!, {
      title: text(body.title),
      detail: text(body.detail),
      paths: strings(body.paths),
      dependsOn: strings(body.dependsOn),
      phase: optionalText(body.phase),
      targetRole: targetRole as ProtocolTaskTargetRole,
      roleName: optionalText(body.roleName),
      roleDescription: optionalText(body.roleDescription),
    }))
  }
  if (action === 'claim_task') return mutate(() => claimExternalProtocolTask(participantIdentity!, optionalText(body.taskId)))
  if (action === 'release_task') {
    return mutate(() => releaseExternalProtocolTask(participantIdentity!, {
      taskId: text(body.taskId),
      reason: optionalText(body.reason),
    }))
  }
  if (action === 'read_inbox') {
    return mutate(() => readExternalProtocolInbox(participantIdentity!, {
      after: optionalText(body.after),
      limit: Number(body.limit) || undefined,
      acknowledge: body.acknowledge !== false,
    }))
  }
  if (action === 'send_message') {
    const kind = text(body.kind) || 'request'
    const priority = text(body.priority) || (kind === 'status' ? 'status' : 'normal')
    if (!['request', 'response', 'status', 'finding', 'handoff', 'review_request', 'review_result'].includes(kind)) {
      throw new Error('Invalid message kind')
    }
    if (!['urgent', 'normal', 'status'].includes(priority)) throw new Error('Invalid message priority')
    return mutate(() => sendExternalProtocolMessage(participantIdentity!, {
      to: text(body.to),
      body: text(body.message),
      kind: kind as ProtocolMessageKind,
      priority: priority as ProtocolMessagePriority,
      replyRequired: body.replyRequired === true,
      correlationId: optionalText(body.correlationId),
      inReplyTo: optionalText(body.inReplyTo),
    }))
  }
  if (action === 'handoff_task') {
    const failureClass = text(body.failureClass)
    if (!PROTOCOL_FAILURE_CLASSES.some((entry) => entry === failureClass)) {
      throw new Error('Invalid provider failure class')
    }
    return mutate(() => handoffExternalProtocolTask(participantIdentity!, {
      taskId: text(body.taskId),
      summary: text(body.summary),
      detail: optionalText(body.detail),
      failureClass: failureClass as ProtocolFailureClass,
    }))
  }
  if (action === 'request_locks') return mutate(() => requestExternalProtocolLocks(participantIdentity!, strings(body.paths)))
  if (action === 'progress') {
    const status = text(body.status)
    if (!['ready', 'working', 'idle', 'blocked', 'heartbeat'].includes(status)) {
      throw new Error('Invalid progress status')
    }
    return mutate(() => reportExternalProtocolProgress(participantIdentity!, {
      status: status as 'ready' | 'working' | 'idle' | 'blocked' | 'heartbeat',
      taskId: optionalText(body.taskId),
      summary: optionalText(body.summary),
      detail: optionalText(body.detail),
    }))
  }
  if (action === 'finding') {
    const kind = text(body.kind)
    if (!['finding', 'learning', 'handoff', 'review.requested'].includes(kind)) throw new Error('Invalid finding kind')
    return mutate(() => publishExternalProtocolFinding(participantIdentity!, {
      kind: kind as 'finding' | 'learning' | 'handoff' | 'review.requested',
      summary: text(body.summary),
      detail: optionalText(body.detail),
      taskId: optionalText(body.taskId),
    }))
  }
  if (action === 'query_context') {
    return queryExternalProtocolContext(participantIdentity!, {
      query: text(body.query),
      limit: Number(body.limit) || undefined,
    })
  }
  if (action === 'remember') {
    return mutate(() => rememberExternalProtocolMemory(participantIdentity!, {
      summary: text(body.summary),
      detail: optionalText(body.detail),
    }))
  }
  if (action === 'save_role') {
    return mutate(() => saveExternalProtocolRole(participantIdentity!, {
      name: text(body.name),
      description: text(body.description),
    }))
  }
  if (action === 'list_roles') return listExternalProtocolRoles(participantIdentity!)
  if (action === 'submit_plan') {
    return mutate(() => submitExternalProtocolPlan(participantIdentity!, {
      taskId: text(body.taskId),
      summary: text(body.summary),
      detail: optionalText(body.detail),
    }))
  }
  if (action === 'review_plan') {
    return mutate(() => reviewExternalProtocolPlan(participantIdentity!, {
      taskId: text(body.taskId),
      approved: body.approved === true,
      summary: optionalText(body.summary),
      detail: optionalText(body.detail),
    }))
  }
  if (action === 'complete_task') {
    return mutate(() => completeExternalProtocolTask(participantIdentity!, {
      taskId: text(body.taskId),
      summary: text(body.summary),
      detail: optionalText(body.detail),
    }))
  }
  if (action === 'fail_task') {
    return mutate(() => failExternalProtocolTask(participantIdentity!, {
      taskId: text(body.taskId),
      summary: text(body.summary),
      detail: optionalText(body.detail),
    }))
  }
  if (action === 'finalize_run') return mutate(() => finalizeExternalProtocolRun(participantIdentity!, text(body.summary)))
  if (action === 'save_playbook') {
    return mutate(() => saveExternalProtocolPlaybook(participantIdentity!, {
      name: text(body.playbookName),
      description: optionalText(body.description),
      argsHint: optionalText(body.argsHint),
    }))
  }
  if (action === 'list_playbooks') {
    return { playbooks: await listRunPlaybooks(text(body.cwd) || process.cwd()) }
  }
  if (action === 'list_runs') {
    return { runs: await listProtocolRuns(Number(body.limit) || 20) }
  }
  throw new Error(`Unknown external Coordinator action: ${action || '(missing)'}`)
}
