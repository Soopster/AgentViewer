import type { SystemMessagePayload } from '@/lib/types'
import { claudeStartupFailureHint, claudeTaskEndCause, formatClaudeRuntimeCounts, formatClaudeRuntimeDetailLines } from '@/lib/claudeSdkFeatures'
import { fmtTokens, safeJson } from './format'

function formatClaudeTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const ms = value > 10_000_000_000 ? value : value * 1000
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function claudeSystemErrorSummary(errorCode: string) {
  if (!errorCode) return ''
  switch (errorCode) {
    case 'model_not_found': return 'Model not available — pick a different model'
    case 'authentication_failed': return 'Authentication failed'
    case 'oauth_org_not_allowed': return 'OAuth org not allowed'
    case 'verification_required': return 'Account verification required'
    case 'account_on_hold': return 'Account on hold'
    case 'cloud_credential_error': return 'Cloud credential error'
    case 'overloaded': return 'Overloaded — retry shortly'
    case 'billing_error': return 'Billing error'
    case 'rate_limit': return 'Rate limited'
    case 'invalid_request': return 'Invalid request'
    case 'server_error': return 'Server error'
    case 'max_output_tokens': return 'Max output tokens reached'
    default: return errorCode.replace(/_/g, ' ')
  }
}

function claudeSystemContext(subtype: string, payload: SystemMessagePayload) {
  const content = typeof payload.content === 'string' ? payload.content : ''
  const stopReason = typeof payload.stop_reason === 'string' ? payload.stop_reason : ''
  const isRefusal = subtype === 'result' && stopReason === 'refusal'
  const additionalContext = typeof payload.additionalContext === 'string' && payload.additionalContext.trim()
    ? payload.additionalContext.trim()
    : payload.hookSpecificOutput
      && typeof payload.hookSpecificOutput === 'object'
      && typeof (payload.hookSpecificOutput as Record<string, unknown>).additionalContext === 'string'
    ? String((payload.hookSpecificOutput as Record<string, unknown>).additionalContext).trim()
    : ''
  const headerLabel = subtype.replace(/_/g, ' ')
  const errorCode = typeof payload.error === 'string' ? payload.error : ''
  const apiErrorStatus = typeof payload.api_error_status === 'number' ? payload.api_error_status : null
  const errorSummary = claudeSystemErrorSummary(errorCode)
  const runtimeCountText = formatClaudeRuntimeCounts(payload).join(' · ')
  const runtimeDetailBody = formatClaudeRuntimeDetailLines(payload).join('\n')
  return { subtype, payload, content, stopReason, isRefusal, additionalContext, headerLabel, errorCode, apiErrorStatus, errorSummary, runtimeCountText, runtimeDetailBody }
}

type ClaudeSystemContext = ReturnType<typeof claudeSystemContext>

