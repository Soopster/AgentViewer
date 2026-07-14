/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TextAttributes } from '@opentui/core'
import type { MouseEvent, ScrollBoxRenderable, TextareaAction, TextareaRenderable } from '@opentui/core'
import type { SelectedLineRange } from '@pierre/diffs'
import type { TuiThemePalette } from '../theme'
import {
  fetchPullRequestWorkspace,
  mutatePullRequest,
  type PullRequestComment,
  type PullRequestFile,
  type PullRequestWorkspace,
} from '../../lib/githubPr'
import { buildDiffCommentComposerPrompt } from '../../lib/diffCommentComposer'
import { flattenHastLine, loadDiffHighlights, type TuiFileHighlights, type TuiRenderSpan } from './pierreDiffView'
import { createScrollVelocityState, velocityScrollStep } from './scrollVelocity'

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string; eventType?: string; repeated?: boolean }
type ComposerKeyBinding = { name: string; action: TextareaAction; shift?: boolean; meta?: boolean; ctrl?: boolean }

const PR_COMPOSER_KEY_BINDINGS: ComposerKeyBinding[] = [
  { name: 'return', action: 'submit' },
  { name: 'kpenter', action: 'submit' },
  { name: 'return', shift: true, action: 'newline' },
  { name: 'return', meta: true, action: 'newline' },
  { name: 'j', ctrl: true, action: 'newline' },
  { name: 'linefeed', action: 'newline' },
]

type Props = {
  cwd?: string | null
  theme: TuiThemePalette
  width: number
  height: number
  onClose: () => void
  onKeyHandlerReady: (handler: (key: Key) => boolean) => void
  onAskAgent: (prompt: string) => void
  onSendDiffNoteToComposer?: (prompt: string) => void
}

// ---------------------------------------------------------------------------
// Diff line model
// ---------------------------------------------------------------------------

type DiffLineKind = 'file' | 'hunk' | 'add' | 'del' | 'ctx' | 'meta' | 'comment'
type CommentCardPart = 'header' | 'body' | 'footer'

type DiffLine = {
  kind: DiffLineKind
  text: string
  fileIndex: number
  oldNo?: number
  newNo?: number
  // Indexes into FileDiffMetadata.additionLines / deletionLines for syntax spans.
  addIdx?: number
  delIdx?: number
  commentId?: string
  commentPart?: CommentCardPart
}

type DiffLayout = 'stack' | 'split'
type DiffMode = 'viewer' | 'plain'

type ReviewDiffRow = {
  key: string
  fileIndex: number
  line?: DiffLine
  left?: DiffLine
  right?: DiffLine
  hunkBoundary?: boolean
}

type DiffSelectionPoint = {
  fileIndex: number
  lineNumber: number
  side: NonNullable<SelectedLineRange['side']>
}

type DiffSelectionSpan = {
  startIndex: number
  endIndex: number
  selection: SelectedLineRange
  key: string
  label: string
  fileIndex: number
}

type DiffNote = {
  path: string
  range: SelectedLineRange
  text: string
}

const STATUS_LETTER: Record<string, string> = {
  added: 'A', removed: 'D', modified: 'M', renamed: 'R', copied: 'C', changed: 'M',
}

function statusColor(theme: TuiThemePalette, status: string): string {
  if (status === 'added') return theme.green
  if (status === 'removed') return theme.red
  if (status === 'renamed' || status === 'copied') return theme.violet
  return theme.cyan
}

function questionPrompt(workspace: PullRequestWorkspace, question: string): string {
  const pr = workspace.selected
  if (!pr) return question
  const files = pr.files.map((file) => `${file.filename} (+${file.additions} -${file.deletions})`).join('\n')
  return `Review GitHub PR #${pr.number}: ${pr.title}\n${pr.url}\nBase: ${pr.baseRefName} <- ${pr.headRefName}\n\nChanged files:\n${files}\n\nQuestion: ${question}`
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    if (raw.length <= width) { lines.push(raw); continue }
    let rest = raw
    while (rest.length > width) {
      let cut = rest.lastIndexOf(' ', width)
      if (cut <= 0) cut = width
      lines.push(rest.slice(0, cut))
      rest = rest.slice(cut).trimStart()
    }
    lines.push(rest)
  }
  return lines
}

function fitText(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return '…'
  return `${text.slice(0, width - 1)}…`
}

function diffSelectionKey(path: string, selection: SelectedLineRange): string {
  return [path, selection.start, selection.side ?? '', selection.end, selection.endSide ?? ''].join('\u0000')
}

function diffSelectionLineLabel(selection: SelectedLineRange): string {
  const start = `L${selection.start}${selection.side === 'deletions' ? ' (old)' : ''}`
  const end = `L${selection.end}${selection.endSide === 'deletions' ? ' (old)' : ''}`
  return selection.start === selection.end && selection.side === selection.endSide ? start : `${start} → ${end}`
}

function reviewRowSelectionPoint(row: ReviewDiffRow): DiffSelectionPoint | null {
  const right = row.right ?? row.line
  if (right?.newNo != null) return { fileIndex: row.fileIndex, lineNumber: right.newNo, side: 'additions' }
  const left = row.left ?? row.line
  if (left?.oldNo != null) return { fileIndex: row.fileIndex, lineNumber: left.oldNo, side: 'deletions' }
  return null
}

function reviewRowSelectionPoints(row: ReviewDiffRow): DiffSelectionPoint[] {
  const points: DiffSelectionPoint[] = []
  const left = row.left ?? row.line
  const right = row.right ?? row.line
  if (left?.oldNo != null) points.push({ fileIndex: row.fileIndex, lineNumber: left.oldNo, side: 'deletions' })
  if (right?.newNo != null) points.push({ fileIndex: row.fileIndex, lineNumber: right.newNo, side: 'additions' })
  return points
}

function diffSelectionSpanFromRowRange(
  files: PullRequestFile[],
  rows: ReviewDiffRow[],
  startIndex: number,
  endIndex: number,
): DiffSelectionSpan | null {
  if (rows.length === 0) return null
  const lo = clampNumber(Math.min(startIndex, endIndex), 0, rows.length - 1)
  const hi = clampNumber(Math.max(startIndex, endIndex), 0, rows.length - 1)
  let startPoint: DiffSelectionPoint | null = null
  for (let index = lo; index <= hi; index += 1) {
    startPoint = reviewRowSelectionPoint(rows[index]!)
    if (startPoint) break
  }
  let endPoint: DiffSelectionPoint | null = null
  for (let index = hi; index >= lo; index -= 1) {
    endPoint = reviewRowSelectionPoint(rows[index]!)
    if (endPoint) break
  }
  if (!startPoint || !endPoint || startPoint.fileIndex !== endPoint.fileIndex) return null
  const path = files[startPoint.fileIndex]?.filename
  if (!path) return null
  const selection: SelectedLineRange = {
    start: startPoint.lineNumber,
    side: startPoint.side,
    end: endPoint.lineNumber,
    endSide: endPoint.side,
  }
  return {
    startIndex: lo,
    endIndex: hi,
    selection,
    key: diffSelectionKey(path, selection),
    label: diffSelectionLineLabel(selection),
    fileIndex: startPoint.fileIndex,
  }
}

function diffSelectionSpanFromSelection(
  path: string,
  files: PullRequestFile[],
  rows: ReviewDiffRow[],
  selection: SelectedLineRange,
): DiffSelectionSpan | null {
  const fileIndex = files.findIndex((file) => file.filename === path)
  if (fileIndex < 0) return null
  let startIndex = -1
  let endIndex = -1
  for (let index = 0; index < rows.length; index += 1) {
    const points = reviewRowSelectionPoints(rows[index]!).filter((point) => point.fileIndex === fileIndex)
    if (startIndex < 0 && points.some((point) => point.lineNumber === selection.start && point.side === selection.side)) startIndex = index
    if (points.some((point) => point.lineNumber === selection.end && point.side === selection.endSide)) endIndex = index
  }
  if (startIndex < 0 || endIndex < startIndex) return null
  return {
    startIndex,
    endIndex,
    selection,
    key: diffSelectionKey(path, selection),
    label: diffSelectionLineLabel(selection),
    fileIndex,
  }
}

