import type { RefObject } from 'react'
import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import { type ContextComposerHandle } from '../../ContextComposer'
import { readComposerContext, restoreContextAttachments } from '@/lib/composerContext'
import { type SendState, type SendAttachment } from '@/lib/types'
import { type SlashCommandSuggestion } from '@/lib/slashCommands'
import { ArrowUp } from 'lucide-react'
import { mergeComposerAttachments } from '@/lib/composerAttachments'
import { type MentionResult } from '../types'

export type HandleKeyDownContext = {
  isComposingRef: RefObject<boolean>
  session: Session | null
  sendState: SendState
  reattachedRunning: boolean
  backgroundClaudeTasks: () => Promise<void>
  mentionQuery: { start: number; query: string; } | null
  mentionResults: MentionResult[]
  setMentionActiveIndex: Dispatch<SetStateAction<number>>
  mentionActiveIndex: number
  insertMention: (entry: MentionResult) => void
  setMentionQuery: Dispatch<SetStateAction<{ start: number; query: string; } | null>>
  slashOpen: boolean
  slashCommands: SlashCommandSuggestion[]
  setSlashActiveIndex: Dispatch<SetStateAction<number>>
  slashActiveIndex: number
  insertSlashCommand: (command: string) => void
  setSlashOpen: Dispatch<SetStateAction<boolean>>
  sendMessage: (retryOverride?: { text: string; attachments: SendAttachment[]; turnRequestId?: string; }) => Promise<void>
  sentHistory: string[]
  textareaRef: MutableRefObject<ContextComposerHandle | null>
  inputTextRef: MutableRefObject<string>
  historyIndex: number
  draftBeforeHistoryRef: RefObject<{ text: string; cursorPos: number; }>
  setHistoryIndex: Dispatch<SetStateAction<number>>
  setAttachments: Dispatch<SetStateAction<SendAttachment[]>>
  setInputText: Dispatch<SetStateAction<string>>
  resizeComposer: () => void
}

export function runHandleKeyDown(ctx: HandleKeyDownContext, e: React.KeyboardEvent<HTMLDivElement>) {
  const {
    isComposingRef, session, sendState, reattachedRunning, backgroundClaudeTasks, mentionQuery,
    mentionResults, setMentionActiveIndex, mentionActiveIndex, insertMention, setMentionQuery,
    slashOpen, slashCommands, setSlashActiveIndex, slashActiveIndex, insertSlashCommand,
    setSlashOpen, sendMessage, sentHistory, textareaRef, inputTextRef, historyIndex,
    draftBeforeHistoryRef, setHistoryIndex, setAttachments, setInputText, resizeComposer,
  } = ctx
  if (e.nativeEvent.isComposing || isComposingRef.current) return
  if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b'
    && session?.provider === 'claude' && (sendState === 'sending' || reattachedRunning)) {
    e.preventDefault()
    e.stopPropagation()
    if (!e.repeat) void backgroundClaudeTasks()
    return
  }
  if (mentionQuery && mentionResults.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionActiveIndex((i) => Math.min(i + 1, mentionResults.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const entry = mentionResults[mentionActiveIndex]
      if (entry) {
        e.preventDefault()
        insertMention(entry)
        return
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setMentionQuery(null)
      return
    }
  }
  if (slashOpen && slashCommands.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSlashActiveIndex((i) => Math.min(i + 1, slashCommands.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSlashActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      const entry = slashCommands[slashActiveIndex]
      if (entry) {
        e.preventDefault()
        insertSlashCommand(entry.command)
        return
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setSlashOpen(false)
      return
    }
  }
  if (e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey || !e.altKey)) {
    e.preventDefault()
    sendMessage()
    return
  }
  if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && sentHistory.length > 0) {
    const textarea = textareaRef.current
    const draftValue = textarea?.value ?? inputTextRef.current
    const cursorAtStart = textarea ? textarea.selectionStart === 0 && textarea.selectionEnd === 0 : true
    if (historyIndex === -1) {
      if (draftValue.length > 0 && !cursorAtStart) return
      draftBeforeHistoryRef.current = {
        text: draftValue,
        cursorPos: textarea?.selectionStart ?? draftValue.length,
      }
      const nextIndex = sentHistory.length - 1
      setHistoryIndex(nextIndex)
      const restoredContext = readComposerContext(sentHistory[nextIndex] ?? '')
      const replacement = restoredContext.text
      setAttachments(prev => mergeComposerAttachments(prev, restoreContextAttachments(restoredContext.records)))
      setInputText(replacement)
      inputTextRef.current = replacement
      e.preventDefault()
      window.requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        ta.setSelectionRange(replacement.length, replacement.length)
        resizeComposer()
      })
      return
    }
    const nextIndex = Math.max(historyIndex - 1, 0)
    if (nextIndex === historyIndex) {
      e.preventDefault()
      return
    }
    setHistoryIndex(nextIndex)
    const restoredContext = readComposerContext(sentHistory[nextIndex] ?? '')
    const replacement = restoredContext.text
    setAttachments(prev => mergeComposerAttachments(prev, restoreContextAttachments(restoredContext.records)))
    setInputText(replacement)
    inputTextRef.current = replacement
    e.preventDefault()
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.setSelectionRange(replacement.length, replacement.length)
      resizeComposer()
    })
    return
  }
  if (e.key === 'ArrowDown' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && historyIndex !== -1) {
    const nextIndex = historyIndex + 1
    if (nextIndex >= sentHistory.length) {
      setHistoryIndex(-1)
      const { text: restored, cursorPos } = draftBeforeHistoryRef.current
      setInputText(restored)
      inputTextRef.current = restored
      e.preventDefault()
      window.requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        ta.setSelectionRange(cursorPos, cursorPos)
        resizeComposer()
      })
      return
    }
    setHistoryIndex(nextIndex)
    const restoredContext = readComposerContext(sentHistory[nextIndex] ?? '')
    const replacement = restoredContext.text
    setAttachments(prev => mergeComposerAttachments(prev, restoreContextAttachments(restoredContext.records)))
    setInputText(replacement)
    inputTextRef.current = replacement
    e.preventDefault()
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.setSelectionRange(replacement.length, replacement.length)
      resizeComposer()
    })
    return
  }
}
