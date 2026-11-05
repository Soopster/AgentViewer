/** @jsxImportSource @opentui/react */
import type { KeyEvent } from '@opentui/core'
import type { CardDisplayData } from '../types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { type SelectedLineRange } from '@pierre/diffs'
import { type TuiTranscriptCard } from '../../../format'
import { type TuiTranscriptView } from '../../../theme'
import { writeTuiDiffLayout, type TuiDiffLayout } from '../../../../lib/tui/service'
import { type PaneFocus, type NoticeTone } from '../types'
import { clamp } from '../util'
import { cardDiffText } from '../transcriptRows'
import { type TranscriptDiffNote, transcriptDiffCardNamespace, transcriptDiffSelectionKey, transcriptDiffSelectionLineLabel, transcriptDiffSelectionSpanFromRowRange, nextTranscriptDiffRowIndex } from '../transcriptDiffSelection'

/** Returns true when one of these branches handled the key. */
export function handleReaderKeys({
  effectiveFocus, key, handled, moveAgentToolCursor, moveCursor, velocityScrollStep,
  jumpToTranscriptIndex, isShifted, jumpToTranscriptTail, transcriptViewportRows, isCtrl,
  moveViewport, openSelectedAsyncQuestionsOrFold, toggleExpansion, transcriptView,
  jumpToUnreadBoundary, selectedInteractiveTranscriptCard,
  selectedInteractiveTranscriptCardDisplay, jumpToResumeMarker, toggleBookmarkForCursor,
  replySelectedMessage, diffLayout, transcriptDiffHiddenHunkHeaderCardKeys,
  transcriptDiffRowCursorByCardKey, setTranscriptDiffSelectionAnchorByCardKey,
  setTranscriptDiffRowCursorForCard, committedSessionKey, transcriptDiffSelectionAnchorByCardKey,
  transcriptDiffNotes, toggleTranscriptDiffCardSet, setTranscriptDiffPlainCardKeys,
  clearTranscriptDiffSelectionForCard, setTranscriptDiffHiddenLineNumberCardKeys,
  setTranscriptDiffHiddenHunkHeaderCardKeys, showNotice, openTranscriptDiffNote,
  deleteTranscriptDiffNote, sendTranscriptDiffNoteToComposer, selectedAgentToolCard,
  selectedAgentToolExpanded, resolvedExpandedKeys, sequence, setSearchMode, setSessionSearchMode,
  copySelectedMessage, setDiffLayout, showToggleOutcome, setError, searchMatches,
  jumpToSearchMatch, jumpToMatchingCard,
}: {
  effectiveFocus: PaneFocus
  key: KeyEvent
  handled: (action: () => void) => void
  moveAgentToolCursor: (delta: -1 | 1) => boolean
  moveCursor: (delta: number) => void
  velocityScrollStep: (direction: -1 | 1) => number
  jumpToTranscriptIndex: (index: number) => void
  isShifted: (char: string) => boolean
  jumpToTranscriptTail: () => void
  transcriptViewportRows: number
  isCtrl: (char: string) => boolean
  moveViewport: (direction: -1 | 1) => void
  openSelectedAsyncQuestionsOrFold: () => void
  toggleExpansion: (scope?: 'selected' | 'parent') => void
  transcriptView: TuiTranscriptView
  jumpToUnreadBoundary: () => void
  selectedInteractiveTranscriptCard: TuiTranscriptCard | null
  selectedInteractiveTranscriptCardDisplay: CardDisplayData | null
  jumpToResumeMarker: () => void
  toggleBookmarkForCursor: () => Promise<void>
  replySelectedMessage: (cardOverride?: TuiTranscriptCard) => void
  diffLayout: TuiDiffLayout
  transcriptDiffHiddenHunkHeaderCardKeys: Set<string>
  transcriptDiffRowCursorByCardKey: Record<string, number>
  setTranscriptDiffSelectionAnchorByCardKey: React.Dispatch<React.SetStateAction<Record<string, number>>>
  setTranscriptDiffRowCursorForCard: (cardKey: string, rowIndex: number, preserveSelection?: boolean) => void
  committedSessionKey: string | null
  transcriptDiffSelectionAnchorByCardKey: Record<string, number>
  transcriptDiffNotes: Map<string, TranscriptDiffNote>
  toggleTranscriptDiffCardSet: (setter: React.Dispatch<React.SetStateAction<Set<string>>>, cardKey: string) => void
  setTranscriptDiffPlainCardKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  clearTranscriptDiffSelectionForCard: (cardKey: string) => void
  setTranscriptDiffHiddenLineNumberCardKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  setTranscriptDiffHiddenHunkHeaderCardKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  openTranscriptDiffNote: (selection: SelectedLineRange, cardKey?: string) => void
  deleteTranscriptDiffNote: (selectionKey: string) => void
  sendTranscriptDiffNoteToComposer: (card: TuiTranscriptCard, note: TranscriptDiffNote, label: string, diffText: string | null) => void
  selectedAgentToolCard: TuiTranscriptCard | null
  selectedAgentToolExpanded: boolean
  resolvedExpandedKeys: Set<string>
  sequence: string
  setSearchMode: React.Dispatch<React.SetStateAction<boolean>>
  setSessionSearchMode: React.Dispatch<React.SetStateAction<boolean>>
  copySelectedMessage: (cardOverride?: TuiTranscriptCard) => Promise<void>
  setDiffLayout: React.Dispatch<React.SetStateAction<TuiDiffLayout>>
  showToggleOutcome: (label: string, outcome: string | boolean) => void
  setError: React.Dispatch<React.SetStateAction<string | null>>
  searchMatches: number[]
  jumpToSearchMatch: (matchOffset: number) => void
  jumpToMatchingCard: (direction: -1 | 1, predicate: (card: TuiTranscriptCard) => boolean) => void
}): boolean {
    // Unshifted only — Shift+j/k (and Shift+↑/↓) are reserved for the diff
    // card's row range-select block below; without the !key.shift guard these
    // card-cursor moves would swallow the shifted keys first (same precedence
    // trap as the resume-marker `m`).
    // SCROLLBACK has no card cursor: the keys that move it elsewhere move the
    // text here, by rows, and `e`/Enter fold or unfold the whole transcript.

    if (effectiveFocus === 'messages' && (key.name === 'j' || key.name === 'down') && !key.shift) {
      handled(() => {
        if (!moveAgentToolCursor(1)) moveCursor(velocityScrollStep(1))
      })
      return true
    }

    if (effectiveFocus === 'messages' && (key.name === 'k' || key.name === 'up') && !key.shift) {
      handled(() => {
        if (!moveAgentToolCursor(-1)) moveCursor(-velocityScrollStep(-1))
      })
      return true
    }

    if (effectiveFocus === 'messages' && key.name === 'g' && !key.shift) {
      handled(() => {
        jumpToTranscriptIndex(0)
      })
      return true
    }

    if (effectiveFocus === 'messages' && isShifted('G')) {
      handled(() => {
        jumpToTranscriptTail()
      })
      return true
    }

    if (effectiveFocus === 'messages' && key.name === 'pagedown') {
      handled(() => {
        moveCursor(Math.max(Math.floor(transcriptViewportRows * 0.8), 1))
      })
      return true
    }

    if (effectiveFocus === 'messages' && key.name === 'pageup') {
      handled(() => {
        moveCursor(-Math.max(Math.floor(transcriptViewportRows * 0.8), 1))
      })
      return true
    }

    if (effectiveFocus === 'messages' && isCtrl('d')) {
      handled(() => {
        moveViewport(1)
      })
      return true
    }

    if (effectiveFocus === 'messages' && isCtrl('u')) {
      handled(() => {
        moveViewport(-1)
      })
      return true
    }

    if (effectiveFocus === 'messages' && key.name === 'return') {
      handled(() => {
        openSelectedAsyncQuestionsOrFold()
      })
      return true
    }

    if (effectiveFocus === 'messages' && key.name === 'e') {
      handled(() => {
        toggleExpansion('selected')
      })
      return true
    }

    if (effectiveFocus === 'sessions' && transcriptView === 'agents' && key.name === 'e') {
      handled(() => {
        toggleExpansion('parent')
      })
      return true
    }

    if (effectiveFocus === 'messages' && key.name === 'f') {
      handled(() => {
        jumpToTranscriptTail()
      })
      return true
    }

    if (effectiveFocus === 'messages' && key.name === 'u') {
      handled(() => {
        jumpToUnreadBoundary()
      })
      return true
    }

    // Resume-marker jump yields to the diff card's own `m` (toggle hunk
    // headers) when the cursor is on an interactive diff — this global handler
    // sits above the diff key block, so without the guard it would swallow `m`
    // before the diff block (below) ever sees it, leaving the documented
    // per-card shortcut dead.
    if (
      effectiveFocus === 'messages'
      && key.name === 'm'
      && !(selectedInteractiveTranscriptCard?.category === 'diff' && selectedInteractiveTranscriptCardDisplay?.diffView)
    ) {
      handled(() => {
        jumpToResumeMarker()
      })
      return true
    }

    if (effectiveFocus === 'messages' && key.name === 'b' && !key.shift) {
      handled(() => {
        void toggleBookmarkForCursor()
      })
      return true
    }

    if (effectiveFocus === 'messages' && isShifted('Q')) {
      handled(() => {
        replySelectedMessage()
      })
      return true
    }

    if (
      effectiveFocus === 'messages'
      && selectedInteractiveTranscriptCard?.category === 'diff'
      && selectedInteractiveTranscriptCardDisplay?.diffView
      && key.shift
      && (key.name === 'j' || key.name === 'down' || key.name === 'k' || key.name === 'up')
    ) {
      const selectedDiffView = selectedInteractiveTranscriptCardDisplay.diffView
      if (!selectedDiffView) return true
      handled(() => {
        const cardKey = selectedInteractiveTranscriptCard.key
        const currentRows = diffLayout === 'split'
          ? selectedDiffView.splitRows
          : selectedDiffView.rows
        const visibleRows = currentRows.filter((row) => !transcriptDiffHiddenHunkHeaderCardKeys.has(cardKey) || row.tone !== 'hunk')
        if (visibleRows.length === 0) return
        const currentCursor = transcriptDiffRowCursorByCardKey[cardKey] ?? 0
        const currentIndex = clamp(currentCursor, 0, visibleRows.length - 1)
        const delta = key.name === 'j' || key.name === 'down' ? 1 : -1
        const nextIndex = clamp(currentIndex + delta, 0, visibleRows.length - 1)
        setTranscriptDiffSelectionAnchorByCardKey((prev) => (
          prev[cardKey] != null ? prev : { ...prev, [cardKey]: currentIndex }
        ))
        setTranscriptDiffRowCursorForCard(cardKey, nextIndex, true)
      })
      return true
    }

    if (effectiveFocus === 'messages' && selectedInteractiveTranscriptCard?.category === 'diff' && selectedInteractiveTranscriptCardDisplay?.diffView) {
      const selectedDiffView = selectedInteractiveTranscriptCardDisplay.diffView
      if (!selectedDiffView) return true
      const cardKey = selectedInteractiveTranscriptCard.key
      const currentRows = diffLayout === 'split'
        ? selectedDiffView.splitRows
        : selectedDiffView.rows
      const visibleRows = currentRows.filter((row) => !transcriptDiffHiddenHunkHeaderCardKeys.has(cardKey) || row.tone !== 'hunk')
      const currentCursor = transcriptDiffRowCursorByCardKey[cardKey] ?? 0
      const currentIndex = visibleRows.length > 0 ? clamp(currentCursor, 0, visibleRows.length - 1) : 0
      const currentRow = visibleRows[currentIndex] ?? null
      const noteAnchorNamespace = transcriptDiffCardNamespace(committedSessionKey ?? 'no-session', cardKey)
      const selectionAnchorIndex = transcriptDiffSelectionAnchorByCardKey[cardKey] ?? null
      const currentSelectionSpan = selectionAnchorIndex != null
        ? transcriptDiffSelectionSpanFromRowRange(noteAnchorNamespace, visibleRows, selectionAnchorIndex, currentIndex)
        : (currentRow
          ? transcriptDiffSelectionSpanFromRowRange(noteAnchorNamespace, visibleRows, currentIndex, currentIndex)
          : null)
      const noteSelection = currentSelectionSpan?.selection ?? null
      const legacyNoteKey = noteSelection ? transcriptDiffSelectionKey(committedSessionKey ?? 'no-session', noteSelection) : null
      const noteSelectionKey = currentSelectionSpan && transcriptDiffNotes.has(currentSelectionSpan.key)
        ? currentSelectionSpan.key : legacyNoteKey && transcriptDiffNotes.has(legacyNoteKey) ? legacyNoteKey : currentSelectionSpan?.key ?? null
      const hunkHeadersVisible = !transcriptDiffHiddenHunkHeaderCardKeys.has(cardKey)

      if (key.sequence === 'v') {
        handled(() => {
          toggleTranscriptDiffCardSet(setTranscriptDiffPlainCardKeys, cardKey)
          clearTranscriptDiffSelectionForCard(cardKey)
        })
        return true
      }
      if (key.sequence === 'n') {
        handled(() => {
          toggleTranscriptDiffCardSet(setTranscriptDiffHiddenLineNumberCardKeys, cardKey)
          clearTranscriptDiffSelectionForCard(cardKey)
        })
        return true
      }
      if (key.sequence === 'm') {
        handled(() => {
          toggleTranscriptDiffCardSet(setTranscriptDiffHiddenHunkHeaderCardKeys, cardKey)
          clearTranscriptDiffSelectionForCard(cardKey)
        })
        return true
      }
      if (key.sequence === '{') {
        handled(() => {
          const next = nextTranscriptDiffRowIndex(visibleRows, currentIndex, -1, hunkHeadersVisible)
          if (next != null) setTranscriptDiffRowCursorForCard(cardKey, next)
        })
        return true
      }
      if (key.sequence === '}') {
        handled(() => {
          const next = nextTranscriptDiffRowIndex(visibleRows, currentIndex, 1, hunkHeadersVisible)
          if (next != null) setTranscriptDiffRowCursorForCard(cardKey, next)
        })
        return true
      }
      if (key.sequence === 'a') {
        handled(() => {
          if (!noteSelection) {
            showNotice('info', 'No diff row selected')
            return
          }
          openTranscriptDiffNote(noteSelection, cardKey)
        })
        return true
      }
      if (key.sequence === 'x') {
        handled(() => {
          if (!noteSelectionKey) {
            showNotice('info', 'No diff row selected')
            return
          }
          if (!transcriptDiffNotes.has(noteSelectionKey)) {
            showNotice('info', 'No note on the selected diff row')
            return
          }
          deleteTranscriptDiffNote(noteSelectionKey)
        })
        return true
      }
      if (key.sequence === 'A') {
        handled(() => {
          if (!noteSelectionKey) {
            showNotice('info', 'No diff row selected')
            return
          }
          const note = transcriptDiffNotes.get(noteSelectionKey)
          if (!note) {
            showNotice('info', 'No note on the selected diff row')
            return
          }
          sendTranscriptDiffNoteToComposer(
            selectedInteractiveTranscriptCard,
            note,
            currentSelectionSpan?.label ?? transcriptDiffSelectionLineLabel(note.range),
            cardDiffText(
              selectedInteractiveTranscriptCard,
              selectedAgentToolCard ? selectedAgentToolExpanded : resolvedExpandedKeys.has(selectedInteractiveTranscriptCard.key),
            ),
          )
          showNotice('info', 'Diff comment added to composer')
        })
        return true
      }
    }

    if (effectiveFocus === 'messages' && sequence === '/') {
      handled(() => {
        setSearchMode(true)
      })
      return true
    }

    if (effectiveFocus === 'sessions' && sequence === '/') {
      handled(() => {
        setSessionSearchMode(true)
      })
      return true
    }

    if (effectiveFocus === 'messages' && sequence === 'y') {
      handled(() => {
        void copySelectedMessage()
      })
      return true
    }

    if (effectiveFocus === 'messages' && sequence === 's') {
      const selectedCard = selectedInteractiveTranscriptCard
      if (selectedCard?.category === 'diff') {
        handled(() => {
          const next: TuiDiffLayout = diffLayout === 'stack' ? 'split' : 'stack'
          setDiffLayout(next)
          showToggleOutcome('Diff layout:', next)
          void writeTuiDiffLayout(next).catch((err) => {
            setError(err instanceof Error ? err.message : 'Failed to store diff layout')
          })
        })
        return true
      }
    }

    if (effectiveFocus === 'messages' && key.name === 'n' && !key.shift && searchMatches.length > 0) {
      handled(() => {
        jumpToSearchMatch(1)
      })
      return true
    }

    if (effectiveFocus === 'messages' && isShifted('N') && searchMatches.length > 0) {
      handled(() => {
        jumpToSearchMatch(-1)
      })
      return true
    }

    if (effectiveFocus === 'messages' && sequence === '(') {
      handled(() => {
        jumpToMatchingCard(-1, (card) => card.category === 'conversation')
      })
      return true
    }

    if (effectiveFocus === 'messages' && sequence === ')') {
      handled(() => {
        jumpToMatchingCard(1, (card) => card.category === 'conversation')
      })
      return true
    }

    if (effectiveFocus === 'messages' && sequence === '{') {
      handled(() => {
        jumpToMatchingCard(-1, (card) => card.category !== 'conversation')
      })
      return true
    }

    if (effectiveFocus === 'messages' && sequence === '}') {
      handled(() => {
        jumpToMatchingCard(1, (card) => card.category !== 'conversation')
      })
      return true
    }
  return false
}
