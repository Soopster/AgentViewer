/** @jsxImportSource @opentui/react */
// TUI entry for Code provenance: the files this session wrote and how much of
// each still traces back to it; Enter blames a file (which sessions wrote its
// current lines), and Enter on a run of lines opens the session at that edit.
import { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { ProvenanceBlameResult, SessionProvenanceResult } from '../../../lib/provenance'
// A path inside the session's folder reads relative to it; anything else stays whole.
function displayPath(filePath: string, cwd: string | null): string {
  if (!cwd) return filePath
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`
  return filePath.startsWith(root) ? filePath.slice(root.length) : filePath
}
import { fitText, MODAL_CONTENT_Z_INDEX, popoverFrameCells, popoverRootProps, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'

function age(ms: number | null): string {
  if (!ms) return ''
  const minutes = Math.round((Date.now() - ms) / 60_000)
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`
}

function Provenance({ services, theme, accent, width, height, placement, registerKeys, close }: TuiPluginViewProps) {
  const session = services.session?.session ?? null
  const service = services.provenance
  const navigation = services['session-navigation']
  const [summary, setSummary] = useState<SessionProvenanceResult | null>(null)
  const [blame, setBlame] = useState<ProvenanceBlameResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [fileCursor, setFileCursor] = useState(0)

  useEffect(() => {
    if (!service || !session || session.isPending) return undefined
    const controller = new AbortController()
    service.sessionFiles({ provider: session.provider ?? 'claude', sessionId: session.sessionId }, controller.signal)
      .then(next => { if (!controller.signal.aborted) setSummary(next) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => controller.abort()
  }, [service, session?.provider, session?.sessionId])

  const files = summary?.files ?? []
  const segments = blame?.segments ?? []
  const openFile = async (index: number) => {
    const file = files[index]
    if (!service || !file) return
    setError(null)
    try { setBlame(await service.blame(file.resolvedPath ?? file.filePath, summary?.cwd ?? session?.cwd ?? null)); setCursor(0); setFileCursor(index) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const openSegment = (index: number) => {
    const segment = segments[index]
    if (!segment || !navigation) return
    if (placement === 'overlay') close()
    navigation.open({ provider: segment.edit.provider, sessionId: segment.edit.sessionId }, segment.edit.messageUuid)
  }
  useEffect(() => {
    registerKeys((key) => {
      if (key.name === 'escape' || key.name === 'backspace' || key.sequence === 'q') { if (blame) setBlame(null); else close(); return true }
      const count = blame ? segments.length : files.length
      if (key.name === 'down' || key.sequence === 'j') { setCursor(value => Math.min(value + 1, Math.max(count - 1, 0))); return true }
      if (key.name === 'up' || key.sequence === 'k') { setCursor(value => Math.max(value - 1, 0)); return true }
      if (key.name === 'return') { if (blame) openSegment(cursor); else void openFile(cursor); return true }
      return placement === 'overlay'
    })
    return () => registerKeys(null)
  })
  useEffect(() => { if (!blame) setCursor(fileCursor) }, [blame])

  const docked = placement !== 'overlay'
  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 110)
  const popH = docked ? height : Math.min(height - 2, 34)
  const innerW = popW - frame - 2
  const rows = Math.max(popH - frame - 3, 3)
  const start = Math.max(0, Math.min(cursor - Math.floor(rows / 2), (blame ? segments.length : files.length) - rows))
  const header = blame
    ? `${blame.relPath ?? displayPath(blame.file, summary?.cwd ?? session?.cwd ?? null)} · ${blame.attributedLines}/${blame.totalLines} lines from agent sessions`
    : session ? `Files this session wrote${summary ? ` · ${files.length}` : ''}` : 'Select a session to see what it wrote'
  return (
    <box id="provenance" {...popoverRootProps(docked, { top: Math.max(Math.floor((height - popH) / 2), 0), left: Math.max(Math.floor((width - popW) / 2), 0), width: popW, height: popH }, MODAL_CONTENT_Z_INDEX)}
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface} flexDirection="column" title={docked ? undefined : ' Code provenance '} titleColor={accent}>
      <box paddingX={1} backgroundColor={theme.surface2}><text fg={accent} wrapMode="none">{fitText(header, innerW)}</text></box>
      <box paddingX={1} flexDirection="column" height={rows}>
        {error ? <text fg={theme.red} wrapMode="word" width={innerW}>{error}</text>
          : !service ? <text fg={theme.dim}>This host offers no provenance service.</text>
          : blame ? segments.slice(start, start + rows).map((segment, offset) => {
            const index = start + offset
            const selected = index === cursor
            const label = `L${segment.start + 1}-${segment.end + 1}  ${segment.edit.sessionTitle ?? segment.edit.sessionId}  ${segment.edit.tool}  ${age(segment.edit.timestampMs)}  ${segment.edit.prompt ?? ''}`
            return <box key={index} id={`provenance-segment:${index}`} backgroundColor={selected ? theme.surface3 : theme.surface} onMouseDown={() => { setCursor(index); openSegment(index) }}>
              <text fg={selected ? theme.text : theme.muted} wrapMode="none" selectable={false}>{fitText(`${selected ? '▎' : ' '}${label}`, innerW)}</text>
            </box>
          })
          : !summary ? <text fg={theme.dim}>{session ? 'Reading the provenance index…' : ''}</text>
          : files.length === 0 ? <text fg={theme.dim}>This session wrote no files the index recorded.</text>
          : files.slice(start, start + rows).map((file, offset) => {
            const index = start + offset
            const selected = index === cursor
            const surviving = file.linesSurviving === null ? 'gone' : `${file.linesSurviving}/${file.totalFileLines ?? '?'} lines`
            return <box key={index} id={`provenance-file:${index}`} backgroundColor={selected ? theme.surface3 : theme.surface} onMouseDown={() => { setCursor(index); void openFile(index) }}>
              <text wrapMode="none" selectable={false}>
                <span fg={theme.cyan}>{selected ? '▎' : ' '}</span>
                <span fg={file.exists ? theme.text : theme.dim}>{fitText(displayPath(file.filePath, summary?.cwd ?? session?.cwd ?? null), Math.max(innerW - 34, 10))}</span>
                <span fg={theme.dim}>{`  ${surviving} · ${file.edits} edit${file.edits === 1 ? '' : 's'} · ${age(file.lastEditAt)}`}</span>
              </text>
            </box>
          })}
      </box>
      <box paddingX={1} backgroundColor={theme.surface2}>
        <text fg={theme.dim} wrapMode="none">{fitText(blame ? 'j/k move · ⏎ open the session at that edit · esc back' : 'j/k move · ⏎ blame the file · esc close', innerW)}</text>
      </box>
    </box>
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'provenance',
  views: { provenance: Provenance },
}
