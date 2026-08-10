import {
  cancelExternalProtocolTurn,
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
  previewExternalProtocolPlaybook,
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
  reviewExternalProtocolPhase,
  reviewExternalProtocolRun,
  resolveExternalProtocolDecision,
  promoteExternalLearningCandidate,
  runExternalProtocolIdempotent,
  saveExternalProtocolPlaybook,
  saveExternalProtocolRole,
  sendExternalProtocolMessage,
  submitExternalProtocolPlan,
  waitForExternalProtocolChange,
} from './agentCoordination'
import {
  PROTOCOL_FAILURE_CLASSES,
  isProtocolAutonomy,
  parseRunPlaybook,
  type ExternalProtocolCapabilities,
  type ExternalProtocolClient,
  type ExternalProtocolIdentity,
  type ProtocolAgentRespondToMode,
  type ProtocolFailureClass,
  type ProtocolMessageKind,
  type ProtocolMessagePriority,
  type ProtocolTaskTargetRole,
  type ProtocolNeedsDecision,
  type ProtocolSeat,
  type ProtocolUsageReceipt,
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

function messageText(body: Record<string, unknown>): string {
  const canonical = text(body.message)
  if (canonical) return canonical
  const compatibilityBody = text(body.body)
  if (compatibilityBody) return compatibilityBody
  return [text(body.summary), text(body.detail)].filter(Boolean).join('\n\n')
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
    : []
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

const RESPOND_TO_MODES = ['owner-only', 'allowlist', 'anyone', 'nobody']

/** Parses the optional respond-to gate from create_run/join_run body fields. Undefined means "not set" (defaults to `anyone` downstream). */
function respondTo(body: Record<string, unknown>): { mode: ProtocolAgentRespondToMode; allowlist?: string[] } | undefined {
  const mode = optionalText(body.respondToMode)
  if (!mode) return undefined
  if (!RESPOND_TO_MODES.includes(mode)) throw new Error(`Invalid respondToMode: ${mode}`)
  if (mode === 'allowlist' && strings(body.respondToAllowlist).length === 0) {
    throw new Error('respondToMode "allowlist" requires a non-empty respondToAllowlist')
  }
  return { mode: mode as ProtocolAgentRespondToMode, allowlist: strings(body.respondToAllowlist) }
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
  const participantIdentity = ['create_run', 'join_run', 'list_playbooks', 'list_runs', 'preview_playbook'].includes(action) ? null : identity(body)
  const mutate = <T>(operation: () => Promise<T>) => {
    if (!participantIdentity) return operation()
    return runExternalProtocolIdempotent(participantIdentity, action, requestId, operation)
  }

  if (action === 'preview_playbook') {
    const cwd = text(body.cwd) || process.cwd()
    const playbookName = optionalText(body.playbookName)
    return previewExternalProtocolPlaybook({
      cwd,
      playbookName,
      playbook: !playbookName && body.playbook !== undefined ? parseRunPlaybook(body.playbook) : undefined,
      args: body.args,
    })
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
      autonomy: isProtocolAutonomy(body.autonomy) ? body.autonomy : undefined,
      acceptanceContract: record(body.acceptanceContract),
      requireReview: body.requireReview === true ? true : undefined,
      budget: record(body.budget),
      playbook,
      playbookArgs: body.args,
      respondTo: respondTo(body),
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
      respondTo: respondTo(body),
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
    const seat = optionalText(body.seat) ?? 'executor'
    if (!['director', 'executor', 'validator', 'watcher'].includes(seat)) throw new Error('Invalid task seat')
    const requestedProvider = optionalText(body.requestedProvider)
    if (requestedProvider && !isAgentProvider(requestedProvider)) throw new Error('Invalid requested provider')
    return mutate(() => createExternalProtocolTask(participantIdentity!, {
      title: text(body.title),
      detail: text(body.detail),
      paths: strings(body.paths),
      dependsOn: strings(body.dependsOn),
      phase: optionalText(body.phase),
      targetRole: targetRole as ProtocolTaskTargetRole,
      roleName: optionalText(body.roleName),
      roleDescription: optionalText(body.roleDescription),
      seat: seat as ProtocolSeat,
      requestedProvider: requestedProvider as AgentProvider | undefined,
      requestedModel: optionalText(body.requestedModel),
      requestedEffort: optionalText(body.requestedEffort),
      verifyCommands: strings(body.verifyCommands),
    }))
  }
  if (action === 'claim_task') return mutate(() => claimExternalProtocolTask(participantIdentity!, optionalText(body.taskId)))
  if (action === 'release_task') {
    return mutate(() => releaseExternalProtocolTask(participantIdentity!, {
      taskId: text(body.taskId),
      reason: optionalText(body.reason),
    }))
  }
  if (action === 'cancel_turn') {
    return mutate(() => cancelExternalProtocolTurn(participantIdentity!, { agentId: text(body.agentId) }))
  }
  if (action === 'read_inbox') {
    return mutate(() => readExternalProtocolInbox(participantIdentity!, {
      after: optionalText(body.after),
      limit: Number(body.limit) || undefined,
      acknowledge: body.acknowledge !== false,
    }))
  }
  if (action === 'send_message') {
    const requestedKind = text(body.kind)
    const kind = requestedKind === 'alert' ? 'request' : requestedKind || 'request'
    const priority = text(body.priority) || (kind === 'status' ? 'status' : 'normal')
    if (!['request', 'response', 'status', 'finding', 'handoff', 'review_request', 'review_result'].includes(kind)) {
      throw new Error('Invalid message kind')
    }
    if (!['urgent', 'normal', 'status'].includes(priority)) throw new Error('Invalid message priority')
    return mutate(() => sendExternalProtocolMessage(participantIdentity!, {
      to: text(body.to),
      body: messageText(body),
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
    const defaultProvider = optionalText(body.defaultProvider)
    if (defaultProvider && !isAgentProvider(defaultProvider)) throw new Error('Invalid defaultProvider')
    return mutate(() => saveExternalProtocolRole(participantIdentity!, {
      name: text(body.name),
      description: text(body.description),
      defaultProvider: defaultProvider as AgentProvider | undefined,
      defaultModel: optionalText(body.defaultModel),
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
  if (action === 'review_phase') {
    return mutate(() => reviewExternalProtocolPhase(participantIdentity!, {
      phase: text(body.phase),
      approved: body.approved === true,
      summary: optionalText(body.summary),
      detail: optionalText(body.detail),
    }))
  }
  if (action === 'review_run') {
    return mutate(() => reviewExternalProtocolRun(participantIdentity!, {
      approved: body.approved === true,
      summary: text(body.summary),
      detail: optionalText(body.detail),
    }))
  }
  if (action === 'resolve_decision') {
    return mutate(() => resolveExternalProtocolDecision(participantIdentity!, {
      taskId: text(body.taskId),
      decisionId: text(body.decisionId),
      answer: text(body.answer),
      deferred: body.deferred === true,
    }))
  }
  if (action === 'promote_learning') {
    const target = text(body.target)
    if (!['playbook', 'role', 'project_memory'].includes(target)) throw new Error('Invalid learning promotion target')
    return mutate(() => promoteExternalLearningCandidate(participantIdentity!, {
      candidateId: text(body.candidateId),
      target: target as 'playbook' | 'role' | 'project_memory',
    }))
  }
  if (action === 'complete_task') {
    const usage = record(body.usage)
    const decisions = Array.isArray(body.needsDecision) ? body.needsDecision.filter((entry): entry is ProtocolNeedsDecision => Boolean(record(entry))) : undefined
    return mutate(() => completeExternalProtocolTask(participantIdentity!, {
      taskId: text(body.taskId),
      summary: text(body.summary),
      detail: optionalText(body.detail),
      actualModel: optionalText(body.actualModel),
      usage: usage as ProtocolUsageReceipt | undefined,
      filesChanged: strings(body.filesChanged),
      commandsRun: strings(body.commandsRun),
      needsDecision: decisions,
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
