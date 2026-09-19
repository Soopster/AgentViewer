// Claude's model list, and the fallback-model chain that every Claude query
// shares.
//
// Reading the model list means asking a Claude CLI subprocess, which is why so
// much care sits here: the pre-warmed query slot avoids a 1-3s spawn on the
// first call after boot, `maxTurns: 0` with a never-yielding prompt services
// the control RPCs without burning an API round-trip, and an empty result is
// retried rather than cached, because a genuinely model-less install does not
// happen in practice while a not-yet-ready one does.

import { query } from '@anthropic-ai/claude-agent-sdk'
import { claudeProcessSpawnOptions } from './claudeProcessSpawner'
import { PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS } from './providerWarmup'
import { consumeReadModelsWarmQuery, openPrompt } from './sdkControlQuery'
import type { SessionModelInfo } from './types'
import { withTimeout } from './withTimeout'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref()
  })
}

export function claudeFallbackModelChain(): string | undefined {
  const value = process.env.AGENT_VIEWER_CLAUDE_FALLBACK_MODELS
    ?? process.env.CLAUDE_FALLBACK_MODELS
    ?? process.env.CLAUDE_FALLBACK_MODEL
  if (!value) return undefined
  const models = value.split(',').map((model) => model.trim()).filter(Boolean)
  return models.length > 0 ? models.join(',') : undefined
}

export async function readClaudeSupportedModelsOnce(): Promise<SessionModelInfo[]> {
  // Prefer the pre-warmed slot primed by instrumentation.ts → skips the
  // ~1–3s subprocess spawn for the first call after boot. The slot
  // automatically re-warms in the background after consumption so the next
  // call is hot too. Falls back to a fresh query() when the slot is empty
  // (warmup failed, or this is the second concurrent call before re-warm
  // finished).
  //
  // `maxTurns: 0` + a never-yielding prompt iterator stops the SDK from
  // starting an actual model turn — the subprocess spins up, services the
  // `initializationResult` / `supportedModels` control RPCs, and shuts down
  // via `q.close()`. The legacy `prompt: 'ping'` + `maxTurns: 1` pattern
  // would burn a full API round-trip on every cache miss.
  const warm = await consumeReadModelsWarmQuery()
  const fallbackModel = claudeFallbackModelChain()
  const q = warm
    ? warm.query(openPrompt())
    : query({
        prompt: openPrompt(),
        options: {
          // No explicit model — let the CLI boot with its own default so this
          // works on custom deployments (Bedrock/Vertex, proxied base URLs,
          // non-default ANTHROPIC_MODEL) instead of a literal that may not
          // resolve there.
          ...(fallbackModel ? { fallbackModel } : {}),
          persistSession: false,
          maxTurns: 0,
          enableFileCheckpointing: true,
          // No approval surface on a model listing — see sdkControlQuery.ts.
          permissionPrompts: 'none',
          ...claudeProcessSpawnOptions(),
        },
      })

  try {
    const initialization = await withTimeout(
      q.initializationResult(),
      PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS,
      'Claude model discovery',
    )
    const supportedModels = await q.supportedModels().catch(() => [] as SessionModelInfo[])
    return supportedModels.length > 0
      ? supportedModels
      : (initialization.models ?? [])
  } finally {
    q.close()
  }
}

// Retry delays for a not-yet-ready model list, not a genuinely model-less
// install. On some systems — custom model configuration especially (a
// non-default ANTHROPIC_MODEL, a custom base URL, Bedrock/Vertex — anything
// where the CLI enumerates models from somewhere other than its own static
// table) — the very first query right after a fresh subprocess spawn can
// come back before that recognition has finished, both on
// initializationResult() and supportedModels(). A real zero-model install
// doesn't happen in practice, so treat an empty result as "not ready yet"
// and retry with backoff rather than caching/returning it as final.
export const CLAUDE_MODELS_RETRY_DELAYS_MS = [300, 800, 1500, 3000]

export async function readClaudeSupportedModels(): Promise<SessionModelInfo[]> {
  let models = await readClaudeSupportedModelsOnce()
  for (const wait of CLAUDE_MODELS_RETRY_DELAYS_MS) {
    if (models.length > 0) break
    await delay(wait)
    models = await readClaudeSupportedModelsOnce()
  }
  return models
}
