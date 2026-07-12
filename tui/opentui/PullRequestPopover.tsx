/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TextAttributes } from '@opentui/core'
import type { ScrollBoxRenderable, TextareaRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import {
  fetchPullRequestWorkspace,
  mutatePullRequest,
  type PullRequestComment,
  type PullRequestFile,
  type PullRequestWorkspace,
} from '../../lib/githubPr'
import { flattenHastLine, loadDiffHighlights, type TuiFileHighlights, type TuiRenderSpan } from './pierreDiffView'

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  cwd?: string | null
  theme: TuiThemePalette
  width: number
  height: number
  onClose: () => void
  onKeyHandlerReady: (handler: (key: Key) => void) => void
  onAskAgent: (prompt: string) => void
}

// ---------------------------------------------------------------------------
// Diff line model
// ---------------------------------------------------------------------------

type DiffLineKind = 'file' | 'hunk' | 'add' | 'del' | 'ctx' | 'meta' | 'comment'

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
    if (comment.path !== path || comment.line == null) continue
    const key = `${comment.side === 'LEFT' ? 'L' : 'R'}:${comment.line}`
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

  const pushComments = (anchored: PullRequestComment[] | undefined, fileIndex: number) => {
    for (const comment of anchored ?? []) {
      const wrapped = wrapText(`${comment.author}: ${comment.body.trim()}`, Math.max(commentWidth, 20))
      for (let index = 0; index < wrapped.length; index++) {
        lines.push({ kind: 'comment', text: `${index === 0 ? '● ' : '  '}${wrapped[index]}`, fileIndex, commentId: comment.id })
      }
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
    if (!file.patch) {
      lines.push({ kind: 'meta', text: '  (no textual diff — binary or too large)', fileIndex })
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
type ComposerMode = 'comment' | 'approve' | 'request' | 'question' | 'inline'

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

export function PullRequestPopover({ cwd, theme, width, height, onClose, onKeyHandlerReady, onAskAgent }: Props) {
  const repoCwd = cwd || process.cwd()
  const [workspace, setWorkspace] = useState<PullRequestWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pane, setPane] = useState<PaneId>(2)
  const [focusSide, setFocusSide] = useState<FocusSide>('right')
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>('normal')
  const [leftPaneWidth, setLeftPaneWidth] = useState(LEFT_PANE_DEFAULT_MAX_WIDTH)
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [diffCursor, setDiffCursor] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set())
  const [treeCursor, setTreeCursor] = useState(0)
  const [discussionCursor, setDiscussionCursor] = useState(0)
  const [prCursor, setPrCursor] = useState(0)
  const [composer, setComposer] = useState<
    | { mode: Exclude<ComposerMode, 'inline'> }
    | { mode: 'inline'; path: string; line: number; side: 'LEFT' | 'RIGHT' }
    | null
  >(null)
  const [highlights, setHighlights] = useState<{ fileIndex: number; data: TuiFileHighlights } | null>(null)
  const editorRef = useRef<TextareaRenderable | null>(null)
  const treeRef = useRef<ScrollBoxRenderable>(null)
  const discussionRef = useRef<ScrollBoxRenderable>(null)
  const prListRef = useRef<ScrollBoxRenderable>(null)
  const pendingCommentJumpRef = useRef<string | null>(null)

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

  const { lines, fileStarts, maxLineNo } = useMemo(
    () => buildDiffLines(pr?.files ?? [], pr?.comments ?? [], collapsed, rightW - gutterDigits * 2 - 8),
    [collapsed, pr, rightW],
  )
  const lineNoWidth = Math.max(String(maxLineNo).length, 3)
  const gutterCols = showLineNumbers ? lineNoWidth * 2 + 2 : 0
  const diffTextWidth = Math.max(rightW - gutterCols - 4, 12)

  const treeRows = useMemo(() => buildTreeRows(pr?.files ?? [], collapsedDirs), [collapsedDirs, pr])

  const maxScroll = Math.max(lines.length - diffRows, 0)
  const clampedTop = Math.min(scrollTop, maxScroll)
  const clampedCursor = lines.length > 0 ? clampNumber(diffCursor, 0, lines.length - 1) : 0

  // The file the diff cursor sits in (drives tree highlight, fold, highlights).
  const currentFileIndex = useMemo(() => {
    let current = 0
    for (let index = 0; index < fileStarts.length; index++) {
      if (fileStarts[index] <= clampedCursor) current = index
      else break
    }
    return current
  }, [clampedCursor, fileStarts])

  // The file covering the top visible row (drives the sticky header).
  const topFileIndex = useMemo(() => {
    let current = 0
    for (let index = 0; index < fileStarts.length; index++) {
      if (fileStarts[index] <= clampedTop) current = index
      else break
    }
    return current
  }, [clampedTop, fileStarts])

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
        ? `● ${item.author} ${item.path.split('/').at(-1)}:${item.line ?? ''} ${firstLine(item.body)}`
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
    const target = clampNumber(index, 0, Math.max(lines.length - 1, 0))
    setDiffCursor(target)
    setScrollTop((top) => {
      if (center) return clampNumber(target - 3, 0, maxScroll)
      if (target < top) return target
      if (target >= top + diffRows) return target - diffRows + 1
      return top
    })
  }, [diffRows, lines.length, maxScroll])

  const jumpToFile = useCallback((fileIndex: number) => {
    const target = fileStarts[clampNumber(fileIndex, 0, Math.max(fileStarts.length - 1, 0))]
    if (target != null) moveCursorTo(target)
    setScrollTop(clampNumber(fileStarts[clampNumber(fileIndex, 0, Math.max(fileStarts.length - 1, 0))] ?? 0, 0, maxScroll))
  }, [fileStarts, maxScroll, moveCursorTo])

  const jumpToComment = useCallback((comment: PullRequestComment) => {
    if (!comment.path || comment.line == null) return
    const fileIndex = (pr?.files ?? []).findIndex((file) => file.filename === comment.path)
    if (fileIndex < 0) return
    const target = lines.findIndex((line) => line.commentId === comment.id)
    if (target >= 0) { moveCursorTo(target, true); return }
    // Anchor lives in a collapsed file — expand it and finish once lines rebuild.
    pendingCommentJumpRef.current = comment.id
    setCollapsed((prev) => { const next = new Set(prev); next.delete(fileIndex); return next })
  }, [lines, moveCursorTo, pr])

  useEffect(() => {
    const id = pendingCommentJumpRef.current
    if (!id) return
    const target = lines.findIndex((line) => line.commentId === id)
    if (target >= 0) { pendingCommentJumpRef.current = null; moveCursorTo(target, true) }
  }, [lines, moveCursorTo])

  const toggleFold = useCallback(() => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(currentFileIndex)) next.delete(currentFileIndex)
      else next.add(currentFileIndex)
      return next
    })
    const target = fileStarts[currentFileIndex]
    if (target != null) { setDiffCursor(target); setScrollTop(clampNumber(target, 0, maxScroll)) }
  }, [currentFileIndex, fileStarts, maxScroll])

  const jumpToHunk = useCallback((direction: 1 | -1) => {
    if (lines.length === 0) return
    if (direction > 0) {
      for (let index = clampedCursor + 1; index < lines.length; index++) {
        if (lines[index]?.kind === 'hunk') { moveCursorTo(index); return }
      }
    } else {
      for (let index = clampedCursor - 1; index >= 0; index--) {
        if (lines[index]?.kind === 'hunk') { moveCursorTo(index); return }
      }
    }
  }, [clampedCursor, lines, moveCursorTo])

  const submitComposer = useCallback(async () => {
    if (!composer) return
    const body = editorRef.current?.plainText.trim() ?? ''
    if (composer.mode === 'question') {
      if (!body || !workspace) return
      onAskAgent(questionPrompt(workspace, body))
      setComposer(null)
      onClose()
      return
    }
    if (!workspace?.repo || !pr) return
    if (!body && composer.mode !== 'approve') return
    setLoading(true); setError(null)
    try {
      if (composer.mode === 'inline') {
        await mutatePullRequest(repoCwd, workspace.repo, {
          action: 'inline-comment', number: pr.number, body,
          commitId: pr.headRefOid, path: composer.path, line: composer.line, side: composer.side,
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

  const openInlineComposer = useCallback(() => {
    const line = lines[clampedCursor]
    const file = pr?.files[line?.fileIndex ?? -1]
    if (!line || !file) return
    if (line.kind === 'del' && line.oldNo != null) {
      setComposer({ mode: 'inline', path: file.filename, line: line.oldNo, side: 'LEFT' })
    } else if ((line.kind === 'add' || line.kind === 'ctx') && line.newNo != null) {
      setComposer({ mode: 'inline', path: file.filename, line: line.newNo, side: 'RIGHT' })
    }
  }, [clampedCursor, lines, pr])

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

    // Shift+J/K: next/prev file in the diff, regardless of focus.
    if ((key.name === 'j' || key.name === 'down') && key.shift) { jumpToFile(currentFileIndex + 1); return }
    if ((key.name === 'k' || key.name === 'up') && key.shift) { jumpToFile(currentFileIndex - 1); return }

    if (key.name === 'j' || key.name === 'down') {
      if (focusSide === 'left' && pane === 2) setTreeCursor((cursor) => Math.min(cursor + 1, Math.max(treeRows.length - 1, 0)))
      else if (focusSide === 'left' && pane === 3) setDiscussionCursor((cursor) => Math.min(cursor + 1, Math.max(discussionEntries.length - 1, 0)))
      else if (focusSide === 'left' && pane === 4) setPrCursor((cursor) => Math.min(cursor + 1, Math.max(pullRequests.length - 1, 0)))
      else moveCursorTo(clampedCursor + 1)
      return
    }
    if (key.name === 'k' || key.name === 'up') {
      if (focusSide === 'left' && pane === 2) setTreeCursor((cursor) => Math.max(cursor - 1, 0))
      else if (focusSide === 'left' && pane === 3) setDiscussionCursor((cursor) => Math.max(cursor - 1, 0))
      else if (focusSide === 'left' && pane === 4) setPrCursor((cursor) => Math.max(cursor - 1, 0))
      else moveCursorTo(clampedCursor - 1)
      return
    }

    if ((key.name === 'd' && key.ctrl) || key.name === 'pagedown') { moveCursorTo(clampedCursor + halfPage); return }
    if ((key.name === 'u' && key.ctrl) || key.name === 'pageup') { moveCursorTo(clampedCursor - halfPage); return }
    if (key.name === 'g' && key.shift) { moveCursorTo(Math.max(lines.length - 1, 0)); return }
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
    if (key.sequence === 'n') { setShowLineNumbers((value) => !value); return }
    if (key.sequence === 'r') { void load(pr?.number); return }

    // PR actions
    if (key.sequence === 'a') { openInlineComposer(); return }
    if (key.sequence === 'c') { setComposer({ mode: 'comment' }); return }
    if (key.sequence === 'A' || (key.name === 'a' && key.shift)) { setComposer({ mode: 'approve' }); return }
    if (key.sequence === 'X' || (key.name === 'x' && key.shift)) { setComposer({ mode: 'request' }); return }
    if (key.sequence === '?' || key.name === '?') { setComposer({ mode: 'question' }); return }
  }, [clampedCursor, composer, currentFileIndex, defaultLeftW, diffRows, discussionCursor, discussionEntries, focusSide,
      jumpToComment, jumpToFile, jumpToHunk, leftPaneHidden, leftPaneMode, lines.length, load, maxLeftW, minLeftW,
      moveCursorTo, onClose, openInlineComposer, pane, pr?.number, prCursor, pullRequests, toggleFold, treeCursor, treeRows])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

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
    if (!highlights || highlights.fileIndex !== line.fileIndex) return null
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

  const renderDiffLine = (line: DiffLine, index: number, sticky = false) => {
    const isCursor = !sticky && focusSide === 'right' && index === clampedCursor
    if (line.kind === 'file') {
      const file = pr?.files[line.fileIndex]
      return (
        <box key={sticky ? 'sticky' : index} width={rightW} flexDirection="row" backgroundColor={sticky ? theme.surface3 : theme.diffMetaBg}>
          <text fg={isCursor ? theme.cyan : theme.dim} wrapMode="none">{isCursor ? '▶' : '>'}</text>
          <text fg={file ? statusColor(theme, file.status) : theme.cyan} attributes={TextAttributes.BOLD} wrapMode="none">
            {` ${fitText(line.text, rightW - 3)}`}
          </text>
        </box>
      )
    }
    if (line.kind === 'hunk' || line.kind === 'meta') {
      return (
        <box key={index} width={rightW} flexDirection="row" backgroundColor={isCursor ? theme.surface3 : lineBg(line)}>
          <text fg={isCursor ? theme.cyan : lineFg(line)} wrapMode="none">
            {fitText(`${isCursor ? '▶' : ' '}${line.kind === 'hunk' ? '@' : ' '} ${line.text}`, rightW - 1)}
          </text>
        </box>
      )
    }
    if (line.kind === 'comment') {
      const pad = ' '.repeat(Math.min(gutterCols + 1, 10))
      return (
        <box key={index} width={rightW} flexDirection="row" backgroundColor={isCursor ? theme.surface3 : theme.surface2}>
          <text fg={theme.violet} wrapMode="none">{fitText(`${isCursor ? '▶' : ' '}${pad}${line.text}`, rightW - 1)}</text>
        </box>
      )
    }
    const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
    const fg = lineFg(line)
    const spans = lineSpans(line)
    return (
      <box key={index} width={rightW} flexDirection="row" backgroundColor={isCursor ? theme.surface3 : lineBg(line)}>
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

  const visible = lines.slice(clampedTop, clampedTop + diffRows)
  const stickyNeeded = visible.length > 0 && visible[0]?.kind !== 'file' && fileStarts.length > 0
  const stickyLine = stickyNeeded ? lines[fileStarts[topFileIndex]] : null
  const contentLines = stickyLine ? visible.slice(0, diffRows - 1) : visible

  // ── Left section heights ──────────────────────────────────────────────────
  const overviewH = 6
  const prsH = clampNumber(pullRequests.length + 2, 3, 7)
  const filesMaxH = Math.max(4, Math.floor((innerH - overviewH - prsH) * 0.62))
  const filesH = Math.min(Math.max(3, treeRows.length + 2), filesMaxH)

  const focusLabel = focusSide === 'right' ? 'shift-tab return left' : 'tab focus right'
  const syntaxReady = highlights?.fileIndex === currentFileIndex

  const sectionHeader = (id: PaneId, title: string, counter?: string) => (
    <box paddingX={1} width={leftW - 2} flexDirection="row" backgroundColor={pane === id ? theme.cyan : 'transparent'}>
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
                      <box key={`d:${row.path}`} width={Math.max(0, leftW - 3)} paddingX={1} flexDirection="row" backgroundColor={isCursor ? theme.surface3 : 'transparent'}>
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
                    <box key={`f:${row.file.filename}`} width={Math.max(0, leftW - 3)} paddingX={1} flexDirection="row" backgroundColor={isCursor || isActive ? theme.surface3 : 'transparent'}>
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
                    <box key={entry.id} width={Math.max(0, leftW - 3)} paddingX={1} flexDirection="row" backgroundColor={isCursor ? theme.surface3 : 'transparent'}>
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
                    <box key={item.number} width={Math.max(0, leftW - 3)} paddingX={1} flexDirection="row" backgroundColor={isCursor ? theme.surface3 : 'transparent'}>
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
        <box flexGrow={1} flexDirection="column">
          <box paddingX={1} flexDirection="row" backgroundColor={theme.surface2}>
            {(() => {
              const controls: Array<[string, string]> = [
                ['n', showLineNumbers ? '#' : 'no#'],
                ['z', 'fold'],
                ['{}', 'hunk'],
                ['⇧j/k', 'file'],
                ['a', 'note'],
              ]
              const groups: Array<[string, string]> = [
                ['1-4', 'sections'], ['[ ]', 'resize'], ['w', 'wide'], ['-', 'hide/show'],
                ['j/k', 'move'], ['⏎', 'jump'], ['r', 'refresh'], ['esc', 'close'],
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
              segs.push(<span key="syn-dot" fg={syntaxReady ? theme.green : theme.dim}>{'   ● '}</span>)
              segs.push(<span key="syn" fg={theme.muted}>syntax</span>)
              groups.forEach(([k, l], i) => {
                segs.push(<span key={`gd${i}`} fg={theme.dim}>{i === 0 ? '  │  ' : '  '}</span>)
                segs.push(<span key={`gk${i}`} fg={theme.cyan}>{k}</span>)
                segs.push(<span key={`gl${i}`} fg={theme.muted}>{` ${l}`}</span>)
              })
              return <text wrapMode="none">{segs}</text>
            })()}
          </box>
          <box flexGrow={1} flexDirection="column" backgroundColor={theme.surface}>
            {stickyLine ? renderDiffLine(stickyLine, -1, true) : null}
            {contentLines.map((line, index) => renderDiffLine(line, clampedTop + index))}
            {lines.length === 0 ? (
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
            ['a', 'inline note'], ['c', 'comment'], ['⇧A', 'approve'], ['⇧X', 'request changes'], ['?', 'ask agent'],
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
        {lines.length > 0 ? (
          <text fg={theme.dim} wrapMode="none">
            {`${Math.min(clampedTop + diffRows, lines.length)}/${lines.length}  file ${currentFileIndex + 1}/${pr?.files.length ?? 0}`}
          </text>
        ) : null}
      </box>

      {/* ── Composer overlay ──────────────────────────────── */}
      {composer !== null ? (
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
                  : composer.mode === 'inline' ? ` Note ${composer.path.split('/').at(-1)}:${composer.line} `
                    : ' PR comment '
          }
          titleColor={theme.cyan}
          flexDirection="column"
          paddingX={1}
          zIndex={52}
        >
          {composer.mode === 'inline' ? (
            <box height={1} flexShrink={0}>
              <text fg={theme.dim} wrapMode="none">{fitText(`${composer.path}:${composer.line} (${composer.side === 'LEFT' ? 'old' : 'new'} side)`, Math.max(Math.floor(popW * 0.64), 48) - 4)}</text>
            </box>
          ) : null}
          <textarea
            ref={editorRef}
            focused
            height={composer.mode === 'inline' ? 5 : 6}
            placeholder={
              composer.mode === 'question' ? 'What should the agent inspect?'
                : composer.mode === 'approve' ? 'Optional approval message…'
                  : 'Write a GitHub comment…'
            }
            onSubmit={() => { void submitComposer() }}
          />
          <box height={1} flexShrink={0}>
            <text fg={theme.dim} wrapMode="none">Enter submit  Esc cancel</text>
          </box>
        </box>
      ) : null}
    </box>
  )
}
