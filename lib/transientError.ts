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
  constructor(message: string, apiErrorStatus?: number | null) {
    super(message)
    this.name = 'TransientAwareSendError'
    if (typeof apiErrorStatus === 'number') this.apiErrorStatus = apiErrorStatus
  }
}

export function isTransientSendError(message: string | null | undefined, apiErrorStatus?: number | null): boolean {
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

// How many automatic retries to attempt before surfacing a terminal error, and
// the backoff before each. Deliberately small: each retry only fires after a
// full failed turn, so this is "ride out a blip," not a heavy retry loop.
export const MAX_TRANSIENT_SEND_RETRIES = 2
export function transientRetryBackoffMs(attempt: number): number {
  // attempt is 1-based: 1500ms, 4000ms.
  return attempt <= 1 ? 1500 : 4000
}
