/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useState } from 'react'
import type { AgentProvider } from '../../lib/types'
import { formatProviderLabel } from '../format'
import type { TuiThemePalette } from '../theme'

export type NewSessionKeyEvent = {
  name: string
  ctrl: boolean
  shift: boolean
  sequence: string
}

// Providers a fresh single-agent session can be started for (no 'all' aggregate).
export const NEW_SESSION_PROVIDERS: AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi']

type Row = 'folder' | 'provider'
const ROWS: Row[] = ['folder', 'provider']

type Props = {
  theme: TuiThemePalette
  width: number
  height: number
  provider: AgentProvider
  cwd: string
  busy?: boolean
  onCycleProvider: (direction: 1 | -1) => void
  onBrowseFolder: () => void
  onCreate: () => void
  onClose: () => void
  onKeyHandlerReady: (handler: (key: NewSessionKeyEvent) => void) => void
}

function fitText(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length <= width) return value
  if (width === 1) return '…'
  // Keep the tail of a path visible — the leaf directory matters most.
  return `…${value.slice(value.length - (width - 1))}`
}

export function NewSessionModal({
  theme,
  width,
  height,
  provider,
  cwd,
  busy = false,
  onCycleProvider,
  onBrowseFolder,
  onCreate,
  onClose,
  onKeyHandlerReady,
}: Props) {
  const [row, setRow] = useState<Row>('folder')

  const handleKey = useCallback((key: NewSessionKeyEvent) => {
    if (busy) return
    if (key.name === 'escape' || key.sequence === 'q') { onClose(); return }
    if (key.name === 'return') { onCreate(); return }
    if (key.sequence === 'b') { onBrowseFolder(); return }
    if (key.name === 'up' || key.sequence === 'k') {
      setRow((current) => ROWS[Math.max(0, ROWS.indexOf(current) - 1)]!)
      return
    }
    if (key.name === 'down' || key.sequence === 'j') {
      setRow((current) => ROWS[Math.min(ROWS.length - 1, ROWS.indexOf(current) + 1)]!)
      return
    }
    if (key.name === 'left' || key.sequence === 'h') {
      if (row === 'provider') onCycleProvider(-1)
      return
    }
    if (key.name === 'right' || key.sequence === 'l') {
      if (row === 'provider') onCycleProvider(1)
      else onBrowseFolder()
      return
    }
  }, [busy, onBrowseFolder, onClose, onCreate, onCycleProvider, row])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const popW = Math.min(Math.max(48, width - 8), 72)
  const popH = 9
  const labelW = 10
  const valueW = Math.max(8, popW - labelW - 6)

  const renderRow = (which: Row, label: string, value: string, hint: string) => {
    const active = row === which
    return (
      <box height={1} flexDirection="row" paddingX={1} backgroundColor={active ? theme.surface3 : undefined}>
        <text wrapMode="none">
          <span fg={active ? theme.cyan : theme.dim}>{`${active ? '›' : ' '} `}</span>
          <span fg={active ? theme.text : theme.muted}>{label.padEnd(labelW)}</span>
          <span fg={active ? theme.cyan : theme.text}>{fitText(value, valueW)}</span>
        </text>
        <box flexGrow={1} />
        <text fg={theme.dim} wrapMode="none">{active ? hint : ''}</text>
      </box>
    )
  }

  return (
    <box
      position="absolute"
      top={Math.max(0, Math.floor((height - popH) / 2))}
      left={Math.max(0, Math.floor((width - popW) / 2))}
      width={popW}
      height={popH}
      zIndex={52}
      border
      borderStyle="rounded"
      borderColor={theme.cyan}
      backgroundColor={theme.surface}
      flexDirection="column"
      title=" New agent session "
      titleColor={theme.cyan}
    >
      <box height={1} />
      {renderRow('folder', 'Folder', cwd, '→/b browse')}
      {renderRow('provider', 'Provider', formatProviderLabel(provider), '←→ change')}
      <box flexGrow={1} />
      <box height={1} paddingX={1} backgroundColor={theme.surface2}>
        <text wrapMode="none">
          {busy
            ? <span fg={theme.amber}>Creating session…</span>
            : <span fg={theme.muted}>{'↑↓ move · enter create · esc cancel'}</span>}
        </text>
      </box>
    </box>
  )
}
