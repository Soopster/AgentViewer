// Shared startup deadlines for provider runtimes and explicit model changes.
//
// An explicit model may be backed by a custom endpoint (Bedrock/Vertex, a
// proxy, an enterprise gateway, or another provider's remote catalog). Those
// paths can legitimately spend tens of seconds on discovery/authentication on
// their first use. Keep the ordinary/default-model path tight, but give an
// explicitly selected model a larger bounded window so "slow" is not mistaken
// for "dead". Successful operations are unaffected: the deadline is only a
// ceiling, never a delay.

const MIN_STARTUP_TIMEOUT_MS = 1_000
const MAX_STARTUP_TIMEOUT_MS = 10 * 60 * 1_000

function configuredTimeout(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(MAX_STARTUP_TIMEOUT_MS, Math.max(MIN_STARTUP_TIMEOUT_MS, Math.trunc(parsed)))
}

export const DEFAULT_PROVIDER_STARTUP_TIMEOUT_MS = configuredTimeout(
  'AGENT_VIEWER_PROVIDER_STARTUP_TIMEOUT_MS',
  30_000,
)

export const EXPLICIT_MODEL_STARTUP_TIMEOUT_MS = configuredTimeout(
  'AGENT_VIEWER_EXPLICIT_MODEL_STARTUP_TIMEOUT_MS',
  120_000,
)

// Catalog reads happen before the UI knows which model is selected. Give cold
// custom endpoints more room than an ordinary local resume, but keep a dead
// model service from blocking the picker/send gate for the full turn-start
// allowance.
export const PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS = configuredTimeout(
  'AGENT_VIEWER_MODEL_DISCOVERY_TIMEOUT_MS',
  60_000,
)

/**
 * Return a bounded startup window for this operation. `baselineMs` preserves a
 * call site's existing fast/default policy; an explicit model only raises the
 * ceiling when the shared custom-model allowance is larger.
 */
export function providerStartupTimeoutMs(
  model: string | null | undefined,
  baselineMs = DEFAULT_PROVIDER_STARTUP_TIMEOUT_MS,
): number {
  const baseline = Math.min(
    MAX_STARTUP_TIMEOUT_MS,
    Math.max(MIN_STARTUP_TIMEOUT_MS, Math.trunc(baselineMs)),
  )
  return typeof model === 'string' && model.trim()
    ? Math.max(baseline, EXPLICIT_MODEL_STARTUP_TIMEOUT_MS)
    : baseline
}