function buildReviewDiffRows(lines: DiffLine[], layout: DiffLayout, showHunkHeaders: boolean): ReviewDiffRow[] {
  const unfiltered: ReviewDiffRow[] = []
  if (layout === 'stack') {
    lines.forEach((line, index) => unfiltered.push({ key: `stack:${index}`, fileIndex: line.fileIndex, line }))
  } else {
    let index = 0
    while (index < lines.length) {
      const line = lines[index]!
      if (line.kind === 'del') {
        const deletions: DiffLine[] = []
        const additions: DiffLine[] = []
        while (lines[index]?.kind === 'del' && lines[index]?.fileIndex === line.fileIndex) deletions.push(lines[index++]!)
        while (lines[index]?.kind === 'add' && lines[index]?.fileIndex === line.fileIndex) additions.push(lines[index++]!)
        const count = Math.max(deletions.length, additions.length)
        for (let pair = 0; pair < count; pair += 1) {
          unfiltered.push({
            key: `split:${index - count}:${pair}`,
            fileIndex: line.fileIndex,
            left: deletions[pair],
            right: additions[pair],
          })
        }
        continue
      }
      if (line.kind === 'add') {
        while (lines[index]?.kind === 'add' && lines[index]?.fileIndex === line.fileIndex) {
          unfiltered.push({ key: `split:add:${index}`, fileIndex: line.fileIndex, right: lines[index] })
          index += 1
        }
        continue
      }
      if (line.kind === 'ctx') {
        unfiltered.push({ key: `split:ctx:${index}`, fileIndex: line.fileIndex, left: line, right: line })
      } else {
        unfiltered.push({ key: `split:single:${index}`, fileIndex: line.fileIndex, line })
      }
      index += 1
    }
  }
  if (showHunkHeaders) return unfiltered
  const visible: ReviewDiffRow[] = []
  let hunkBoundary = false
  for (const row of unfiltered) {
    if (row.line?.kind === 'hunk') {
      hunkBoundary = true
      continue
    }
    visible.push(hunkBoundary ? { ...row, hunkBoundary: true } : row)
    hunkBoundary = false
  }
  return visible
}

// Render syntax-highlighted spans clipped to maxWidth terminal columns.
function renderDiffSpans(spans: TuiRenderSpan[], defaultFg: string, maxWidth: number) {
  const elements = []
  let remaining = maxWidth
  for (let i = 0; i < spans.length; i++) {
    if (remaining <= 0) break
    const span = spans[i]!
    const text = span.text.length <= remaining ? span.text : `${span.text.slice(0, remaining - 1)}…`
    remaining -= text.length
    elements.push(<span key={i} fg={span.fg ?? defaultFg}>{text}</span>)
  }
  return elements
}

// GitHub per-file patches lack the `diff --git` header parsePatchFiles expects.
function filePatchText(file: PullRequestFile): string {
  const oldPath = file.previousFilename ?? file.filename
  const oldSide = file.status === 'added' ? '/dev/null' : `a/${oldPath}`
  const newSide = file.status === 'removed' ? '/dev/null' : `b/${file.filename}`
  return `diff --git a/${oldPath} b/${file.filename}\n--- ${oldSide}\n+++ ${newSide}\n${file.patch}`
}

// Inline review comments keyed by "<side>:<line>" so they can be woven into
// the diff right below the line they anchor to, diffshub-style.
function commentAnchors(comments: PullRequestComment[], path: string): Map<string, PullRequestComment[]> {
  const anchors = new Map<string, PullRequestComment[]>()
  for (const comment of comments) {
    const line = comment.line ?? comment.originalLine
    const side = comment.side ?? comment.originalSide
    if (comment.path !== path || line == null) continue
    const key = `${side === 'LEFT' ? 'L' : 'R'}:${line}`
    const list = anchors.get(key) ?? []
    list.push(comment)
    anchors.set(key, list)
  }
  return anchors
}

function buildDiffLines(
  files: PullRequestFile[],
  comments: PullRequestComment[],
  collapsed: ReadonlySet<number>,
  commentWidth: number,
): { lines: DiffLine[]; fileStarts: number[]; maxLineNo: number } {
  const lines: DiffLine[] = []
  const fileStarts: number[] = []
  let maxLineNo = 1

  const emittedCommentIds = new Set<string>()
  const pushComments = (anchored: PullRequestComment[] | undefined, fileIndex: number, fallback = false) => {
    for (const comment of anchored ?? []) {
      if (emittedCommentIds.has(comment.id)) continue
      emittedCommentIds.add(comment.id)
      const anchorLine = comment.line ?? comment.originalLine
      const side = (comment.side ?? comment.originalSide) === 'LEFT' ? 'old' : 'new'
      const location = anchorLine != null
        ? `${fallback && comment.line == null ? 'outdated · ' : ''}${side} L${anchorLine}`
        : fallback ? 'outside patch' : side
      lines.push({
        kind: 'comment', commentPart: 'header',
        text: `Review comment — ${comment.author} · ${location}`,
        fileIndex, commentId: comment.id,
      })
      const wrapped = wrapText(comment.body.trim() || '(empty comment)', Math.max(commentWidth - 4, 20))
      for (const text of wrapped) lines.push({ kind: 'comment', commentPart: 'body', text, fileIndex })
      lines.push({ kind: 'comment', commentPart: 'footer', text: '', fileIndex })
    }
  }

  files.forEach((file, fileIndex) => {
    fileStarts.push(lines.length)
    const letter = STATUS_LETTER[file.status] ?? 'M'
    const isCollapsed = collapsed.has(fileIndex)
    const chevron = isCollapsed ? '▸' : '▾'
    const commentCount = comments.filter((comment) => comment.path === file.filename).length
    lines.push({
      kind: 'file', fileIndex,
      text: `${chevron} ${letter} ${file.filename}${file.previousFilename ? ` (was ${file.previousFilename})` : ''}  +${file.additions} -${file.deletions}${commentCount ? `  ● ${commentCount}` : ''}`,
    })
    if (isCollapsed) return
    const fileComments = comments.filter((comment) => comment.path === file.filename)
    if (!file.patch) {
      lines.push({ kind: 'meta', text: '  (no textual diff — binary or too large)', fileIndex })
      pushComments(fileComments, fileIndex, true)
      return
    }
    const anchors = commentAnchors(comments, file.filename)
    let oldNo = 0
    let newNo = 0
    // Running indexes into parsePatchFiles' additionLines/deletionLines arrays:
    // additions+context land in additionLines, deletions+context in deletionLines.
    let addSide = 0
    let delSide = 0
    for (const raw of file.patch.split('\n')) {
      if (raw.startsWith('@@')) {
        const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
        if (match) { oldNo = Number(match[1]) - 1; newNo = Number(match[2]) - 1 }
        lines.push({ kind: 'hunk', text: raw, fileIndex })
      } else if (raw.startsWith('+')) {
        newNo += 1
        lines.push({ kind: 'add', text: raw.slice(1), fileIndex, newNo, addIdx: addSide })
        addSide += 1
        pushComments(anchors.get(`R:${newNo}`), fileIndex)
      } else if (raw.startsWith('-')) {
        oldNo += 1
        lines.push({ kind: 'del', text: raw.slice(1), fileIndex, oldNo, delIdx: delSide })
        delSide += 1
        pushComments(anchors.get(`L:${oldNo}`), fileIndex)
      } else if (raw.startsWith('\\')) {
        lines.push({ kind: 'meta', text: raw, fileIndex })
      } else {
        oldNo += 1; newNo += 1
        lines.push({ kind: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw, fileIndex, oldNo, newNo, addIdx: addSide, delIdx: delSide })
        addSide += 1
        delSide += 1
        pushComments(anchors.get(`R:${newNo}`), fileIndex)
      }
      if (oldNo > maxLineNo) maxLineNo = oldNo
      if (newNo > maxLineNo) maxLineNo = newNo
    }
    const unmatched = fileComments.filter((comment) => !emittedCommentIds.has(comment.id))
    if (unmatched.length > 0) {
      lines.push({ kind: 'meta', text: '  Review comments outside the visible patch', fileIndex })
      pushComments(unmatched, fileIndex, true)
    }
  })
  return { lines, fileStarts, maxLineNo }
}

// ---------------------------------------------------------------------------
// File tree
// ---------------------------------------------------------------------------

type TreeRow =
  | { kind: 'dir'; label: string; depth: number; path: string; expanded: boolean }
  | { kind: 'file'; label: string; depth: number; fileIndex: number; file: PullRequestFile }

function buildTreeRows(files: PullRequestFile[], collapsedDirs: ReadonlySet<string>): TreeRow[] {
  type DirNode = { dirs: Map<string, DirNode>; files: Array<{ name: string; fileIndex: number; file: PullRequestFile }> }
  const root: DirNode = { dirs: new Map(), files: [] }
  files.forEach((file, fileIndex) => {
    const parts = file.filename.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part)
      if (!next) { next = { dirs: new Map(), files: [] }; node.dirs.set(part, next) }
      node = next
    }
    node.files.push({ name: parts[parts.length - 1], fileIndex, file })
  })
  const rows: TreeRow[] = []
  const walk = (node: DirNode, depth: number, prefix: string) => {
    for (const [name, child] of [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      let label = name
      let path = prefix ? `${prefix}/${name}` : name
      let current = child
      while (current.files.length === 0 && current.dirs.size === 1) {
        const [nextName, nextChild] = [...current.dirs.entries()][0]
        label = `${label}/${nextName}`
        path = `${path}/${nextName}`
        current = nextChild
      }
      const expanded = !collapsedDirs.has(path)
      rows.push({ kind: 'dir', label, depth, path, expanded })
      if (expanded) walk(current, depth + 1, path)
    }
    for (const leaf of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push({ kind: 'file', label: leaf.name, depth, fileIndex: leaf.fileIndex, file: leaf.file })
    }
  }
  walk(root, 0, '')
  return rows
}

// ---------------------------------------------------------------------------
// Pane definitions
// ---------------------------------------------------------------------------

