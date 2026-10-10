/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useState } from 'react'
import type { TuiThemePalette } from '../theme'
import { fitText } from './textLayout'
import type { AgentProvider } from '../../lib/types'
import type { CoordinatorCapabilities } from '../../lib/coordinatorCapabilities'
import { readTuiCoordinatorCapabilities } from '../../lib/tui/service'
import { MODAL_CONTENT_Z_INDEX } from './layers'

export type DelegationOptions = { requestedModel?: string; requestedEffort?: string }
type Key = { name: string; sequence: string; ctrl: boolean; shift: boolean }
export function CoordinatorDelegationOptions({ value, session, targetProvider, theme, width, height, onSave, onClose, onKeyHandlerReady }: {
  session?: { sessionId: string; provider: AgentProvider }; targetProvider?: AgentProvider
  value: DelegationOptions; theme: TuiThemePalette; width: number; height: number
  onSave: (value: DelegationOptions) => void; onClose: () => void
  onKeyHandlerReady: (handler: (key: Key) => void) => void
}) {
  const [fields, setFields] = useState(() => [value.requestedModel ?? '', value.requestedEffort ?? ''])
  const [index, setIndex] = useState(0)
  const [editing, setEditing] = useState(false)
  const [catalog, setCatalog] = useState<CoordinatorCapabilities | null>(null)
  const [catalogStatus, setCatalogStatus] = useState('r refresh catalog · m model · e effort')
  useEffect(() => {
    setCatalog(null)
    setCatalogStatus('r refresh catalog · m model · e effort')
  }, [session?.sessionId, targetProvider])
  const refresh = useCallback(() => {
    if (!session || !targetProvider) return
    setCatalogStatus('Reading provider catalog…')
    void readTuiCoordinatorCapabilities(session.sessionId, session.provider, targetProvider).then(result => {
      setCatalog(result)
      setCatalogStatus(result.status === 'available' ? `${result.models.length} advertised models · m model · e effort · r refresh` : result.error ?? 'No session-free catalog; dispatcher checks IDs')
    }, () => setCatalogStatus('Catalog unavailable · r retry'))
  }, [session, targetProvider])
  const handleKey = useCallback((key: Key) => {
    if (editing) {
      if (key.name === 'return' || key.name === 'escape') { setEditing(false); return }
      if (key.ctrl && key.name === 'u') setFields(current => current.map((text, row) => row === index ? '' : text))
      else if (key.name === 'backspace') setFields(current => current.map((text, row) => row === index ? Array.from(text).slice(0, -1).join('') : text))
      else if (key.name === 'paste' || (!key.ctrl && key.sequence && !/[\x00-\x1f\x7f]/.test(key.sequence))) setFields(current => current.map((text, row) => row === index ? (text + key.sequence.replace(/[\r\n]/g, ' ')).slice(0, index === 0 ? 200 : 100) : text))
      return
    }
    if (key.name === 'r') { refresh(); return }
    if (key.name === 'm' && catalog?.status === 'available') {
      const options = ['', ...catalog.models.map(model => model.value)]
      setFields(current => [options[(options.indexOf(current[0]!) + 1) % options.length]!, ''])
      return
    }
    if (key.name === 'e' && catalog?.status === 'available') {
      const levels = ['', ...(catalog.models.find(model => model.value === fields[0])?.supportedEffortLevels ?? [])]
      setFields(current => [current[0]!, levels[(levels.indexOf(current[1]!) + 1) % levels.length]!])
      return
    }
    if (key.name === 'escape') { onClose(); return }
    if (key.name === 'tab' || key.name === 'down' || key.name === 'up') setIndex(current => 1 - current)
    if (key.name === 'return') setEditing(true)
    if (key.name === 's') { onSave({ requestedModel: fields[0]!.trim() || undefined, requestedEffort: fields[1]!.trim() || undefined }); onClose() }
  }, [editing, fields, index, onClose, onSave, catalog, refresh])
  useEffect(() => onKeyHandlerReady(handleKey), [handleKey, onKeyHandlerReady])
  const inner = Math.max(12, width - 8)
  return <box position="absolute" top={2} left={2} width={width - 4} height={Math.min(height - 4, 15)} border borderStyle="single" borderColor={theme.border2} backgroundColor={theme.surface} zIndex={MODAL_CONTENT_Z_INDEX} flexDirection="column" paddingX={1} title=" Task model and effort ">
    <text fg={theme.muted} wrapMode="word">Use IDs supported by the teammate provider. Blank uses team defaults. Applies only to delegated tasks; messages keep the active turn’s settings.</text>
    {fields.map((text, row) => <text key={row} fg={index === row ? theme.cyan : theme.text} wrapMode="none">{fitText(`${index === row ? '›' : ' '} ${row === 0 ? 'Model ID' : 'Effort'}: ${text || 'team default'}${editing && index === row ? '▏' : ''}`, inner)}</text>)}
    <text fg={theme.muted} wrapMode="word">{catalogStatus}</text>
    <box flexGrow={1} />
    <text fg={theme.dim} wrapMode="word">{editing ? 'Type · ctrl+u clear · Enter finish' : 'Tab field · Enter edit · s save · Esc cancel'}</text>
  </box>
}
