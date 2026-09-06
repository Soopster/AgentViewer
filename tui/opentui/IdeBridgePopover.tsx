/** @jsxImportSource @opentui/react */
// OpenTUI popover for the IDE bridge — the third Claude composer flow. agentViewer
// hosts a Claude Code IDE endpoint (channels/agentviewer-ide.ts) an external
// `claude` connects to. This panel shows the IDE tool calls that session makes
// (openFile, getDiagnostics, …), lets you accept/reject blocking openDiff
// requests (^Y / ^N), and pushes @file mentions into the session. Mirrors
// ChannelBridgePopover; uses lib/ideBridge.ts. The protocol streams no prose
// back, so this is a tool-activity feed rather than a chat thread.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import {
  readIdeBridgeConfigFromEnv,
  resolveIdeDiff,
  sendIdeAtMention,
  subscribeToIdeEvents,
  type IdeBridgeStatus,
  type IdeEvent,
  type IdeOpenDiffEvent,
} from '../../lib/ideBridge'
import { buildDiffCommentComposerPrompt } from '../../lib/diffCommentComposer'

type IdeBridgeKeyEvent = { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }

type LogEntry =
  | { kind: 'mention'; id: string; label: string }
  | { kind: 'tool'; id: string; name: string; summary: string }
  | { kind: 'diff'; id: string; request: IdeOpenDiffEvent; resolved?: 'accept' | 'reject' }
  | { kind: 'lifecycle'; id: string; event: 'connected' | 'disconnected' | 'initialized' }

type Props = {
  theme: TuiThemePalette
  accentColor: string
  width: number
  height: number
  routeComposer: boolean
  onToggleRoute: () => void
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string) => void
  onKeyHandlerReady: (handler: (key: IdeBridgeKeyEvent) => void) => void
  // Deliver a diff-review comment (structured prompt) into the composer.
  onSendComment?: (text: string) => void
}

// Mirror the web buildDiffContext / Edit-card context block.
function buildDiffContext(oldStr: string, newStr: string): string {
  const block = (prefix: string, text: string) =>
    text === '' ? `${prefix} ` : text.split('\n').map((line) => `${prefix} ${line}`).join('\n')
  return ['--- original', block('-', oldStr), '+++ updated', block('+', newStr)].join('\n')
}

let entrySeq = 0
function nextEntryId(prefix: string): string {
  entrySeq += 1
  return `${prefix}-${entrySeq}`
}

function isPrintable(key: IdeBridgeKeyEvent): boolean {
  return !key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= ' '
}

function withCursor(value: string): string {
  return `${value}▏`
}

function shortPath(value: unknown): string {
  return typeof value === 'string' ? value.replace(/^file:\/\//, '') : ''
}

// One-line summary of an IDE tool call for the activity feed.
function toolSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'openFile':
    case 'checkDocumentDirty':
    case 'saveDocument':
      return shortPath(args.filePath)
    case 'getDiagnostics':
      return args.uri ? shortPath(args.uri) : 'all files'
    case 'close_tab':
      return typeof args.tab_name === 'string' ? args.tab_name : ''
    case 'executeCode':
      return typeof args.code === 'string' ? args.code.slice(0, 60) : ''
    default:
      return ''
  }
}

function statusLabel(status: IdeBridgeStatus, claudeConnected: boolean): string {
  switch (status) {
    case 'connected': return claudeConnected ? 'host up · claude connected' : 'host up · waiting for claude'
    case 'connecting': return 'connecting…'
    case 'error': return 'host unreachable — retrying'
    default: return 'idle'
  }
}

function statusColor(status: IdeBridgeStatus, claudeConnected: boolean, theme: TuiThemePalette): string {
  if (status === 'error') return theme.red
  if (status === 'connected') return claudeConnected ? theme.green : theme.amber
  return theme.dim
}

type DiffRow = { kind: 'context' | 'add' | 'del'; text: string }

