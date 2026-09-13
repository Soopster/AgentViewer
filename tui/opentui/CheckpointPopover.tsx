/** @jsxImportSource @opentui/react */
// Checkpoint & review popover — the trust loop for agent edits:
//  TURNS tab: every agent turn snapshotted the working tree first (hidden git
//    commits). Browse them, see what changed since any turn, restore a single
//    file or the whole change set.
//  REVIEW tab: the current working diff as individually rejectable hunks
//    (plus untracked files), then commit everything and open a PR — without
//    leaving the terminal.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import {
  commitTuiAllChanges,
  createTuiReviewPullRequest,
  deleteTuiUntrackedFile,
  listTuiCheckpoints,
  listTuiWorkingDiff,
  readTuiCheckpointChanges,
  readTuiCheckpointDiff,
  rejectTuiWorkingHunk,
  restoreTuiCheckpoint,
  type CheckpointFileChange,
  type TurnCheckpoint,
  type WorkingDiffHunk,
} from '../../lib/tui/service'

type CheckpointKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  cwd: string
  theme: TuiThemePalette
  accentColor: string
  width: number
  height: number
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string, durationMs?: number) => void
  onKeyHandlerReady: (handler: (key: CheckpointKeyEvent) => void) => void
}

type TurnsRow =
  | { kind: 'checkpoint'; checkpoint: TurnCheckpoint }
  | { kind: 'file'; sha: string; change: CheckpointFileChange }

type ReviewRow =
  | { kind: 'hunk'; hunk: WorkingDiffHunk }
  | { kind: 'untracked'; path: string }

type PendingAction =
  | { kind: 'restore-all'; sha: string; label: string; sessionId?: string; provider?: string }
  | { kind: 'restore-file'; sha: string; path: string; sessionId?: string; provider?: string }
  | { kind: 'reject-hunk'; hunk: WorkingDiffHunk }
  | { kind: 'delete-untracked'; path: string }
  | { kind: 'create-pr' }

