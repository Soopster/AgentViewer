/** @jsxImportSource @opentui/react */
// File history: one file scrubbed through the turn checkpoints. Each step is
// an interval between two snapshots in which the file changed — the work of
// the turn that started there — shown as its diff, labelled with that turn's
// prompt. Any one hunk of any step can be undone against the file as it is
// now, the file can be put back to how it was before a step, and a step can be
// handed to an agent with the prompt that produced it.
import { MODAL_CONTENT_Z_INDEX, PopoverDetachButton, popoverFrameCells, popoverRootProps, type TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { SELECTION_ASK_INTENTS, type SelectionAskInput } from '../../../lib/selectionAsk'
import {
  readTuiFileHistory,
  restoreTuiCheckpoint,
  revertTuiFileHistoryHunk,
  type FileHistory,
  type FileHistoryStep,
  type WorkingDiffHunk,
} from '../../../lib/tui/service'

type FileHistoryKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  cwd: string
  path: string
  theme: TuiThemePalette
  accentColor: string
  width: number
  height: number
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string, durationMs?: number) => void
  onKeyHandlerReady: (handler: (key: FileHistoryKeyEvent) => void) => void
  onAskAgent?: (request: SelectionAskInput) => void
  /** Fill the given box inside a window, with no frame of its own. */
  docked?: boolean
  /** Shows the `⧉ window` button: break the popover out into a window. */
  onDetach?: () => void
}

type Pending =
  | { kind: 'revert-hunk'; hunk: WorkingDiffHunk }
  | { kind: 'restore-file'; step: FileHistoryStep }

export type FileHistoryBodyLine = { text: string; hunk: number }

/** The diff below its file headers, each line tagged with the hunk it belongs to. */
export function fileHistoryBodyLines(step: FileHistoryStep): FileHistoryBodyLine[] {
  const lines: FileHistoryBodyLine[] = []
  step.hunks.forEach((hunk, index) => {
    for (const text of hunk.lines) lines.push({ text, hunk: index })
  })
  return lines
}

/** The new-side lines a hunk covers, 1-based; an all-deletion hunk names the line it sat before. */
export function hunkNewLineRange(hunk: WorkingDiffHunk): { startLine: number; endLine: number } {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(hunk.header)
  const start = Math.max(Number(match?.[1] ?? 1), 1)
  const count = match?.[2] === undefined ? 1 : Number(match[2])
  return { startLine: start, endLine: Math.max(start, start + count - 1) }
}

/**
 * The timeline strip: one glyph per step, oldest left, the selection marked,
 * windowed around it when every step will not fit. Two cells per step.
 */
export function fileHistoryTimeline(steps: FileHistoryStep[], selected: number, width: number): Array<{ text: string; index: number | null }> {
  const capacity = Math.max(Math.floor((width - 6) / 2), 1)
  let first = 0
  if (steps.length > capacity) first = Math.min(Math.max(selected - Math.floor(capacity / 2), 0), steps.length - capacity)
  const last = Math.min(steps.length, first + capacity)
  const cells: Array<{ text: string; index: number | null }> = []
  if (first > 0) cells.push({ text: '…', index: null })
  for (let index = first; index < last; index += 1) {
    cells.push({ text: index === selected ? '◆' : '●', index })
    cells.push({ text: '─', index: null })
  }
  if (last < steps.length) cells.push({ text: '…', index: null })
  cells.push({ text: ' now', index: null })
  return cells
}

function groupByHunk(lines: FileHistoryBodyLine[], selectedHunk: number): Array<{ start: number; current: boolean; lines: FileHistoryBodyLine[] }> {
  const groups: Array<{ start: number; current: boolean; lines: FileHistoryBodyLine[] }> = []
  lines.forEach((line, index) => {
    const current = line.hunk === selectedHunk
    const last = groups[groups.length - 1]
    if (last && last.current === current) last.lines.push(line)
    else groups.push({ start: index, current, lines: [line] })
  })
  return groups
}

