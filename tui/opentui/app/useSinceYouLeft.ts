import { useEffect, useRef, useState } from 'react'
import type { TuiTranscriptCard } from '../../format'
import { readLastSeen, writeLastSeen, type LastSeen } from '../../../lib/tuiLastSeen'

/** How long after opening the first read may still bring in what arrived while away. */
const SETTLE_MS = 2_000

export type SinceYouLeft = { cardKey: string; label: string } | null

/** The first card not yet read, and what has happened from it on. Null when nothing is new or it cannot be told. */
export function sinceYouLeft(cards: readonly TuiTranscriptCard[], mark: LastSeen | null, seenAt: number): SinceYouLeft {
  if (!mark) return null
  let start: number
  // Another client looked more recently than this one did.
  if (seenAt > mark.at) start = cards.findIndex(card => (card.timestampMs ?? 0) > seenAt)
  else {
    const at = cards.findIndex(card => card.key === mark.cardKey)
    // Compacted or rewound away: where the reading stopped is unknown.
    start = at < 0 ? -1 : at + 1
  }
  if (start < 0 || start >= cards.length) return null
  const fresh = cards.slice(start)
  const turns = fresh.filter(card => card.role === 'user').length
  const failures = fresh.filter(card => card.lines.some(line => line.tone === 'result_error')).length
  return {
    cardKey: cards[start]!.key,
    label: ['NEW SINCE YOU LEFT',
      turns ? `${turns} turn${turns === 1 ? '' : 's'}` : `${fresh.length} message${fresh.length === 1 ? '' : 's'}`,
      failures ? `${failures} failed` : null].filter(Boolean).join(' · '),
  }
}

/**
 * Marks where this window's reader left off, and records where it leaves off now.
 * The divider is settled shortly after opening and then stays put for the visit.
 * It is written only on leaving, and only if there was more to read than before.
 */
export function useSinceYouLeft({ sessionKey, cards, ready, reading, seenAt }: {
  sessionKey: string; cards: readonly TuiTranscriptCard[]; ready: boolean
  /** The window is on screen and following the tail. */
  reading: boolean; seenAt: number
}): SinceYouLeft {
  const visit = useRef<{ key: string; mark: LastSeen | null; seenAt: number; openedAt: number } | null>(null)
  if (visit.current?.key !== sessionKey) visit.current = { key: sessionKey, mark: readLastSeen(sessionKey), seenAt, openedAt: Date.now() }
  const [found, setFound] = useState<{ key: string; value: SinceYouLeft } | null>(null)
  useEffect(() => {
    const current = visit.current!
    if (!ready || !cards.length || found?.key === sessionKey || Date.now() - current.openedAt > SETTLE_MS) return
    const value = sinceYouLeft(cards, current.mark, current.seenAt)
    if (value) setFound({ key: sessionKey, value })
  }, [sessionKey, cards, ready, found])

  const latest = useRef<{ key: string; entry: LastSeen } | null>(null)
  const lastKey = cards.findLast(card => !card.key.startsWith('live-') && !card.key.startsWith('activity-summary:'))?.key
  if (reading && ready && lastKey && (latest.current?.key !== sessionKey || latest.current.entry.cardKey !== lastKey)) {
    latest.current = { key: sessionKey, entry: { cardKey: lastKey, at: Date.now() } }
  }
  useEffect(() => {
    const save = () => {
      const read = latest.current
      if (read?.key === sessionKey && readLastSeen(sessionKey)?.cardKey !== read.entry.cardKey) writeLastSeen(sessionKey, read.entry)
    }
    process.once('exit', save)
    return () => {
      process.off('exit', save)
      save()
    }
  }, [sessionKey])
  return found?.key === sessionKey ? found.value : null
}
