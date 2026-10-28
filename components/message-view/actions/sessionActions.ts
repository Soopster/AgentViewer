import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { SessionMessage } from '../../../lib/types'
import { downloadHtml } from '@/lib/downloadHtml'
import { pathBasename } from '@/lib/projectPaths'
import { getPrimarySessionTag } from '@/lib/sessionTags'
import { type RewindPreview } from '../types'
import { type RollbackPreview } from '../types'
import { type SessionCapabilities } from '../../../lib/types'
import { readOptionalJsonResponse } from '@/lib/httpResponse'
import { withProviderQuery } from '../threadedCompare'
import { type SessionDiagnosticSection } from '@/lib/types'
import { claudeDiagnosticActionNotice } from '../lazyPanels'
import { type RefObject } from 'react'
import { readJsonResponse } from '@/lib/httpResponse'
import { type TimelineRowLayout } from '@/lib/timelineVirtualizer'
import { type TimelineRow } from '../types'
import { TIMELINE_TARGET_TOP_GUTTER_PX } from '../constants'

export type HandleExportContext = {
  session: Session | null
  setExporting: Dispatch<SetStateAction<boolean>>
  messages: SessionMessage[]
  setSessionActionError: Dispatch<SetStateAction<string | null>>
}

export async function runHandleExport(ctx: HandleExportContext) {
  const {
    session, setExporting, messages, setSessionActionError,
  } = ctx
  if (!session) return
  const dirName  = session.customTitle ?? session.summary ?? getPrimarySessionTag(session.tag) ?? (pathBasename(session.cwd) || session.sessionId)
  const safeName = dirName.replace(/[^a-z0-9\-_]/gi, '-').toLowerCase()
  const filename = `${safeName}_${session.sessionId.slice(0, 8)}.html`

  if (typeof Worker === 'undefined') {
    setExporting(true)
    try {
      const { exportSessionToHtml } = await import('@/lib/export')
      const html = exportSessionToHtml(session, messages)
      downloadHtml(html, filename)
    } catch (error) {
      setSessionActionError(error instanceof Error ? error.message : 'Failed to export session')
    } finally {
      setExporting(false)
    }
    return
  }

  setExporting(true)
  const worker = new Worker(new URL('../../../workers/exportWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<{ html?: string; error?: string }>) => {
    const { html, error } = event.data ?? {}
    if (html) {
      downloadHtml(html, filename)
    } else if (error) {
      setSessionActionError(error)
    }
    setExporting(false)
    worker.terminate()
  }
  worker.onerror = () => {
    setExporting(false)
    setSessionActionError('Failed to export session')
    worker.terminate()
  }
  worker.postMessage({ session, messages })
}

export type HandleRewindContext = {
  session: Session | null
  selectedRewindTarget: { uuid: string; content: string; timestamp: string | undefined; } | null
  previewingRewind: boolean
  applyingRewind: boolean
  setPreviewingRewind: Dispatch<SetStateAction<boolean>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  selectedModel: string
  setRewindPreview: Dispatch<SetStateAction<RewindPreview | null>>
}

export async function runHandleRewind(ctx: HandleRewindContext) {
  const {
    session, selectedRewindTarget, previewingRewind, applyingRewind, setPreviewingRewind,
    setSessionActionError, setSessionActionNotice, selectedModel, setRewindPreview,
  } = ctx
  if (!session || !selectedRewindTarget || previewingRewind || applyingRewind) return

  setPreviewingRewind(true)
  setSessionActionError(null)
  setSessionActionNotice(null)
  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessageId: selectedRewindTarget.uuid, model: selectedModel, dryRun: true, provider: session.provider, providerInstanceId: session.providerInstanceId }),
    })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
    if (!data.canRewind) throw new Error(data.error ?? 'Rewind unavailable for this session state')

    const filesChanged = Array.isArray(data.filesChanged)
      ? data.filesChanged.filter((file: unknown): file is string => typeof file === 'string')
      : []

    setRewindPreview({
      userMessageId: selectedRewindTarget.uuid,
      contentPreview: selectedRewindTarget.content.replace(/\s+/g, ' ').trim().slice(0, 160),
      filesChanged,
    })
    setSessionActionNotice(filesChanged.length > 0
      ? `Previewed ${filesChanged.length} file change${filesChanged.length === 1 ? '' : 's'}.`
      : 'No tracked file changes at that prompt.')
  } catch (err) {
    setSessionActionError(err instanceof Error ? err.message : 'Failed to rewind files')
  } finally {
    setPreviewingRewind(false)
  }
}

