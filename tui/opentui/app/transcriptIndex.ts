import type { TuiTranscriptCard } from '../../format'

type TranscriptIndexLookup = {
  get: (key: string) => number | undefined
}
// Build an index only if a detached reader actually asks for one. When the
// visible list is a stable persisted prefix plus a tiny live suffix, reuse the
// prefix lookup across streamed-token arrays and index only that suffix. The
// suffix is checked first to preserve Map's last-key-wins behavior.

export function createLazyTranscriptIndexLookup(
  cards: readonly TuiTranscriptCard[],
  stablePrefix?: { length: number; lookup: TranscriptIndexLookup} 
): TranscriptIndexLookup {
  let indexByKey: Map<string, number> | null = null
  return {
    get(key: string): number | undefined {
      if (!indexByKey) {
        const start = stablePrefix?.length ?? 0
        indexByKey = new Map<string, number>()
        for (let index = start; index < cards.length; index += 1) {
          indexByKey.set(cards[index].key, index)
        }
      }
      const suffixIndex = indexByKey.get(key)
      if (suffixIndex !== undefined) return suffixIndex
      return stablePrefix?.lookup.get(key)
    },
  }
}
