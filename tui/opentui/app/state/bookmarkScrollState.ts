/** @jsxImportSource @opentui/react */
import { useRef, useState } from 'react'
import { useWorkspaceState, useQuietWorkspaceState } from '../../workspaceContext'
import { type MessageBookmark } from '../../../../lib/messageBookmarks'
import { type TuiSessionReaderState } from '../../../../lib/tuiState'
import { type ContextUsage } from '../../../../lib/types'
import { sessionKey } from '../sessionList'

export function useBookmarkScrollState() {
  // Global bookmarks overlay (cross-session/provider browser).
  const [bookmarksOverlayOpen, setBookmarksOverlayOpen] = useState(false)
  const [bookmarksOverlay, setBookmarksOverlay] = useState<MessageBookmark[]>([])
  const [bookmarksOverlayIndex, setBookmarksOverlayIndex] = useState(0)
  // When jumping to a bookmark in another session, remember where to land once
  // that session's transcript has loaded.
  const pendingBookmarkCursorRef = useRef<{ sessionKey: string; uuid: string } | null>(null)
  const [followTail, setFollowTail] = useWorkspaceState('followTail', true)
  // Absolute index (into visibleTranscriptCards) of the first mounted reader
  // card when the window is detached from the tail. null = pinned to the tail
  // (derived), which is also the followTail shape. See READER_CARD_WINDOW.
  const [pendingNewCount, setPendingNewCount] = useState(0)
  const [unreadBoundaryKey, setUnreadBoundaryKey] = useWorkspaceState<string | null>('unreadBoundaryKey', null)
  const [resumeMarkerKey, setResumeMarkerKey] = useWorkspaceState<string | null>('resumeMarkerKey', null)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [restoredReaderState, setRestoredReaderState] = useState<{
    sessionKey: string | null
    loaded: boolean
    state: TuiSessionReaderState | null
  }>({
    sessionKey: null,
    loaded: false,
    state: null,
  })
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [contextUsageStatus, setContextUsageStatus] = useState<'idle' | 'loading' | 'unavailable' | 'ready'>('idle')
  const [renameSessionKey, setRenameSessionKey] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const renameDraftRef = useRef(renameDraft)
  const [composerActive, setComposerActive] = useWorkspaceState('composerActive', false)
  const [composerWindowOpen, setComposerWindowOpen] = useWorkspaceState('composerWindowOpen', false)
  const [composerHidden, setComposerHidden] = useWorkspaceState('composerHidden', false)
  // The draft is read, not subscribed to: a keystroke must not re-render this root (see
  // useQuietWorkspaceState). `composerDraft` is its value as of this render; whatever changes
  // per key is drawn by a child that subscribes itself, or arrives through composerDraftShape.
  const composerDraftState = useQuietWorkspaceState('composerDraft', '')

  return {
    bookmarksOverlayOpen, setBookmarksOverlayOpen, bookmarksOverlay, setBookmarksOverlay,
    bookmarksOverlayIndex, setBookmarksOverlayIndex, pendingBookmarkCursorRef, followTail,
    setFollowTail, pendingNewCount, setPendingNewCount, unreadBoundaryKey, setUnreadBoundaryKey,
    resumeMarkerKey, setResumeMarkerKey, bootstrapped, setBootstrapped, restoredReaderState,
    setRestoredReaderState, contextUsage, setContextUsage, contextUsageStatus,
    setContextUsageStatus, renameSessionKey, setRenameSessionKey, renameDraft, setRenameDraft,
    renameDraftRef, composerActive, setComposerActive, composerWindowOpen, setComposerWindowOpen,
    composerHidden, setComposerHidden, composerDraftState,
  }
}