function claudeSystemPreview(context: ClaudeSystemContext) {
  const { subtype, payload, content, isRefusal, apiErrorStatus, errorSummary, runtimeCountText } = context

  const withRuntime = (value: string) => runtimeCountText ? `${value} · ${runtimeCountText}` : value
  if (errorSummary) return apiErrorStatus ? `${errorSummary} (HTTP ${apiErrorStatus})` : errorSummary
  if (subtype === 'model_refusal_fallback') {
    const from = typeof payload.original_model === 'string' ? payload.original_model : '?'
    const to = typeof payload.fallback_model === 'string' ? payload.fallback_model : '?'
    const category = typeof payload.api_refusal_category === 'string' ? payload.api_refusal_category : ''
    const verb = payload.direction === 'revert' ? 'Reverted' : 'Fell back'
    // scope 'local' (subagent/side-question/background fork) doesn't touch
    // the session model — say so, or "fell back" reads as a session-wide
    // swap that didn't happen. Absent on older CLIs; treat as session-wide.
    const scopeNote = payload.scope === 'local' ? ' (this response only)' : ''
    return withRuntime(`${verb} ${from} → ${to}${scopeNote}${category ? ` · refusal: ${category}` : ' · refusal'}`)
  }
  if (subtype === 'informational' && content.trim()) {
    const stopped = payload.prevent_continuation === true ? ' · stopped' : ''
    return withRuntime(`${content.replace(/\s+/g, ' ').trim()}${stopped}`)
  }
  if (content.trim()) return withRuntime(content.replace(/\s+/g, ' ').trim())
  if (subtype === 'compact_boundary') return withRuntime('Conversation compacted')
  if (subtype === 'task_started' && typeof payload.description === 'string') return withRuntime(payload.description)
  if (subtype === 'task_progress' && typeof payload.summary === 'string') return withRuntime(payload.summary)
  if (subtype === 'task_updated') {
    if (typeof payload.summary === 'string') return withRuntime(payload.summary)
    const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch as Record<string, unknown> : null
    if (typeof patch?.description === 'string') return withRuntime(patch.description)
    if (typeof patch?.status === 'string') return withRuntime(`Task ${patch.status}`)
  }
  if (subtype === 'task_notification' && typeof payload.summary === 'string') return withRuntime(payload.summary)
  if (subtype === 'tool_progress' && typeof payload.tool_name === 'string') {
    const retry = payload.subagent_retry && typeof payload.subagent_retry === 'object'
      ? payload.subagent_retry as Record<string, unknown>
      : null
    const retryText = retry && typeof retry.attempt === 'number' && typeof retry.max_retries === 'number'
      ? ` · retry ${retry.attempt}/${retry.max_retries}`
      : ''
    return withRuntime(`${payload.tool_name} · ${typeof payload.elapsed_time_seconds === 'number' ? `${payload.elapsed_time_seconds}s` : 'running'}${retryText}`)
  }
  if (subtype === 'tool_use_summary' && typeof payload.summary === 'string') return withRuntime(payload.summary)
  if (subtype === 'status' && typeof payload.status === 'string') return withRuntime(payload.status)
  if (subtype === 'hook_started') {
    const hookName = typeof payload.hook_name === 'string' ? payload.hook_name : 'hook'
    const event = typeof payload.hook_event === 'string' ? payload.hook_event : ''
    return withRuntime(event ? `${hookName} ▸ ${event}` : hookName)
  }
  if (subtype === 'hook_progress') {
    const hookName = typeof payload.hook_name === 'string' ? payload.hook_name : 'hook'
    const output = typeof payload.output === 'string' && payload.output ? payload.output
      : typeof payload.stdout === 'string' ? payload.stdout : ''
    return withRuntime(output ? `${hookName} · ${output.replace(/\s+/g, ' ').trim().slice(0, 120)}` : hookName)
  }
  if (subtype === 'hook_response') {
    const hookName = typeof payload.hook_name === 'string' ? payload.hook_name : 'hook'
    const outcome = typeof payload.outcome === 'string' ? payload.outcome : ''
    return withRuntime(outcome ? `${hookName} ${outcome}` : hookName)
  }
  if (subtype === 'memory_recall') {
    const memories = Array.isArray(payload.memories) ? payload.memories : []
    const mode = typeof payload.mode === 'string' ? payload.mode : ''
    const count = memories.length
    return withRuntime(`${count} memor${count === 1 ? 'y' : 'ies'}${mode ? ` · ${mode}` : ''}`)
  }
  if (subtype === 'rate_limit_event') {
    const info = payload.rate_limit_info && typeof payload.rate_limit_info === 'object'
      ? payload.rate_limit_info as Record<string, unknown>
      : null
    const status = typeof info?.status === 'string' ? info.status : 'updated'
    const utilization = typeof info?.utilization === 'number' ? ` · ${Math.round(info.utilization * 100)}%` : ''
    return `Rate limit ${status}${utilization}${typeof info?.overageEnabled === 'boolean' ? ` · extra usage ${info.overageEnabled ? 'enabled' : 'disabled'}` : ''}`
  }
  if (subtype === 'prompt_suggestion' && typeof payload.suggestion === 'string') return payload.suggestion
  if (subtype === 'auth_status') {
    if (typeof payload.error === 'string') return payload.error
    if (payload.isAuthenticating === true) return 'Authenticating'
    return 'Authentication status'
  }
  if (subtype === 'files_persisted') {
    const files = Array.isArray(payload.files) ? payload.files.length : 0
    const failed = Array.isArray(payload.failed) ? payload.failed.length : 0
    return `${files} file${files === 1 ? '' : 's'} persisted${failed ? ` · ${failed} failed` : ''}`
  }
  if (subtype === 'permission_denied') {
    const tool = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool'
    const reason = typeof payload.decision_reason === 'string' ? payload.decision_reason : ''
    return reason ? `${tool} denied · ${reason}` : `${tool} denied`
  }
  if (subtype === 'notification' && typeof payload.text === 'string') return payload.text
  if (subtype === 'plugin_install') {
    const name = typeof payload.name === 'string' ? payload.name : 'plugin'
    const status = typeof payload.status === 'string' ? payload.status : 'updated'
    return `${name} ${status}`
  }
  if (subtype === 'elicitation_complete' && typeof payload.mcp_server_name === 'string') return `${payload.mcp_server_name} elicitation complete`
  if (subtype === 'mirror_error' && typeof payload.error === 'string') return payload.error
  if (subtype === 'api_retry') {
    const attempt = typeof payload.attempt === 'number' ? payload.attempt : undefined
    const max = typeof payload.max_retries === 'number' ? payload.max_retries : undefined
    const delayMs = typeof payload.retry_delay_ms === 'number' ? payload.retry_delay_ms : undefined
    const status = typeof payload.error_status === 'number' ? payload.error_status : null
    const parts: string[] = []
    if (attempt != null && max != null) parts.push(`attempt ${attempt}/${max}`)
    else if (attempt != null) parts.push(`attempt ${attempt}`)
    if (delayMs != null) parts.push(`retry in ${(delayMs / 1000).toFixed(1)}s`)
    if (status != null) parts.push(`HTTP ${status}`)
    // SDK 0.3.261: a first-byte timeout retries with error_status null, so
    // without this the card reads as a bare "attempt 1/1" with no cause.
    const noResponse = payload.no_response && typeof payload.no_response === 'object'
      ? payload.no_response as { waited_ms?: unknown }
      : null
    if (noResponse) {
      parts.push(typeof noResponse.waited_ms === 'number'
        ? `no response in ${(noResponse.waited_ms / 1000).toFixed(1)}s`
        : 'no response')
    }
    return parts.length > 0 ? parts.join(' · ') : 'API retry'
  }
  if (subtype === 'session_state_changed') {
    const state = typeof payload.state === 'string' ? payload.state : 'changed'
    return `Session ${state}`
  }
  if (subtype === 'local_command_output') {
    if (content) return content.replace(/\s+/g, ' ').trim()
    return 'Local command output'
  }
  if (subtype === 'result') {
    const resultSubtype = typeof payload.result_subtype === 'string' ? payload.result_subtype : null
    const durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : null
    const turns = typeof payload.num_turns === 'number' ? payload.num_turns : null
    const errors = Array.isArray(payload.errors) ? payload.errors : []
    const head = isRefusal
      ? 'Run refused'
      : resultSubtype && resultSubtype !== 'success'
      ? resultSubtype.replace(/_/g, ' ')
      : 'Run completed'
    const parts: string[] = [head]
    if (turns != null) parts.push(`${turns} turn${turns === 1 ? '' : 's'}`)
    if (durationMs != null) parts.push(`${(durationMs / 1000).toFixed(1)}s`)
    if (errors.length > 0 && typeof errors[0] === 'string') parts.push(errors[0])
    return parts.join(' · ')
  }
  // Surface a useful string field on unknown subtypes instead of "Claude system event"
  for (const key of ['message', 'text', 'summary', 'description', 'error', 'content'] as const) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) {
      return withRuntime(value.replace(/\s+/g, ' ').trim())
    }
  }
  return withRuntime('Claude system event')

}

