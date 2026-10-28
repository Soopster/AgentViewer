import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import { type PendingMessageBaseline } from '../types'

export type UseTurnProducedOutputRefGroupContext = {
  composerSessions: { get<T>(key: string, name: string, initial: T | (() => T)): T; set<T>(key: string, name: string, initial: T | (() => T), action: SetStateAction<T>): void; subscribe(key: string, name: string, listener: () => void): () => void; ref<T>(key: string, name: string, initial: T): MutableRefObject<T>; peekRef<T>(key: string, name: string): MutableRefObject<T> | undefined; same(a: string, b: string): boolean; rekey(from: string, to: string): void; keys(): string[]; }
  composerOwnerKey: string
}

export function useTurnProducedOutputRefGroup(ctx: UseTurnProducedOutputRefGroupContext) {
  const {
    composerSessions, composerOwnerKey,
  } = ctx

  // Transient auto-retry bookkeeping. turnProducedOutputRef gates retries to
  // turns that streamed nothing yet (so a retry can't duplicate work);
  // transientRetryCountRef counts attempts within one logical send;
  // transientRetryTimerRef holds the pending backoff so cancel can clear it.
  const turnProducedOutputRef = composerSessions.ref(composerOwnerKey, 'turnProducedOutputRef', false)
  const transientRetryCountRef = composerSessions.ref(composerOwnerKey, 'transientRetryCountRef', 0)
  const transientRetryTimerRef = composerSessions.ref<ReturnType<typeof setTimeout> | null>(composerOwnerKey, 'transientRetryTimerRef', null)
  // Set when a send was blocked because the model list hadn't resolved yet
  // (see the modelsLoading guard in sendMessage). The composer draft is left
  // untouched in that case — this just re-fires the send once the fetch
  // settles, so a cold custom-model connection reads as "sending" rather than
  // making the user notice the error and hit enter again.
  const pendingSendOnModelsReadyRef = composerSessions.ref<string | null>(composerOwnerKey, 'pendingSendOnModelsReadyRef', null)
  const pendingMessageBaselineRef = composerSessions.ref<PendingMessageBaseline | null>(composerOwnerKey, 'pendingMessageBaselineRef', null)
  const liveTurnSessionHandoffRef = composerSessions.ref<string | null>(composerOwnerKey, 'liveTurnSessionHandoffRef', null)
  const liveAssistantTextRef = composerSessions.ref(composerOwnerKey, 'liveAssistantTextRef', '')
  const pendingLiveAssistantTextRef = composerSessions.ref<string | null>(composerOwnerKey, 'pendingLiveAssistantTextRef', null)
  const liveAssistantFlushFrameRef = composerSessions.ref<number | null>(composerOwnerKey, 'liveAssistantFlushFrameRef', null)

  return {
    turnProducedOutputRef, transientRetryCountRef, transientRetryTimerRef,
    pendingSendOnModelsReadyRef, pendingMessageBaselineRef, liveTurnSessionHandoffRef,
    liveAssistantTextRef, pendingLiveAssistantTextRef, liveAssistantFlushFrameRef,
  }
}
