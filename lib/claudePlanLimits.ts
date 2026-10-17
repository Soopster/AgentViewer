// Claude plan rate-limit windows (5-hour, 7-day, per-model) for the composer's
// limit meter: the same data as Claude Code's `/usage`. Without it the first a
// user hears of a limit is the turn that hits it ("resets 6:50pm").
//
// Read only through a session's warm pool entry, never by spawning a CLI: the
// meter is refreshed as a turn ends and as the composer engages, and a spawn per
// refresh would boot every configured MCP server for a percentage. No warm entry
// means no fresh reading, and the last one is kept. The method is experimental
// in the SDK, so a rename degrades the meter to absent rather than throwing.

import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import { peekClaudeSessionIfLoaded } from './claudePoolHandle'
import { withTimeout } from './withTimeout'

export type PlanLimitWindow = {
  /** Short name for the meter: `5h`, `7d`, `7d opus`. */
  label: string
  /** Percentage of the window used, 0-100. */
  utilization: number
  /** Epoch ms when the window resets, when the server said. */
  resetsAt: number | null
}

export type ClaudePlanLimits = { windows: PlanLimitWindow[]; readAt: number }

type UsageCapableQuery = {
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (opts?: { skipBehaviors?: boolean }) => Promise<SDKControlGetUsageResponse>
}

/** Fresh enough to answer without asking again; a turn is worth a few percent at most. */
const PLAN_LIMITS_FRESH_MS = 60_000
const PLAN_LIMITS_TIMEOUT_MS = 4_000

// Per account (provider instance): two Claude logins have two sets of limits.
const cache = new Map<string, ClaudePlanLimits>()
const inFlight = new Map<string, Promise<ClaudePlanLimits | null>>()

export function summarizeClaudePlanLimits(usage: SDKControlGetUsageResponse, now = Date.now()): ClaudePlanLimits | null {
  if (!usage.rate_limits_available || !usage.rate_limits) return null
  const limits = usage.rate_limits
  const windows: PlanLimitWindow[] = []
  const add = (label: string, value: { utilization: number | null; resets_at: string | null } | null | undefined) => {
    if (!value || value.utilization == null || !Number.isFinite(value.utilization)) return
    const resetsAt = value.resets_at ? Date.parse(value.resets_at) : NaN
    windows.push({ label, utilization: value.utilization, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null })
  }
  add('5h', limits.five_hour)
  add('7d', limits.seven_day)
  add('7d opus', limits.seven_day_opus)
  add('7d sonnet', limits.seven_day_sonnet)
  for (const scoped of limits.model_scoped ?? []) add(`7d ${scoped.display_name}`, scoped)
  return windows.length > 0 ? { windows, readAt: now } : null
}

/** The window closest to its limit — the one the meter shows. */
export function tightestPlanLimit(limits: ClaudePlanLimits | null): PlanLimitWindow | null {
  let tightest: PlanLimitWindow | null = null
  for (const window of limits?.windows ?? []) {
    if (!tightest || window.utilization > tightest.utilization) tightest = window
  }
  return tightest
}

/** The last reading for this account, without asking. */
export function peekClaudePlanLimits(accountKey: string): ClaudePlanLimits | null {
  return cache.get(accountKey) ?? null
}

/**
 * A fresh reading through the session's warm pool entry, or the last one
 * when there is no such entry. Never spawns. Concurrent callers share one call.
 */
export async function readClaudePlanLimits(sessionId: string, accountKey: string): Promise<ClaudePlanLimits | null> {
  const cached = cache.get(accountKey) ?? null
  if (cached && Date.now() - cached.readAt < PLAN_LIMITS_FRESH_MS) return cached
  const entry = peekClaudeSessionIfLoaded(sessionId)
  // The caller asks between turns; a control RPC to a booting CLI would wait out its init.
  if (!entry || !entry.isAlive() || !entry.isInitialized()) return cached
  const call = (entry.query as unknown as UsageCapableQuery).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET
  if (typeof call !== 'function') return cached
  const pending = inFlight.get(accountKey)
  if (pending) return pending
  const read = withTimeout(call.call(entry.query, { skipBehaviors: true }), PLAN_LIMITS_TIMEOUT_MS, 'plan limits')
    .then((usage) => {
      const limits = summarizeClaudePlanLimits(usage)
      if (limits) cache.set(accountKey, limits)
      else cache.delete(accountKey)
      return limits
    })
    .catch(() => cached)
    .finally(() => inFlight.delete(accountKey))
  inFlight.set(accountKey, read)
  return read
}