function formatAge(createdAt: number, now: number): string {
  if (createdAt <= 0) return ''
  const minutes = Math.floor((now - createdAt) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function statusColor(status: CheckpointFileChange['status'], theme: TuiThemePalette): string {
  return status === 'A' ? theme.green : status === 'D' ? theme.red : theme.amber
}

export function CheckpointPopover({
  cwd,
  theme,
  accentColor,
  width,
  height,
  onClose,
  onNotice,
  onKeyHandlerReady,
}: Props) {
  const [tab, setTab] = useState<'turns' | 'review'>('turns')
  const [checkpoints, setCheckpoints] = useState<TurnCheckpoint[]>([])
  const [expandedSha, setExpandedSha] = useState<string | null>(null)
  const [expandedChanges, setExpandedChanges] = useState<CheckpointFileChange[]>([])
  const [hunks, setHunks] = useState<WorkingDiffHunk[]>([])
  const [untracked, setUntracked] = useState<string[]>([])
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [diffLines, setDiffLines] = useState<string[] | null>(null)
  const [commitMode, setCommitMode] = useState(false)
  const [commitDraft, setCommitDraft] = useState('')
  const now = useMemo(() => Date.now(), [checkpoints])
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const generationRef = useRef(0)

  const reload = useCallback(async () => {
    const generation = ++generationRef.current
    setLoading(true)
    try {
      const [nextCheckpoints, workingDiff] = await Promise.all([
        listTuiCheckpoints(cwd).catch(() => [] as TurnCheckpoint[]),
        listTuiWorkingDiff(cwd).catch(() => ({ hunks: [], untracked: [] })),
      ])
      if (generation !== generationRef.current) return
      setCheckpoints(nextCheckpoints)
      setHunks(workingDiff.hunks)
      setUntracked(workingDiff.untracked)
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [cwd])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (!expandedSha) {
      setExpandedChanges([])
      return
    }
    let cancelled = false
    void readTuiCheckpointChanges(cwd, expandedSha)
      .then((changes) => { if (!cancelled) setExpandedChanges(changes) })
      .catch(() => { if (!cancelled) setExpandedChanges([]) })
    return () => { cancelled = true }
  }, [cwd, expandedSha])

  const turnsRows = useMemo<TurnsRow[]>(() => {
    const rows: TurnsRow[] = []
    for (const checkpoint of checkpoints) {
      rows.push({ kind: 'checkpoint', checkpoint })
      if (checkpoint.sha === expandedSha) {
        for (const change of expandedChanges) rows.push({ kind: 'file', sha: checkpoint.sha, change })
      }
    }
    return rows
  }, [checkpoints, expandedSha, expandedChanges])

  const reviewRows = useMemo<ReviewRow[]>(() => [
    ...hunks.map((hunk): ReviewRow => ({ kind: 'hunk', hunk })),
    ...untracked.map((path): ReviewRow => ({ kind: 'untracked', path })),
  ], [hunks, untracked])

  const rowsLength = tab === 'turns' ? turnsRows.length : reviewRows.length
  const clampedCursor = rowsLength === 0 ? 0 : Math.min(cursor, rowsLength - 1)

  // Every row above the cursor is exactly one line — only the selected review
  // hunk expands — so the cursor's own offset is its index.
  const selectedRowHeight = useMemo(() => {
    if (tab !== 'review') return 1
    const row = reviewRows[clampedCursor]
    if (row?.kind !== 'hunk') return 1
    return 1 + Math.min(Math.max(row.hunk.lines.length - 1, 0), 12)
  }, [clampedCursor, reviewRows, tab])

  const popW = Math.min(width - 4, 110)
  const popH = Math.min(height - 4, 38)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = popW - 4
  const headerH = 2
  const footerH = 2
  const bodyH = Math.max(popH - headerH - footerH - 2, 6)

  const scrollBody = useCallback((delta: number) => {
    const box = scrollRef.current
    if (!box) return
    const max = Math.max(box.scrollHeight - bodyH, 0)
    box.scrollTop = Math.max(0, Math.min(box.scrollTop + delta, max))
  }, [bodyH])

  // Keep the keyboard cursor inside the viewport — without this the list only
  // ever shows its first bodyH rows and j/k walks the selection off-screen.
  useEffect(() => {
    if (diffLines) return
    const box = scrollRef.current
    if (!box) return
    const top = clampedCursor
    const bottom = top + selectedRowHeight
    if (top < box.scrollTop) box.scrollTop = top
    else if (bottom > box.scrollTop + bodyH) box.scrollTop = bottom - bodyH
  }, [bodyH, clampedCursor, diffLines, rowsLength, selectedRowHeight])

  // Diff overlay and tab switches both replace the content wholesale.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [diffLines, tab])

  const runAction = useCallback(async (action: PendingAction) => {
    setBusy(true)
    try {
      if (action.kind === 'restore-all') {
        const result = await restoreTuiCheckpoint(cwd, action.sha, undefined, action)
        onNotice('info', `Restored ${result.restored} file${result.restored === 1 ? '' : 's'}, removed ${result.deleted}`, 4000)
      } else if (action.kind === 'restore-file') {
        await restoreTuiCheckpoint(cwd, action.sha, [action.path], action)
        onNotice('info', `Restored ${action.path}`, 4000)
      } else if (action.kind === 'reject-hunk') {
        await rejectTuiWorkingHunk(cwd, action.hunk.patchText)
        onNotice('info', `Rejected hunk in ${action.hunk.file}`, 4000)
      } else if (action.kind === 'delete-untracked') {
        await deleteTuiUntrackedFile(cwd, action.path)
        onNotice('info', `Deleted ${action.path}`, 4000)
      } else {
        const title = checkpoints[0]?.label ?? 'Agent review'
        const url = await createTuiReviewPullRequest(cwd, title)
        onNotice('info', url ? `PR created: ${url}` : 'PR created', 8000)
      }
      await reload()
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
      setPending(null)
    }
  }, [checkpoints, cwd, onNotice, reload])

  const submitCommit = useCallback(async () => {
    const message = commitDraft.trim()
    if (!message || busy) return
    setBusy(true)
    try {
      const sha = await commitTuiAllChanges(cwd, message)
      onNotice('info', `Committed ${sha.slice(0, 8)}`, 5000)
      setCommitMode(false)
      setCommitDraft('')
      await reload()
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Commit failed')
    } finally {
      setBusy(false)
    }
  }, [busy, commitDraft, cwd, onNotice, reload])

  const openDiff = useCallback(async (sha: string, filePath?: string) => {
    try {
      const diff = await readTuiCheckpointDiff(cwd, sha, filePath)
      setDiffLines(diff ? diff.split('\n') : ['(no changes since this checkpoint)'])
    } catch (err) {
      onNotice('error', err instanceof Error ? err.message : 'Failed to read diff')
    }
  }, [cwd, onNotice])

  const handleKey = useCallback((key: CheckpointKeyEvent) => {
    if (commitMode) {
      if (key.name === 'escape') {
        setCommitMode(false)
        return
      }
      if (key.name === 'return') {
        void submitCommit()
      }
      // remaining keys fall through to the focused input
      return
    }
    if (diffLines) {
      if (key.name === 'escape' || key.name === 'q' || key.name === 'd') setDiffLines(null)
      else if (key.name === 'j' || key.name === 'down') scrollBody(1)
      else if (key.name === 'k' || key.name === 'up') scrollBody(-1)
      else if (key.name === 'pagedown' || (key.name === 'f' && key.ctrl)) scrollBody(bodyH)
      else if (key.name === 'pageup' || (key.name === 'b' && key.ctrl)) scrollBody(-bodyH)
      else if (key.name === 'G' || (key.name === 'g' && key.shift)) scrollBody(Number.MAX_SAFE_INTEGER)
      else if (key.name === 'g') scrollBody(-Number.MAX_SAFE_INTEGER)
      return
    }
    if (pending) {
      if (key.name === 'y' || key.name === 'return') {
        if (!busy) void runAction(pending)
        return
      }
      if (key.name === 'n' || key.name === 'escape') {
        setPending(null)
      }
      return
    }
    if (key.name === 'escape' || key.name === 'q') {
      onClose()
      return
    }
    if (key.name === 'tab' || key.name === 't') {
      setTab((current) => (current === 'turns' ? 'review' : 'turns'))
      setCursor(0)
      return
    }
    if (key.name === 'r' && !key.shift && tab === 'turns') {
      const row = turnsRows[clampedCursor]
      if (row?.kind === 'checkpoint') setPending({
        kind: 'restore-all',
        sha: row.checkpoint.sha,
        label: row.checkpoint.label,
        sessionId: row.checkpoint.sessionId,
        provider: row.checkpoint.provider,
      })
      else if (row?.kind === 'file') {
        const checkpoint = checkpoints.find((entry) => entry.sha === row.sha)
        setPending({
          kind: 'restore-file',
          sha: row.sha,
          path: row.change.path,
          sessionId: checkpoint?.sessionId,
          provider: checkpoint?.provider,
        })
      }
      return
    }
    if (key.name === 'j' || key.name === 'down') {
      setCursor((current) => Math.min(current + 1, Math.max(rowsLength - 1, 0)))
      return
    }
    if (key.name === 'k' || key.name === 'up') {
      setCursor((current) => Math.max(current - 1, 0))
      return
    }
    if (key.name === 'pagedown' || (key.name === 'f' && key.ctrl)) {
      setCursor((current) => Math.min(current + bodyH, Math.max(rowsLength - 1, 0)))
      return
    }
    if (key.name === 'pageup' || (key.name === 'b' && key.ctrl)) {
      setCursor((current) => Math.max(current - bodyH, 0))
      return
    }
    if (key.name === 'home' || (key.name === 'g' && !key.shift)) {
      setCursor(0)
      return
    }
    if (key.name === 'end' || key.name === 'G' || (key.name === 'g' && key.shift)) {
      setCursor(Math.max(rowsLength - 1, 0))
      return
    }
    if (key.name === 'return' && tab === 'turns') {
      const row = turnsRows[clampedCursor]
      if (row?.kind === 'checkpoint') {
        setExpandedSha((current) => (current === row.checkpoint.sha ? null : row.checkpoint.sha))
      }
      return
    }
    if (key.name === 'd') {
      if (tab === 'turns') {
        const row = turnsRows[clampedCursor]
        if (row?.kind === 'checkpoint') void openDiff(row.checkpoint.sha)
        else if (row?.kind === 'file') void openDiff(row.sha, row.change.path)
      }
      return
    }
    if (key.name === 'x' && tab === 'review') {
      const row = reviewRows[clampedCursor]
      if (row?.kind === 'hunk') setPending({ kind: 'reject-hunk', hunk: row.hunk })
      else if (row?.kind === 'untracked') setPending({ kind: 'delete-untracked', path: row.path })
      return
    }
    if (key.name === 'c' && tab === 'review') {
      if (reviewRows.length === 0) {
        onNotice('info', 'Nothing to commit', 2500)
        return
      }
      setCommitDraft(checkpoints[0]?.label ?? '')
      setCommitMode(true)
      return
    }
    if (key.name === 'p' && key.shift && tab === 'review') {
      setPending({ kind: 'create-pr' })
      return
    }
  }, [bodyH, busy, checkpoints, clampedCursor, commitMode, diffLines, onClose, onNotice, openDiff, pending, reviewRows, rowsLength, runAction, scrollBody, submitCommit, tab, turnsRows])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const pendingLabel = pending?.kind === 'restore-all'
    ? `Restore EVERYTHING to "${pending.label}"? Later edits are overwritten.`
    : pending?.kind === 'restore-file'
    ? `Restore ${pending.path} to this checkpoint?`
    : pending?.kind === 'reject-hunk'
    ? `Drop this hunk from ${pending.hunk.file}?`
    : pending?.kind === 'delete-untracked'
    ? `Delete untracked file ${pending.path}?`
    : pending?.kind === 'create-pr'
    ? 'Push the current branch and open a PR via gh?'
    : null

  const footerHint = commitMode
    ? '⏎ commit · Esc cancel'
    : diffLines
    ? 'j/k scroll · PgUp/PgDn page · g/G ends · Esc/d close diff'
    : pendingLabel
    ? 'y/⏎ confirm · n/Esc cancel'
    : tab === 'turns'
    ? '⏎ files · d diff · r restore · PgUp/PgDn · ⇥ review · Esc close'
    : 'x reject · c commit · ⇧P pr · PgUp/PgDn · ⇥ turns · Esc close'

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
      title=" Checkpoints & review "
      titleColor={accentColor}
      titleAlignment="left"
    >
      <box height={headerH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={tab === 'turns' ? accentColor : theme.dim} wrapMode="none">{'TURNS'}</text>
        <text fg={theme.dim} wrapMode="none">{'  ·  '}</text>
        <text fg={tab === 'review' ? accentColor : theme.dim} wrapMode="none">{'REVIEW'}</text>
        <box flexGrow={1} />
        <text fg={theme.dim} wrapMode="none">
          {tab === 'turns'
            ? `${checkpoints.length} checkpoint${checkpoints.length === 1 ? '' : 's'}`
            : `${hunks.length} hunk${hunks.length === 1 ? '' : 's'} · ${untracked.length} untracked`}
        </text>
      </box>

      <scrollbox
        ref={scrollRef}
        width={popW - 2}
        height={bodyH}
        scrollY
        backgroundColor={theme.surface}
        scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      >
        <box paddingX={1} flexDirection="column">
          {diffLines ? (
            diffLines.map((line, index) => (
              <text
                key={`diff-${index}`}
                fg={line.startsWith('+') ? theme.green : line.startsWith('-') ? theme.red : line.startsWith('@@') ? theme.cyan : theme.muted}
                wrapMode="none"
              >
                {line.slice(0, innerW) || ' '}
              </text>
            ))
          ) : loading ? (
            <box paddingTop={1}>
              <text fg={theme.dim}>Loading…</text>
            </box>
          ) : tab === 'turns' ? (
            turnsRows.length === 0 ? (
              <box paddingTop={1}>
                <text fg={theme.dim} wrapMode="word" width={innerW}>
                  No turn checkpoints yet. Every agent turn snapshots the working tree
                  before it starts — they will appear here.
                </text>
              </box>
            ) : (
              turnsRows.map((row, index) => {
                const selected = index === clampedCursor
                if (row.kind === 'checkpoint') {
                  const expanded = row.checkpoint.sha === expandedSha
                  return (
                    <box key={row.checkpoint.ref} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface} paddingX={1}>
                      <text fg={selected ? accentColor : theme.dim} wrapMode="none">{selected ? '▸ ' : '  '}</text>
                      <text fg={theme.cyan} wrapMode="none">{expanded ? '▾ ' : '▸ '}</text>
                      <text fg={selected ? theme.text : theme.muted} wrapMode="none">
                        {row.checkpoint.label.slice(0, Math.max(innerW - 26, 12)) || '(no message)'}
                      </text>
                      <box flexGrow={1} />
                      {row.checkpoint.provider ? (
                        <text fg={theme.dim} wrapMode="none">{`${row.checkpoint.provider.toUpperCase()}  `}</text>
                      ) : null}
                      <text fg={theme.dim} wrapMode="none">{formatAge(row.checkpoint.createdAt, now)}</text>
                    </box>
                  )
                }
                return (
                  <box key={`${row.sha}:${row.change.path}`} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface} paddingX={1}>
                    <text fg={selected ? accentColor : theme.dim} wrapMode="none">{selected ? '▸ ' : '  '}</text>
                    <text fg={theme.dim} wrapMode="none">{'    '}</text>
                    <text fg={statusColor(row.change.status, theme)} wrapMode="none">{`${row.change.status} `}</text>
                    <text fg={selected ? theme.text : theme.muted} wrapMode="none">
                      {row.change.path.slice(-Math.max(innerW - 12, 12))}
                    </text>
                  </box>
                )
              })
            )
          ) : reviewRows.length === 0 ? (
            <box paddingTop={1}>
              <text fg={theme.dim} wrapMode="word" width={innerW}>
                Working tree is clean — nothing to review. Changes made by agent turns
                (or a merged worktree task) show up here as rejectable hunks.
              </text>
            </box>
          ) : (
            reviewRows.map((row, index) => {
              const selected = index === clampedCursor
              if (row.kind === 'untracked') {
                return (
                  <box key={`untracked:${row.path}`} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface} paddingX={1}>
                    <text fg={selected ? accentColor : theme.dim} wrapMode="none">{selected ? '▸ ' : '  '}</text>
                    <text fg={theme.green} wrapMode="none">{'A '}</text>
                    <text fg={selected ? theme.text : theme.muted} wrapMode="none">{row.path.slice(0, innerW - 14)}</text>
                    <box flexGrow={1} />
                    <text fg={theme.dim} wrapMode="none">untracked</text>
                  </box>
                )
              }
              return (
                <box key={`hunk:${index}:${row.hunk.file}:${row.hunk.header}`} flexDirection="column" backgroundColor={selected ? theme.surface3 : theme.surface} paddingX={1}>
                  <box flexDirection="row">
                    <text fg={selected ? accentColor : theme.dim} wrapMode="none">{selected ? '▸ ' : '  '}</text>
                    <text fg={selected ? theme.text : theme.muted} wrapMode="none">{row.hunk.file.slice(0, Math.max(innerW - 24, 12))}</text>
                    <box flexGrow={1} />
                    <text fg={theme.cyan} wrapMode="none">{row.hunk.header.split(' @@')[0]?.slice(0, 20) ?? ''}{' @@'}</text>
                  </box>
                  {selected
                    ? row.hunk.lines.slice(1, 13).map((line, lineIndex) => (
                      <text
                        key={lineIndex}
                        fg={line.startsWith('+') ? theme.green : line.startsWith('-') ? theme.red : theme.dim}
                        wrapMode="none"
                      >
                        {`      ${line}`.slice(0, innerW) || ' '}
                      </text>
                    ))
                    : null}
                </box>
              )
            })
          )}
        </box>
      </scrollbox>

      <box height={footerH} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        {commitMode ? (
          <box flexDirection="row" alignItems="center" flexGrow={1}>
            <text fg={theme.dim} wrapMode="none">{'commit: '}</text>
            <box flexGrow={1} backgroundColor={theme.surface3}>
              <input
                focused
                value={commitDraft}
                maxLength={120}
                onInput={(value: string) => setCommitDraft(value)}
                onSubmit={() => { void submitCommit() }}
              />
            </box>
          </box>
        ) : (
          <text fg={pendingLabel ? theme.amber : theme.dim} wrapMode="none">
            {(busy ? 'Working… ' : '') + (pendingLabel ?? footerHint)}
          </text>
        )}
      </box>
    </box>
  )
}