type PaneId = 1 | 2 | 3 | 4

const PANE_TITLES: Record<PaneId, string> = {
  1: 'Overview',
  2: 'Files',
  3: 'Discussion',
  4: 'Pull requests',
}

type FocusSide = 'left' | 'right'
type LeftPaneMode = 'normal' | 'expanded' | 'hidden'
type ComposerMode = 'comment' | 'approve' | 'request' | 'question' | 'inline' | 'note'

const LEFT_PANE_MIN_WIDTH = 24
const LEFT_PANE_DEFAULT_MAX_WIDTH = 40
const LEFT_PANE_RIGHT_MIN_WIDTH = 44
const LEFT_PANE_EXPANDED_RATIO = 0.5
const LEFT_PANE_RESIZE_STEP = 4

type DiscussionEntry = { id: string; label: string; comment?: PullRequestComment }

function firstLine(text: string): string {
  return text.split('\n', 1)[0]?.trim() ?? ''
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

// ---------------------------------------------------------------------------
// PullRequestPopover component
// ---------------------------------------------------------------------------

export function PullRequestPopover({
  cwd,
  theme,
  width,
  height,
  onClose,
  onKeyHandlerReady,
  onAskAgent,
  onSendDiffNoteToComposer,
}: Props) {
  const repoCwd = cwd || process.cwd()
  const [workspace, setWorkspace] = useState<PullRequestWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pane, setPane] = useState<PaneId>(2)
  const [focusSide, setFocusSide] = useState<FocusSide>('right')
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>('normal')
  const [leftPaneWidth, setLeftPaneWidth] = useState(LEFT_PANE_DEFAULT_MAX_WIDTH)
  const [diffMode, setDiffMode] = useState<DiffMode>('viewer')
  const [diffLayout, setDiffLayout] = useState<DiffLayout>('stack')
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [showHunkHeaders, setShowHunkHeaders] = useState(true)
  const [diffCursor, setDiffCursor] = useState(0)
  const [diffSelectionAnchor, setDiffSelectionAnchor] = useState<number | null>(null)
  const [diffNotes, setDiffNotes] = useState<Map<string, DiffNote>>(() => new Map())
  const [scrollTop, setScrollTop] = useState(0)
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set())
  const [treeCursor, setTreeCursor] = useState(0)
  const [discussionCursor, setDiscussionCursor] = useState(0)
  const [prCursor, setPrCursor] = useState(0)
  const [composer, setComposer] = useState<
    | { mode: Exclude<ComposerMode, 'inline' | 'note'> }
    | {
        mode: 'inline' | 'note'
        path: string
        range: SelectedLineRange
        rowIndex: number
        rowKey: string
        text: string
      }
    | null
  >(null)
  const [highlights, setHighlights] = useState<{ fileIndex: number; data: TuiFileHighlights } | null>(null)
  const editorRef = useRef<TextareaRenderable | null>(null)
  const treeRef = useRef<ScrollBoxRenderable>(null)
  const discussionRef = useRef<ScrollBoxRenderable>(null)
  const prListRef = useRef<ScrollBoxRenderable>(null)
  const pendingCommentJumpRef = useRef<string | null>(null)
  const selectedPrNumberRef = useRef<number | null>(null)
  const scrollVelocityRef = useRef(createScrollVelocityState())

  const load = useCallback(async (number?: number) => {
    setLoading(true); setError(null)
    try {
      setWorkspace(await fetchPullRequestWorkspace(repoCwd, number))
      setScrollTop(0); setDiffCursor(0); setCollapsed(new Set()); setHighlights(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }, [repoCwd])
  useEffect(() => { void load() }, [load])

  const pr = workspace?.selected ?? null
  const pullRequests = workspace?.pullRequests ?? []

  useEffect(() => {
    const nextNumber = pr?.number ?? null
    if (selectedPrNumberRef.current !== null && nextNumber !== null && selectedPrNumberRef.current !== nextNumber) {
      setDiffNotes(new Map())
      setDiffSelectionAnchor(null)
      setComposer(null)
    }
    selectedPrNumberRef.current = nextNumber
  }, [pr?.number])

  // ── Dimensions (mirrors GitPopover) ──────────────────────────────────────
  const popW = Math.max(width - 4, 60)
  const popH = Math.max(height - 4, 16)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const defaultLeftW = Math.min(LEFT_PANE_DEFAULT_MAX_WIDTH, Math.floor(popW * 0.28))
  const minLeftW = Math.min(LEFT_PANE_MIN_WIDTH, Math.max(defaultLeftW, popW - LEFT_PANE_RIGHT_MIN_WIDTH - 4))
  const maxLeftW = Math.max(defaultLeftW, Math.min(Math.floor(popW * LEFT_PANE_EXPANDED_RATIO), popW - LEFT_PANE_RIGHT_MIN_WIDTH - 4))
  const leftPaneHidden = leftPaneMode === 'hidden'
  const leftW = leftPaneHidden ? 0 : Math.max(minLeftW, Math.min(leftPaneWidth, maxLeftW))
  const dividerW = leftPaneHidden ? 0 : 1
  const rightW = Math.max(LEFT_PANE_RIGHT_MIN_WIDTH, popW - leftW - dividerW - 2)
  const innerH = popH - 2
  const bodyH = innerH - 1        // bottom action bar
  const diffRows = Math.max(bodyH - 1, 4)  // top hint bar
  const gutterDigits = 4

  const { lines, maxLineNo } = useMemo(
    () => buildDiffLines(pr?.files ?? [], pr?.comments ?? [], collapsed, rightW - gutterDigits * 2 - 8),
    [collapsed, pr, rightW],
  )
  const effectiveDiffLayout = diffMode === 'plain' ? 'stack' : diffLayout
  const reviewRows = useMemo(
    () => buildReviewDiffRows(lines, effectiveDiffLayout, diffMode === 'plain' ? true : showHunkHeaders),
    [diffMode, effectiveDiffLayout, lines, showHunkHeaders],
  )
  const lineNoWidth = Math.max(String(maxLineNo).length, 3)
  const gutterCols = showLineNumbers ? lineNoWidth * 2 + 2 : 0
  const diffTextWidth = Math.max(rightW - gutterCols - 4, 12)
  const splitHalfW = Math.floor((rightW - 1) / 2)
  const splitRightW = rightW - splitHalfW - 1
  const splitGutterCols = showLineNumbers ? lineNoWidth + 1 : 0
  const splitTextW = Math.max(splitHalfW - splitGutterCols - 3, 6)
  const splitRightTextW = Math.max(splitRightW - splitGutterCols - 3, 6)

  const treeRows = useMemo(() => buildTreeRows(pr?.files ?? [], collapsedDirs), [collapsedDirs, pr])

  const inlineComposerRows = composer?.mode === 'inline' || composer?.mode === 'note' ? 7 : 0
  const visibleDiffRows = Math.max(diffRows - inlineComposerRows, 1)
  const maxScroll = Math.max(reviewRows.length - visibleDiffRows, 0)
  const clampedTop = Math.min(scrollTop, maxScroll)
  const clampedCursor = reviewRows.length > 0 ? clampNumber(diffCursor, 0, reviewRows.length - 1) : 0

  // The file the diff cursor sits in (drives tree highlight, fold, highlights).
  const currentFileIndex = reviewRows[clampedCursor]?.fileIndex ?? 0

  // The file covering the top visible row (drives the sticky header).
  const topFileIndex = reviewRows[clampedTop]?.fileIndex ?? 0

  // Keep the files tree centred on the diff cursor's file while browsing the diff.
  useEffect(() => {
    if (focusSide !== 'right') return
    const row = treeRows.findIndex((entry) => entry.kind === 'file' && entry.fileIndex === currentFileIndex)
    if (row >= 0) {
      setTreeCursor(row)
      treeRef.current?.scrollTo(Math.max(row - 4, 0))
    }
  }, [currentFileIndex, focusSide, treeRows])

  useEffect(() => { treeRef.current?.scrollTo(Math.max(treeCursor - 4, 0)) }, [treeCursor])
  useEffect(() => { discussionRef.current?.scrollTo(Math.max(discussionCursor - 2, 0)) }, [discussionCursor])
  useEffect(() => { prListRef.current?.scrollTo(Math.max(prCursor - 2, 0)) }, [prCursor])

  const stats = useMemo(() => {
    if (!pr) return null
    const byStatus = new Map<string, number>()
    for (const file of pr.files) byStatus.set(file.status, (byStatus.get(file.status) ?? 0) + 1)
    return [...byStatus.entries()].map(([status, count]) => `${STATUS_LETTER[status] ?? 'M'}:${count}`).join(' ')
  }, [pr])

  const discussionEntries = useMemo((): DiscussionEntry[] => pr ? [
    ...pr.reviews.map((item) => ({
      id: `review-${item.id}`,
      label: `${item.author} [${item.state.toLowerCase().replaceAll('_', ' ')}] ${firstLine(item.body) || ''}`,
    })),
    ...pr.comments.map((item) => ({
      id: `comment-${item.id}`,
      comment: item,
      label: item.path
        ? `● ${item.author} ${item.path}:${item.line ?? item.originalLine ?? ''} ${firstLine(item.body)}`
        : `${item.author}: ${firstLine(item.body)}`,
    })),
  ] : [], [pr])

  // ── Syntax highlights for the file under the cursor (lazy, debounced) ────
  const pierreAppearance: 'dark' | 'light' = useMemo(() => {
    const hex = theme.bg.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? 'light' : 'dark'
  }, [theme.bg])

  useEffect(() => {
    const file = pr?.files[currentFileIndex]
    if (!file?.patch) { setHighlights(null); return }
    let cancelled = false
    const timer = setTimeout(() => {
      void loadDiffHighlights(filePatchText(file), `pr:${pr!.number}:${file.filename}`, pierreAppearance).then((map) => {
        if (cancelled) return
        const data = [...map.values()][0]
        setHighlights(data ? { fileIndex: currentFileIndex, data } : null)
      })
    }, 160)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [currentFileIndex, pierreAppearance, pr])

  // ── Cursor / scroll movement ──────────────────────────────────────────────
  const moveCursorTo = useCallback((index: number, center = false) => {
    const target = clampNumber(index, 0, Math.max(reviewRows.length - 1, 0))
    setDiffCursor(target)
    setScrollTop((top) => {
      if (center) return clampNumber(target - 3, 0, maxScroll)
      if (target < top) return target
      if (target >= top + diffRows) return target - diffRows + 1
      return top
    })
  }, [diffRows, maxScroll, reviewRows.length])

  const jumpToFile = useCallback((fileIndex: number) => {
    const targetFileIndex = clampNumber(fileIndex, 0, Math.max((pr?.files.length ?? 1) - 1, 0))
    const target = reviewRows.findIndex((row) => row.fileIndex === targetFileIndex)
    if (target >= 0) {
      setDiffSelectionAnchor(null)
      moveCursorTo(target)
      setScrollTop(clampNumber(target, 0, maxScroll))
    }
  }, [maxScroll, moveCursorTo, pr?.files.length, reviewRows])

  const jumpToComment = useCallback((comment: PullRequestComment) => {
    if (!comment.path || (comment.line ?? comment.originalLine) == null) return
    const fileIndex = (pr?.files ?? []).findIndex((file) => file.filename === comment.path)
    if (fileIndex < 0) return
    setPane(2)
    setFocusSide('right')
    const treeRow = treeRows.findIndex((row) => row.kind === 'file' && row.fileIndex === fileIndex)
    if (treeRow >= 0) setTreeCursor(treeRow)
    const target = reviewRows.findIndex((row) => row.line?.commentId === comment.id)
    if (target >= 0) { moveCursorTo(target, true); return }
    // Anchor lives in a collapsed file — expand it and finish once lines rebuild.
    pendingCommentJumpRef.current = comment.id
    setCollapsed((prev) => { const next = new Set(prev); next.delete(fileIndex); return next })
  }, [moveCursorTo, pr, reviewRows, treeRows])

  useEffect(() => {
    const id = pendingCommentJumpRef.current
    if (!id) return
    const target = reviewRows.findIndex((row) => row.line?.commentId === id)
    if (target >= 0) { pendingCommentJumpRef.current = null; moveCursorTo(target, true) }
  }, [moveCursorTo, reviewRows])

  const toggleFold = useCallback(() => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(currentFileIndex)) next.delete(currentFileIndex)
      else next.add(currentFileIndex)
      return next
    })
    const target = reviewRows.findIndex((row) => row.fileIndex === currentFileIndex)
    if (target >= 0) { setDiffCursor(target); setScrollTop(clampNumber(target, 0, maxScroll)) }
  }, [currentFileIndex, maxScroll, reviewRows])

  const jumpToHunk = useCallback((direction: 1 | -1) => {
    if (reviewRows.length === 0) return
    const isHunkTarget = (row: ReviewDiffRow) => row.line?.kind === 'hunk' || row.hunkBoundary === true
    if (direction > 0) {
      for (let index = clampedCursor + 1; index < reviewRows.length; index += 1) {
        if (isHunkTarget(reviewRows[index]!)) { setDiffSelectionAnchor(null); moveCursorTo(index); return }
      }
      for (let index = 0; index <= clampedCursor; index += 1) {
        if (isHunkTarget(reviewRows[index]!)) { setDiffSelectionAnchor(null); moveCursorTo(index); return }
      }
    } else {
      for (let index = clampedCursor - 1; index >= 0; index -= 1) {
        if (isHunkTarget(reviewRows[index]!)) { setDiffSelectionAnchor(null); moveCursorTo(index); return }
      }
      for (let index = reviewRows.length - 1; index >= clampedCursor; index -= 1) {
        if (isHunkTarget(reviewRows[index]!)) { setDiffSelectionAnchor(null); moveCursorTo(index); return }
      }
    }
  }, [clampedCursor, moveCursorTo, reviewRows])

  const selectedDiffSpan = useMemo(
    () => diffSelectionSpanFromRowRange(
      pr?.files ?? [],
      reviewRows,
      diffSelectionAnchor ?? clampedCursor,
      clampedCursor,
    ),
    [clampedCursor, diffSelectionAnchor, pr?.files, reviewRows],
  )

  const openRangeComposer = useCallback((mode: 'inline' | 'note') => {
    if (!selectedDiffSpan || !pr) return
    const path = pr.files[selectedDiffSpan.fileIndex]?.filename
    if (!path) return
    setComposer({
      mode,
      path,
      range: selectedDiffSpan.selection,
      rowIndex: selectedDiffSpan.endIndex,
      rowKey: selectedDiffSpan.key,
      text: mode === 'note' ? diffNotes.get(selectedDiffSpan.key)?.text ?? '' : '',
    })
    const nextVisibleRows = Math.max(diffRows - 7, 1)
    const nextMaxScroll = Math.max(reviewRows.length - nextVisibleRows, 0)
    setScrollTop(clampNumber(selectedDiffSpan.endIndex - Math.max(nextVisibleRows - 2, 0), 0, nextMaxScroll))
  }, [diffNotes, diffRows, pr, reviewRows.length, selectedDiffSpan])

  const submitComposer = useCallback(async () => {
    if (!composer) return
    const body = (composer.mode === 'inline' || composer.mode === 'note'
      ? editorRef.current?.plainText ?? composer.text
      : editorRef.current?.plainText ?? '').trim()
    if (composer.mode === 'question') {
      if (!body || !workspace) return
      onAskAgent(questionPrompt(workspace, body))
      setComposer(null)
      onClose()
      return
    }
    if (composer.mode === 'note') {
      setDiffNotes((prev) => {
        const next = new Map(prev)
        if (body) next.set(composer.rowKey, { path: composer.path, range: composer.range, text: body })
        else next.delete(composer.rowKey)
        return next
      })
      setComposer(null)
      return
    }
    if (!workspace?.repo || !pr) return
    if (!body && composer.mode !== 'approve') return
    setLoading(true); setError(null)
    try {
      if (composer.mode === 'inline') {
        const endSide = composer.range.endSide ?? composer.range.side
        const startSide = composer.range.side ?? endSide
        if (!endSide || !startSide) return
        await mutatePullRequest(repoCwd, workspace.repo, {
          action: 'inline-comment', number: pr.number, body,
          commitId: pr.headRefOid,
          path: composer.path,
          line: composer.range.end,
          side: endSide === 'deletions' ? 'LEFT' : 'RIGHT',
          ...(composer.range.start !== composer.range.end
            ? { startLine: composer.range.start, startSide: startSide === 'deletions' ? 'LEFT' as const : 'RIGHT' as const }
            : {}),
        })
      } else if (composer.mode === 'comment') {
        await mutatePullRequest(repoCwd, workspace.repo, { action: 'comment', number: pr.number, body })
      } else {
        await mutatePullRequest(repoCwd, workspace.repo, {
          action: 'review', number: pr.number, body,
          verdict: composer.mode === 'approve' ? 'approve' : 'request-changes',
        })
      }
      setComposer(null)
      await load(pr.number)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false) }
  }, [composer, load, onAskAgent, onClose, pr, repoCwd, workspace])

  function clampLeftPaneWidth(nextWidth: number): number {
    return Math.max(minLeftW, Math.min(nextWidth, maxLeftW))
  }

  // ── Key handling ──────────────────────────────────────────────────────────
  const handleKey = useCallback((key: Key) => {
    if (composer !== null) {
      if (key.name === 'escape') setComposer(null)
      return
    }
    if (key.name === 'escape' || key.name === 'q') { onClose(); return }

    if (key.name === 'tab' && key.shift) { if (!leftPaneHidden) setFocusSide('left'); return }
    if (key.name === 'tab') { setFocusSide('right'); return }

    if (key.sequence >= '1' && key.sequence <= '4') {
      setPane(Number(key.sequence) as PaneId)
      if (!leftPaneHidden) setFocusSide('left')
      return
    }

    if (key.sequence === '[' || key.sequence === ']') {
      if (leftPaneHidden) setLeftPaneMode('normal')
      setLeftPaneWidth((current) => {
        const nextWidth = clampLeftPaneWidth(current + (key.sequence === ']' ? LEFT_PANE_RESIZE_STEP : -LEFT_PANE_RESIZE_STEP))
        setLeftPaneMode(nextWidth >= maxLeftW - 1 ? 'expanded' : 'normal')
        return nextWidth
      })
      return
    }
    if (key.sequence === 'w') {
      if (leftPaneHidden) setLeftPaneMode('normal')
      setLeftPaneMode((mode) => (mode === 'expanded' ? 'normal' : 'expanded'))
      setLeftPaneWidth(leftPaneMode === 'expanded' ? defaultLeftW : maxLeftW)
      setFocusSide('left')
      return
    }
    if (key.sequence === '-') {
      if (leftPaneHidden) { setLeftPaneMode('normal'); setFocusSide('left') }
      else { setLeftPaneMode('hidden'); setFocusSide('right') }
      return
    }

    const halfPage = Math.max(Math.floor(diffRows / 2), 1)

    if (key.name === 'j' || key.name === 'down') {
      const step = velocityScrollStep(scrollVelocityRef.current, 1, key, Math.max(1, Math.floor(diffRows / 3)))
      if (focusSide === 'left' && pane === 2) setTreeCursor((cursor) => Math.min(cursor + step, Math.max(treeRows.length - 1, 0)))
      else if (focusSide === 'left' && pane === 3) setDiscussionCursor((cursor) => Math.min(cursor + step, Math.max(discussionEntries.length - 1, 0)))
      else if (focusSide === 'left' && pane === 4) setPrCursor((cursor) => Math.min(cursor + step, Math.max(pullRequests.length - 1, 0)))
      else {
        if (key.shift && pane === 2 && diffMode === 'viewer') setDiffSelectionAnchor((anchor) => anchor ?? clampedCursor)
        else setDiffSelectionAnchor(null)
        moveCursorTo(clampedCursor + step)
      }
      return
    }
    if (key.name === 'k' || key.name === 'up') {
      const step = velocityScrollStep(scrollVelocityRef.current, -1, key, Math.max(1, Math.floor(diffRows / 3)))
      if (focusSide === 'left' && pane === 2) setTreeCursor((cursor) => Math.max(cursor - step, 0))
      else if (focusSide === 'left' && pane === 3) setDiscussionCursor((cursor) => Math.max(cursor - step, 0))
      else if (focusSide === 'left' && pane === 4) setPrCursor((cursor) => Math.max(cursor - step, 0))
      else {
        if (key.shift && pane === 2 && diffMode === 'viewer') setDiffSelectionAnchor((anchor) => anchor ?? clampedCursor)
        else setDiffSelectionAnchor(null)
        moveCursorTo(clampedCursor - step)
      }
      return
    }

    if ((key.name === 'd' && key.ctrl) || key.name === 'pagedown') { moveCursorTo(clampedCursor + halfPage); return }
    if ((key.name === 'u' && key.ctrl) || key.name === 'pageup') { moveCursorTo(clampedCursor - halfPage); return }
    if (key.name === 'g' && key.shift) { setDiffSelectionAnchor(null); moveCursorTo(Math.max(reviewRows.length - 1, 0)); return }
    if (key.name === 'g') { moveCursorTo(0); return }
    if (key.sequence === '{') { jumpToHunk(-1); return }
    if (key.sequence === '}') { jumpToHunk(1); return }

    // Enter: activate the left cursor (jump/toggle/load).
    if (key.name === 'return' || key.name === 'space' || key.sequence === ' ') {
      if (focusSide === 'left' && pane === 2) {
        const row = treeRows[treeCursor]
        if (row?.kind === 'dir') {
          setCollapsedDirs((prev) => {
            const next = new Set(prev)
            if (next.has(row.path)) next.delete(row.path)
            else next.add(row.path)
            return next
          })
        } else if (row?.kind === 'file') {
          jumpToFile(row.fileIndex)
        }
        return
      }
      if (focusSide === 'left' && pane === 3) {
        const entry = discussionEntries[discussionCursor]
        if (entry?.comment) jumpToComment(entry.comment)
        return
      }
      if (focusSide === 'left' && pane === 4) {
        const number = pullRequests[prCursor]?.number
        if (number && number !== pr?.number) void load(number)
        return
      }
      toggleFold()
      return
    }

    // h/l on the files tree: collapse/expand dirs (fold current file on the right).
    if ((key.name === 'h' || key.name === 'left') && focusSide === 'left' && pane === 2) {
      const row = treeRows[treeCursor]
      if (row?.kind === 'dir' && row.expanded) {
        setCollapsedDirs((prev) => new Set(prev).add(row.path))
      }
      return
    }
    if ((key.name === 'l' || key.name === 'right') && focusSide === 'left' && pane === 2) {
      const row = treeRows[treeCursor]
      if (row?.kind === 'dir' && !row.expanded) {
        setCollapsedDirs((prev) => { const next = new Set(prev); next.delete(row.path); return next })
      }
      return
    }

    if (key.sequence === 'z') { toggleFold(); return }
    if (key.sequence === 'v' && pane === 2) {
      setDiffMode((mode) => mode === 'viewer' ? 'plain' : 'viewer')
      setDiffSelectionAnchor(null)
      return
    }
    if (key.sequence === 's' && pane === 2 && diffMode === 'viewer') {
      setDiffLayout((layout) => layout === 'stack' ? 'split' : 'stack')
      setDiffSelectionAnchor(null)
      return
    }
    if (key.sequence === 'n' && pane === 2 && diffMode === 'viewer') {
      setShowLineNumbers((value) => !value)
      setDiffSelectionAnchor(null)
      return
    }
    if (key.sequence === 'm' && pane === 2 && diffMode === 'viewer') {
      setShowHunkHeaders((value) => !value)
      setDiffSelectionAnchor(null)
      return
    }
    if (key.sequence === 'r') { void load(pr?.number); return }

    // PR actions
    if (key.sequence === 'a' && pane === 2 && diffMode === 'viewer' && focusSide === 'right') { openRangeComposer('note'); return }
    if (key.sequence === 'i' && pane === 2 && focusSide === 'right') { openRangeComposer('inline'); return }
    if (key.sequence === 'x' && pane === 2 && diffMode === 'viewer' && focusSide === 'right' && selectedDiffSpan) {
      setDiffNotes((prev) => {
        const next = new Map(prev)
        next.delete(selectedDiffSpan.key)
        return next
      })
      return
    }
    if (key.sequence === 'A' && pane === 2 && diffMode === 'viewer' && focusSide === 'right' && selectedDiffSpan && onSendDiffNoteToComposer) {
      const note = diffNotes.get(selectedDiffSpan.key)
      if (!note) return
      const context = (pr?.files ?? []).map(filePatchText).join('\n')
      onSendDiffNoteToComposer(buildDiffCommentComposerPrompt({
        filePath: note.path,
        range: note.range,
        comment: note.text,
        context,
        source: `PR review ${selectedDiffSpan.label}`,
      }))
      return
    }
    if (key.sequence === 'c') { setComposer({ mode: 'comment' }); return }
    if (key.sequence === 'y') { setComposer({ mode: 'approve' }); return }
    if (key.sequence === 'X' || (key.name === 'x' && key.shift)) { setComposer({ mode: 'request' }); return }
    if (key.sequence === '?' || key.name === '?') { setComposer({ mode: 'question' }); return }
  }, [clampedCursor, composer, defaultLeftW, diffMode, diffNotes, diffRows, discussionCursor, discussionEntries, focusSide,
      jumpToComment, jumpToFile, jumpToHunk, leftPaneHidden, leftPaneMode, load, maxLeftW,
      moveCursorTo, onClose, onSendDiffNoteToComposer, openRangeComposer, pane, pr, prCursor, pullRequests, reviewRows.length,
      selectedDiffSpan, toggleFold, treeCursor, treeRows])
  const dispatchKey = useCallback((key: Key): boolean => {
    const editorOwnsKey = composer !== null && key.name !== 'escape'
    handleKey(key)
    return !editorOwnsKey
  }, [composer, handleKey])
  useEffect(() => { onKeyHandlerReady(dispatchKey) }, [dispatchKey, onKeyHandlerReady])

  useEffect(() => {
    if (leftPaneHidden && focusSide === 'left') setFocusSide('right')
  }, [focusSide, leftPaneHidden])

  // ── Diff row rendering ────────────────────────────────────────────────────
  const lineFg = (line: DiffLine): string => {
    if (line.kind === 'add') return theme.green
    if (line.kind === 'del') return theme.red
    if (line.kind === 'hunk') return theme.cyan
    if (line.kind === 'comment') return theme.violet
    if (line.kind === 'meta') return theme.dim
    return theme.text
  }

  const lineBg = (line: DiffLine): string | undefined => {
    if (line.kind === 'add') return theme.diffAddBg
    if (line.kind === 'del') return theme.diffRemoveBg
    if (line.kind === 'hunk') return theme.diffMetaBg
    if (line.kind === 'comment') return theme.surface2
    return undefined
  }

  const lineSpans = (line: DiffLine): TuiRenderSpan[] | null => {
    if (diffMode === 'plain' || !highlights || highlights.fileIndex !== line.fileIndex) return null
    const node = line.kind === 'del'
      ? (line.delIdx != null ? highlights.data.deletionLines[line.delIdx] : undefined)
      : (line.addIdx != null ? highlights.data.additionLines[line.addIdx] : undefined)
    if (!node) return null
    const spans = flattenHastLine(node, pierreAppearance)
    if (spans.length === 0) return null
    // Guard against index drift between our patch walk and parsePatchFiles'
    // line arrays — never show highlighted text that differs from the diff.
    const joined = spans.map((span) => span.text).join('')
    return joined.trimEnd() === line.text.trimEnd() ? spans : null
  }

  const beginRowSelection = (event: MouseEvent, index: number, dragging = false) => {
    if (event.button !== 0 || (dragging && !event.isDragging && event.type !== 'drag')) return
    event.stopPropagation()
    setFocusSide('right')
    if (!dragging) {
      if (event.modifiers.shift) setDiffSelectionAnchor((anchor) => anchor ?? clampedCursor)
      else setDiffSelectionAnchor(index)
    }
    moveCursorTo(index)
  }

  const renderDiffLine = (line: DiffLine, index: number, sticky = false, selected = false) => {
    const isCursor = !sticky && focusSide === 'right' && index === clampedCursor
    const selectionBg = selected ? theme.surface3 : undefined
    const selectionHandlers = sticky ? {} : {
      onMouseDown: (event: MouseEvent) => beginRowSelection(event, index),
      onMouseDrag: (event: MouseEvent) => beginRowSelection(event, index, true),
      onMouseOver: (event: MouseEvent) => beginRowSelection(event, index, true),
    }
    if (line.kind === 'file') {
      const file = pr?.files[line.fileIndex]
      return (
        <box key={sticky ? 'sticky' : index} width={rightW} flexDirection="row" backgroundColor={sticky || selected ? theme.surface3 : theme.diffMetaBg} {...selectionHandlers}>
          <text fg={isCursor ? theme.cyan : theme.dim} wrapMode="none">{isCursor ? '▶' : '>'}</text>
          <text fg={file ? statusColor(theme, file.status) : theme.cyan} attributes={TextAttributes.BOLD} wrapMode="none">
            {` ${fitText(line.text, rightW - 3)}`}
          </text>
        </box>
      )
    }
    if (line.kind === 'hunk' || line.kind === 'meta') {
      return (
        <box key={index} width={rightW} flexDirection="row" backgroundColor={selectionBg ?? (isCursor ? theme.surface3 : lineBg(line))} {...selectionHandlers}>
          <text fg={isCursor ? theme.cyan : lineFg(line)} wrapMode="none">
            {fitText(`${isCursor ? '▶' : ' '}${line.kind === 'hunk' ? '@' : ' '} ${line.text}`, rightW - 1)}
          </text>
        </box>
      )
    }
    if (line.kind === 'comment') {
      const width = Math.max(rightW, 4)
      const innerWidth = width - 2
      let framed: string
      if (line.commentPart === 'header') {
        const label = fitText(line.text, Math.max(innerWidth - 3, 1))
        framed = `┌─ ${label} ${'─'.repeat(Math.max(innerWidth - label.length - 3, 0))}┐`
      } else if (line.commentPart === 'footer') {
        framed = `└${'─'.repeat(innerWidth)}┘`
      } else {
        const body = fitText(line.text, Math.max(innerWidth - 2, 1))
        framed = `│ ${body.padEnd(Math.max(innerWidth - 1, 1))}│`
      }
      return (
        <box key={index} width={rightW} flexDirection="row" backgroundColor={selectionBg ?? (isCursor ? theme.surface3 : theme.surface2)} {...selectionHandlers}>
          <text fg={line.commentPart === 'body' ? theme.text : theme.violet} wrapMode="none">
            {isCursor ? `▶${framed.slice(1)}` : framed}
          </text>
        </box>
      )
    }
    const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
    const fg = lineFg(line)
    const spans = lineSpans(line)
    return (
      <box key={index} width={rightW} flexDirection="row" backgroundColor={selectionBg ?? (isCursor ? theme.surface3 : lineBg(line))} {...selectionHandlers}>
        {showLineNumbers ? (
          <text fg={theme.dim} wrapMode="none">
            {`${line.oldNo != null ? String(line.oldNo).padStart(lineNoWidth) : ' '.repeat(lineNoWidth)} ${line.newNo != null ? String(line.newNo).padStart(lineNoWidth) : ' '.repeat(lineNoWidth)}`}
          </text>
        ) : null}
        <text fg={isCursor ? theme.cyan : fg} wrapMode="none">{`${isCursor ? '▶' : ' '}${sign} `}</text>
        {spans ? (
          <text wrapMode="none">{renderDiffSpans(spans, fg, diffTextWidth)}</text>
        ) : (
          <text fg={fg} wrapMode="none">{fitText(line.text || ' ', diffTextWidth)}</text>
        )}
      </box>
    )
  }

  const renderSplitSide = (line: DiffLine | undefined, side: 'left' | 'right', width: number, textWidth: number) => {
    if (!line) {
      return <box width={width} backgroundColor={theme.surface2}><text fg={theme.dim}>{' '.repeat(width)}</text></box>
    }
    const fg = lineFg(line)
    const spans = lineSpans(line)
    const lineNumber = side === 'left' ? line.oldNo : line.newNo
    const sign = line.kind === 'del' ? '-' : line.kind === 'add' ? '+' : ' '
    return (
      <box width={width} flexDirection="row" backgroundColor={lineBg(line)}>
        {showLineNumbers ? (
          <text fg={theme.dim} wrapMode="none">{`${lineNumber != null ? String(lineNumber).padStart(lineNoWidth) : ' '.repeat(lineNoWidth)} `}</text>
        ) : null}
        <text fg={fg} wrapMode="none">{` ${sign} `}</text>
        {spans ? (
          <text wrapMode="none">{renderDiffSpans(spans, fg, textWidth)}</text>
        ) : (
          <text fg={fg} wrapMode="none">{fitText(line.text || ' ', textWidth)}</text>
        )}
      </box>
    )
  }

  const notesByEndIndex = useMemo(() => {
    const result = new Map<number, Array<{ key: string; note: DiffNote; span: DiffSelectionSpan }>>()
    for (const [key, note] of diffNotes) {
      const span = diffSelectionSpanFromSelection(note.path, pr?.files ?? [], reviewRows, note.range)
      if (!span) continue
      const entries = result.get(span.endIndex) ?? []
      entries.push({ key, note, span })
      result.set(span.endIndex, entries)
    }
    return result
  }, [diffNotes, pr?.files, reviewRows])

  const renderReviewRow = (row: ReviewDiffRow, index: number, sticky = false) => {
    const selected = !sticky && focusSide === 'right' && selectedDiffSpan !== null
      && index >= selectedDiffSpan.startIndex && index <= selectedDiffSpan.endIndex
    if (row.line) return renderDiffLine(row.line, index, sticky, selected)
    const isCursor = focusSide === 'right' && index === clampedCursor
    return (
      <box
        key={row.key}
        width={rightW}
        flexDirection="row"
        backgroundColor={selected || isCursor ? theme.surface3 : undefined}
        onMouseDown={(event) => beginRowSelection(event, index)}
        onMouseDrag={(event) => beginRowSelection(event, index, true)}
        onMouseOver={(event) => beginRowSelection(event, index, true)}
      >
        {renderSplitSide(row.left, 'left', splitHalfW, splitTextW)}
        <text fg={isCursor ? theme.cyan : theme.border} wrapMode="none">{isCursor ? '▶' : '│'}</text>
        {renderSplitSide(row.right, 'right', splitRightW, splitRightTextW)}
      </box>
    )
  }

  const renderNoteCard = (note: DiffNote, span: DiffSelectionSpan) => (
    <box width={rightW} flexDirection="column" border borderStyle="single" borderColor={theme.violet} paddingX={1}>
      <box flexDirection="row">
        <text fg={theme.violet} wrapMode="none">{fitText(`Note — ${note.path} ${span.label}`, rightW - 24)}</text>
        <box flexGrow={1} />
        {onSendDiffNoteToComposer ? (
          <text fg={theme.green} wrapMode="none" onMouseUp={(event) => {
            if (event.button !== 0) return
            event.stopPropagation()
            onSendDiffNoteToComposer(buildDiffCommentComposerPrompt({
              filePath: note.path,
              range: note.range,
              comment: note.text,
              context: (pr?.files ?? []).map(filePatchText).join('\n'),
              source: `PR review ${span.label}`,
            }))
          }}>A:composer  </text>
        ) : null}
        <text fg={theme.dim} wrapMode="none">x:del</text>
      </box>
      <text fg={theme.text} wrapMode="none">{fitText(note.text, rightW - 4)}</text>
    </box>
  )

  const renderInlineComposer = () => {
    if (composer?.mode !== 'inline' && composer?.mode !== 'note') return null
    const rangeLabel = diffSelectionLineLabel(composer.range)
    return (
      <box
        width={rightW}
        height={7}
        flexDirection="column"
        border
        borderStyle="single"
        borderColor={theme.cyan}
        backgroundColor={theme.surface2}
        title={` ${composer.mode === 'note' ? 'Diff note' : 'Inline review'} — ${composer.path.split('/').at(-1)} ${rangeLabel} `}
        titleColor={theme.cyan}
        paddingX={1}
      >
        <textarea
          key={`${composer.mode}:${composer.rowKey}`}
          ref={editorRef}
          focused
          keyBindings={PR_COMPOSER_KEY_BINDINGS}
          height={3}
          initialValue={composer.text}
          placeholder={composer.mode === 'note' ? 'Write a note for the active agent…' : 'Write a GitHub review comment…'}
          onContentChange={() => {
            const value = editorRef.current?.plainText ?? ''
            setComposer((current) => current?.mode === 'inline' || current?.mode === 'note' ? { ...current, text: value } : current)
          }}
          onSubmit={() => { void submitComposer() }}
        />
        <box height={1} flexShrink={0} flexDirection="row">
          <text fg={theme.dim} wrapMode="none">{composer.mode === 'note' ? 'local note' : 'posts to GitHub'}</text>
          <box flexGrow={1} />
          <text fg={theme.green} wrapMode="none">Enter submit</text>
          <text fg={theme.dim} wrapMode="none">  Shift+Enter newline  </text>
          <text fg={theme.muted} wrapMode="none">Esc cancel</text>
        </box>
      </box>
    )
  }

  const visible = reviewRows.slice(clampedTop, clampedTop + visibleDiffRows)
  const stickyNeeded = visible.length > 0 && visible[0]?.line?.kind !== 'file'
  const stickyRow = stickyNeeded
    ? reviewRows.find((row) => row.fileIndex === topFileIndex && row.line?.kind === 'file') ?? null
    : null
  const contentRows = stickyRow ? visible.slice(0, visibleDiffRows - 1) : visible

  // ── Left section heights ──────────────────────────────────────────────────
  const overviewH = 6
  const prsH = clampNumber(pullRequests.length + 2, 3, 7)
  const filesMaxH = Math.max(4, Math.floor((innerH - overviewH - prsH) * 0.62))
  const filesH = Math.min(Math.max(3, treeRows.length + 2), filesMaxH)

  const focusLabel = focusSide === 'right' ? 'shift-tab return left' : 'tab focus right'
  const syntaxReady = diffMode === 'viewer' && highlights?.fileIndex === currentFileIndex

  const sectionHeader = (id: PaneId, title: string, counter?: string) => (
    <box
      paddingX={1}
      width={leftW - 2}
      flexDirection="row"
      backgroundColor={pane === id ? theme.cyan : 'transparent'}
      onMouseUp={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        setPane(id)
        setFocusSide('left')
      }}
    >
      <text fg={pane === id ? theme.surface : theme.muted} wrapMode="none">{`[${id}] ${title}`}</text>
      {counter && pane === id ? (
        <box flexGrow={1}><text fg={theme.surface2} wrapMode="none">{`  ${counter}`}</text></box>
      ) : null}
    </box>
  )

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
      title=" PR review "
      titleColor={theme.cyan}
      titleAlignment="left"
    >
      <box height={bodyH} flexDirection="row">
        {/* ── Left column ─────────────────────────────────── */}
        {!leftPaneHidden ? (
          <box width={leftW} flexDirection="column">
            {/* [1] Overview */}
            <box
              height={overviewH}
              flexDirection="column"
              border={['bottom']} borderStyle="single"
              borderColor={pane === 1 ? theme.border2 : theme.border}
              backgroundColor={pane === 1 ? theme.surface2 : theme.surface}
            >
              {sectionHeader(1, 'Overview')}
              <box paddingX={1} flexDirection="column">
                <text fg={theme.text} wrapMode="none">
                  {fitText(pr ? `#${pr.number} ${pr.title}` : loading ? 'loading…' : 'no pull request', leftW - 3)}
                </text>
                <text fg={theme.muted} wrapMode="none">
                  {fitText(pr ? `${pr.headRefName} -> ${pr.baseRefName}` : workspace?.repo ?? repoCwd, leftW - 3)}
                </text>
                <text fg={theme.dim} wrapMode="none">
                  {fitText(pr ? `+${pr.additions} -${pr.deletions}  ${pr.files.length} files  ${stats ?? ''}` : '', leftW - 3)}
                </text>
                <text fg={error || workspace?.error ? theme.red : theme.dim} wrapMode="none">
                  {fitText(error || workspace?.error || (pr ? `${pr.reviewDecision || 'review pending'}${pr.isDraft ? '  draft' : ''}${loading ? '  refreshing…' : ''}` : ''), leftW - 3)}
                </text>
              </box>
            </box>

            {/* [2] Files */}
            <box
              height={filesH}
              flexDirection="column"
              border={['bottom']} borderStyle="single"
              borderColor={pane === 2 ? theme.border2 : theme.border}
              backgroundColor={pane === 2 ? theme.surface2 : theme.surface}
            >
              {sectionHeader(2, 'Files', pr ? `${currentFileIndex + 1}/${pr.files.length}` : undefined)}
              <scrollbox
                ref={treeRef}
                flexGrow={1}
                scrollY
                scrollbarOptions={{ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }}
              >
                {treeRows.map((row, index) => {
                  const isCursor = index === treeCursor && pane === 2
                  const indent = '  '.repeat(row.depth)
                  if (row.kind === 'dir') {
                    return (
                      <box key={`d:${row.path}`} width={Math.max(0, leftW - 3)} paddingX={1} flexDirection="row" backgroundColor={isCursor ? theme.surface3 : 'transparent'} onMouseUp={(event) => {
                        if (event.button !== 0) return
                        event.stopPropagation()
                        setPane(2); setFocusSide('left'); setTreeCursor(index)
                        setCollapsedDirs((prev) => {
                          const next = new Set(prev)
                          if (next.has(row.path)) next.delete(row.path)
                          else next.add(row.path)
                          return next
                        })
                      }}>
                        <text fg={theme.cyan} wrapMode="none">{isCursor ? '▎' : ' '}</text>
                        <text fg={isCursor ? theme.text : theme.muted} wrapMode="none">
                          {fitText(`${indent}${row.expanded ? '▼' : '▶'} ${row.label}`, leftW - 5)}
                        </text>
                      </box>
                    )
                  }
                  const isActive = row.fileIndex === currentFileIndex
                  const letter = STATUS_LETTER[row.file.status] ?? 'M'
                  return (
                    <box key={`f:${row.file.filename}`} width={Math.max(0, leftW - 3)} paddingX={1} flexDirection="row" backgroundColor={isCursor || isActive ? theme.surface3 : 'transparent'} onMouseUp={(event) => {
                      if (event.button !== 0) return
                      event.stopPropagation()
                      setPane(2); setFocusSide('left'); setTreeCursor(index); jumpToFile(row.fileIndex)
                    }}>
                      <text fg={theme.cyan} wrapMode="none">{isCursor ? '▎' : ' '}</text>
                      <text fg={statusColor(theme, row.file.status)} wrapMode="none">{`${indent}${letter} `}</text>
                      <text fg={isCursor || isActive ? theme.text : theme.muted} wrapMode="none">
                        {fitText(`${row.label} +${row.file.additions} -${row.file.deletions}`, leftW - 7 - indent.length)}
                      </text>
                    </box>
                  )
                })}
                {treeRows.length === 0 ? (
                  <box paddingX={1}><text fg={theme.dim}>{loading ? 'loading…' : 'no files'}</text></box>
                ) : null}
              </scrollbox>
            </box>

            {/* [3] Discussion */}
            <box
              flexGrow={1}
              flexDirection="column"
              border={['bottom']} borderStyle="single"
              borderColor={pane === 3 ? theme.border2 : theme.border}
              backgroundColor={pane === 3 ? theme.surface2 : theme.surface}
            >
              {sectionHeader(3, 'Discussion', discussionEntries.length > 0 ? `${discussionCursor + 1}/${discussionEntries.length}` : undefined)}
              <scrollbox
                ref={discussionRef}
                flexGrow={1}
                scrollY
                scrollbarOptions={{ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }}
              >
                {discussionEntries.map((entry, index) => {
                  const isCursor = index === discussionCursor && pane === 3
                  return (
                    <box key={entry.id} width={Math.max(0, leftW - 3)} paddingX={1} flexDirection="row" backgroundColor={isCursor ? theme.surface3 : 'transparent'} onMouseUp={(event) => {
                      if (event.button !== 0) return
                      event.stopPropagation()
                      setPane(3); setFocusSide('left'); setDiscussionCursor(index)
                      if (entry.comment) jumpToComment(entry.comment)
                    }}>
                      <text fg={theme.cyan} wrapMode="none">{isCursor ? '▎' : ' '}</text>
                      <text fg={entry.comment?.path ? theme.violet : isCursor ? theme.text : theme.muted} wrapMode="none">
                        {fitText(entry.label, leftW - 5)}
                      </text>
                    </box>
                  )
                })}
                {discussionEntries.length === 0 ? (
                  <box paddingX={1}><text fg={theme.dim}>no discussion yet</text></box>
                ) : null}
              </scrollbox>
            </box>

            {/* [4] Pull requests */}
            <box height={prsH} flexDirection="column" backgroundColor={pane === 4 ? theme.surface2 : theme.surface}>
              {sectionHeader(4, 'Pull requests', pullRequests.length > 0 ? `${prCursor + 1}/${pullRequests.length}` : undefined)}
              <scrollbox
                ref={prListRef}
                flexGrow={1}
                scrollY
                scrollbarOptions={{ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }}
              >
                {pullRequests.map((item, index) => {
                  const isCursor = index === prCursor && pane === 4
                  const isCurrent = item.number === pr?.number
                  return (
                    <box key={item.number} width={Math.max(0, leftW - 3)} paddingX={1} flexDirection="row" backgroundColor={isCursor ? theme.surface3 : 'transparent'} onMouseUp={(event) => {
                      if (event.button !== 0) return
                      event.stopPropagation()
                      setPane(4); setFocusSide('left'); setPrCursor(index)
                      if (item.number !== pr?.number) void load(item.number)
                    }}>
                      <text fg={theme.cyan} wrapMode="none">{isCursor ? '▎' : ' '}</text>
                      <text fg={theme.amber} wrapMode="none">{isCurrent ? `*#${item.number} ` : ` #${item.number} `}</text>
                      <text fg={isCurrent ? theme.green : isCursor ? theme.text : theme.muted} wrapMode="none">
                        {fitText(item.title, leftW - 10 - String(item.number).length)}
                      </text>
                    </box>
                  )
                })}
                {pullRequests.length === 0 ? (
                  <box paddingX={1}><text fg={theme.dim}>{loading ? 'loading…' : 'no open PRs'}</text></box>
                ) : null}
              </scrollbox>
            </box>
          </box>
        ) : null}

        {/* ── Divider ─────────────────────────────────────── */}
        {!leftPaneHidden ? (
          <box width={1} height={bodyH} backgroundColor={theme.surface}>
            {Array.from({ length: Math.max(1, bodyH) }, (_, i) => (
              <box key={i} width={1}>
                <text fg={theme.border2}>│</text>
              </box>
            ))}
          </box>
        ) : null}

        {/* ── Right column ────────────────────────────────── */}
        <box flexGrow={1} flexDirection="column" onMouseScroll={(event) => {
          const direction = event.scroll?.direction === 'up' ? -1 : event.scroll?.direction === 'down' ? 1 : 0
          if (direction === 0) return
          event.preventDefault(); event.stopPropagation(); setFocusSide('right')
          setDiffSelectionAnchor(null)
          const amount = Math.max(2, Math.min(Math.round(Math.abs(event.scroll?.delta ?? 1)), Math.max(2, Math.floor(diffRows / 2))))
          moveCursorTo(clampedCursor + direction * amount)
        }}>
          <box paddingX={1} flexDirection="row" backgroundColor={theme.surface2}>
            {(() => {
              const controls: Array<[string, string]> = diffMode === 'viewer' ? [
                ['v', 'plain'],
                ['s', diffLayout],
                ['n', showLineNumbers ? '#' : 'no#'],
                ['m', showHunkHeaders ? '@@' : 'no@@'],
                ['{}', 'hunk'],
                ['⇧j/k', 'range'],
                ['a', 'note'],
                ['A', 'composer'],
                ['x', 'del'],
                ['z', 'fold'],
              ] : [['v', 'parsed']]
              const groups: Array<[string, string]> = [
                ['1-4', 'sections'], ['[ ]', 'resize'], ['w', 'wide'], ['-', 'hide/show'],
                ['j/k', 'move/fast'], ['⏎', 'jump'], ['r', 'refresh'], ['esc', 'close'],
              ]
              const segs: React.ReactNode[] = [
                <span key="focus" fg={theme.cyan}>{focusLabel}</span>,
                <span key="pane" fg={theme.dim}>{`  ${PANE_TITLES[pane]}  `}</span>,
              ]
              controls.forEach(([k, l], i) => {
                if (i > 0) segs.push(<span key={`cs${i}`} fg={theme.dim}>{'  '}</span>)
                segs.push(<span key={`ck${i}`} fg={theme.cyan}>{k}</span>)
                segs.push(<span key={`cl${i}`} fg={theme.muted}>{` ${l}`}</span>)
              })
              if (diffMode === 'viewer') {
                segs.push(<span key="syn-dot" fg={syntaxReady ? theme.green : theme.dim}>{'   ● '}</span>)
                segs.push(<span key="syn" fg={theme.muted}>syntax</span>)
              }
              groups.forEach(([k, l], i) => {
                segs.push(<span key={`gd${i}`} fg={theme.dim}>{i === 0 ? '  │  ' : '  '}</span>)
                segs.push(<span key={`gk${i}`} fg={theme.cyan}>{k}</span>)
                segs.push(<span key={`gl${i}`} fg={theme.muted}>{` ${l}`}</span>)
              })
              return <text wrapMode="none">{segs}</text>
            })()}
          </box>
          <box flexGrow={1} flexDirection="column" backgroundColor={theme.surface}>
            {stickyRow ? renderReviewRow(stickyRow, -1, true) : null}
            {contentRows.map((row, index) => {
              const rowIndex = clampedTop + index
              const rowNotes = notesByEndIndex.get(rowIndex) ?? []
              return (
                <React.Fragment key={row.key}>
                  {renderReviewRow(row, rowIndex)}
                  {(composer?.mode === 'inline' || composer?.mode === 'note') && composer.rowIndex === rowIndex ? renderInlineComposer() : null}
                  {rowNotes
                    .filter(({ key }) => composer?.mode !== 'note' || composer.rowKey !== key)
                    .map(({ key, note, span }) => <React.Fragment key={key}>{renderNoteCard(note, span)}</React.Fragment>)}
                </React.Fragment>
              )
            })}
            {reviewRows.length === 0 ? (
              <box paddingX={1}>
                <text fg={theme.dim} wrapMode="none">
                  {loading ? 'loading…' : error || workspace?.error || (pr ? 'No textual diff available.' : 'No pull request selected.')}
                </text>
              </box>
            ) : null}
          </box>
        </box>
      </box>

      {/* ── Bottom action bar ─────────────────────────────── */}
      <box height={1} paddingX={1} flexDirection="row" backgroundColor={theme.surface2}>
        {(() => {
          const actions: Array<[string, string]> = [
            ['i', 'GitHub inline'], ['c', 'comment'], ['y', 'approve'], ['⇧X', 'request changes'], ['?', 'ask agent'],
          ]
          const segs: React.ReactNode[] = []
          actions.forEach(([k, l], i) => {
            if (i > 0) segs.push(<span key={`ad${i}`} fg={theme.dim}>{'  '}</span>)
            segs.push(<span key={`ak${i}`} fg={theme.cyan}>{k}</span>)
            segs.push(<span key={`al${i}`} fg={theme.muted}>{` ${l}`}</span>)
          })
          if (pr) {
            segs.push(<span key="pr-sep" fg={theme.dim}>{'  │  '}</span>)
            segs.push(<span key="pr-ref" fg={theme.dim}>{fitText(`${workspace?.repo ?? ''} #${pr.number}`, 40)}</span>)
          }
          return <text wrapMode="none">{segs}</text>
        })()}
        <box flexGrow={1} />
        {reviewRows.length > 0 ? (
          <text fg={theme.dim} wrapMode="none">
            {`${Math.min(clampedTop + visibleDiffRows, reviewRows.length)}/${reviewRows.length}  file ${currentFileIndex + 1}/${pr?.files.length ?? 0}`}
          </text>
        ) : null}
      </box>

      {/* ── Composer overlay ──────────────────────────────── */}
      {composer !== null && composer.mode !== 'inline' && composer.mode !== 'note' ? (
        <box
          position="absolute"
          left={Math.max(Math.floor(popW * 0.18), 2)}
          top={Math.max(Math.floor(popH * 0.25), 3)}
          width={Math.max(Math.floor(popW * 0.64), 48)}
          height={11}
          border
          borderStyle="single"
          borderColor={theme.cyan}
          backgroundColor={theme.surface2}
          title={
            composer.mode === 'question' ? ' Ask the active agent '
              : composer.mode === 'approve' ? ' Approve pull request '
                : composer.mode === 'request' ? ' Request changes '
                  : ' PR comment '
          }
          titleColor={theme.cyan}
          flexDirection="column"
          paddingX={1}
          zIndex={52}
        >
          <textarea
            ref={editorRef}
            focused
            keyBindings={PR_COMPOSER_KEY_BINDINGS}
            height={6}
            placeholder={
              composer.mode === 'question' ? 'What should the agent inspect?'
                : composer.mode === 'approve' ? 'Optional approval message…'
                  : 'Write a GitHub comment…'
            }
            onSubmit={() => { void submitComposer() }}
          />
          <box height={1} flexShrink={0}>
            <text fg={theme.dim} wrapMode="none">Enter submit  Shift+Enter newline  Esc cancel</text>
          </box>
        </box>
      ) : null}
    </box>
  )
}
