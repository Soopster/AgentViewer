// Short-lived, single-flight cache in front of `gh` reads. Opening the GitHub
// view asks several questions at once and two clients (web + TUI) often ask the
// same one; each `gh` call is a network round trip, so concurrent readers share
// one spawn and a repeat read inside the TTL is free. Mutations invalidate by
// key prefix so a merge is never followed by a stale "open" list.

const MAX_ENTRIES = 64

type Entry = { at: number; value: unknown; inFlight: Promise<unknown> | null }

const entries = new Map<string, Entry>()

function evictOldest() {
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) return
    entries.delete(oldest)
  }
}

export function githubCacheKey(cwd: string, ...parts: Array<string | number>): string {
  return [cwd, ...parts].join('\u0000')
}

export async function cachedGithubRead<T>(key: string, ttlMs: number, read: () => Promise<T>): Promise<T> {
  const entry = entries.get(key)
  if (entry?.inFlight) return entry.inFlight as Promise<T>
  if (entry && Date.now() - entry.at < ttlMs) return entry.value as T
  const inFlight = read().then(
    (value) => {
      entries.set(key, { at: Date.now(), value, inFlight: null })
      return value
    },
    (error) => {
      // A failure is never cached: the next caller retries.
      const current = entries.get(key)
      if (current?.inFlight === inFlight) {
        if (current.value === undefined) entries.delete(key)
        else entries.set(key, { ...current, inFlight: null })
      }
      throw error
    },
  )
  entries.set(key, { at: entry?.at ?? 0, value: entry?.value, inFlight })
  evictOldest()
  return inFlight
}

/** Drop every cached read for a checkout; `prefix` narrows it (e.g. 'issues'). */
export function invalidateGithubCache(cwd: string, prefix = ''): void {
  const head = `${cwd}\u0000${prefix}`
  for (const key of [...entries.keys()]) if (key.startsWith(head)) entries.delete(key)
}

export function clearGithubCache(): void {
  entries.clear()
}
