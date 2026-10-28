/** @jsxImportSource @opentui/react */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { randomUUID } from 'node:crypto'
import type { TuiThemePalette } from '../theme'
import { formatTranscriptCards } from '../format'
import { buildThreadedMessages } from '../../lib/threading'
import { coordinatorAttention, type CoordinatorAttentionItem } from '../../lib/coordinatorAttention'
import type { TuiSessionCoordinationRequest } from '../../lib/tui/service'
import {
  readRemoteCoordinator, sendRemoteCoordinatorRequest, pendingRemoteCoordinatorRequest,
  discardRemoteCoordinatorRequest, REMOTE_COORDINATOR_FRESH_MS,
  type RemoteCoordinatorTarget, type RemoteCoordinatorView,
} from '../../lib/tui/remoteCoordinator'
import { RemoteNativeRequest } from './RemoteNativeRequest'
import type { PendingPermission } from '../../lib/permissions'
import { coordinatorPermissionToken } from '../../lib/coordinatorNativePermission'
import { fitText } from './textLayout'
import { MODAL_CONTENT_Z_INDEX } from './layers'

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }
type Draft = { request: Omit<TuiSessionCoordinationRequest, 'requestId' | 'detail'>; label: string; text: string }
type Props = { target: RemoteCoordinatorTarget; theme: TuiThemePalette; width: number; height: number; onClose: () => void; onKeyHandlerReady: (handler: (key: Key) => void) => void }

type RemoteKeyContext = {
  busy: boolean; draft: Draft | null; confirm: 'interrupt' | 'resume' | 'discard' | null
  disabled: boolean; pending: TuiSessionCoordinationRequest | null; writeReason: string | null
  view: RemoteCoordinatorView | null; target: RemoteCoordinatorTarget; selected?: CoordinatorAttentionItem
  attentionCount: number; lineCount: number; rows: number; top: number
  onClose: () => void; refresh: () => Promise<void>; submit: (request: TuiSessionCoordinationRequest) => Promise<void>
  setDraft: Dispatch<SetStateAction<Draft | null>>; setConfirm: Dispatch<SetStateAction<'interrupt' | 'resume' | 'discard' | null>>
  setPending: Dispatch<SetStateAction<TuiSessionCoordinationRequest | null>>; setNotice: Dispatch<SetStateAction<string>>
  openNative: () => void
  setOffset: Dispatch<SetStateAction<number>>; setAttentionIndex: Dispatch<SetStateAction<number>>
}

function handleRemoteCoordinatorKey(context: RemoteKeyContext, key: Key): void {
  const { busy, draft, confirm, disabled, pending, writeReason, view, target, selected, attentionCount, lineCount, rows, top,
    onClose, refresh, submit, setDraft, setConfirm, setPending, setNotice, setOffset, setAttentionIndex, openNative } = context

    if (key.name === 'escape') { if (draft) setDraft(null); else if (confirm) setConfirm(null); else onClose(); return }
    if (busy) return
    if (draft) {
      if (key.name === 'return') {
        if (draft.text.trim() && !disabled) void submit({ ...draft.request, detail: draft.text.trim(), requestId: randomUUID() })
        return
      }
      if (key.name === 'backspace') setDraft({ ...draft, text: Array.from(draft.text).slice(0, -1).join('') })
      else if (key.name === 'paste') setDraft({ ...draft, text: (draft.text + key.sequence.replace(/\r\n?/g, '\n')).slice(0, 8000) })
      else if (!key.ctrl && Array.from(key.sequence).length === 1 && key.sequence >= ' ') setDraft({ ...draft, text: (draft.text + key.sequence).slice(0, 8000) })
      return
    }
    if (confirm) {
      if (key.name === 'y') {
        if (confirm === 'discard' && pending) { discardRemoteCoordinatorRequest(target, pending.requestId); setPending(null); setNotice('Discarded after inspection; any accepted remote effect remains') }
        else if (!disabled) void submit({ action: confirm === 'interrupt' ? 'interrupt-agent' : 'resume-agent', to: target.agentId, detail: `${confirm} ${view?.agent.name}`, requestId: randomUUID() })
      }
      setConfirm(null); return
    }
    if (key.name === 'u') { void refresh(); return }
    if (key.name === 'j' || key.name === 'down') setOffset(Math.min(top + 1, Math.max(0, lineCount - rows)))
    if (key.name === 'k' || key.name === 'up') setOffset(Math.max(0, top - 1))
    if (key.name === 'pagedown') setOffset(Math.min(top + rows, Math.max(0, lineCount - rows)))
    if (key.name === 'pageup') setOffset(Math.max(0, top - rows))
    if (key.name === 'tab') setAttentionIndex(index => (index + 1) % Math.max(1, attentionCount))
    if (key.name === 'p') { openNative(); return }
    if (pending) {
      if (key.name === 't' && (!writeReason || pending.action === 'native-answer' && writeReason === 'This team has ended · results remain available')) void submit(pending)
      if (key.name === 'e') setConfirm('discard')
      return
    }
    if (disabled) return
    if (key.name === 'm') setDraft({ label: selected?.messageId ? 'Reply' : 'Message', text: '', request: { action: 'message', to: target.agentId, inReplyTo: selected?.messageId } })
    if (key.name === 'd') {
      const previous = view!.snapshot.tasks.filter(task => task.ownerAgentId === target.agentId).at(-1)
      setDraft({ label: 'Follow-up', text: '', request: { action: 'delegate', to: target.agentId, paths: previous?.paths ?? [] } })
    }
    if (key.name === 'i') setConfirm('interrupt')
    if (key.name === 'r') setConfirm('resume')
    if (key.name === 'a' && selected?.kind === 'plan') void submit({ action: 'review-plan', to: target.agentId, taskId: selected.taskId, approved: true, detail: 'Plan approved by operator', requestId: randomUUID() })
    if (key.name === 'x' && selected?.kind === 'plan') setDraft({ label: 'Reject plan', text: '', request: { action: 'review-plan', to: target.agentId, taskId: selected.taskId, approved: false } })
    if (key.name === 'q' && selected?.kind === 'decision') setDraft({ label: 'Answer decision', text: '', request: { action: 'decision', to: target.agentId, taskId: selected.taskId, decisionId: selected.decisionId } })

}