function formatAge(createdAt: number, now: number): string {
  if (createdAt <= 0) return ''
  const minutes = Math.floor((now - createdAt) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : `${text.slice(0, Math.max(width - 1, 0))}…`
}

export function FileHistoryPopover({
  cwd,
  path,
  theme,
  accentColor,
  width,
  height,
  onClose,
  onNotice,
  onKeyHandlerReady,
  onAskAgent,
  docked = false,
  onDetach,
}: Props) {
  const [history, setHistory] = useState<FileHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [stepIndex, setStepIndex] = useState(-1)
  const [hunkIndex, setHunkIndex] = useState(0)
  const [pending, setPending] = useState<Pending | null>(null)
  const [askArmed, setAskArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const generationRef = useRef(0)
  // A reload after a revert keeps the step the user was on, found by its checkpoint.
  const keepRefRef = useRef<string | null>(null)

  const reload = useCallback(async () => {
    const generation = ++generationRef.current
    setLoading(true)
    try {
      const next = await readTuiFileHistory(cwd, path)
      if (generation !== generationRef.current) return
      setHistory(next)
      setError(null)
      const kept = keepRefRef.current ? next.steps.findIndex((step) => step.checkpoint.ref === keepRefRef.current) : -1
      setStepIndex(kept >= 0 ? kept : next.steps.length - 1)
    } catch (err) {
      if (generation === generationRef.current) setError(err instanceof Error ? err.message : 'Failed to read file history')
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [cwd, path])

  useEffect(() => { void reload() }, [reload])

  const steps = history?.steps ?? []
  const step = stepIndex >= 0 ? steps[stepIndex] ?? null : null
  const bodyLines = useMemo(() => (step ? fileHistoryBodyLines(step) : []), [step])
  const hunkOffsets = useMemo(() => {
    const offsets: number[] = []
    bodyLines.forEach((line, index) => { if (offsets[line.hunk] === undefined) offsets[line.hunk] = index })
    return offsets
  }, [bodyLines])
  const now = useMemo(() => Date.now(), [history])

  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 120)
  const popH = docked ? height : Math.min(height - 2, 42)
  const popTop = Math.max(Math.floor((height - popH) / 2), 0)
  const popLeft = Math.max(Math.floor((width - popW) / 2), 0)
  const innerW = popW - frame - 2
  const headerH = 4
  const footerH = 2
  const bodyH = Math.max(popH - headerH - footerH - frame, 4)

  useEffect(() => {
    setHunkIndex(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [stepIndex, history])

  const moveHunk = useCallback((delta: number) => {
    if (!step || step.hunks.length === 0) return
    const next = Math.max(0, Math.min(hunkIndex + delta, step.hunks.length - 1))
    setHunkIndex(next)
    const box = scrollRef.current
    if (box) box.scrollTop = Math.max((hunkOffsets[next] ?? 0) - 1, 0)
  }, [hunkIndex, hunkOffsets, step])

  const scrollBody = useCallback((delta: number) => {
    const box = scrollRef.current
    if (!box) return
    box.scrollTop = Math.max(0, Math.min(box.scrollTop + delta, Math.max(box.scrollHeight - bodyH, 0)))
  }, [bodyH])

  const runPending = useCallback(async (action: Pending) => {
    if (!history) return
    setBusy(true)
    try {
      if (action.kind === 'revert-hunk') {
        await revertTuiFileHistoryHunk(history.repoRoot, action.hunk.patchText)
        onNotice('info', `Reverted one change in ${history.relPath}`, 4000)
      } else {
        const { checkpoint } = action.step
        await restoreTuiCheckpoint(history.repoRoot, checkpoint.sha, [history.relPath], checkpoint)
        onNotice('info', `Restored ${history.relPath} to before "${fit(checkpoint.label, 40)}"`, 5000)
      }
      keepRefRef.current = step?.checkpoint.ref ?? null
      await reload()
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
      setPending(null)
    }
  }, [history, onNotice, reload, step])

  const ask = useCallback((intent: SelectionAskInput['intent']) => {
    if (!history || !step || !onAskAgent) return
    const hunk = step.hunks[hunkIndex]
    const range = hunk ? hunkNewLineRange(hunk) : { startLine: 1, endLine: 1 }
    const { checkpoint } = step
    onAskAgent({
      intent,
      filePath: history.relPath,
      startLine: range.startLine,
      endLine: range.endLine,
      code: hunk ? hunk.lines.join('\n') : step.diff,
      isDiff: true,
      origin: step.until ? 'a change made during one agent turn' : 'a change made since the last agent turn',
      history: [{
        source: `${checkpoint.provider ?? 'agent'} session${checkpoint.sessionId ? ` ${checkpoint.sessionId.slice(0, 8)}` : ''}, the turn this change followed`,
        text: checkpoint.label,
        timestampMs: checkpoint.createdAt,
      }],
    })
  }, [history, hunkIndex, onAskAgent, step])

  const handleKey = useCallback((key: FileHistoryKeyEvent) => {
    if (busy) return
    if (pending) {
      if (key.name === 'y' || key.name === 'return') void runPending(pending)
      else if (key.name === 'n' || key.name === 'escape') setPending(null)
      return
    }
    if (askArmed) {
      const choice = SELECTION_ASK_INTENTS.find((entry) => entry.key === key.sequence)
      if (choice) ask(choice.intent)
      if (choice || key.name === 'escape') setAskArmed(false)
      return
    }
    if (key.name === 'escape' || key.name === 'q') {
      onClose()
      return
    }
    const last = steps.length - 1
    if (key.name === 'left' || key.name === 'h' || key.sequence === '[') { setStepIndex((index) => Math.max(index - 1, 0)); return }
    if (key.name === 'right' || key.name === 'l' || key.sequence === ']') { setStepIndex((index) => Math.min(index + 1, last)); return }
    if (key.sequence === 'g' || key.name === 'home') { setStepIndex(Math.min(0, last)); return }
    if (key.sequence === 'G' || key.name === 'end') { setStepIndex(last); return }
    if (key.name === 'j' || key.name === 'down') { scrollBody(1); return }
    if (key.name === 'k' || key.name === 'up') { scrollBody(-1); return }
    if (key.name === 'pagedown' || (key.ctrl && key.name === 'd')) { scrollBody(bodyH); return }
    if (key.name === 'pageup' || (key.ctrl && key.name === 'u')) { scrollBody(-bodyH); return }
    if (key.sequence === 'n') { moveHunk(1); return }
    if (key.sequence === 'N') { moveHunk(-1); return }
    if (!step) return
    if (key.sequence === 'u') {
      const hunk = step.hunks[hunkIndex]
      // A creation or deletion is undone by restoring the file, not by a hunk:
      // reversed alone, its patch would empty the file rather than remove it.
      if (step.status !== 'M') onNotice('info', `This step ${step.status === 'A' ? 'created' : 'deleted'} the file — R restores it`, 4000)
      else if (hunk) setPending({ kind: 'revert-hunk', hunk })
      return
    }
    if (key.sequence === 'R') { setPending({ kind: 'restore-file', step }); return }
    if (key.sequence === 'a' && onAskAgent) { setAskArmed(true); return }
  }, [ask, askArmed, bodyH, busy, hunkIndex, moveHunk, onAskAgent, onClose, onNotice, pending, runPending, scrollBody, step, steps.length])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const relPath = history?.relPath ?? path
  const timeline = useMemo(() => fileHistoryTimeline(steps, stepIndex, innerW - 12), [innerW, stepIndex, steps])

  const footer = busy
    ? 'Working…'
    : pending?.kind === 'revert-hunk'
    ? `Undo hunk ${hunkIndex + 1} of this step in the file as it is now? y/⏎ confirm · n/Esc cancel`
    : pending?.kind === 'restore-file'
    ? `Put ${relPath} back to how it was before this step? Later changes to it are lost. y/⏎ · n/Esc`
    : askArmed
    ? `ask about ${step?.hunks.length ? `hunk ${hunkIndex + 1}` : 'this step'}: ${SELECTION_ASK_INTENTS.map(({ key, label }) => `${key} ${label.toLowerCase()}`).join(' · ')} · Esc`
    : `←/→ step · n/N hunk · j/k scroll · u undo hunk · R restore before step${onAskAgent ? ' · a ask agent' : ''} · Esc close`

  const statusColor = step?.status === 'A' ? theme.green : step?.status === 'D' ? theme.red : theme.amber

  return (
    <box
      {...popoverRootProps(docked, { top: popTop, left: popLeft, width: popW, height: popH }, MODAL_CONTENT_Z_INDEX)}
      // borderStyle alone turns a border on, so a docked popover passes none.
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={docked ? undefined : ` File history · ${fit(relPath, Math.max(popW - 20, 10))} `}
      titleColor={accentColor}
      titleAlignment="left"
    >
      {!docked && onDetach ? <PopoverDetachButton theme={theme} onPress={onDetach} /> : null}
      <box height={headerH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="column">
        <box flexDirection="row" height={1}>
          <text fg={theme.muted} wrapMode="none">{steps.length > 0 ? `step ${stepIndex + 1}/${steps.length}  ` : ''}</text>
          <text wrapMode="none">
            {timeline.map((cell, index) => (
              <span
                key={index}
                fg={cell.index === null ? theme.dim : cell.index === stepIndex ? accentColor : steps[cell.index]?.status === 'A' ? theme.green : steps[cell.index]?.status === 'D' ? theme.red : theme.muted}
              >
                {cell.text}
              </span>
            ))}
          </text>
        </box>
        <text fg={theme.text} wrapMode="none">
          {step ? fit(`"${step.checkpoint.label || '(no message)'}"`, innerW) : ' '}
        </text>
        <box flexDirection="row" height={1}>
          {step ? (
            <text wrapMode="none">
              <span fg={statusColor}>{step.status === 'A' ? 'created' : step.status === 'D' ? 'deleted' : 'modified'}</span>
              <span fg={theme.dim}>{'  ·  '}</span>
              <span fg={theme.green}>{`+${step.additions}`}</span>
              <span fg={theme.dim}>{' '}</span>
              <span fg={theme.red}>{`−${step.deletions}`}</span>
              <span fg={theme.dim}>{'  ·  '}</span>
              <span fg={theme.muted}>{[
                step.checkpoint.provider?.toUpperCase(),
                step.checkpoint.sessionId ? `session ${step.checkpoint.sessionId.slice(0, 8)}` : null,
                formatAge(step.checkpoint.createdAt, now),
                step.until ? 'until the next turn' : 'until now',
              ].filter(Boolean).join(' · ')}</span>
            </text>
          ) : <text> </text>}
        </box>
      </box>

      <scrollbox
        ref={scrollRef}
        width={popW - frame}
        height={bodyH}
        scrollY
        backgroundColor={theme.surface}
        scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      >
        <box paddingX={1} flexDirection="column">
          {loading && !history ? (
            <text fg={theme.dim}>Loading…</text>
          ) : error ? (
            <text fg={theme.red} wrapMode="word" width={innerW}>{error}</text>
          ) : !step ? (
            <text fg={theme.dim} wrapMode="word" width={innerW}>
              {(history?.checkpointsScanned ?? 0) === 0
                ? 'No turn checkpoints in this repository yet. Every agent turn snapshots the working tree before it starts; this file\'s history builds from those.'
                : `${relPath} did not change across the ${history?.checkpointsScanned} turn checkpoints here.`}
            </text>
          ) : (
            // One text per run of lines sharing a background: the selected
            // hunk is lit, the rest is not. A box per line would mount every
            // line of a long diff as its own renderable.
            groupByHunk(bodyLines, hunkIndex).map((group) => (
              <box key={group.start} backgroundColor={group.current ? theme.surface3 : theme.surface}>
              <text wrapMode="none">
                {group.lines.map((line, offset) => (
                  <span
                    key={offset}
                    fg={line.text.startsWith('+') ? theme.green
                      : line.text.startsWith('-') ? theme.red
                      : line.text.startsWith('@@') ? theme.cyan
                      : group.current ? theme.muted : theme.dim}
                  >
                    {`${fit(line.text, innerW) || ' '}${offset < group.lines.length - 1 ? '\n' : ''}`}
                  </span>
                ))}
              </text>
              </box>
            ))
          )}
        </box>
      </scrollbox>

      <box height={footerH} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={pending ? theme.amber : askArmed ? theme.cyan : theme.dim} wrapMode="none">{fit(footer, innerW)}</text>
      </box>
    </box>
  )
}
