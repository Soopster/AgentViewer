import assert from 'node:assert/strict'
import { pruneUnmountedCardData } from './readerCardCache'

const cards = Array.from({ length: 10_000 }, () => ({}))
const caches = Array.from({ length: 4 }, () => new Map<object, object>())
let previous: object[] = []
for (let start = 0; start <= cards.length - 240; start += 8) {
  const window = cards.slice(start, start + 240)
  const overlap = previous.filter(card => window.includes(card))
  const oldValues = overlap.map(card => caches[0].get(card))
  for (const cache of caches) for (const card of window) if (!cache.has(card)) cache.set(card, {})
  pruneUnmountedCardData(previous, window, caches)
  for (const cache of caches) assert.equal(cache.size, 240, 'derived data is bounded despite all source keys remaining live')
  overlap.forEach((card, index) => assert.equal(caches[0].get(card), oldValues[index], 'overlapping card keeps derived identity'))
  previous = window
}
const replacements = Array.from({ length: 240 }, () => ({}))
pruneUnmountedCardData(previous, replacements, caches)
assert.equal(caches[0].size, 0, 'session replacement clears departing identities')
for (const cache of caches) cache.set(replacements[0], cards[0])
pruneUnmountedCardData(replacements, replacements, caches)
assert.equal(caches[0].get(replacements[0]), cards[0], 'unchanged window leaves cached values alone')
pruneUnmountedCardData(replacements, [], caches)
assert.equal(caches[0].size, 0, 'empty window releases final data')
console.log('Reader cache smoke passed: 10k live keys, sliding overlap identity, replacement and empty windows')
