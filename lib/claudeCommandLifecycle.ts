export type ClaudeCommandLifecycleState =
  | 'queued'
  | 'started'
  | 'completed'
  | 'cancelled'
  | 'discarded'

export type ClaudeCommandLifecycle = {
  commandUuid: string
  state: ClaudeCommandLifecycleState
}

const COMMAND_LIFECYCLE_STATES = new Set<ClaudeCommandLifecycleState>([
  'queued',
  'started',
  'completed',
  'cancelled',
  'discarded',
])

/**
 * Parse Claude Code's command_lifecycle push. The CLI emits this frame in
 * stream-json output, but the Agent SDK's SDKMessage union does not expose it
 * yet, so keep the runtime validation at our stream boundary.
 */
export function parseClaudeCommandLifecycle(value: unknown): ClaudeCommandLifecycle | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { type?: unknown; command_uuid?: unknown; state?: unknown }
  if (
    record.type !== 'command_lifecycle'
    || typeof record.command_uuid !== 'string'
    || typeof record.state !== 'string'
    || !COMMAND_LIFECYCLE_STATES.has(record.state as ClaudeCommandLifecycleState)
  ) {
    return null
  }
  return {
    commandUuid: record.command_uuid,
    state: record.state as ClaudeCommandLifecycleState,
  }
}