function claudeSystemBadges(context: ClaudeSystemContext) {
  const { subtype, payload, stopReason, errorCode, apiErrorStatus } = context

  const nextBadges: string[] = []
  if (errorCode) nextBadges.push(errorCode)
  if (apiErrorStatus != null) nextBadges.push(`HTTP ${apiErrorStatus}`)
  if (typeof payload.status === 'string') nextBadges.push(payload.status)
  if (typeof payload.task_id === 'string') nextBadges.push(payload.task_id.slice(0, 8))
  const taskEndCause = claudeTaskEndCause(payload)
  if (taskEndCause) nextBadges.push(taskEndCause)
  if (typeof payload.startup_failure_reason === 'string') nextBadges.push(payload.startup_failure_reason.replace(/_/g, ' '))
  if (subtype === 'model_refusal_no_fallback' && typeof payload.api_refusal_category === 'string') {
    nextBadges.push(payload.api_refusal_category)
  }
  if (subtype === 'conversation_reset' && typeof payload.new_conversation_id === 'string') {
    nextBadges.push(payload.new_conversation_id.slice(0, 8))
  }
  if (typeof payload.tool_use_id === 'string') nextBadges.push(payload.tool_use_id.slice(0, 8))
  if (typeof payload.tool_name === 'string') nextBadges.push(payload.tool_name)
  if (typeof payload.hook_name === 'string') nextBadges.push(payload.hook_name)
  if (typeof payload.hook_event === 'string') nextBadges.push(payload.hook_event)
  if (typeof payload.outcome === 'string') nextBadges.push(payload.outcome)
  if (stopReason) nextBadges.push(`stop ${stopReason}`)
  if (typeof payload.mcp_server_name === 'string') nextBadges.push(payload.mcp_server_name)
  if (typeof payload.subagent_type === 'string') nextBadges.push(payload.subagent_type)
  if (payload.subagent_retry && typeof payload.subagent_retry === 'object') {
    const retry = payload.subagent_retry as Record<string, unknown>
    if (typeof retry.attempt === 'number' && typeof retry.max_retries === 'number') nextBadges.push(`retry ${retry.attempt}/${retry.max_retries}`)
    if (typeof retry.error_status === 'number') nextBadges.push(`HTTP ${retry.error_status}`)
    if (typeof retry.error_category === 'string') nextBadges.push(retry.error_category)
  }
  if (typeof payload.task_type === 'string' && payload.task_type !== payload.subagent_type) nextBadges.push(payload.task_type)
  if (subtype === 'rate_limit_event' && payload.rate_limit_info && typeof payload.rate_limit_info === 'object') {
    const info = payload.rate_limit_info as Record<string, unknown>
    if (typeof info.rateLimitType === 'string') nextBadges.push(info.rateLimitType)
    if (typeof info.overageEnabled === 'boolean') nextBadges.push(`extra usage ${info.overageEnabled ? 'enabled' : 'disabled'}`)
    if (typeof info.overageStatus === 'string') nextBadges.push(`overage ${info.overageStatus}`)
    if (info.isUsingOverage === true) nextBadges.push('using overage')
  }
  if (subtype === 'notification' && typeof payload.priority === 'string') nextBadges.push(payload.priority)
  if (subtype === 'plugin_install' && typeof payload.name === 'string') nextBadges.push(payload.name)
  if (subtype === 'model_refusal_fallback') {
    if (typeof payload.original_model === 'string') nextBadges.push(payload.original_model)
    if (typeof payload.fallback_model === 'string') nextBadges.push(`→ ${payload.fallback_model}`)
    if (typeof payload.api_refusal_category === 'string') nextBadges.push(payload.api_refusal_category)
    if (typeof payload.direction === 'string') nextBadges.push(payload.direction)
    if (payload.scope === 'local') nextBadges.push('local')
  }
  if (subtype === 'informational') {
    if (typeof payload.level === 'string' && payload.level !== 'info') nextBadges.push(payload.level)
    if (payload.prevent_continuation === true) nextBadges.push('stopped')
  }
  nextBadges.push(...formatClaudeRuntimeCounts(payload))
  if (subtype === 'memory_recall' && typeof payload.mode === 'string') nextBadges.push(payload.mode)
  if (subtype === 'compact_boundary' && payload.compact_metadata && typeof payload.compact_metadata === 'object') {
    const compact = payload.compact_metadata as { trigger?: unknown; pre_tokens?: unknown }
    if (typeof compact.trigger === 'string') nextBadges.push(compact.trigger)
    if (typeof compact.pre_tokens === 'number') nextBadges.push(`${fmtTokens(compact.pre_tokens)} pre`)
  }
  return [...new Set(nextBadges)]

}

