import type { ComposerSessions } from '../../../../lib/composerSessions'
/** @jsxImportSource @opentui/react */
import { useComposerSessionState } from '../../../../lib/composerSessions'
import React, { useRef, useState } from 'react'
import { useWorkspaceState } from '../../workspaceContext'
import { type SendAttachment, type SessionComposerAgentOption } from '../../../../lib/types'
import { type ComposerPromptPart, type TuiMentionResult } from '../types'

export type UseComposerInputStateContext = {
  composerSessions: ComposerSessions
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
