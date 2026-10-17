/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentProvider } from '../../lib/types'
import type { CoordinatorInteractiveState } from '../../lib/coordinatorInteractiveState'
import { recoveryOverview, type RecoveryInspection } from '../../lib/coordinatorRecovery'
import { inspectTuiCoordinatorRecovery } from '../../lib/tui/service'
import { runInteractiveCoordinatorAction } from './interactiveCoordinatorStore'
import type { TuiThemePalette } from '../theme'
import { MODAL_CONTENT_Z_INDEX } from './layers'

function wrapRecoveryLine(value: string, width: number): string[] {
  const lines: string[] = []
  let remaining = value
  while (remaining.length > width) {
    const boundary = remaining.lastIndexOf(' ', width)
    const end = boundary > Math.floor(width / 3) ? boundary : width
    lines.push(remaining.slice(0, end))
    remaining = remaining.slice(end + (end === boundary ? 1 : 0))
  }
  lines.push(remaining)
  return lines
}

type Key = { name: string; sequence: string; ctrl: boolean; shift: boolean }
export function CoordinatorRecovery({ state, sessionId, provider, pendingRequest, disabled, theme, width, height, onClose, onInspect, onKeyHandlerReady }: {
  state: CoordinatorInteractiveState | null; sessionId: string; provider: AgentProvider; pendingRequest: string | null; disabled: boolean
  theme: TuiThemePalette; width: number; height: number; onClose: () => void; onInspect: (agentId: string) => void
  onKeyHandlerReady: (handler: (key: Key) => void) => void
}) {
  const [inspection, setInspection] = useState<RecoveryInspection | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(0)
  const [offset, setOffset] = useState(0)
  const [confirm, setConfirm] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setBusy(true); setError(''); setConfirm(null)
    try { setInspection(await inspectTuiCoordinatorRecovery(sessionId, provider)) }
    catch (error) { setInspection(null); setError(String(error)) }
    finally { setBusy(false) }
  }, [sessionId, provider])
  useEffect(() => { void refresh() }, [refresh])
  const rows = recoveryOverview(state, inspection, pendingRequest)
  const row = rows[Math.min(selected, rows.length - 1)]!
  const inner = Math.max(12, width - 8)
  const bodyRows = Math.max(3, height - 10)
  const lines = useMemo(() => [row.title, ...row.detail].flatMap(line => wrapRecoveryLine(line, inner)), [row, inner])
  const top = Math.min(offset, Math.max(0, lines.length - bodyRows))
  const handleKey = useCallback((key: Key) => {
    if (confirm) {
      if (key.name === 'escape') { setConfirm(null); return }
      if (key.name === 'y' && row.id === confirm && (row.canResume || row.canReconcile) && !disabled && !busy) {
        setBusy(true)
        void runInteractiveCoordinatorAction({ action: row.canReconcile ? 'reconcile-agent' : 'resume-agent', to: row.agentId, detail: 'Resume saved conversation after inspecting recovery evidence and transcript' }).then(() => onClose()).finally(() => setBusy(false))
      }
      return
    }
    if (key.name === 'escape') { onClose(); return }
    if (busy) return
    if (key.name === 'tab') { setSelected(value => (value + 1) % rows.length); setOffset(0) }
    if (key.name === 'j' || key.name === 'down') setOffset(value => value + 1)
    if (key.name === 'k' || key.name === 'up') setOffset(value => Math.max(0, value - 1))
    if (key.name === 'pagedown') setOffset(value => value + bodyRows)
    if (key.name === 'pageup') setOffset(value => Math.max(0, value - bodyRows))
    if (key.name === 'u') void refresh()
    if (key.name === 'return' && row.agentId) onInspect(row.agentId)
    if (key.name === 'a' && row.canReconcile && !disabled) setConfirm(row.id)
    if (key.name === 'r' && row.canResume && !disabled) setConfirm(row.id)
  }, [confirm, row, disabled, busy, rows.length, bodyRows, refresh, onClose, onInspect])
  useEffect(() => onKeyHandlerReady(handleKey), [handleKey, onKeyHandlerReady])
  return <box position="absolute" left={2} top={2} width={width - 4} height={height - 4} border borderStyle="single" borderColor={theme.border2} backgroundColor={theme.surface} zIndex={MODAL_CONTENT_Z_INDEX} flexDirection="column" title=" Team recovery ">
    <box height={bodyRows} paddingX={1} flexDirection="column">{lines.slice(top, top + bodyRows).map((line, index) => <text key={top + index} fg={theme.text} wrapMode="none">{line}</text>)}</box>
    <text fg={theme.red} wrapMode="word">{error}</text>
    <text fg={theme.dim} wrapMode="word">{busy ? 'Checking saved identities…' : confirm ? row.canReconcile ? 'Acknowledge result without a turn? y yes · Esc back' : 'Resume saved task after inspection? y yes · Esc back' : `Tab item ${selected + 1}/${rows.length} · j/k scroll · u check · Enter inspect${row.canResume && !disabled ? ' · r resume' : row.canReconcile && !disabled ? ' · a acknowledge' : ''} · Esc back`}</text>
  </box>
}
