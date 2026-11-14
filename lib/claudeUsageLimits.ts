// Classification of Claude's plan/usage-limit and org-policy messages.
//
// The Agent SDK exports the exact message prefixes its rate-limit and billing
// generators emit, so consumers can tell "you are out of usage" apart from
// "the API hiccuped" without guessing at prose. agent-viewer needs that split
// in two places:
//
//   1. Retry policy. isTransientSendError() matches "rate limit" and friends
//      to ride out an overloaded API. A genuine usage limit reads the same way
//      to a substring matcher but is NOT transient — retrying burns two more
//      round-trips and then shows the same error. These prefixes take
//      precedence over the transient heuristic.
//   2. Presentation. A usage limit, an overage transition, an approaching-limit
//      warning, and an org-policy block all want different UI. The SDK
//      deliberately keeps org policy in its own bucket ("never the usage-limit
//      card"), so we do too.
//
// The constants are @alpha in the SDK. They are read defensively — if a future
// release renames or drops one, we degrade to the previous heuristic-only
// behavior rather than throwing at import time.
import {
  ORG_POLICY_LIMIT_PREFIXES,
  USAGE_LIMIT_ERROR_PREFIXES,
  USAGE_TRANSITION_PREFIXES,
  USAGE_WARNING_PREFIXES,
} from '@anthropic-ai/claude-agent-sdk'

export type ClaudeUsageLimitKind = 'limit-reached' | 'org-policy' | 'transition' | 'warning'

function safePrefixes(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

const LIMIT = safePrefixes(USAGE_LIMIT_ERROR_PREFIXES)
const ORG_POLICY = safePrefixes(ORG_POLICY_LIMIT_PREFIXES)
const TRANSITION = safePrefixes(USAGE_TRANSITION_PREFIXES)
const WARNING = safePrefixes(USAGE_WARNING_PREFIXES)

// The prefixes describe the START of the generated message, but agent-viewer
// often sees them wrapped by a result envelope ("Claude run ended with an
// error: ..."), so match on a normalized-whitespace containment rather than a
// strict startsWith. The strings are long and distinctive enough that this
// does not meaningfully widen the match.
function matchesAny(message: string, prefixes: readonly string[]): boolean {
  if (!prefixes.length) return false
  const normalized = message.replace(/\s+/g, ' ')
  return prefixes.some((prefix) => normalized.includes(prefix.replace(/\s+/g, ' ')))
}

/**
 * Which usage/policy bucket a message falls into, or null when it is an
 * ordinary message. Org policy is checked before the usage bucket because both
 * arrive on the same severity:'error' path and the policy text must never
 * render as a usage-limit card.
 */
export function classifyClaudeUsageMessage(message: string | null | undefined): ClaudeUsageLimitKind | null {
  if (!message) return null
  if (matchesAny(message, ORG_POLICY)) return 'org-policy'
  if (matchesAny(message, LIMIT)) return 'limit-reached'
  if (matchesAny(message, TRANSITION)) return 'transition'
  if (matchesAny(message, WARNING)) return 'warning'
  return null
}

/**
 * True when retrying this send can only fail the same way — the account is out
 * of usage, or an org policy forbids the call. Callers must check this BEFORE
 * isTransientSendError().
 */
export function isClaudeUsageLimitError(message: string | null | undefined): boolean {
  const kind = classifyClaudeUsageMessage(message)
  return kind === 'limit-reached' || kind === 'org-policy'
}

/** Short human label for the classified bucket, for headers and toasts. */
export function claudeUsageMessageLabel(kind: ClaudeUsageLimitKind): string {
  switch (kind) {
    case 'limit-reached': return 'Usage limit reached'
    case 'org-policy': return 'Disabled by org policy'
    case 'transition': return 'Usage source changed'
    case 'warning': return 'Approaching usage limit'
  }
}
