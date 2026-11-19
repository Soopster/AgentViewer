import type { TuiSessionDetail } from '../../lib/tui/service'

const sources = new WeakMap<object, WeakMap<object, WeakMap<object, number>>>()
const sizes = new WeakMap<object, number>()
/** Conservative JS payload estimate, not RSS. Inspect data properties only:
 * card search/preview getters must stay lazy while accounting for retention. */
export function transcriptPayloadBytes(detail: TuiSessionDetail): number {
  const cached = sizes.get(detail)
  if (cached !== undefined) return cached
  // Polls deliver a fresh detail wrapper while preserving the immutable source
  // arrays. Reuse its accounting, just as rendering reuses their identities.
  const raw = detail.rawMessages
  const threaded = detail.threadedMessages
  const cards = detail.transcriptCards ?? threaded
  const sourceSize = raw && threaded && cards ? sources.get(raw)?.get(threaded)?.get(cards) : undefined
  if (sourceSize !== undefined) { sizes.set(detail, sourceSize); return sourceSize }
  const seen = new Set<object>()
  const pending: unknown[] = [detail]
  let bytes = 0
  while (pending.length) {
    const value = pending.pop()
    if (typeof value === 'string') { bytes += value.length * 2; continue }
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    bytes += Array.isArray(value) ? 32 + value.length * 8 : 64
    for (const key of Object.keys(value)) {
      const property = Object.getOwnPropertyDescriptor(value, key)
      if (property && 'value' in property) pending.push(property.value)
    }
  }
  sizes.set(detail, bytes)
  if (raw && threaded && cards) {
    let byThreaded = sources.get(raw)
    if (!byThreaded) sources.set(raw, byThreaded = new WeakMap())
    let byCards = byThreaded.get(threaded)
    if (!byCards) byThreaded.set(threaded, byCards = new WeakMap())
    byCards.set(cards, bytes)
  }
  return bytes
}
