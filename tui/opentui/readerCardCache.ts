/** Drop derived rows as cards leave the committed mounted window. WeakMap keys
 * alone do not bound these caches: the delivery layer retains the source cards
 * of an entire transcript. Prune once per slide, leaving cache reads untouched.
 */
export function pruneUnmountedCardData<Card extends object>(
  previous: readonly Card[],
  current: readonly Card[],
  caches: readonly { delete(key: Card): boolean }[],
): void {
  if (previous === current || previous.length === 0) return
  const retained = new Set(current)
  for (const card of previous) {
    if (retained.has(card)) continue
    for (const cache of caches) cache.delete(card)
  }
}
