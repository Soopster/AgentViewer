import { type TuiSessionDetail } from '../../../lib/tui/service'
import { type ContextUsage } from '../../../lib/types'
import { SESSION_CACHE_LIMIT } from './layoutConstants'

// A reset that keeps an already-empty value, so resetting what is empty
// renders nothing. Session switches reset a dozen of these at once.
export function keepEmpty<Value extends { length: number } | { size: number }>(current: Value): Value {
  return ('length' in current ? current.length : current.size) === 0 ? current : (Array.isArray(current) ? [] : new Set()) as unknown as Value
}

// A filter that returns the same array when it removes nothing, so a state
// update that filters out what is not there renders nothing.
export function keepFiltered<Item>(list: Item[], keep: (item: Item, index: number) => boolean): Item[] {
  const next = list.filter(keep)
  return next.length === list.length ? list : next
}

// Whether a set already holds exactly these keys.
export function sameKeys(current: ReadonlySet<string>, keys: readonly string[] | undefined): boolean {
  const list = keys ?? []
  return current.size === list.length && list.every((key) => current.has(key))
}

export function touchMapEntry<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.has(key)) map.delete(key)
  map.set(key, value)
}

export function pruneSessionCaches(
  detailCache: Map<string, TuiSessionDetail>,
  usageCache: Map<string, ContextUsage | null>,
  metadataFetchedAt: Map<string, number>,
  pinnedKeys: Set<string>,
  limit = SESSION_CACHE_LIMIT,
): void {
  const orderedKeys = [
    ...detailCache.keys(),
    ...usageCache.keys(),
    ...metadataFetchedAt.keys(),
  ].filter((key, index, keys) => keys.indexOf(key) === index)

  let evictableCount = orderedKeys.filter((key) => !pinnedKeys.has(key)).length
  if (evictableCount <= limit) return

  for (const key of orderedKeys) {
    if (pinnedKeys.has(key)) continue
    detailCache.delete(key)
    usageCache.delete(key)
    metadataFetchedAt.delete(key)
    evictableCount -= 1
    if (evictableCount <= limit) break
  }
}