export type HandleRollbackPreviewContext = {
  session: Session | null
  previewingRewind: boolean
  applyingRewind: boolean
  rollbackTurns: number
  setPreviewingRewind: Dispatch<SetStateAction<boolean>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  setRollbackPreview: Dispatch<SetStateAction<RollbackPreview | null>>
}

export async function runHandleRollbackPreview(ctx: HandleRollbackPreviewContext) {
  const {
    session, previewingRewind, applyingRewind, rollbackTurns, setPreviewingRewind,
    setSessionActionError, setSessionActionNotice, setRollbackPreview,
  } = ctx
  if (!session || previewingRewind || applyingRewind || rollbackTurns < 1) return

  setPreviewingRewind(true)
  setSessionActionError(null)
  setSessionActionNotice(null)
  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numTurns: rollbackTurns, dryRun: true, provider: session.provider, providerInstanceId: session.providerInstanceId }),
    })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
    const turnsRemoved = Array.isArray(data.turnsRemoved)
      ? data.turnsRemoved.filter((turn: unknown): turn is { turnId: string; preview: string } =>
          Boolean(turn)
          && typeof turn === 'object'
          && typeof (turn as { turnId?: unknown }).turnId === 'string'
          && typeof (turn as { preview?: unknown }).preview === 'string'
        )
      : []
    setRollbackPreview({ numTurns: rollbackTurns, turnsRemoved })
    setSessionActionNotice(`Previewed rollback of ${rollbackTurns} turn${rollbackTurns === 1 ? '' : 's'}.`)
  } catch (err) {
    setSessionActionError(err instanceof Error ? err.message : 'Failed to preview rollback')
  } finally {
    setPreviewingRewind(false)
  }
}

export type HandleApplyRewindContext = {
  session: Session | null
  rewindPreview: RewindPreview | null
  applyingRewind: boolean
  setApplyingRewind: Dispatch<SetStateAction<boolean>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  selectedModel: string
  setRewindPreview: Dispatch<SetStateAction<RewindPreview | null>>
}

export async function runHandleApplyRewind(ctx: HandleApplyRewindContext) {
  const {
    session, rewindPreview, applyingRewind, setApplyingRewind, setSessionActionError,
    setSessionActionNotice, selectedModel, setRewindPreview,
  } = ctx
  if (!session || !rewindPreview || applyingRewind) return

  setApplyingRewind(true)
  setSessionActionError(null)
  setSessionActionNotice(null)
  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessageId: rewindPreview.userMessageId, model: selectedModel, provider: session.provider, providerInstanceId: session.providerInstanceId }),
    })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
    if (!data.canRewind) throw new Error(data.error ?? 'Rewind unavailable for this session state')

    const fileCount = Array.isArray(data.filesChanged) ? data.filesChanged.length : rewindPreview.filesChanged.length
    setRewindPreview(null)
    setSessionActionNotice(fileCount > 0 ? `Rewound ${fileCount} file${fileCount === 1 ? '' : 's'}.` : 'Rewind complete.')
  } catch (err) {
    setSessionActionError(err instanceof Error ? err.message : 'Failed to rewind files')
  } finally {
    setApplyingRewind(false)
  }
}

export type HandleApplyRollbackContext = {
  session: Session | null
  rollbackPreview: RollbackPreview | null
  applyingRewind: boolean
  setApplyingRewind: Dispatch<SetStateAction<boolean>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  setRollbackPreview: Dispatch<SetStateAction<RollbackPreview | null>>
}

export async function runHandleApplyRollback(ctx: HandleApplyRollbackContext) {
  const {
    session, rollbackPreview, applyingRewind, setApplyingRewind, setSessionActionError,
    setSessionActionNotice, setRollbackPreview,
  } = ctx
  if (!session || !rollbackPreview || applyingRewind) return

  setApplyingRewind(true)
  setSessionActionError(null)
  setSessionActionNotice(null)
  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numTurns: rollbackPreview.numTurns, provider: session.provider, providerInstanceId: session.providerInstanceId }),
    })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
    setRollbackPreview(null)
    setSessionActionNotice(`Rolled back ${rollbackPreview.numTurns} turn${rollbackPreview.numTurns === 1 ? '' : 's'}.`)
  } catch (err) {
    setSessionActionError(err instanceof Error ? err.message : 'Failed to roll back thread')
  } finally {
    setApplyingRewind(false)
  }
}

