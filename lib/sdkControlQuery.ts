import { query, startup, type Query, type SDKUserMessage, type WarmQuery } from '@anthropic-ai/claude-agent-sdk'
import { claudeProcessSpawnOptions } from './claudeProcessSpawner'

// Keep the streaming-input iterator open for the lifetime of the query so
// the SDK doesn't tear down the subprocess while we're still issuing control
// requests. SDK 0.3 treats a returned input iterator as "input closed" and
// closes the query — pre-0.3 it kept the subprocess warm even after an empty
// generator returned. Resolved via close() on the Query, which interrupts the
// pending promise.
//
// Exported so other call sites (e.g. `readClaudeSupportedModels`) can use
// the same never-yielding prompt pattern without duplicating the helper.
export function openPrompt(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<SDKUserMessage>>(() => {
          // never resolves; the query closes via q.close()
        }),
        return: () => Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true }),
      }
    },
  }
}

export function createSessionControlQuery(sessionId: string, model?: string): Query {
  return query({
    prompt: openPrompt(),
    options: {
      resume: sessionId,
      // Omit when unset so the CLI resumes with whatever model the session was
      // last running — forcing a literal default here would override custom
      // deployments (Bedrock/Vertex, proxied base URLs, non-default
      // ANTHROPIC_MODEL) with a model id they may not recognize.
      ...(model ? { model } : {}),
      maxTurns: 0,
      enableFileCheckpointing: true,
      ...claudeProcessSpawnOptions(),
      // Read-only control queries (context usage, supported commands, MCP
      // toggles, dry-run rewinds — all maxTurns:0, never sending a turn). Without
      // this, resuming rewrites the session JSONL and bumps its mtime, so merely
      // *viewing* a session reorders it to the top of the list. See
      // READ_MODELS_WARM_OPTIONS, which sets this for the same reason.
      persistSession: false,
    },
  })
}

// ── Pre-warmed Query slot for readClaudeSupportedModels ──────────────────────
//
// WarmQuery binds a pre-spawned CLI subprocess to a specific Options shape at
// startup() time; WarmQuery.query() can only be called once (single-shot).
// readClaudeSupportedModels is our one caller that always uses the same fixed
// options (no resume, no cwd, maxTurns:0, persistSession:false) and runs only
// the control-plane RPCs initializationResult() and supportedModels() — so it
// can fully consume a warm slot.
//
// Flow: prime once at app boot via instrumentation.ts → first read consumes
// the slot (skipping the ~1–3s spawn) → background re-warm refills it so the
// next call is hot too.

const READ_MODELS_WARM_OPTIONS = {
  // No explicit model: this only asks the CLI what models it knows about, so
  // it should boot with whatever default it would normally pick (respecting
  // custom ANTHROPIC_MODEL/base URL/Bedrock/Vertex config) rather than a
  // literal that may not be valid on that deployment.
  persistSession: false,
  maxTurns: 0,
  enableFileCheckpointing: true,
} as const

let readModelsWarmSlot: Promise<WarmQuery | null> | null = null

function spawnReadModelsWarm(): Promise<WarmQuery | null> {
  return startup({
    options: {
      ...READ_MODELS_WARM_OPTIONS,
      ...claudeProcessSpawnOptions(),
    },
  })
    .catch((err: unknown) => {
      console.warn('[sdk] startup() warmup failed:', err instanceof Error ? err.message : err)
      return null
    })
}

/** Kick off the warmup. Called once at app boot. Idempotent. */
export function primeReadModelsWarmQuery(): void {
  if (readModelsWarmSlot) return
  readModelsWarmSlot = spawnReadModelsWarm()
}

/**
 * Consume the warm slot (returns null if not warmed or warmup failed) and
 * immediately re-warm in the background so the next call also benefits.
 * Callers must construct the Query via `warm.query(openPrompt())` and close
 * it themselves — the slot owner just hands off the pre-spawned subprocess.
 */
export async function consumeReadModelsWarmQuery(): Promise<WarmQuery | null> {
  const slot = readModelsWarmSlot
  // Eagerly re-warm so the *next* readClaudeSupportedModels call is hot too.
  // Whether the current consumption succeeds or not, the next slot starts
  // spinning up now.
  readModelsWarmSlot = spawnReadModelsWarm()
  return slot ? slot : null
}
