/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PopoverDetachButton, popoverFrameCells, popoverRootProps, type TuiPluginKeyEvent, type TuiThemePalette } from '../../../../tui/opentui/shell/sdk'
import type { TuiTranscriptCard } from '../../../../tui/format'
import { readTuiSessionProvenance } from '../../../../lib/tui/service'
import type { Session } from '../../../../lib/types'
import { relativeTo, touchedRows, touchedTurns, touchedTurnsFromProvenance, type TouchedRow, type TouchedTurn } from './model'

type Props = {
  theme: TuiThemePalette
  width: number
  height: number
  cards: readonly TuiTranscriptCard[] | null
  session: Session | null
  loading: boolean
  onOpenFile?: (path: string, line?: number | null) => void
  onClose: () => void
  onDetach?: () => void
  onKeyHandlerReady: (handler: (key: TuiPluginKeyEvent) => void) => void
  docked?: boolean
}

// What of this edit still stands: "✓12" lines still attributed to the session, "gone" once rewritten away.
const kept = (row: Extract<TouchedRow, { kind: 'file' }>) =>
  `${row.surviving == null ? '    ' : row.surviving === 0 ? 'gone' : `✓${String(row.surviving).padEnd(3)}`}  `

const isFile = (row: TouchedRow | undefined): row is Extract<TouchedRow, { kind: 'file' }> => row?.kind === 'file'

export function ChangedFilesPopover({ theme, width, height, cards, session, loading, onOpenFile, onClose, onDetach, onKeyHandlerReady, docked = false }: Props) {
  const cwd = typeof session?.cwd === 'string' ? session.cwd : undefined
  // The provenance index is the source: it records each edit with the prompt that led to it and can say how
  // many lines still survive. A session it has not indexed yet falls back to the transcript's own edit stats.
  const [indexed, setIndexed] = useState<TouchedTurn[] | null>(null)
  const sessionKey = session?.provider && session.sessionId ? `${session.provider}:${session.sessionId}` : null
  useEffect(() => {
    setIndexed(null)
    if (!session?.provider || !session.sessionId) return
    let cancelled = false
    void readTuiSessionProvenance(session.provider, session.sessionId)
      .then(({ summary, edits }) => {
        if (cancelled) return
        setIndexed(edits.length > 0 ? touchedTurnsFromProvenance(edits, summary) : [])
      })
      .catch(() => { if (!cancelled) setIndexed([]) })
    return () => { cancelled = true }
  }, [sessionKey])
  const fromIndex = indexed !== null && indexed.length > 0
  const turns = useMemo(() => (fromIndex ? indexed! : cards ? touchedTurns(cards) : []), [fromIndex, indexed, cards])
  const rows = useMemo(() => touchedRows(turns), [turns])
  const fileIndexes = useMemo(() => rows.flatMap((row, index) => (row.kind === 'file' ? [index] : [])), [rows])
  const [cursor, setCursor] = useState(0)
  const at = Math.min(cursor, Math.max(fileIndexes.length - 1, 0))
  const selectedRow = rows[fileIndexes[at] ?? -1]

  const move = useCallback((delta: number) => setCursor((value) => Math.max(0, Math.min(value + delta, fileIndexes.length - 1))), [fileIndexes.length])
  const handleKey = useCallback((key: TuiPluginKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }
    if (key.name === 'down' || key.sequence === 'j') move(1)
    else if (key.name === 'up' || key.sequence === 'k') move(-1)
    else if (key.sequence === 'g') setCursor(0)
    else if (key.sequence === 'G') setCursor(fileIndexes.length - 1)
    else if (key.name === 'return' && isFile(selectedRow) && onOpenFile) { onOpenFile(selectedRow.path); onClose() }
  }, [fileIndexes.length, move, onClose, onOpenFile, selectedRow])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 100)
  const popH = docked ? height : Math.min(height - 4, 30)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = Math.max(popW - frame - 2, 20)
  const listRows = Math.max(popH - frame - 3, 3)
  const clip = (text: string, limit = innerW) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text)

  // Keep the selected file in view, with its turn heading when it is the turn's first file.
  const selectedAt = fileIndexes[at] ?? 0
  const top = Math.max(0, Math.min(selectedAt - Math.floor(listRows / 2), Math.max(rows.length - listRows, 0)))
  const visible = rows.slice(top, top + listRows)
  const totalAdded = turns.reduce((sum, turn) => sum + turn.added, 0)
  const totalRemoved = turns.reduce((sum, turn) => sum + turn.removed, 0)
  const distinct = new Set(turns.flatMap((turn) => turn.files.map((file) => file.path))).size

  return (
    <box
      {...popoverRootProps(docked, { top: popTop, left: popLeft, width: popW, height: popH }, 50)}
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={docked ? undefined : ' Files touched '}
      titleAlignment="left"
      paddingX={1}
    >
      {!docked && onDetach ? <PopoverDetachButton theme={theme} onPress={onDetach} /> : null}
      <text fg={theme.muted} wrapMode="none">
        {clip((loading && !cards) || (indexed === null && !cards) ? 'Reading…' : rows.length === 0 ? 'No files edited in this session' : `${distinct} file${distinct === 1 ? '' : 's'} · +${totalAdded} −${totalRemoved} · ${turns.length} turn${turns.length === 1 ? '' : 's'}`)}
      </text>
      <box flexDirection="column" height={listRows}>
        {visible.map((row) => row.kind === 'turn' ? (
          <text key={row.key} fg={theme.cyan} wrapMode="none">
            {clip(`${row.title}  ·  ${row.fileCount} file${row.fileCount === 1 ? '' : 's'}  +${row.added} −${row.removed}`)}
          </text>
        ) : (
          <text key={row.key} fg={row === selectedRow ? theme.text : theme.muted} bg={row === selectedRow ? theme.surface3 : undefined} wrapMode="none">
            {clip(`${row === selectedRow ? '▎' : ' '} +${String(row.added).padEnd(4)} ${fromIndex ? kept(row) : `−${String(row.removed).padEnd(4)} `}${relativeTo(cwd, row.path)}`)}
          </text>
        ))}
      </box>
      <box flexGrow={1} />
      <text fg={theme.dim} wrapMode="none">{clip(`j/k move · g/G ends · enter open in editor · esc close`)}</text>
    </box>
  )
}
