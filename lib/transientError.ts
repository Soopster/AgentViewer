// Shared classifier for "is this send error worth a silent auto-retry?" used by
// both the web composer (components/MessageView.tsx) and the OpenTUI composer
// (tui/opentui/App.tsx). Native provider CLIs quietly retry transient API/network
// blips; agent-viewer mirrors that — but ONLY for errors that are transient AND
// only when the turn produced no output yet, so a retry can't duplicate work.
//
// Keep this conservative: a false positive auto-retries a genuinely fatal error
// (wasting one round-trip before surfacing it), while a false negative just
// shows the error a few seconds sooner. Bias toward not retrying when unsure.
export function isTransientSendError(message: string | null | undefined): boolean {
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
