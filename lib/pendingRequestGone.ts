/**
 * A permission or question can outlive the callback that would answer it: the
 * turn ended, the provider process restarted, or another surface answered
 * first. t3code's `not_resumable`. Answering it is a no-op the user cannot fix
 * by retrying, so a surface must retire the card instead of leaving a button
 * that fails the same way every press.
 */
export const PENDING_REQUEST_GONE_CODE = 'not_resumable'

const GONE_TEXT = 'no longer pending'

export class PendingRequestGoneError extends Error {
  readonly code = PENDING_REQUEST_GONE_CODE
  constructor(what: 'Permission request' | 'Approval request' | 'Question') {
    super(`${what} is ${GONE_TEXT} — the turn that asked it has ended. Send your prompt again.`)
    this.name = 'PendingRequestGoneError'
  }
}

/** True for the error itself and for the message it becomes after an HTTP round trip. */
export function isPendingRequestGone(error: unknown): boolean {
  if (error instanceof PendingRequestGoneError) return true
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === PENDING_REQUEST_GONE_CODE) return true
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message.includes(GONE_TEXT)
}

export const PENDING_REQUEST_GONE_NOTICE = 'That request expired — the turn that asked it has ended. Send your prompt again.'
