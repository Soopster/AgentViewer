// Shared classifier for "is this send error worth a silent auto-retry?" used by
// both the web composer (components/MessageView.tsx) and the OpenTUI composer
// (tui/opentui/App.tsx). Native provider CLIs quietly retry transient API/network
// blips; agent-viewer mirrors that — but ONLY for errors that are transient AND
// only when the turn produced no output yet, so a retry can't duplicate work.
//
// Keep this conservative: a false positive auto-retries a genuinely fatal error
// (wasting one round-trip before surfacing it), while a false negative just
// shows the error a few seconds sooner. Bias toward not retrying when unsure.
// Thrown by SSE consumers when a turn's `error` frame carries a structural
// HTTP status (Claude's api_error_status) alongside the message text, so
// isTransientSendError can classify it without parsing prose.
export class TransientAwareSendError extends Error {
  apiErrorStatus?: number
  /**
   * Set when the server classified this error as a genuine plan/usage limit or
   * an org-policy block (see lib/claudeUsageLimits). Both are permanent for the
   * moment — retrying only burns round-trips — but they read like a rate limit
   * to a substring matcher, so the classification has to ride along rather than
   * be re-derived from the prose here.
   */
  usageLimitKind?: UsageLimitKind
  constructor(message: string, apiErrorStatus?: number | null, usageLimitKind?: UsageLimitKind | null) {
    super(message)
    this.name = 'TransientAwareSendError'
    if (typeof apiErrorStatus === 'number') this.apiErrorStatus = apiErrorStatus
    if (usageLimitKind) this.usageLimitKind = usageLimitKind
  }
}

/**
 * Mirror of ClaudeUsageLimitKind from lib/claudeUsageLimits. Duplicated as a
 * plain union rather than imported because this module is bundled into the web
 * and OpenTUI composers, and claudeUsageLimits pulls in the Agent SDK (a
 * serverExternalPackage that must never reach a client bundle).
 */
export type UsageLimitKind = 'limit-reached' | 'org-policy' | 'transition' | 'warning'

/**
 * True when the server told us the send failed on an exhausted usage limit or
 * an org policy. Callers must consult this before isTransientSendError():
 * "You've hit your usage limit" contains none of the transient tokens today,
 * but the retry decision should rest on the SDK's own classification rather
 * than on that continuing to be true.
 */
export function isPermanentUsageError(kind: UsageLimitKind | null | undefined): boolean {
  return kind === 'limit-reached' || kind === 'org-policy'
}

export function isTransientSendError(
  message: string | null | undefined,
  apiErrorStatus?: number | null,
  usageLimitKind?: UsageLimitKind | null,
): boolean {
  // A genuine usage limit / org-policy block is permanent for now. It has to be
  // rejected before the heuristics below, which would otherwise be free to
  // classify a future "…rate limit…"-worded limit message as retryable.
  if (isPermanentUsageError(usageLimitKind)) return false
  // Structural signal first: Claude's SDK now reports the HTTP status of a
  // recovered-but-errored API call directly (api_error_status on result
  // messages) instead of only embedding it in prose. Prefer it over the
  // string match below when available — it can't be fooled by wording changes.
  if (typeof apiErrorStatus === 'number' && (apiErrorStatus === 429 || (apiErrorStatus >= 500 && apiErrorStatus < 600))) {
    return true
  }
  if (!message) return false
  const m = message.toLowerCase()
  // Network-layer hiccups.
  if (
    m.includes('econnreset')
    || m.includes('etimedout')
    || m.includes('econnrefused')
    || m.includes('epipe')
    || m.includes('socket hang up')
    || m.includes('network error')
    || m.includes('fetch failed')
    || m.includes('connection closed')
    || m.includes('connection reset')
  ) return true
  // Provider overload / rate-limit / transient 5xx. Matched as whole-ish tokens
  // so an unrelated number in prose is unlikely to trip them.
  if (
    m.includes('overloaded')
    || m.includes('rate limit')
    || m.includes('rate_limit')
    || m.includes('too many requests')
    || m.includes('429')
    || m.includes('502')
    || m.includes('503')
    || m.includes('504')
    || m.includes('529')
    || m.includes('service unavailable')
    || m.includes('temporarily unavailable')
    || m.includes('timed out')
    || m.includes('timeout')
  ) return true
  return false
}

// Claude's `resumeDropsTurn` guard refuses a truncating resume/fork when the
// discarded range would strand the kept turn's own payload (its tool_result
// carrier or structured_output attachment). Unlike a transient error, retrying
// the identical request fails forever — the fix is to drop the fork point and
// resume plainly. Matched on the CLI's fixed message prefix per the SDK's
// documented contract for `resumeDropsTurn`.
export function isResumeDropsTurnRefusal(message: string | null | undefined): boolean {
  return typeof message === 'string' && message.includes('Resume rejected by --resume-drops-turn:')
}

// How many automatic retries to attempt before surfacing a terminal error, and
// the backoff before each. Deliberately small: each retry only fires after a
// full failed turn, so this is "ride out a blip," not a heavy retry loop.
export const MAX_TRANSIENT_SEND_RETRIES = 2
export function transientRetryBackoffMs(attempt: number): number {
  // attempt is 1-based: 1500ms, 4000ms.
  return attempt <= 1 ? 1500 : 4000
}