export type HandleForkFromMessageContext = {
  session: Session | null
  forkingMessageId: string | null
  sessionCapabilities: SessionCapabilities | undefined
  setForkingMessageId: Dispatch<SetStateAction<string | null>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  onFork: ((newSessionId: string, sourceSession?: Session) => void) | undefined
}

export async function runHandleForkFromMessage(ctx: HandleForkFromMessageContext, messageId: string) {
  const {
    session, forkingMessageId, sessionCapabilities, setForkingMessageId, setSessionActionError,
    setSessionActionNotice, onFork,
  } = ctx
  if (!session || forkingMessageId || !sessionCapabilities?.messageFork) return
  setForkingMessageId(messageId)
  setSessionActionError(null)
  setSessionActionNotice(null)
  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upToMessageId: messageId, provider: session.provider, providerInstanceId: session.providerInstanceId }),
    })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
    onFork?.(data.sessionId)
    setSessionActionNotice('Forked a new session from that point.')
  } catch (err) {
    setSessionActionError(err instanceof Error ? err.message : 'Failed to fork from message')
  } finally {
    setForkingMessageId(null)
  }
}

export type HandleDeleteSessionContext = {
  session: Session | null
  deleting: boolean
  sessionCapabilities: SessionCapabilities | undefined
  setDeleting: Dispatch<SetStateAction<boolean>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  onDelete: ((sessionId: string, provider?: Session['provider']) => void) | undefined
}

export async function runHandleDeleteSession(ctx: HandleDeleteSessionContext) {
  const {
    session, deleting, sessionCapabilities, setDeleting, setSessionActionError,
    setSessionActionNotice, onDelete,
  } = ctx
  if (!session || deleting || !sessionCapabilities?.deleteSession) return
  const confirmed = window.confirm('Delete this session? This cannot be undone from Agent Viewer.')
  if (!confirmed) return
  setDeleting(true)
  setSessionActionError(null)
  setSessionActionNotice(null)
  try {
    const res = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}`, session.provider, session.providerInstanceId), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: session.provider, providerInstanceId: session.providerInstanceId }),
    })
    const data = await readOptionalJsonResponse(res, {})
    if (data.error) throw new Error(data.error)
    onDelete?.(session.sessionId, session.provider)
    setSessionActionNotice('Session deleted.')
  } catch (err) {
    setSessionActionError(err instanceof Error ? err.message : 'Failed to delete session')
  } finally {
    setDeleting(false)
  }
}

export type RunSessionActionContext = {
  session: Session | null
  sessionActionLoading: string | null
  setSessionActionLoading: Dispatch<SetStateAction<string | null>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  setDiagnosticSections: Dispatch<SetStateAction<SessionDiagnosticSection[]>>
}

export async function runRunSessionAction(ctx: RunSessionActionContext, action: string) {
  const {
    session, sessionActionLoading, setSessionActionLoading, setSessionActionError,
    setSessionActionNotice, setDiagnosticSections,
  } = ctx
  if (!session || sessionActionLoading) return
  setSessionActionLoading(action)
  setSessionActionError(null)
  setSessionActionNotice(null)
  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, provider: session.provider, providerInstanceId: session.providerInstanceId }),
    })
    const data = await readOptionalJsonResponse(res, {})
    if (data.error) throw new Error(data.error)
    const shareUrl = data.result?.session?.share?.url
    setSessionActionNotice(
      action === 'share' && shareUrl
        ? `Shared: ${shareUrl}`
        : `${action.toUpperCase()} complete.`
    )
    setDiagnosticSections([])
  } catch (err) {
    setSessionActionError(err instanceof Error ? err.message : `Failed to run ${action}`)
  } finally {
    setSessionActionLoading(null)
  }
}

export type RunClaudeSessionActionContext = {
  session: Session | null
  setClaudeMcpBusy: Dispatch<SetStateAction<string | null>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  refreshDiagnostics: () => Promise<void>
}

export async function runRunClaudeSessionAction(ctx: RunClaudeSessionActionContext, action: string, extra: Record<string, unknown>, busyKey: string, successNotice: string) {
  const {
    session, setClaudeMcpBusy, setSessionActionError, setSessionActionNotice, refreshDiagnostics,
  } = ctx
  if (!session) return null
  setClaudeMcpBusy(busyKey)
  setSessionActionError(null)
  setSessionActionNotice(null)
  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, provider: session.provider, providerInstanceId: session.providerInstanceId, ...extra }),
    })
    const data = await readOptionalJsonResponse(res, {})
    if (data.error) throw new Error(data.error)
    const result = data.result && typeof data.result === 'object' && !Array.isArray(data.result)
      ? data.result as Record<string, unknown>
      : data as Record<string, unknown>
    setSessionActionNotice(claudeDiagnosticActionNotice(action, successNotice, result))
    await refreshDiagnostics()
    return result
  } catch (err) {
    setSessionActionError(err instanceof Error ? err.message : 'Action failed')
    return null
  } finally {
    setClaudeMcpBusy(null)
  }
}

export type ToggleBookmarkContext = {
  session: Session | null
  bookmarkIdsRef: RefObject<Set<string>>
  setBookmarkIds: Dispatch<SetStateAction<Set<string>>>
  buildBookmarkMeta: (uuid: string) => { role: 'user' | 'assistant' | 'system' | undefined; label: string; preview: string | undefined; sessionTitle: string | undefined; messageTimestamp: string | undefined; }
}

export function runToggleBookmark(ctx: ToggleBookmarkContext, uuid: string) {
  const {
    session, bookmarkIdsRef, setBookmarkIds, buildBookmarkMeta,
  } = ctx
  if (!session) return
  const next = !bookmarkIdsRef.current.has(uuid)
  setBookmarkIds((prev) => {
    const updated = new Set(prev)
    if (next) updated.add(uuid)
    else updated.delete(uuid)
    return updated
  })
  const meta = next ? buildBookmarkMeta(uuid) : undefined
  fetch(`/api/sessions/${session.sessionId}/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: session.provider, providerInstanceId: session.providerInstanceId, uuid, bookmarked: next, meta }),
  })
    .then(readJsonResponse)
    .then((data) => {
      if (Array.isArray(data?.ids)) setBookmarkIds(new Set(data.ids as string[]))
    })
    .catch(() => {
      // Revert the optimistic update on failure.
      setBookmarkIds((prev) => {
        const updated = new Set(prev)
        if (next) updated.delete(uuid)
        else updated.add(uuid)
        return updated
      })
    })
}