function claudeSystemBody(context: ClaudeSystemContext) {
  const { subtype, payload, content, stopReason, isRefusal, additionalContext, runtimeDetailBody } = context

  let main = ''
  if (subtype === 'task_notification') {
    main = content || (typeof payload.result === 'string' ? payload.result : '')
  }
  else if (subtype === 'task_progress') {
    main = [content, typeof payload.last_tool_name === 'string' ? `Last tool: ${payload.last_tool_name}` : ''].filter(Boolean).join('\n')
  }
  else if (subtype === 'task_updated') {
    const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch as Record<string, unknown> : null
    const lines = [
      content,
      typeof patch?.description === 'string' ? `Description: ${patch.description}` : '',
      typeof patch?.status === 'string' ? `Status: ${patch.status}` : '',
      typeof patch?.error === 'string' ? `Error: ${patch.error}` : '',
      typeof patch?.total_paused_ms === 'number' ? `Paused: ${(patch.total_paused_ms / 1000).toFixed(1)}s` : '',
    ].filter(Boolean)
    main = lines.join('\n')
  }
  else if (subtype === 'hook_started' || subtype === 'hook_progress' || subtype === 'hook_response') {
    main = [
      content,
      typeof payload.output === 'string' ? payload.output : '',
      typeof payload.stdout === 'string' ? payload.stdout : '',
      typeof payload.stderr === 'string' ? payload.stderr : '',
      additionalContext ? `Additional context:\n${additionalContext}` : '',
    ].filter(Boolean).join('\n\n')
  }
  else if (subtype === 'memory_recall') {
    const memories = Array.isArray(payload.memories) ? payload.memories as Array<Record<string, unknown>> : []
    const lines = memories.map((m) => {
      const scope = typeof m.scope === 'string' ? m.scope : ''
      const path = typeof m.path === 'string' ? m.path : ''
      const memContent = typeof m.content === 'string' ? m.content : ''
      const header = scope ? `[${scope}] ${path}` : path
      return memContent ? `${header}\n${memContent}` : header
    })
    main = lines.join('\n\n')
  }
  else if (subtype === 'rate_limit_event') {
    const info = payload.rate_limit_info && typeof payload.rate_limit_info === 'object'
      ? payload.rate_limit_info as Record<string, unknown>
      : null
    const lines = [
      typeof info?.status === 'string' ? `Status: ${info.status}` : '',
      typeof info?.rateLimitType === 'string' ? `Limit: ${info.rateLimitType}` : '',
      typeof info?.utilization === 'number' ? `Utilization: ${Math.round(info.utilization * 100)}%` : '',
      formatClaudeTimestamp(info?.resetsAt) ? `Resets: ${formatClaudeTimestamp(info?.resetsAt)}` : '',
      typeof info?.overageEnabled === 'boolean' ? `Extra usage: ${info.overageEnabled ? 'enabled' : 'disabled'}` : '',
      typeof info?.overageStatus === 'string' ? `Overage: ${info.overageStatus}` : '',
      formatClaudeTimestamp(info?.overageResetsAt) ? `Overage resets: ${formatClaudeTimestamp(info?.overageResetsAt)}` : '',
      typeof info?.overageDisabledReason === 'string' ? `Overage disabled: ${info.overageDisabledReason}` : '',
    ].filter(Boolean)
    main = lines.join('\n')
  }
  else if (subtype === 'auth_status') {
    const output = Array.isArray(payload.output)
      ? payload.output.filter((entry): entry is string => typeof entry === 'string').join('\n')
      : ''
    main = [content, output, typeof payload.error === 'string' ? payload.error : ''].filter(Boolean).join('\n')
  }
  else if (subtype === 'files_persisted') {
    const files = Array.isArray(payload.files) ? payload.files as Array<Record<string, unknown>> : []
    const failed = Array.isArray(payload.failed) ? payload.failed as Array<Record<string, unknown>> : []
    main = [
      ...files.map((file) => {
        const name = typeof file.filename === 'string' ? file.filename : 'file'
        const id = typeof file.file_id === 'string' ? file.file_id : ''
        return id ? `${name} (${id})` : name
      }),
      ...failed.map((file) => {
        const name = typeof file.filename === 'string' ? file.filename : 'file'
        const err = typeof file.error === 'string' ? file.error : 'failed'
        return `${name}: ${err}`
      }),
    ].join('\n')
  }
  else if (subtype === 'permission_denied') {
    main = [
      content,
      typeof payload.message === 'string' ? payload.message : '',
      typeof payload.decision_reason === 'string' ? `Reason: ${payload.decision_reason}` : '',
    ].filter(Boolean).join('\n')
  }
  else if (subtype === 'plugin_install') {
    main = [content, typeof payload.error === 'string' ? payload.error : ''].filter(Boolean).join('\n')
  }
  else if (subtype === 'api_retry') {
    const err = payload.error && typeof payload.error === 'object' ? payload.error as Record<string, unknown> : null
    const noResponse = payload.no_response && typeof payload.no_response === 'object'
      ? payload.no_response as { waited_ms?: unknown; retry_wait_ms?: unknown }
      : null
    const lines = [
      typeof payload.attempt === 'number' && typeof payload.max_retries === 'number'
        ? `Attempt ${payload.attempt} of ${payload.max_retries}`
        : '',
      typeof payload.retry_delay_ms === 'number' ? `Retry delay: ${(payload.retry_delay_ms / 1000).toFixed(1)}s` : '',
      typeof payload.error_status === 'number' ? `HTTP ${payload.error_status}` : '',
      typeof noResponse?.waited_ms === 'number'
        ? `No response headers after ${(noResponse.waited_ms / 1000).toFixed(1)}s`
          + (typeof noResponse.retry_wait_ms === 'number'
            ? ` · retry waits ${(noResponse.retry_wait_ms / 1000).toFixed(1)}s`
            : '')
        : '',
      typeof err?.message === 'string' ? err.message : '',
    ].filter(Boolean)
    main = lines.join('\n')
  }
  else if (subtype === 'session_state_changed') {
    main = typeof payload.state === 'string' ? `state: ${payload.state}` : ''
  }
  else if (subtype === 'local_command_output') {
    main = content
  }
  else if (subtype === 'result') {
    const startupFailureHint = claudeStartupFailureHint(payload.startup_failure_reason)
    const errors = Array.isArray(payload.errors) ? payload.errors.filter((e): e is string => typeof e === 'string') : []
    const lines = [
      isRefusal ? 'Outcome: refused' : typeof payload.result_subtype === 'string' ? `Outcome: ${payload.result_subtype}` : '',
      typeof payload.num_turns === 'number' ? `Turns: ${payload.num_turns}` : '',
      typeof payload.duration_ms === 'number' ? `Duration: ${(payload.duration_ms / 1000).toFixed(1)}s` : '',
      typeof payload.duration_api_ms === 'number' ? `API time: ${(payload.duration_api_ms / 1000).toFixed(1)}s` : '',
      typeof payload.total_cost_usd === 'number' ? `Cost: $${payload.total_cost_usd.toFixed(4)}` : '',
      stopReason ? `Stop: ${stopReason}` : '',
      ...errors,
      startupFailureHint ? `Fix: ${startupFailureHint}` : '',
    ].filter(Boolean)
    main = lines.join('\n')
  } else {
    main = content
  }
  return [main, runtimeDetailBody].filter(Boolean).join('\n\n')

}

