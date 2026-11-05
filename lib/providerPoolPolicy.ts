export type ProviderPoolCandidate<Key extends string = string> = {
  key: Key
  lastUsed: number
  active: boolean
}

/**
 * Select least-recently-used idle entries until a warm pool reaches its cap.
 *
 * Active entries and the entry being acquired/released are protected. This
 * deliberately makes caps soft while every candidate is busy, then lets the
 * next lifecycle boundary shrink the pool back to its configured size.
 */
export function selectIdleProviderPoolEvictions<Key extends string>(
  entries: readonly ProviderPoolCandidate<Key>[],
  maxEntries: number,
  protectedKey?: Key,
): Key[] {
  const excess = entries.length - Math.max(0, maxEntries)
  if (excess <= 0) return []
  return entries
    .filter((entry) => !entry.active && entry.key !== protectedKey)
    .toSorted((a, b) => a.lastUsed - b.lastUsed)
    .slice(0, excess)
    .map((entry) => entry.key)
}
