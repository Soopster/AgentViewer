// Load-on-demand handle for lib/claudePool.ts.
//
// claudePool is the warm-subprocess pool for Claude turns — the *send* path.
// Evaluating it costs ~30MB of physical footprint, and it was reachable from
// three places, two of which are pure read paths:
//
//   - lib/adapters/claude.ts, for a single peekClaudeSession() when listing a
//     session's slash commands;
//   - lib/tui/service.ts, for one queueClaudeReadStateSeeds() during checkpoint
//     restore;
//   - lib/sessionBackend.ts, which genuinely runs turns.
//
// The first two mattered because the TUI's transcript Worker is a separate JS
// VM that reads sessions and never sends a turn, so it was paying 30MB for a
// pool it could not use — and paying it again on top of the main isolate's copy.
//
// The read-path answer is exact rather than approximate, which is what makes
// this safe: **a warm pool entry cannot exist unless this module has been
// loaded**, because the only thing that creates one is the send path, and the
// send path loads it. So "not loaded" and "no warm entry for this session" are
// the same answer, and peekClaudeSessionIfLoaded() can return undefined without
// loading anything. Callers already handle that case — it is the ordinary
// cold-session path.
//
// This module is the only loader of lib/claudePool.ts. That invariant is what
// keeps `loaded` honest: a direct static `import … from './claudePool'` would
// create warm entries the handle never learned about. The degradation is
// graceful rather than wrong — peekClaudeSessionIfLoaded() would miss a warm
// entry and the caller would fall back to spawning a control query, which is
// merely slower — but don't reintroduce one; go through ensureClaudePool().

type ClaudePoolModule = typeof import('./claudePool')

let loaded: ClaudePoolModule | null = null
let loading: Promise<ClaudePoolModule> | null = null

/** Loads the pool if it isn't loaded yet. Send-path entry points await this. */
export async function ensureClaudePool(): Promise<ClaudePoolModule> {
  if (loaded) return loaded
  loading ??= import('./claudePool').then((mod) => {
    loaded = mod
    return mod
  })
  return loading
}

/** The pool, or null when nothing has needed it yet. Use this when "not loaded"
 *  is a meaningful answer in its own right (no pool ⇒ no warm entries). */
export function claudePoolIfLoaded(): ClaudePoolModule | null {
  return loaded
}

/** The warm entry for a session, or undefined when there is none — including
 *  when the pool has never been loaded, which means the same thing. */
export function peekClaudeSessionIfLoaded(sessionId: string): ReturnType<ClaudePoolModule['peekClaudeSession']> | undefined {
  return loaded?.peekClaudeSession(sessionId)
}

/** The pool for send-path code that has already awaited ensureClaudePool().
 *  Throws rather than loading, so a use that is not behind an entry point is
 *  loud in development instead of a stall on a hot path. */
export function claudePoolModule(): ClaudePoolModule {
  if (!loaded) {
    throw new Error('claudePool used before ensureClaudePool() — add the await to this send-path entry point')
  }
  return loaded
}
