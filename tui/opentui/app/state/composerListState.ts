/** @jsxImportSource @opentui/react */
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import { useComposerSessionState } from '../../../../lib/composerSessions'
import React, { useState } from 'react'
import { readComposerStash } from '../../../../lib/tuiComposerState'
import { type SendState } from '../../../../lib/types'
import { type RewindCandidate } from '../../rewindTargets'
import { type SlashCommandSuggestion } from '../../../../lib/slashCommands'
import { type ComposerDraftSnapshot } from '../types'
import { isComposerDraftSnapshot } from '../composerInput'

export type UseComposerListStateContext = {
  composerSessions: { get<T>(key: string, name: string, initial: T | (() => T)): T; set<T>(key: string, name: string, initial: T | (() => T), action: React.SetStateAction<T>): void; subscribe(key: string, name: string, listener: () => void): () => void; ref<T>(key: string, name: string, initial: T): React.MutableRefObject<T>; peekRef<T>(key: string, name: string): React.MutableRefObject<T> | undefined; same(a: string, b: string): boolean; rekey(from: string, to: string): void; keys(): string[]; }
  composerOwnerKey: string
}

export function useComposerListState(ctx: UseComposerListStateContext) {
  const {
    composerSessions, composerOwnerKey,
  } = ctx

  // Shelved drafts survive a restart: the whole point of stashing a prompt is
  // that you are not ready to send it, and "not ready" outlives one session.
  const [composerStash, setComposerStash] = useState<ComposerDraftSnapshot[]>(() =>
    readComposerStash(isComposerDraftSnapshot))
  const [composerStashOpen, setComposerStashOpen] = useState(false)
  // /rewind's prompt picker: the prompts it lists are frozen when it opens.
  const [composerRewindItems, setComposerRewindItems] = useState<RewindCandidate[] | null>(null)
  const [composerRewindIndex, setComposerRewindIndex] = useState(0)
  const [composerStashIndex, setComposerStashIndex] = useState(0)
  const [composerSlashIndex, setComposerSlashIndex] = useState(0)
  const [composerSlashDismissed, setComposerSlashDismissed] = useState(false)
  const [composerHistoryOpen, setComposerHistoryOpen] = useState(false)
  const [composerHistoryIndex, setComposerHistoryIndex] = useState(0)
  const [composerLiveSlashCommands, setComposerLiveSlashCommands] = useComposerSessionState<SlashCommandSuggestion[]>(composerSessions, composerOwnerKey, 'composerLiveSlashCommands', [])
  const [composerSendState, setComposerSendState] = useComposerSessionState<SendState>(composerSessions, composerOwnerKey, 'composerSendState', 'idle')
  // Transient stream UI belongs to the session that started the turn, not the
  // tab selected later. Keep the owner through persisted-transcript reconcile
  // so the final syncing spinner cannot jump across tabs either.
  const [composerActivitySessionKey, setComposerActivitySessionKey] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'composerActivitySessionKey', null)
  const [composerSendStartedAt, setComposerSendStartedAt] = useComposerSessionState<number | null>(composerSessions, composerOwnerKey, 'composerSendStartedAt', null)
  const [interruptPressActive, setInterruptPressActive] = useComposerSessionState(composerSessions, composerOwnerKey, 'interruptPressActive', false)
  const [backgroundingTasks, setBackgroundingTasks] = useState(false)

  return {
    composerStash, setComposerStash, composerStashOpen, setComposerStashOpen, composerRewindItems,
    setComposerRewindItems, composerRewindIndex, setComposerRewindIndex, composerStashIndex,
    setComposerStashIndex, composerSlashIndex, setComposerSlashIndex, composerSlashDismissed,
    setComposerSlashDismissed, composerHistoryOpen, setComposerHistoryOpen, composerHistoryIndex,
    setComposerHistoryIndex, composerLiveSlashCommands, setComposerLiveSlashCommands,
    composerSendState, setComposerSendState, composerActivitySessionKey,
    setComposerActivitySessionKey, composerSendStartedAt, setComposerSendStartedAt,
    interruptPressActive, setInterruptPressActive, backgroundingTasks, setBackgroundingTasks,
  }
}
