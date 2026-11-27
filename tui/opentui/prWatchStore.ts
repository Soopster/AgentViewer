// Which sessions' pull requests are being watched, for the windows that show it.
// The daemon or this TUI's engine ends a watch on its own, so a shown one is read again.
import { useCallback, useSyncExternalStore } from 'react'
import { readTuiPrWatching, setTuiPrWatching } from '../../lib/tui/github'
import type { LinkedPullRequest, Session } from '../../lib/types'

const REFRESH_MS = 30_000

type Entry = { watching: boolean; listeners: Set<() => void>; timer: ReturnType<typeof setInterval> | null; session: Session }

const entries = new Map<string, Entry>()
const keyOf = (session: Session) => `${session.providerInstanceId ?? session.provider ?? 'claude'}\u0000${session.sessionId}`

function entryFor(session: Session): Entry {
  let entry = entries.get(keyOf(session))
  if (!entry) entries.set(keyOf(session), entry = { watching: false, listeners: new Set(), timer: null, session })
  return entry
}

function publish(entry: Entry, watching: boolean) {
  if (entry.watching === watching) return
  entry.watching = watching
  for (const listener of entry.listeners) listener()
}

const refresh = (entry: Entry) => { void readTuiPrWatching(entry.session).then(value => publish(entry, value)).catch(() => {}) }

function subscribe(session: Session, listener: () => void): () => void {
  const entry = entryFor(session)
  entry.listeners.add(listener)
  if (!entry.timer) { refresh(entry); entry.timer = setInterval(() => refresh(entry), REFRESH_MS) }
  return () => {
    entry.listeners.delete(listener)
    if (!entry.listeners.size && entry.timer) { clearInterval(entry.timer); entry.timer = null }
  }
}

export const peekPrWatching = (session: Session) => entries.get(keyOf(session))?.watching ?? false

export function usePrWatching(session: Session): boolean {
  const key = keyOf(session)
  const linked = !!session.inbox?.linkedPr
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a listing hands out a new object for the same session
  const subscriber = useCallback((listener: () => void) => linked ? subscribe(session, listener) : () => {}, [key, linked])
  return useSyncExternalStore(subscriber, () => peekPrWatching(session))
}

/** Flips the watch and returns what it is now. */
export async function togglePrWatching(session: Session, pr: LinkedPullRequest): Promise<boolean> {
  const entry = entryFor(session)
  const next = !(await readTuiPrWatching(session))
  await setTuiPrWatching(session, next, { ...pr, cwd: pr.cwd ?? session.cwd })
  publish(entry, next)
  return next
}
