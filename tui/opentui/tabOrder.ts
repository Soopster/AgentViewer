// Pinned tabs sit first and are protected from a stray close; the rest keep the order they were opened in.
// Pure, so the strip, the menu and the manager all agree on one answer.

/** Pinned tabs first, each group in its existing order. */
export function orderTabs<T>(tabs: readonly T[], keyOf: (tab: T) => string, pinned: ReadonlySet<string>): T[] {
  if (pinned.size === 0) return tabs as T[]
  return [...tabs.filter((tab) => pinned.has(keyOf(tab))), ...tabs.filter((tab) => !pinned.has(keyOf(tab)))]
}

/** `keys` in strip order with `key` moved one place toward `delta`; never across the pinned/unpinned boundary. */
export function moveTabKey(keys: readonly string[], key: string, delta: -1 | 1, pinned: ReadonlySet<string>): string[] {
  const ordered = orderTabs(keys, (value) => value, pinned)
  const from = ordered.indexOf(key)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ordered.length || pinned.has(ordered[to]!) !== pinned.has(key)) return [...keys]
  const next = [...ordered]
  ;[next[from], next[to]] = [next[to]!, next[from]!]
  return next
}

/** `keys` in strip order with `key` moved to where `target` is (a drag along the strip); never across the pinned/unpinned boundary. */
export function moveTabKeyTo(keys: readonly string[], key: string, target: string, pinned: ReadonlySet<string>): string[] {
  const ordered = orderTabs(keys, (value) => value, pinned)
  const from = ordered.indexOf(key)
  const to = ordered.indexOf(target)
  if (from < 0 || to < 0 || from === to || pinned.has(target) !== pinned.has(key)) return [...keys]
  const next = ordered.filter((entry) => entry !== key)
  next.splice(to, 0, key)
  return next
}

export function togglePinnedKey(pinned: readonly string[], key: string): string[] {
  return pinned.includes(key) ? pinned.filter((entry) => entry !== key) : [...pinned, key]
}
