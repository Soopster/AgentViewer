/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useState } from 'react'
import { resourceLimits, resourceSummary, type CoordinatorResources as Resources } from '../../lib/coordinatorResources'
import { runInteractiveCoordinatorAction } from './interactiveCoordinatorStore'
import type { TuiThemePalette } from '../theme'
import { MODAL_CONTENT_Z_INDEX } from './layers'

type Key = { name: string; sequence: string; ctrl: boolean; shift: boolean }
const FIELDS = ['capacity', 'tokens', 'cost', 'minutes'] as const
const LABELS = ['Capacity incl. lead', 'Token limit', 'Cost limit USD', 'Minutes since creation']
export function CoordinatorResources({ resources, theme, width, height, onClose, onKeyHandlerReady }: {
  resources: Resources; theme: TuiThemePalette; width: number; height: number; onClose: () => void
  onKeyHandlerReady: (handler: (key: Key) => void) => void
}) {
  const [fields, setFields] = useState(() => ({ capacity: String(resources.maxAgents), tokens: String(resources.budget?.maxTokens ?? ''), cost: String(resources.budget?.maxCostUsd ?? ''), minutes: String(resources.budget?.maxDurationMinutes ?? '') }))
  const [index, setIndex] = useState(0)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  const field = FIELDS[index]!
  const handleKey = useCallback((key: Key) => {
    if (busy) return
    if (confirm) {
      if (key.name === 'y') {
        setBusy(true)
        void runInteractiveCoordinatorAction({ action: 'settings', detail: 'Apply interactive team resource limits', ...resourceLimits(fields) }).then(() => onClose()).finally(() => setBusy(false))
      } else if (key.name === 'escape') setConfirm(false)
      return
    }
    if (editing) {
      if (key.name === 'escape' || key.name === 'return') { setEditing(false); return }
      if (key.name === 'backspace') setFields(current => ({ ...current, [field]: Array.from(current[field]).slice(0, -1).join('') }))
      else if (key.name === 'paste' || (!key.ctrl && /^[0-9.]$/.test(key.sequence))) setFields(current => ({ ...current, [field]: (current[field] + key.sequence).slice(0, 30) }))
      return
    }
    if (key.name === 'escape') { onClose(); return }
    if (key.name === 'tab' || key.name === 'down' || key.name === 'j') setIndex(value => (value + 1) % FIELDS.length)
    if (key.name === 'up' || key.name === 'k') setIndex(value => (value + FIELDS.length - 1) % FIELDS.length)
    if (key.name === 'return') setEditing(true)
    if (key.name === 'pagedown') setOffset(value => value + 5)
    if (key.name === 'pageup') setOffset(value => Math.max(0, value - 5))
    if (key.name === 's') { try { resourceLimits(fields); setConfirm(true); setError('') } catch (error) { setError(String(error)) } }
  }, [busy, confirm, editing, fields, field, onClose])
  useEffect(() => onKeyHandlerReady(handleKey), [handleKey, onKeyHandlerReady])
  const inner = Math.max(12, width - 8)
  const rows = Math.max(2, height - 15)
  const lines = resourceSummary(resources).flatMap(line => line.match(new RegExp(`.{1,${inner}}`, 'gu')) ?? [''])
  const top = Math.min(offset, Math.max(0, lines.length - rows))
  return <box position="absolute" left={2} top={2} width={width - 4} height={height - 4} border borderStyle="single" borderColor={theme.border2} backgroundColor={theme.surface} zIndex={MODAL_CONTENT_Z_INDEX} flexDirection="column" title=" Team resources ">
    <box height={rows} flexDirection="column" paddingX={1}>{lines.slice(top, top + rows).map((line, index) => <text key={top + index} fg={theme.text} wrapMode="none">{line}</text>)}</box>
    {FIELDS.map((key, row) => <text key={key} fg={index === row ? theme.cyan : theme.dim} wrapMode="none">{`${index === row ? '›' : ' '} ${LABELS[row]}: ${fields[key] || 'no limit'}${editing && row === index ? '▏' : ''}`}</text>)}
    <text fg={theme.red} wrapMode="word">{error}</text>
    <text fg={theme.dim} wrapMode="word">{busy ? 'Applying…' : confirm ? 'Apply limits and resume eligible work? y yes · Esc back' : editing ? 'Type value · Backspace clear · Enter finish' : 'Tab field · Enter edit · s apply · PgUp/Dn info · Esc back'}</text>
  </box>
}