function claudeSystemTone({ subtype, payload, errorCode, isRefusal }: ClaudeSystemContext) {
  const hookOutcome = typeof payload.outcome === 'string' ? payload.outcome : ''
  const isHardError = errorCode === 'model_not_found'
    || errorCode === 'authentication_failed'
    || errorCode === 'oauth_org_not_allowed'
    || errorCode === 'billing_error'
  return isHardError
    ? 'var(--red)'
    : payload.level === 'warning'
    ? 'var(--yellow)'
    : subtype === 'hook_response' && (hookOutcome === 'error' || hookOutcome === 'cancelled')
    ? 'var(--yellow)'
    : subtype === 'compact_boundary'
    ? 'var(--violet)'
    : subtype.startsWith('task_')
    ? 'var(--violet)'
    : subtype.startsWith('hook_')
    ? 'var(--cyan)'
    : subtype === 'tool_progress' || subtype === 'tool_use_summary'
    ? 'var(--cyan)'
    : subtype === 'memory_recall'
    ? 'var(--cyan)'
    : subtype === 'rate_limit_event'
    ? 'var(--yellow)'
    : subtype === 'permission_denied'
    ? 'var(--red)'
    : subtype === 'prompt_suggestion'
    ? 'var(--green)'
    : subtype === 'api_retry'
    ? 'var(--yellow)'
    : subtype === 'session_state_changed'
    ? 'var(--violet)'
    : subtype === 'model_refusal_fallback'
    ? 'var(--yellow)'
    // A refusal with no fallback ends the turn — red, not the fallback's yellow.
    : subtype === 'model_refusal_no_fallback'
    ? 'var(--red)'
    : subtype === 'worker_shutting_down'
    ? 'var(--yellow)'
    : subtype === 'conversation_reset'
    ? 'var(--violet)'
    : subtype === 'informational'
    ? (payload.level === 'suggestion' ? 'var(--green)' : payload.level === 'notice' ? 'var(--text-3)' : 'var(--cyan)')
    : subtype === 'local_command_output'
    ? 'var(--cyan)'
    : subtype === 'result'
    ? (isRefusal || (typeof payload.result_subtype === 'string' && payload.result_subtype !== 'success') ? 'var(--red)' : 'var(--green)')
    : 'var(--text-3)'
}

/** Interpret an SDK system event without depending on React or transcript composition. */
export function describeClaudeSystem(subtype: string, payload: SystemMessagePayload) {
  const context = claudeSystemContext(subtype, payload)
  return {
    headerLabel: context.headerLabel,
    detailPreview: claudeSystemPreview(context),
    badges: claudeSystemBadges(context),
    body: claudeSystemBody(context),
    tone: claudeSystemTone(context),
    payloadJson: safeJson(payload),
  }
}
