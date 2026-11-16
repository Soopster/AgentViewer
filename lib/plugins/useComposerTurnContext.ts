import { useSyncExternalStore } from 'react'
import { sessionIdentityKey, type SessionIdentity } from '../sessionIdentity'
import type { ComposerTurnContext } from './composer'
import { modAppStore } from './modApp'

/** Runtime start time keeps turn identity stable through polls and remounts. */
export function useComposerTurnContext(session: SessionIdentity | null, running: boolean, needsAttention: boolean, startedAt?: number | null): ComposerTurnContext | undefined {
  const key = session ? sessionIdentityKey(session) : null
  const readStart = () => startedAt ?? modAppStore.getSnapshot().sessions.find(entry => entry.key === key)?.startedAt
  const start = useSyncExternalStore(modAppStore.subscribe, readStart, readStart)
  if (!key || start == null || !Number.isFinite(start)) return undefined
  return { id: JSON.stringify([key, start]), startedAt: start, running, needsAttention }
}