export type HandleJumpToMessageContext = {
  setHighlightedMessageId: Dispatch<SetStateAction<string | null>>
  autoFollowRef: RefObject<boolean>
  setAutoFollow: Dispatch<SetStateAction<boolean>>
  timelineRef: RefObject<HTMLDivElement | null>
  timelineRowsRef: RefObject<TimelineRow[]>
  rowLayoutRef: { current: TimelineRowLayout; }
  suppressFollowEvalUntilRef: RefObject<number>
  markProgrammaticTimelineScroll: (duration?: number) => void
  commitTimelineScrollTop: (value: number) => void
  scrollMountedTimelineRowIntoView: (messageId: string) => boolean
}

export function runHandleJumpToMessage(ctx: HandleJumpToMessageContext, messageId: string) {
  const {
    setHighlightedMessageId, autoFollowRef, setAutoFollow, timelineRef, timelineRowsRef,
    rowLayoutRef, suppressFollowEvalUntilRef, markProgrammaticTimelineScroll,
    commitTimelineScrollTop, scrollMountedTimelineRowIntoView,
  } = ctx
  setHighlightedMessageId(messageId)
  autoFollowRef.current = false
  setAutoFollow(false)

  const scrollToMessage = () => {
    const node = timelineRef.current
    const rows = timelineRowsRef.current
    const layout = rowLayoutRef.current
    if (!node) return
    const rowIndex = rows.findIndex((row) => row.message.uuid === messageId)
    if (rowIndex < 0) return
    const targetTop = Math.max(layout.tops[rowIndex] - TIMELINE_TARGET_TOP_GUTTER_PX, 0)
    suppressFollowEvalUntilRef.current = performance.now() + 300
    markProgrammaticTimelineScroll()
    node.scrollTop = targetTop
    commitTimelineScrollTop(targetTop)
  }

  window.requestAnimationFrame(() => {
    scrollToMessage()
    window.requestAnimationFrame(() => {
      if (!scrollMountedTimelineRowIntoView(messageId)) scrollToMessage()
    })
  })
}