/** Keeps remote refreshes and drafts outside the root reader/composer. */
export const RemoteCoordinatorPopover = memo(function RemoteCoordinatorPopover({ target, theme, width, height, onClose, onKeyHandlerReady }: Props) {
  const [view, setView] = useState<RemoteCoordinatorView | null>(null)
  const [error, setError] = useState('')
  const [journalError, setJournalError] = useState('')
  const [pending, setPending] = useState<TuiSessionCoordinationRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirm, setConfirm] = useState<'interrupt' | 'resume' | 'discard' | null>(null)
  const [offset, setOffset] = useState(0)
  const [attentionIndex, setAttentionIndex] = useState(0)
  const [notice, setNotice] = useState('')
  const [nativeAsk, setNativeAsk] = useState<PendingPermission | null>(null)
  const alive = useRef(true)
  const reading = useRef(false)
  const sending = useRef(false)
  const refresh = useCallback(async () => {
    if (reading.current) return
    reading.current = true
    try {
      const next = await readRemoteCoordinator(target)
      if (alive.current) { setView(next); setError('') }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { reading.current = false }
  }, [target])
  useEffect(() => {
    alive.current = true
    try { setPending(pendingRemoteCoordinatorRequest(target)) }
    catch (cause) { setJournalError(String(cause)) }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 2_000)
    return () => { alive.current = false; clearInterval(timer) }
  }, [refresh, target])

  const attention = useMemo(() => view ? coordinatorAttention(view.snapshot).filter(item => item.agentId === target.agentId) : [], [view, target.agentId])
  const selected = attention[Math.min(attentionIndex, Math.max(0, attention.length - 1))]
  const innerWidth = Math.max(12, width - 6)
  const rows = Math.max(3, height - 12)
  const lines = useMemo(() => {
    if (!view) return ['Loading remote teammate…']
    const content: string[] = []
    if (view.permissionNotice) content.push(view.permissionNotice)
    for (const permission of view.permissions) content.push(`NATIVE REQUEST: ${permission.title}`, permission.command || permission.detail || '', '')
    if (view.transcriptNotice) content.push(view.transcriptNotice)
    for (const item of attention) content.push(`${item.kind.toUpperCase()}: ${item.title}`, item.detail, '')
    const tasks = view.snapshot.tasks.filter(task => task.ownerAgentId === target.agentId)
    for (const task of tasks) content.push(`TASK ${task.title} · ${task.status}`, task.resultSummary || task.prompt || '', `Editable paths: ${task.paths.join(', ') || 'read only'}`, '')
    content.push('TRANSCRIPT · latest 100 messages')
    for (const card of formatTranscriptCards(buildThreadedMessages(view.messages))) {
      content.push(`${card.role.toUpperCase()} · ${card.label}`, ...card.lines.map(line => line.text), '')
    }
    return content.flatMap(line => line.split('\n').flatMap(part => part.match(new RegExp(`.{1,${innerWidth}}`, 'gu')) ?? ['']))
  }, [view, attention, innerWidth, target.agentId])
  const top = Math.min(offset, Math.max(0, lines.length - rows))
  const stale = !view || Boolean(error) || Date.now() - view.observedAt > REMOTE_COORDINATOR_FRESH_MS
  const writeReason = journalError || (stale ? 'Observation unavailable · refresh before sending' : view.writeReason)
  const disabled = busy || Boolean(pending) || Boolean(writeReason)

  const submit = useCallback(async (request: TuiSessionCoordinationRequest) => {
    if (sending.current) return
    sending.current = true; setBusy(true); setNotice('')
    try {
      await sendRemoteCoordinatorRequest(target, request)
      if (alive.current) { setPending(null); setDraft(null); setNativeAsk(null); setNotice('Remote action confirmed') }
    } catch (cause) {
      if (alive.current) {
        const reason = cause instanceof Error ? cause.message : String(cause)
        setError(reason); setNotice(reason)
        try {
          const saved = pendingRemoteCoordinatorRequest(target)
          setPending(saved)
          if (saved) { setDraft(null); setNativeAsk(null) }
        } catch (cause) { setJournalError(String(cause)) }
      }
    } finally {
      sending.current = false
      if (alive.current) { setBusy(false); void refresh() }
    }
  }, [refresh, target])

  const handleKey = useCallback((key: Key) => handleRemoteCoordinatorKey({
    busy, draft, confirm, disabled, pending, writeReason, view, target, selected,
    openNative: () => { if (view?.permissionNotice) setNotice(view.permissionNotice); else if (view?.permissions[0]) setNativeAsk(view.permissions[0]); else setNotice('No pending native request') },
    attentionCount: attention.length, lineCount: lines.length, rows, top,
    onClose, refresh, submit, setDraft, setConfirm, setPending, setNotice, setOffset, setAttentionIndex,
  }, key), [attention.length, busy, confirm, disabled, draft, lines.length, onClose, pending, refresh, rows, selected, submit, target, top, view, writeReason])
  useEffect(() => { if (!nativeAsk) onKeyHandlerReady(handleKey) }, [handleKey, nativeAsk, onKeyHandlerReady])
  const status = confirm ? confirm === 'discard' ? 'Discard retry identity? Check remote history first.' : `${confirm} teammate?`
    : busy ? 'Sending to owning daemon…' : pending ? `Unconfirmed ${pending.action} · ${error || writeReason || notice || pending.requestId}` : error || writeReason || notice || 'Remote controls available'
  const footer = draft ? 'Enter send · Esc cancel'
    : confirm ? 'y confirm · esc cancel'
    : pending ? 't retry · e discard · esc close'
    : writeReason ? view?.permissions.length ? 'p inspect native · u refresh · esc close' : 'u refresh · esc close'
    : view?.permissions.length ? 'p answer native request · esc close'
    : innerWidth < 70 ? selected?.kind === 'plan' ? 'a approve · x reject · esc close'
      : selected?.kind === 'decision' ? 'q answer · esc close' : 'm reply · d ask · i stop · esc close'
    : 'm reply · d ask · i stop · r resume · a/x plan · q decision · esc close'
  if (nativeAsk) {
    const current = view?.permissions.find(permission => permission.id === nativeAsk.id)
    const changed = !current || coordinatorPermissionToken(current) !== coordinatorPermissionToken(nativeAsk)
    return <RemoteNativeRequest key={coordinatorPermissionToken(nativeAsk)} permission={nativeAsk} machineName={target.machine.name} agentName={view?.agent.name ?? target.agentId} theme={theme} width={width} height={height}
      disabledReason={writeReason || (busy ? 'Sending to owning daemon…' : pending ? 'Previous submission unconfirmed' : view?.permissionNotice || (changed ? 'Request changed or answered · Esc back and refresh' : null))}
      onClose={() => setNativeAsk(null)} onSubmit={submit} onKeyHandlerReady={onKeyHandlerReady} />
  }
  return <box position="absolute" top={1} left={1} zIndex={MODAL_CONTENT_Z_INDEX} width={Math.max(20, width - 2)} height={Math.max(12, height - 2)} border borderColor={theme.border} backgroundColor={theme.surface} flexDirection="column" paddingX={1}>
    <text fg={theme.cyan} wrapMode="none">{fitText(`REMOTE · ${target.machine.name} · ${view?.agent.name ?? target.agentId}`, innerWidth)}</text>
    <text fg={theme.dim} wrapMode="none">{fitText(`${target.provider} · ${view?.agent.status ?? 'unknown'} · ${target.runId}`, innerWidth)}</text>
    <box height={rows} flexDirection="column">{lines.slice(top, top + rows).map((line, index) => <text key={`${top + index}`} fg={theme.text} wrapMode="none">{line || ' '}</text>)}</box>
    <text fg={theme.amber} wrapMode="none">{fitText(selected ? `Tab attention ${Math.min(attentionIndex + 1, attention.length)}/${attention.length}: ${selected.kind} · ${selected.title}` : `No outstanding attention · ${top + 1}-${Math.min(top + rows, lines.length)}/${lines.length}`, innerWidth)}</text>
    <text fg={error || pending ? theme.red : theme.dim} wrapMode="none">{fitText(status, innerWidth)}</text>
    {draft ? <text fg={theme.cyan} wrapMode="none">{fitText(`${draft.label}: ${draft.text}▏`, innerWidth)}</text> : <text fg={theme.dim} wrapMode="none">{fitText('j/k scroll · PgUp/PgDn · Tab attention · u refresh', innerWidth)}</text>}
    <text fg={theme.cyan} wrapMode="none">{fitText(footer, innerWidth)}</text>
  </box>
})