// Fast, dependency-free line diff for terminal review: collapse the common
// prefix and suffix, then show the changed region as removed/added blocks with
// a few context lines around it. O(n) — never blows up on large files. For a
// multi-region edit it renders one combined hunk, which is plenty for a quick
// terminal review (the web overlay has the full per-hunk diff).
function computeLineDiffRows(oldText: string, newText: string, maxRows: number): { rows: DiffRow[]; truncated: number } {
  const oldLines = oldText.length === 0 ? [] : oldText.split('\n')
  const newLines = newText.length === 0 ? [] : newText.split('\n')

  let prefix = 0
  const maxPrefix = Math.min(oldLines.length, newLines.length)
  while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < maxPrefix - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1

  const removed = oldLines.slice(prefix, oldLines.length - suffix)
  const added = newLines.slice(prefix, newLines.length - suffix)

  const CONTEXT = 2
  const rows: DiffRow[] = []
  for (let i = Math.max(0, prefix - CONTEXT); i < prefix; i += 1) rows.push({ kind: 'context', text: oldLines[i] })
  for (const line of removed) rows.push({ kind: 'del', text: line })
  for (const line of added) rows.push({ kind: 'add', text: line })
  const suffixStart = oldLines.length - suffix
  for (let i = suffixStart; i < Math.min(oldLines.length, suffixStart + CONTEXT); i += 1) {
    rows.push({ kind: 'context', text: oldLines[i] })
  }

  if (rows.length <= maxRows) return { rows, truncated: 0 }
  return { rows: rows.slice(0, maxRows), truncated: rows.length - maxRows }
}

function parseMention(text: string): { filePath: string; lineStart?: number; lineEnd?: number } {
  const match = text.match(/^(.*?):(\d+)(?:-(\d+))?$/)
  if (match) {
    const filePath = match[1]
    const lineStart = Number(match[2])
    const lineEnd = match[3] ? Number(match[3]) : lineStart
    return { filePath, lineStart, lineEnd }
  }
  return { filePath: text }
}

