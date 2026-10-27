/** @jsxImportSource @opentui/react */
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import { useComposerSessionState } from '../../../../lib/composerSessions'
import React, { useRef, useState } from 'react'
import { useWorkspaceState } from '../../workspaceContext'
import { type SendAttachment, type SessionComposerAgentOption } from '../../../../lib/types'
import { type ComposerPromptPart, type TuiMentionResult } from '../types'

export type UseComposerInputStateContext = {
  composerSessions: { get<T>(key: string, name: string, initial: T | (() => T)): T; set<T>(key: string, name: string, initial: T | (() => T), action: React.SetStateAction<T>): void; subscribe(key: string, name: string, listener: () => void): () => void; ref<T>(key: string, name: string, initial: T): React.MutableRefObject<T>; peekRef<T>(key: string, name: string): React.MutableRefObject<T> | undefined; same(a: string, b: string): boolean; rekey(from: string, to: string): void; keys(): string[]; }
  composerOwnerKey: string
}

export function useComposerInputState(ctx: UseComposerInputStateContext) {
  const {
    composerSessions, composerOwnerKey,
  } = ctx

  const composerDraftStorageKeyRef = useRef<string | null>(null)
  const [composerLiveTodos, setComposerLiveTodos] = useComposerSessionState<import('../../../../lib/taskRegistry').OpenCodeTodo[]>(composerSessions, composerOwnerKey, 'composerLiveTodos', [])
  const [composerMention, setComposerMention] = useState<{ start: number; query: string } | null>(null)
  const [composerMentionResults, setComposerMentionResults] = useState<TuiMentionResult[]>([])
  const [composerAgentOptions, setComposerAgentOptions] = useState<SessionComposerAgentOption[]>([])
  const [composerMentionAgents, setComposerMentionAgents] = useState<SessionComposerAgentOption[]>([])
  const [composerMentionIndex, setComposerMentionIndex] = useState(0)
  const [composerMentionDismissedStart, setComposerMentionDismissedStart] = useState<number | null>(null)
  const [composerMentionAttachments, setComposerMentionAttachments] = useWorkspaceState<SendAttachment[]>('composerMentionAttachments', [])
  const [composerPromptParts, setComposerPromptParts] = useWorkspaceState<ComposerPromptPart[]>('composerPromptParts', [])
  const composerMentionAttachmentsRef = useRef<SendAttachment[]>([])
  const composerPromptPartsRef = useRef<ComposerPromptPart[]>([])

  return {
    composerDraftStorageKeyRef, composerLiveTodos, setComposerLiveTodos, composerMention,
    setComposerMention, composerMentionResults, setComposerMentionResults, composerAgentOptions,
    setComposerAgentOptions, composerMentionAgents, setComposerMentionAgents, composerMentionIndex,
    setComposerMentionIndex, composerMentionDismissedStart, setComposerMentionDismissedStart,
    composerMentionAttachments, setComposerMentionAttachments, composerPromptParts,
    setComposerPromptParts, composerMentionAttachmentsRef, composerPromptPartsRef,
  }
}
