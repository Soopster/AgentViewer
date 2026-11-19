import { isTransientSendError, MAX_TRANSIENT_SEND_RETRIES, transientRetryBackoffMs, TransientAwareSendError } from './transientError'

export type ComposerRetryState = {
  producedOutput: boolean
  attempts: number
}

/** Decide recovery without owning timers, React state, or the target session. */
export function planComposerRetry(error: unknown, state: ComposerRetryState): { attempt: number; delayMs: number } | null {
  if (state.producedOutput || state.attempts >= MAX_TRANSIENT_SEND_RETRIES) return null
  if (error instanceof Error && error.name === 'AbortError') return null
  const message = error instanceof Error ? error.message : 'Failed to send message'
  const status = error instanceof TransientAwareSendError ? error.apiErrorStatus : undefined
  const usageLimit = error instanceof TransientAwareSendError ? error.usageLimitKind : undefined
  if (!isTransientSendError(message, status, usageLimit)) return null
  const attempt = state.attempts + 1
  return { attempt, delayMs: transientRetryBackoffMs(attempt) }
}