export function IdeBridgePopover({
  theme,
  accentColor,
  width,
  height,
  routeComposer,
  onToggleRoute,
  onClose,
  onNotice,
  onKeyHandlerReady,
  onSendComment,
}: Props) {
  const config = useMemo(readIdeBridgeConfigFromEnv, [])
  const [status, setStatus] = useState<IdeBridgeStatus>('idle')
  const [claudeConnected, setClaudeConnected] = useState(false)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<ScrollBoxRenderable>(null)

  useEffect(() => {
    const unsubscribe = subscribeToIdeEvents(
      config,
      (event: IdeEvent) => {
        if (event.type === 'connected' || event.type === 'disconnected' || event.type === 'initialized') {
          setClaudeConnected(event.type !== 'disconnected')
          const lifecycleEvent = event.type
          setEntries((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.kind === 'lifecycle' && last.event === lifecycleEvent) return prev
            return [...prev, { kind: 'lifecycle', id: nextEntryId('life'), event: lifecycleEvent }]
          })
          return
        }
        if (event.type === 'open_diff') {
          const diffEvent = event
          setEntries((prev) => [...prev, { kind: 'diff', id: nextEntryId('diff'), request: diffEvent }])
        } else if (event.type === 'tool_call') {
          const summary = toolSummary(event.name, event.arguments)
          const name = event.name
          setEntries((prev) => [...prev, { kind: 'tool', id: nextEntryId('tool'), name, summary }])
        }
      },
      (next) => setStatus(next),
    )
    return unsubscribe
  }, [config])

  useEffect(() => {
    scrollRef.current?.scrollTo(scrollRef.current?.scrollHeight ?? Number.MAX_SAFE_INTEGER)
  }, [entries])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const { filePath, lineStart, lineEnd } = parseMention(text)
      const result = await sendIdeAtMention(config, filePath, lineStart, lineEnd)
      const range = lineStart != null ? `:${lineStart}${lineEnd && lineEnd !== lineStart ? `-${lineEnd}` : ''}` : ''
      setEntries((prev) => [...prev, { kind: 'mention', id: nextEntryId('mention'), label: `${shortPath(filePath)}${range}` }])
      setDraft('')
      if (!result.delivered) onNotice('error', 'No `claude` session is connected to the IDE host yet')
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to reach the IDE host')
    } finally {
      setSending(false)
    }
  }, [config, draft, onNotice, sending])

  const answerLatestDiff = useCallback(
    async (behavior: 'accept' | 'reject') => {
      let target: Extract<LogEntry, { kind: 'diff' }> | null = null
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i]
        if (entry.kind === 'diff' && !entry.resolved) { target = entry; break }
      }
      if (!target) {
        onNotice('info', 'No pending diff from the IDE session')
        return
      }
      const request = target
      setEntries((prev) => prev.map((item) => (item.id === request.id ? { ...item, resolved: behavior } : item)))
      try {
        await resolveIdeDiff(config, request.request.diff_id, behavior)
      } catch (err) {
        setEntries((prev) => prev.map((item) => (item.id === request.id && item.kind === 'diff' ? { ...item, resolved: undefined } : item)))
        onNotice('error', err instanceof Error ? err.message : 'Failed to send the diff verdict')
      }
    },
    [config, entries, onNotice],
  )

  // Send the typed draft as a review comment on the latest pending diff. The
  // popover has no gutter line-selection, so the comment applies to the whole
  // proposed change; the prompt format matches the web Edit-card comments.
  const sendComment = useCallback(() => {
    if (!onSendComment) return
    let target: Extract<LogEntry, { kind: 'diff' }> | null = null
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]
      if (entry.kind === 'diff' && !entry.resolved) { target = entry; break }
    }
    if (!target) { onNotice('info', 'No pending diff to comment on'); return }
    const text = draft.trim()
    if (!text) { onNotice('info', 'Type a comment first, then ^S to send it'); return }
    const newLineCount = Math.max(target.request.new_file_contents.split('\n').length, 1)
    onSendComment(
      buildDiffCommentComposerPrompt({
        filePath: target.request.new_file_path,
        range: { start: 1, end: newLineCount, side: 'additions', endSide: 'additions' },
        comment: text,
        context: buildDiffContext(target.request.old_file_contents, target.request.new_file_contents),
        source: 'IDE bridge diff',
      }),
    )
    setDraft('')
    onNotice('info', 'Comment sent to the composer')
  }, [draft, entries, onNotice, onSendComment])

  const handleKey = useCallback((key: IdeBridgeKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }
    if (key.ctrl && (key.name === 'r' || key.sequence === '\x12')) { onToggleRoute(); return }
    if (key.ctrl && key.name === 's') { sendComment(); return }
    if (key.name === 'return') { void send(); return }
    if (key.name === 'backspace' || key.name === 'delete') { setDraft((d) => d.slice(0, -1)); return }
    if (key.ctrl && key.name === 'y') { void answerLatestDiff('accept'); return }
    if (key.ctrl && key.name === 'n') { void answerLatestDiff('reject'); return }
    if (isPrintable(key)) { setDraft((d) => d + key.sequence); return }
  }, [answerLatestDiff, onClose, onToggleRoute, send, sendComment])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const hasPendingDiff = entries.some((e) => e.kind === 'diff' && !e.resolved)

  const popW = Math.min(width - 4, 100)
  const popH = Math.min(height - 4, 36)
  const headerH = 3
  const footerH = 3
  const bodyH = Math.max(popH - headerH - footerH - 2, 8)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = popW - 4

  return (
    <box
      position="absolute"
      top={popTop}
      left={popLeft}
      width={popW}
      height={popH}
      border
      borderStyle="single"
      borderColor={theme.border2}
      backgroundColor={theme.surface}
      zIndex={50}
      flexDirection="column"
      title=" IDE bridge "
      titleColor={accentColor}
      titleAlignment="left"
    >
      <box height={headerH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="column">
        <box flexDirection="row" alignItems="center">
          <text fg={statusColor(status, claudeConnected, theme)} wrapMode="none">{statusLabel(status, claudeConnected)}</text>
          <text fg={theme.dim} wrapMode="none">{'  '}{config.baseUrl.replace(/^https?:\/\//, '')}</text>
          <box flexGrow={1} />
          <text fg={theme.dim} wrapMode="none">
            {hasPendingDiff
              ? `^Y accept · ^N reject${onSendComment ? ' · ^S comment' : ''} · esc close`
              : 'enter @mention · esc close'}
          </text>
        </box>
        <box flexDirection="row" alignItems="center">
          <text fg={routeComposer ? accentColor : theme.dim} wrapMode="none">
            {routeComposer ? '● composer → IDE @mentions' : '○ composer → provider'}
          </text>
          <box flexGrow={1} />
          <text fg={theme.dim} wrapMode="none">^R toggle composer routing</text>
        </box>
      </box>

      <scrollbox
        ref={scrollRef}
        width={popW - 2}
        height={bodyH}
        scrollY
        backgroundColor={theme.surface}
        scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      >
        <box paddingX={1} paddingTop={1} paddingBottom={1} flexDirection="column" gap={1}>
          {entries.length === 0 ? (
            <text fg={theme.dim} wrapMode="word" width={innerW}>
              agentViewer is hosting a Claude Code IDE endpoint (start it with `bun run channels/agentviewer-ide.ts`,
              then launch `claude` in the same shell with the printed CLAUDE_CODE_SSE_PORT / ENABLE_IDE_INTEGRATION
              exports). The session's IDE tool calls and diffs appear here. Type `path/to/file.ts:10-20` below to push
              an @mention.
            </text>
          ) : (
            entries.map((entry) => {
              if (entry.kind === 'lifecycle') {
                const label = entry.event === 'disconnected'
                  ? 'claude disconnected'
                  : entry.event === 'connected'
                  ? 'claude connected'
                  : 'session initialized'
                return (
                  <text key={entry.id} fg={theme.dim} wrapMode="none">{`— ${label} —`}</text>
                )
              }

              if (entry.kind === 'mention') {
                return (
                  <box key={entry.id} flexDirection="row">
                    <text fg={accentColor} wrapMode="none">{'@ '}</text>
                    <text fg={theme.text} wrapMode="word" width={innerW - 2}>{entry.label}</text>
                  </box>
                )
              }

              if (entry.kind === 'tool') {
                return (
                  <box key={entry.id} flexDirection="row">
                    <text fg={accentColor} wrapMode="none">{entry.name}</text>
                    {entry.summary ? <text fg={theme.muted} wrapMode="word" width={innerW - entry.name.length - 1}>{` ${entry.summary}`}</text> : null}
                  </box>
                )
              }

              const resolved = entry.resolved
              const lineCount = entry.request.new_file_contents.split('\n').length
              // Render the actual change for an unresolved diff so it can be
              // reviewed in-place before ^Y / ^N. Cap rows to keep the popover usable.
              const diff = resolved ? null : computeLineDiffRows(entry.request.old_file_contents, entry.request.new_file_contents, Math.max(bodyH - 4, 6))
              return (
                <box key={entry.id} flexDirection="column" border borderStyle="single" borderColor={resolved ? accentColor : theme.border2} paddingX={1}>
                  <box flexDirection="row" alignItems="center">
                    <text fg={accentColor} wrapMode="none">{entry.request.tab_name}</text>
                    <text fg={theme.dim} wrapMode="none"> proposes a change</text>
                  </box>
                  <text fg={theme.muted} wrapMode="word" width={innerW - 4}>
                    {`${shortPath(entry.request.new_file_path)} · ${lineCount} line${lineCount === 1 ? '' : 's'}`}
                  </text>
                  {diff && diff.rows.length > 0 ? (
                    <box flexDirection="column">
                      {diff.rows.map((row, rowIndex) => (
                        <text
                          key={`${entry.id}:r${rowIndex}`}
                          fg={row.kind === 'add' ? theme.green : row.kind === 'del' ? theme.red : theme.dim}
                          wrapMode="none"
                        >
                          {`${row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '} ${row.text}`.slice(0, innerW - 4)}
                        </text>
                      ))}
                      {diff.truncated > 0 ? (
                        <text fg={theme.dim} wrapMode="none">{`  … ${diff.truncated} more line${diff.truncated === 1 ? '' : 's'} — full diff in the web review`}</text>
                      ) : null}
                    </box>
                  ) : null}
                  <text fg={resolved ? (resolved === 'accept' ? theme.green : theme.red) : theme.amber} wrapMode="none">
                    {resolved
                      ? `${resolved === 'accept' ? 'accepted — FILE_SAVED' : 'rejected — DIFF_REJECTED'}`
                      : `pending — ^Y accept · ^N reject${onSendComment ? ' · type a note + ^S comment' : ''}  (claude is blocked until you respond)`}
                  </text>
                </box>
              )
            })
          )}
        </box>
      </scrollbox>

      <box height={footerH} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={theme.dim} wrapMode="none">{'> '}</text>
        <text fg={theme.text} wrapMode="word" width={innerW - 2}>{withCursor(draft)}</text>
      </box>
    </box>
  )
}
