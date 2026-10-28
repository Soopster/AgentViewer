import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import type { Session } from '../../../lib/types'
import { type ContextComposerHandle } from '../../ContextComposer'
import { useCallback, useMemo } from 'react'
import { type SendAttachment } from '@/lib/types'
import { getSlashCommandSuggestions, filterSlashCommands, type SlashCommandSuggestion } from '@/lib/slashCommands'
import { removeComposerQueueItem } from '@/lib/composerAttachments'
import { type QueuedWebSend } from '../types'
import { detectMentionAtCursor } from '../composerUi'

export type UseRemoveQueuedSendGroupContext = {
  commitQueuedSends: (next: QueuedWebSend[]) => void
  queuedSendsRef: RefObject<QueuedWebSend[]>
  setInputText: Dispatch<SetStateAction<string>>
  inputTextRef: MutableRefObject<string>
  setAttachments: Dispatch<SetStateAction<SendAttachment[]>>
  textareaRef: MutableRefObject<ContextComposerHandle | null>
  resizeComposer: () => void
  mentionQuery: { start: number; query: string; } | null
  setMentionActiveIndex: Dispatch<SetStateAction<number>>
  setMentionQuery: Dispatch<SetStateAction<{ start: number; query: string; } | null>>
  slashOpen: boolean
  setSlashActiveIndex: Dispatch<SetStateAction<number>>
  setSlashOpen: Dispatch<SetStateAction<boolean>>
  session: Session | null
  liveSlashCommands: SlashCommandSuggestion[]
  inputText: string
}

export function useRemoveQueuedSendGroup(ctx: UseRemoveQueuedSendGroupContext) {
  const {
    commitQueuedSends, queuedSendsRef, setInputText, inputTextRef, setAttachments, textareaRef,
    resizeComposer, mentionQuery, setMentionActiveIndex, setMentionQuery, slashOpen,
    setSlashActiveIndex, setSlashOpen, session, liveSlashCommands, inputText,
  } = ctx

  // Remove a single queued message (× on its chip) without firing it.
  const removeQueuedSend = useCallback((id: string) => {
    commitQueuedSends(removeComposerQueueItem(queuedSendsRef.current, id))
  }, [commitQueuedSends])

  // Pull a queued message back into the composer to edit it. Its attachments
  // are still in memory so they restore too. The current draft is preserved by
  // prepending the edited text only when the composer is empty; otherwise the
  // queued text replaces the draft (matching ↑ history-recall behaviour).
  const editQueuedSend = useCallback((id: string) => {
    const item = queuedSendsRef.current.find((entry) => entry.id === id)
    if (!item) return
    commitQueuedSends(removeComposerQueueItem(queuedSendsRef.current, id))
    setInputText(item.text)
    inputTextRef.current = item.text
    setAttachments(item.attachments ?? [])
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.value = item.text
        ta.focus()
        ta.setSelectionRange(item.text.length, item.text.length)
      }
      resizeComposer()
    })
  }, [commitQueuedSends, resizeComposer, inputTextRef, textareaRef, setInputText, setAttachments])

  const updateComposerHints = useCallback((text: string, cursor: number) => {
    const mention = detectMentionAtCursor(text, cursor)
    const mentionChanged = mention
      ? !mentionQuery || mentionQuery.start !== mention.start || mentionQuery.query !== mention.query
      : mentionQuery !== null
    if (mentionChanged) {
      setMentionActiveIndex(0)
      setMentionQuery(mention)
    }
    const isSlash = text.startsWith('/') && !/\s/.test(text.split('\n')[0] ?? '')
    if (isSlash !== slashOpen) {
      if (isSlash) setSlashActiveIndex(0)
      setSlashOpen(isSlash)
    }
  }, [mentionQuery, slashOpen])

  const slashCommands = useMemo(() => {
    const baseline = getSlashCommandSuggestions(session?.provider)
    const merged = [...liveSlashCommands]
    const seen = new Set(merged.map((entry) => entry.command))
    for (const entry of baseline) {
      if (!seen.has(entry.command)) {
        merged.push(entry)
        seen.add(entry.command)
      }
    }
    const firstLine = inputText.split('\n')[0] ?? ''
    return filterSlashCommands(merged, firstLine.slice(1))
  }, [inputText, liveSlashCommands, session?.provider])

  const commandSessionId = session?.sessionId
  const commandSessionProvider = session?.provider

  return {
    removeQueuedSend, editQueuedSend, updateComposerHints, slashCommands, commandSessionId,
    commandSessionProvider,
  }
}
