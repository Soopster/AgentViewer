/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRenderer } from '@opentui/react'
import type { MouseEvent, ScrollBoxRenderable } from '@opentui/core'
import type { SelectedLineRange } from '@pierre/diffs'
import type { TuiThemePalette } from '../theme'
import { prepareFileTreeInput } from '@pierre/trees'
import { fetchGitData, fetchGitPaneContent, type GitData, type GitStatusEntry } from '../../lib/gitProvider'
import { runGitCommand } from '../../lib/gitNodeProvider'
import { buildDiffCommentComposerPrompt } from '../../lib/diffCommentComposer'
import {
  buildPierreDiffView,
  loadDiffHighlights,
  type TuiFileHighlights,
  type TuiPierreDiffRow,
  type TuiPierreSplitRow,
  type TuiRenderSpan,
  type TuiSplitRowSide,
} from './pierreDiffView'
import { createScrollVelocityState, velocityScrollStep } from './scrollVelocity'

// ---------------------------------------------------------------------------
// Git data types
// ---------------------------------------------------------------------------

// chainPaths: all dir segments in a flattened chain, e.g. ['tui', 'tui/opentui'] for a
// merged single-child dir. Used so expand/collapse toggles all segments together.
type TreeNode =
  | { kind: 'dir'; path: string; name: string; depth: number; expanded: boolean; chainPaths: readonly string[] }
  | { kind: 'file'; path: string; name: string; depth: number; x: string; y: string }

function buildVisibleNodes(entries: GitStatusEntry[], expandedDirs: Set<string>): TreeNode[] {
  if (entries.length === 0) return []

  // Use @pierre/trees for correct tree-aware sorting (dirs before files per level,
  // consistent with the web GitPopover). Map from path → sort index.
  const filePaths = entries.map((e) => e.path)
  const prepared = prepareFileTreeInput(filePaths, { flattenEmptyDirectories: false, sort: 'default' })
  const sortedFilePaths = [...prepared.paths]

  // Build the nested dir/file structure in sorted order.
  interface DirData { subdirs: Map<string, DirData>; files: GitStatusEntry[] }
  const root: DirData = { subdirs: new Map(), files: [] }
  const entryByPath = new Map(entries.map((e) => [e.path, e]))

  for (const fp of sortedFilePaths) {
    const entry = entryByPath.get(fp)
    if (!entry) continue
    const parts = fp.split('/')
    let cur = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!
      if (!cur.subdirs.has(seg)) cur.subdirs.set(seg, { subdirs: new Map(), files: [] })
      cur = cur.subdirs.get(seg)!
    }
    cur.files.push(entry)
  }

  const nodes: TreeNode[] = []

  // Walk a chain of single-subdir/no-file dirs, collecting paths for display flattening.
  // e.g. tui/ → opentui/ (no files, one subdir) → returns chainPath='tui/opentui', chainDir=opentui's DirData
  function walkChain(dir: DirData, dirPath: string): { chainPath: string; chainDir: DirData; chainPaths: string[] } {
    const chainPaths = [dirPath]
    let currentPath = dirPath
    let currentDir = dir
    while (currentDir.subdirs.size === 1 && currentDir.files.length === 0) {
      const [childName, childDir] = [...currentDir.subdirs.entries()][0]!
      currentPath = `${currentPath}/${childName}`
      chainPaths.push(currentPath)
      currentDir = childDir
    }
    return { chainPath: currentPath, chainDir: currentDir, chainPaths }
  }

  function visit(dir: DirData, prefix: string, depth: number) {
    for (const [name, subdir] of dir.subdirs.entries()) {
      const dirPath = prefix ? `${prefix}/${name}` : name
      const { chainPath, chainDir, chainPaths } = walkChain(subdir, dirPath)
      const expanded = expandedDirs.has(chainPath)
      // Display name is the full flattened path segment, e.g. 'tui/opentui'
      const displayName = chainPath.slice(prefix ? prefix.length + 1 : 0)
      nodes.push({ kind: 'dir', path: chainPath, name: displayName, depth, expanded, chainPaths })
      if (expanded) {
        visit(chainDir, chainPath, depth + 1)
      }
    }
    for (const entry of dir.files) {
      const name = entry.path.split('/').at(-1) ?? entry.path
      nodes.push({ kind: 'file', path: entry.path, name, depth, x: entry.x, y: entry.y })
    }
  }

  visit(root, '', 0)
  return nodes
}

function allDirPaths(entries: GitStatusEntry[]): Set<string> {
  const dirs = new Set<string>()
  for (const entry of entries) {
    const parts = entry.path.split('/')
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'))
    }
  }
  return dirs
}

// ---------------------------------------------------------------------------
// Pane definitions
// ---------------------------------------------------------------------------

type PaneId = 0 | 1 | 2 | 3 | 4

const PANE_TITLES: Record<PaneId, string> = {
  0: 'Unstaged changes',
  1: 'Status',
  2: 'Files',
  3: 'Branches',
  4: 'Commits',
}

// ---------------------------------------------------------------------------
// Panel scrollbar
// ---------------------------------------------------------------------------

function PanelScrollbar({ total, viewportH, scrollTop, theme }: {
  total: number
  viewportH: number
  scrollTop: number
  theme: TuiThemePalette
}) {
  if (total <= viewportH) return null
  const thumbH = Math.max(1, Math.round((viewportH / total) * viewportH))
  const maxTop = Math.max(1, total - viewportH)
  const thumbTop = Math.round((scrollTop / maxTop) * (viewportH - thumbH))
  return (
    <box width={1} flexDirection="column">
      {Array.from({ length: viewportH }, (_, i) => {
        const isThumb = i >= thumbTop && i < thumbTop + thumbH
        return (
          <box key={i} width={1}>
            <text fg={isThumb ? theme.muted : theme.dim}>{isThumb ? '█' : '▏'}</text>
          </box>
        )
      })}
    </box>
  )
}

function diffRowColor(row: TuiPierreDiffRow, theme: TuiThemePalette): string {
  switch (row.tone) {
    case 'addition':
      return theme.green
    case 'deletion':
      return theme.red
    case 'file':
    case 'hunk':
      return theme.cyan
    case 'tree':
    case 'meta':
      return theme.dim
    default:
      return theme.text
  }
}

function diffRowBackground(row: TuiPierreDiffRow, theme: TuiThemePalette): string | undefined {
  switch (row.tone) {
    case 'addition':
      return theme.diffAddBg
    case 'deletion':
      return theme.diffRemoveBg
    case 'file':
    case 'hunk':
      return theme.diffMetaBg
    default:
      return undefined
  }
}

function diffRowIndicator(row: TuiPierreDiffRow): string {
  switch (row.tone) {
    case 'addition':
      return '+'
    case 'deletion':
      return '-'
    case 'file':
      return '>'
    case 'hunk':
      return '@'
    case 'tree':
      return '|'
    default:
      return ' '
  }
}

function formatDiffLineNumber(lineNumber: number | undefined, width: number): string {
  return lineNumber == null ? ''.padStart(width, ' ') : lineNumber.toString().padStart(width, ' ')
}

function fitTerminalText(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return '…'
  return `${text.slice(0, width - 1)}…`
}

// Render syntax-highlighted spans clipped to maxWidth terminal columns.
// Each span becomes an OpenTUI <span fg=...> element inside a parent <text>.
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
  if (remaining > 0) {
    elements.push(<span key="pad" fg={defaultFg}>{' '.repeat(remaining)}</span>)
  }
  return elements
}

// Stable semantic note anchor — survives diff re-parses as long as the line exists.
// Format: "<filePath>:<side>:<lineNum>"  e.g. "src/foo.ts:new:42"
function stackRowAnchor(row: TuiPierreDiffRow, filePath: string | null): string | null {
  const fp = filePath ?? 'unknown'
  if (row.newLine !== undefined) return `${fp}:new:${row.newLine}`
  if (row.oldLine !== undefined) return `${fp}:old:${row.oldLine}`
  return null
}

function splitRowAnchor(row: TuiPierreSplitRow, filePath: string | null): string | null {
  const fp = filePath ?? 'unknown'
  if (row.right?.lineNum !== undefined) return `${fp}:new:${row.right.lineNum}`
  if (row.left?.lineNum !== undefined) return `${fp}:old:${row.left.lineNum}`
  return null
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function splitSideFg(side: TuiSplitRowSide, theme: TuiThemePalette): string {
  if (side.kind === 'deletion') return theme.red
  if (side.kind === 'addition') return theme.green
  return theme.text
}

function splitSideBg(side: TuiSplitRowSide, theme: TuiThemePalette): string | undefined {
  if (side.kind === 'deletion') return theme.diffRemoveBg
  if (side.kind === 'addition') return theme.diffAddBg
  if (side.kind === 'empty') return theme.surface2
  return undefined
}

function nextHunkRowIndex(
  rows: Array<TuiPierreDiffRow | TuiPierreSplitRow>,
  currentIndex: number,
  direction: 1 | -1,
  showHunkHeaders: boolean,
): number | null {
  if (rows.length === 0) return null
  const hunkIndexes = rows
    .map((row, index) => row.tone === 'hunk' ? index : -1)
    .filter((index) => index >= 0)
  if (hunkIndexes.length === 0) return null

  const next = direction > 0
    ? hunkIndexes.find((index) => index > currentIndex) ?? hunkIndexes[0]
    : [...hunkIndexes].reverse().find((index) => index < currentIndex) ?? hunkIndexes[hunkIndexes.length - 1]
  if (showHunkHeaders) return next

  for (let index = next + 1; index < rows.length; index += 1) {
    if (rows[index]?.tone !== 'hunk') return index
  }
  return next
}

function splitSideIndicator(side: TuiSplitRowSide): string {
  if (side.kind === 'deletion') return '-'
  if (side.kind === 'addition') return '+'
  return ' '
}

function renderSplitSide(
  side: TuiSplitRowSide | undefined,
  sideW: number,
  textW: number,
  theme: TuiThemePalette,
  showLineNumbers: boolean,
  gutterCols: number,
  gutterDigits: number,
) {
  if (!side || side.kind === 'empty') {
    return (
      <box width={sideW} backgroundColor={theme.surface2}>
        <text fg={theme.dim} wrapMode="none">{' '.repeat(sideW)}</text>
      </box>
    )
  }
  const fg = splitSideFg(side, theme)
  const bg = splitSideBg(side, theme)
  const indicator = splitSideIndicator(side)
  return (
    <box width={sideW} flexDirection="row" backgroundColor={bg}>
      {showLineNumbers ? (
        <text fg={theme.dim} wrapMode="none">
          {formatDiffLineNumber(side.lineNum, gutterDigits)}
          {' '}
        </text>
      ) : null}
      <text fg={fg} wrapMode="none">{` ${indicator} `}</text>
      {side.spans && side.spans.length > 0 ? (
        <text wrapMode="none">
          {renderDiffSpans(side.spans, fg, textW)}
        </text>
      ) : (
        <text fg={fg} wrapMode="none">
          {fitTerminalText(side.text || ' ', textW)}
        </text>
      )}
    </box>
  )
}

// ─── Inline note rendering helpers ───────────────────────────────────────────

type DraftNote = { rowKey: string; range: SelectedLineRange; lineLabel: string; text: string }
type DiffNote = { range: SelectedLineRange; text: string }

type DiffSelectionPoint = {
  lineNumber: number
  side: SelectedLineRange['side']
}

type DiffSelectionSpan = {
  startIndex: number
  endIndex: number
  selection: SelectedLineRange
  key: string
  label: string
}

function diffSelectionPointForStackRow(row: TuiPierreDiffRow): DiffSelectionPoint | null {
  if (row.newLine !== undefined) return { lineNumber: row.newLine, side: 'additions' }
  if (row.oldLine !== undefined) return { lineNumber: row.oldLine, side: 'deletions' }
  return null
}

function diffSelectionPointForSplitRow(row: TuiPierreSplitRow): DiffSelectionPoint | null {
  if (row.right?.lineNum !== undefined) return { lineNumber: row.right.lineNum, side: 'additions' }
  if (row.left?.lineNum !== undefined) return { lineNumber: row.left.lineNum, side: 'deletions' }
  return null
}

function diffSelectionPointForRow(row: TuiPierreDiffRow | TuiPierreSplitRow): DiffSelectionPoint | null {
  const splitRow = row as TuiPierreSplitRow
  if (splitRow.left !== undefined || splitRow.right !== undefined) {
    return diffSelectionPointForSplitRow(splitRow)
  }
  return diffSelectionPointForStackRow(row as TuiPierreDiffRow)
}

function diffSelectionKey(filePath: string | null, selection: SelectedLineRange): string {
  return [filePath ?? 'unknown', selection.start, selection.side ?? '', selection.end, selection.endSide ?? ''].join('\u0000')
}

function diffSelectionLineLabel(selection: SelectedLineRange): string {
  const start = `L${selection.start}${selection.side === 'deletions' ? ' (old)' : ''}`
  const end = `L${selection.end}${selection.endSide === 'deletions' ? ' (old)' : ''}`
  return selection.start === selection.end && selection.side === selection.endSide ? start : `${start} → ${end}`
}

function diffSelectionSpanFromRowRange(
  filePath: string | null,
  rows: Array<TuiPierreDiffRow | TuiPierreSplitRow>,
  startIndex: number,
  endIndex: number,
): DiffSelectionSpan | null {
  if (rows.length === 0) return null
  const lo = clampNumber(Math.min(startIndex, endIndex), 0, rows.length - 1)
  const hi = clampNumber(Math.max(startIndex, endIndex), 0, rows.length - 1)
  let startPoint: DiffSelectionPoint | null = null
  for (let index = lo; index <= hi; index += 1) {
    startPoint = diffSelectionPointForRow(rows[index]!)
    if (startPoint) break
  }
  let endPoint: DiffSelectionPoint | null = null
  for (let index = hi; index >= lo; index -= 1) {
    endPoint = diffSelectionPointForRow(rows[index]!)
    if (endPoint) break
  }
  if (!startPoint || !endPoint) return null
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
    key: diffSelectionKey(filePath, selection),
    label: diffSelectionLineLabel(selection),
  }
}

function diffSelectionSpanFromSelection(
  filePath: string | null,
  rows: Array<TuiPierreDiffRow | TuiPierreSplitRow>,
  selection: SelectedLineRange,
): DiffSelectionSpan | null {
  if (rows.length === 0) return null
  let startIndex = -1
  let endIndex = -1
  for (let index = 0; index < rows.length; index += 1) {
    const point = diffSelectionPointForRow(rows[index]!)
    if (!point) continue
    if (startIndex === -1 && point.lineNumber === selection.start && point.side === selection.side) {
      startIndex = index
    }
    if (point.lineNumber === selection.end && point.side === selection.endSide) {
      endIndex = index
    }
  }
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return null
  return {
    startIndex,
    endIndex,
    selection,
    key: diffSelectionKey(filePath, selection),
    label: diffSelectionLineLabel(selection),
  }
}

function renderNoteDraft(draft: DraftNote, width: number, filePath: string | null, theme: TuiThemePalette) {
  const header = [filePath ?? '', draft.lineLabel].filter(Boolean).join(' ')
  const displayText = draft.text || 'Write a note…'
  return (
    <box width={width} flexDirection="column" border borderStyle="single" borderColor={theme.cyan} paddingX={1}>
      <box>
        <text fg={theme.cyan} wrapMode="none">
          {fitTerminalText(`Draft note${header ? ` — ${header}` : ''}`, width - 4)}
        </text>
      </box>
      <box height={2}>
        <text fg={draft.text ? theme.text : theme.dim} wrapMode="none">
          {`${displayText}${draft.text ? '▋' : ''}`}
        </text>
      </box>
      <box flexDirection="row" paddingY={0}>
        <box flexGrow={1} />
        <text fg={theme.green} wrapMode="none">Save (^S)</text>
        <text fg={theme.dim} wrapMode="none">{'  '}</text>
        <text fg={theme.muted} wrapMode="none">Cancel (Esc)</text>
      </box>
    </box>
  )
}

function renderNoteCard(
  note: DiffNote,
  width: number,
  filePath: string | null,
  theme: TuiThemePalette,
  lineLabel: string,
  onSendToComposer?: () => void,
) {
  if (!note.text) return null
  const header = [filePath ?? '', lineLabel].filter(Boolean).join(' ')
  return (
    <box width={width} flexDirection="column" border borderStyle="single" borderColor={theme.violet} paddingX={1}>
      <box flexDirection="row">
        <text fg={theme.violet} wrapMode="none">
          {fitTerminalText(`Note${header ? ` — ${header}` : ''}`, width - 6)}
        </text>
        <box flexGrow={1} />
        {onSendToComposer ? (
          <text fg={theme.green} wrapMode="none"> A:composer</text>
        ) : null}
        <text fg={theme.dim} wrapMode="none"> x:del</text>
      </box>
      <box>
        <text fg={theme.text} wrapMode="none">{note.text}</text>
      </box>
      {onSendToComposer ? (
        <box flexDirection="row">
          <box flexGrow={1} />
          <text fg={theme.green} wrapMode="none" onMouseUp={(event) => {
            event.stopPropagation()
            onSendToComposer()
          }}>Send to composer</text>
        </box>
      ) : null}
    </box>
  )
}

// ---------------------------------------------------------------------------
// GitPopover component
// ---------------------------------------------------------------------------

type GitKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string; eventType?: string; repeated?: boolean }
type FocusSide = 'left' | 'right'
type FileDiffMode = 'text' | 'viewer'
type LeftPaneMode = 'normal' | 'expanded' | 'hidden'

const LEFT_PANE_MIN_WIDTH = 24
const DIFF_BADGE_WIDTH = 3  // "[+]" badge column reserved on each stack-view diff row
const LEFT_PANE_DEFAULT_MAX_WIDTH = 40
const LEFT_PANE_RIGHT_MIN_WIDTH = 44
const LEFT_PANE_EXPANDED_RATIO = 0.5
const LEFT_PANE_RESIZE_STEP = 4

type Props = {
  cwd?: string | null
  theme: TuiThemePalette
  width: number
  height: number
  onClose: () => void
  onKeyHandlerReady: (handler: (key: GitKeyEvent) => void) => void
  onSendDiffNoteToComposer?: (prompt: string) => void
}

export function GitPopover({ cwd, theme, width, height, onClose, onKeyHandlerReady, onSendDiffNoteToComposer }: Props) {
  const repoCwd = cwd || process.cwd()
  const [data, setData] = useState<GitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [contentLoading, setContentLoading] = useState(false)
  const [pane, setPane] = useState<PaneId>(2)
  const [focusSide, setFocusSide] = useState<FocusSide>('left')
  const [fileDiffMode, setFileDiffMode] = useState<FileDiffMode>('viewer')
  const [diffHighlights, setDiffHighlights] = useState<Map<string, TuiFileHighlights> | null>(null)
  const [diffLayout, setDiffLayout] = useState<'stack' | 'split'>('stack')
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [showHunkHeaders, setShowHunkHeaders] = useState(true)
  const [diffCursorRow, setDiffCursorRow] = useState(0)
  const [diffSelectionAnchorRow, setDiffSelectionAnchorRow] = useState<number | null>(null)
  const [diffNotes, setDiffNotes] = useState<Map<string, DiffNote>>(new Map())
  const [draftNote, setDraftNote] = useState<DraftNote | null>(null)
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>('normal')
  const [leftPaneWidth, setLeftPaneWidth] = useState(LEFT_PANE_DEFAULT_MAX_WIDTH)
  const [treeCursor, setTreeCursor] = useState(0)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [branchIndex, setBranchIndex] = useState(0)
  const [commitIndex, setCommitIndex] = useState(0)
  const diffScrollRef = useRef<ScrollBoxRenderable>(null)
  const fileTreeScrollRef = useRef<ScrollBoxRenderable>(null)
  const branchesScrollRef = useRef<ScrollBoxRenderable>(null)
  const commitsScrollRef = useRef<ScrollBoxRenderable>(null)
  const rightContentRequestRef = useRef(0)
  const rightContentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref so handleKey can read rightDiffView without a circular dep issue
  const rightDiffViewRef = useRef<ReturnType<typeof buildPierreDiffView>>(null)
  // Ref so handleKey always sees the latest selectedFilePath without stale closure issues
  const selectedFilePathRef = useRef<string | null>(null)
  // Mouse hover state for the diff badge ([+] affordance)
  const [hoveredDiffRowKey, setHoveredDiffRowKey] = useState<string | null>(null)
  const hoverIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollVelocityRef = useRef(createScrollVelocityState())
  const renderer = useRenderer()

  // Refresh on mount
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    void fetchGitData(repoCwd, runGitCommand)
      .then((next) => {
        if (!cancelled) setData(next)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [repoCwd])

  // When data loads, expand all dirs and place cursor on the first file node
  useEffect(() => {
    if (!data) return
    const dirs = allDirPaths(data.status)
    setExpandedDirs(dirs)
    // Compute nodes inline so we can find the first file without waiting for
    // visibleNodes to recompute in a separate render cycle.
    const nodes = buildVisibleNodes(data.status, dirs)
    const firstFile = nodes.findIndex((n) => n.kind === 'file')
    setTreeCursor(firstFile >= 0 ? firstFile : 0)
    branchesScrollRef.current?.scrollTo(0)
    commitsScrollRef.current?.scrollTo(0)
  }, [data])

  // Visible tree nodes (recomputed when data or expanded state changes)
  const visibleNodes = useMemo(
    () => (data ? buildVisibleNodes(data.status, expandedDirs) : []),
    [data, expandedDirs],
  )

  // The file selected by the tree cursor (skip dirs for diff purposes)
  const selectedFilePath = useMemo(() => {
    const node = visibleNodes[treeCursor]
    return node?.kind === 'file' ? node.path : null
  }, [visibleNodes, treeCursor])

  // File count for the N of M counter
  const fileCount = useMemo(
    () => visibleNodes.filter((n) => n.kind === 'file').length,
    [visibleNodes],
  )
  const filePosition = useMemo(() => {
    let pos = 0
    for (let i = 0; i <= treeCursor && i < visibleNodes.length; i++) {
      if (visibleNodes[i]?.kind === 'file') pos++
    }
    return pos
  }, [visibleNodes, treeCursor])

  // Keep the file tree scrollbox centred on the cursor row.
  useEffect(() => {
    fileTreeScrollRef.current?.scrollTo(Math.max(0, treeCursor - 2))
  }, [treeCursor])

  useEffect(() => {
    branchesScrollRef.current?.scrollTo(Math.max(0, branchIndex - 1))
  }, [branchIndex])

  useEffect(() => {
    commitsScrollRef.current?.scrollTo(Math.max(0, commitIndex - 1))
  }, [commitIndex])

  // Right-panel content is loaded in an effect so git commands do not block render.
  const [rightContent, setRightContent] = useState('Loading…')

  useEffect(() => {
    const requestId = ++rightContentRequestRef.current
    if (rightContentTimerRef.current) {
      clearTimeout(rightContentTimerRef.current)
      rightContentTimerRef.current = null
    }

    if (!data) {
      setContentLoading(false)
      setRightContent('Loading…')
      return () => {
        if (rightContentRequestRef.current === requestId) {
          rightContentRequestRef.current += 1
        }
      }
    }

    setRightContent('Loading…')
    setContentLoading(true)
    // Debounce keeps rapid navigation (j/k) from spawning a git process per
    // keystroke — costly on Windows where process creation is slow.
    rightContentTimerRef.current = setTimeout(() => {
      const activeRequestId = rightContentRequestRef.current
      void (async () => {
        const content = await fetchGitPaneContent({
          cwd: repoCwd,
          runGit: runGitCommand,
          data,
          pane,
          selectedFilePath,
          branchIndex,
          commitIndex,
        })

        if (rightContentRequestRef.current !== activeRequestId) return
        setRightContent(content)
        setContentLoading(false)
        diffScrollRef.current?.scrollTo(0)
      })().catch(() => {
        if (rightContentRequestRef.current !== activeRequestId) return
        setContentLoading(false)
      })
    }, 180)

    return () => {
      if (rightContentTimerRef.current) {
        clearTimeout(rightContentTimerRef.current)
        rightContentTimerRef.current = null
      }
      if (rightContentRequestRef.current === requestId) {
        rightContentRequestRef.current += 1
      }
    }
  }, [branchIndex, commitIndex, data, pane, repoCwd, selectedFilePath])

  // Derive the Pierre appearance (dark/light) from the theme's bg luminance.
  const pierreAppearance: 'dark' | 'light' = useMemo(() => {
    const hex = theme.bg.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? 'light' : 'dark'
  }, [theme.bg])

  // Load syntax highlights async whenever the diff content or appearance changes.
  // Resets immediately so stale highlights don't flash over a new file.
  useEffect(() => {
    if (pane !== 2 || fileDiffMode !== 'viewer') return
    const text = rightContent
    if (!text || text === 'Loading…') {
      setDiffHighlights(null)
      return
    }
    let cancelled = false
    setDiffHighlights(null)
    void loadDiffHighlights(text, selectedFilePath ?? 'git-diff', pierreAppearance).then((result) => {
      if (!cancelled) setDiffHighlights(result)
    })
    return () => { cancelled = true }
  }, [rightContent, pane, fileDiffMode, selectedFilePath, pierreAppearance])

  // Reset diff cursor and any open draft when the viewed file changes.
  useEffect(() => {
    setDiffCursorRow(0)
    setDiffSelectionAnchorRow(null)
    setDraftNote(null)
    setHoveredDiffRowKey(null)
  }, [selectedFilePath, pane])

  // Clear hover badge when the terminal loses focus (matches hunk's behaviour).
  useEffect(() => {
    const clear = () => setHoveredDiffRowKey(null)
    renderer.on('blur', clear)
    return () => {
      renderer.off('blur', clear)
      if (hoverIdleTimeoutRef.current) clearTimeout(hoverIdleTimeoutRef.current)
    }
  }, [renderer])

  // Show the [+] badge on a diff row for 2 seconds of idle hover (same as hunk).
  const activateDiffHover = useCallback((rowKey: string) => {
    if (hoverIdleTimeoutRef.current) clearTimeout(hoverIdleTimeoutRef.current)
    setHoveredDiffRowKey(rowKey)
    hoverIdleTimeoutRef.current = setTimeout(() => {
      setHoveredDiffRowKey(null)
      hoverIdleTimeoutRef.current = null
    }, 2000)
  }, [])

  const handleKey = useCallback((key: GitKeyEvent) => {
    // While a draft note is open, all keyboard input goes to the note editor.
    if (draftNote !== null) {
      if (key.name === 'escape') { setDraftNote(null); return }
      if ((key.ctrl && key.name === 's') || key.name === 'return') {
        const trimmed = draftNote.text.trim()
        setDiffNotes((prev) => {
          const next = new Map(prev)
          if (trimmed) next.set(draftNote.rowKey, { range: draftNote.range, text: trimmed })
          else next.delete(draftNote.rowKey)
          return next
        })
        setDraftNote(null)
        return
      }
      if (key.name === 'backspace' || key.name === 'delete') {
        setDraftNote((d) => d ? { ...d, text: d.text.slice(0, -1) } : null)
        return
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
        setDraftNote((d) => d ? { ...d, text: d.text + key.sequence } : null)
        return
      }
      return
    }

    if (key.name === 'escape') { onClose(); return }

    if (key.name === 'tab' && key.shift) {
      setFocusSide(leftPaneMode === 'hidden' ? 'right' : 'left')
      return
    }

    if (key.name === 'tab') {
      setFocusSide('right')
      return
    }

    // 1–4 switch left-side sections.
    if (key.sequence >= '1' && key.sequence <= '4') {
      setPane(parseInt(key.sequence, 10) as PaneId)
      return
    }

    if ((key.sequence === '{' || key.sequence === '}') && pane === 2 && fileDiffMode === 'viewer' && focusSide === 'right') {
      const rows = diffLayout === 'split' ? rightDiffViewRef.current?.splitRows : rightDiffViewRef.current?.rows
      const nextIndex = rows ? nextHunkRowIndex(rows, diffCursorRow, key.sequence === '}' ? 1 : -1, showHunkHeaders) : null
      if (nextIndex != null) {
        setDiffSelectionAnchorRow(null)
        setDiffCursorRow(nextIndex)
        diffScrollRef.current?.scrollTo(nextIndex)
      }
      return
    }

    if (key.sequence === '[' || key.sequence === ']') {
      if (leftPaneMode === 'hidden') setLeftPaneMode('normal')
      setLeftPaneWidth((current) => {
        const nextWidth = clampLeftPaneWidth(current + (key.sequence === ']' ? LEFT_PANE_RESIZE_STEP : -LEFT_PANE_RESIZE_STEP))
        setLeftPaneMode(nextWidth >= maxLeftW - 1 ? 'expanded' : 'normal')
        return nextWidth
      })
      return
    }

    if (key.sequence === 'w') {
      if (leftPaneMode === 'hidden') setLeftPaneMode('normal')
      setPresetLeftPaneWidth(leftPaneMode === 'expanded' ? 'normal' : 'expanded')
      return
    }

    if (key.sequence === '-') {
      if (leftPaneMode === 'hidden') {
        setLeftPaneMode('normal')
        setFocusSide('left')
      } else {
        setLeftPaneMode('hidden')
        setFocusSide('right')
      }
      return
    }

    if (key.name === 'j' || key.name === 'down') {
      const step = velocityScrollStep(scrollVelocityRef.current, 1, key, Math.max(1, Math.min(8, Math.floor((height - 6) / 3))))
      if (focusSide === 'left' && pane === 2) setTreeCursor((i) => Math.min(i + step, visibleNodes.length - 1))
      else if (focusSide === 'left' && pane === 3 && data) setBranchIndex((i) => Math.min(i + step, data.branches.length - 1))
      else if (focusSide === 'left' && pane === 4 && data) setCommitIndex((i) => Math.min(i + step, data.commits.length - 1))
      else {
        const rdv = rightDiffViewRef.current
        const totalRows = pane === 2 && fileDiffMode === 'viewer'
          ? (diffLayout === 'split' ? (rdv?.splitRows.length ?? 0) : (rdv?.rows.length ?? 0))
          : 0
        if (totalRows > 0) {
          const currentIndex = clampNumber(diffCursorRow, 0, totalRows - 1)
          const nextIndex = clampNumber(currentIndex + step, 0, totalRows - 1)
          if (key.shift && pane === 2 && fileDiffMode === 'viewer' && focusSide === 'right') {
            setDiffSelectionAnchorRow((anchor) => anchor ?? currentIndex)
          } else {
            setDiffSelectionAnchorRow(null)
          }
          setDiffCursorRow(nextIndex)
        }
        diffScrollRef.current?.scrollBy(step)
      }
      return
    }
    if (key.name === 'k' || key.name === 'up') {
      const step = velocityScrollStep(scrollVelocityRef.current, -1, key, Math.max(1, Math.min(8, Math.floor((height - 6) / 3))))
      if (focusSide === 'left' && pane === 2) setTreeCursor((i) => Math.max(i - step, 0))
      else if (focusSide === 'left' && pane === 3 && data) setBranchIndex((i) => Math.max(i - step, 0))
      else if (focusSide === 'left' && pane === 4 && data) setCommitIndex((i) => Math.max(i - step, 0))
      else {
        const rdv = rightDiffViewRef.current
        const totalRows = pane === 2 && fileDiffMode === 'viewer'
          ? (diffLayout === 'split' ? (rdv?.splitRows.length ?? 0) : (rdv?.rows.length ?? 0))
          : 0
        if (totalRows > 0) {
          const currentIndex = clampNumber(diffCursorRow, 0, totalRows - 1)
          const nextIndex = clampNumber(currentIndex - step, 0, totalRows - 1)
          if (key.shift && pane === 2 && fileDiffMode === 'viewer' && focusSide === 'right') {
            setDiffSelectionAnchorRow((anchor) => anchor ?? currentIndex)
          } else {
            setDiffSelectionAnchorRow(null)
          }
          setDiffCursorRow(nextIndex)
        } else {
          setDiffCursorRow(0)
          setDiffSelectionAnchorRow(null)
        }
        diffScrollRef.current?.scrollBy(-step)
      }
      return
    }

    // Enter / space: toggle dir expansion
    if ((key.name === 'return' || key.sequence === ' ') && pane === 2 && focusSide === 'left') {
      const node = visibleNodes[treeCursor]
      if (node?.kind === 'dir') {
        setExpandedDirs((prev) => {
          const next = new Set(prev)
          if (next.has(node.path)) {
            for (const p of node.chainPaths) next.delete(p)
          } else {
            for (const p of node.chainPaths) next.add(p)
          }
          return next
        })
      }
      return
    }

    // h / left: collapse expanded dir, or jump to parent dir
    if ((key.name === 'h' || key.name === 'left') && pane === 2 && focusSide === 'left') {
      const node = visibleNodes[treeCursor]
      if (!node) return
      if (node.kind === 'dir' && expandedDirs.has(node.path)) {
        setExpandedDirs((prev) => {
          const next = new Set(prev)
          for (const p of node.chainPaths) next.delete(p)
          return next
        })
      } else if (node.depth > 0) {
        for (let i = treeCursor - 1; i >= 0; i--) {
          const candidate = visibleNodes[i]
          if (candidate?.kind === 'dir' && candidate.depth === node.depth - 1) {
            setTreeCursor(i)
            break
          }
        }
      }
      return
    }

    // l / right: expand collapsed dir, or enter first child
    if ((key.name === 'l' || key.name === 'right') && pane === 2 && focusSide === 'left') {
      const node = visibleNodes[treeCursor]
      if (!node) return
      if (node.kind === 'dir' && !expandedDirs.has(node.path)) {
        setExpandedDirs((prev) => {
          const next = new Set(prev)
          for (const p of node.chainPaths) next.add(p)
          return next
        })
      } else if (visibleNodes[treeCursor + 1]) {
        setTreeCursor(treeCursor + 1)
      }
      return
    }

    if (key.name === 'd') { diffScrollRef.current?.scrollBy(10); return }
    if (key.name === 'u') { diffScrollRef.current?.scrollBy(-10); return }
    if (key.name === 'r') {
      setLoading(true)
      void fetchGitData(repoCwd, runGitCommand)
        .then((next) => setData(next))
        .finally(() => setLoading(false))
      return
    }
    if (key.name === 'v' && pane === 2) {
      setFileDiffMode((mode) => (mode === 'text' ? 'viewer' : 'text'))
      setDiffSelectionAnchorRow(null)
      return
    }
    if (key.sequence === 's' && pane === 2 && fileDiffMode === 'viewer') {
      setDiffLayout((l) => (l === 'stack' ? 'split' : 'stack'))
      setDiffSelectionAnchorRow(null)
      return
    }
    if (key.sequence === 'n' && pane === 2 && fileDiffMode === 'viewer') {
      setShowLineNumbers((v) => !v)
      setDiffSelectionAnchorRow(null)
      return
    }
    if (key.sequence === 'm' && pane === 2 && fileDiffMode === 'viewer') {
      setShowHunkHeaders((v) => !v)
      setDiffSelectionAnchorRow(null)
      return
    }
    // a = add/edit note on current diff cursor range
    if (key.sequence === 'a' && pane === 2 && fileDiffMode === 'viewer' && focusSide === 'right') {
      const rdv = rightDiffViewRef.current
      const fp = selectedFilePathRef.current
      const isSplit = diffLayout === 'split'
      const rows = isSplit ? rdv?.splitRows : rdv?.rows
      if (!rows || rows.length === 0) return
      const currentIndex = clampNumber(diffCursorRow, 0, rows.length - 1)
      const span = diffSelectionSpanFromRowRange(fp, rows, diffSelectionAnchorRow ?? currentIndex, currentIndex)
      if (!span) return
      setDraftNote({
        rowKey: span.key,
        range: span.selection,
        lineLabel: span.label,
        text: diffNotes.get(span.key)?.text ?? '',
      })
      return
    }
    // x = delete note on current diff cursor range
    if (key.sequence === 'x' && pane === 2 && fileDiffMode === 'viewer' && focusSide === 'right') {
      const rdv = rightDiffViewRef.current
      const fp = selectedFilePathRef.current
      const isSplit = diffLayout === 'split'
      const rows = isSplit ? rdv?.splitRows : rdv?.rows
      if (!rows || rows.length === 0) return
      const currentIndex = clampNumber(diffCursorRow, 0, rows.length - 1)
      const span = diffSelectionSpanFromRowRange(fp, rows, diffSelectionAnchorRow ?? currentIndex, currentIndex)
      if (span && diffNotes.has(span.key)) {
        setDiffNotes((prev) => { const n = new Map(prev); n.delete(span.key); return n })
      }
      return
    }
    if (key.sequence === 'A' && pane === 2 && fileDiffMode === 'viewer' && focusSide === 'right' && onSendDiffNoteToComposer) {
      const rdv = rightDiffViewRef.current
      const fp = selectedFilePathRef.current
      const isSplit = diffLayout === 'split'
      const rows = isSplit ? rdv?.splitRows : rdv?.rows
      if (!rows || rows.length === 0) return
      const currentIndex = clampNumber(diffCursorRow, 0, rows.length - 1)
      const span = diffSelectionSpanFromRowRange(fp, rows, diffSelectionAnchorRow ?? currentIndex, currentIndex)
      if (!span) return
      const note = diffNotes.get(span.key)
      if (!note) return
      onSendDiffNoteToComposer(buildDiffCommentComposerPrompt({
        filePath: fp ?? 'git diff',
        range: note.range,
        comment: note.text,
        context: rightContent,
        source: `Git popover ${span.label}`,
      }))
      return
    }
  }, [data, diffCursorRow, diffLayout, diffNotes, diffSelectionAnchorRow, draftNote, expandedDirs, fileDiffMode, focusSide,
      height, leftPaneMode, onClose, onSendDiffNoteToComposer, pane, repoCwd, rightContent, showHunkHeaders, treeCursor, visibleNodes])

  // Register key handler with parent
  useEffect(() => {
    onKeyHandlerReady(handleKey)
  }, [handleKey, onKeyHandlerReady])

  useEffect(() => {
    if (leftPaneMode === 'hidden' && focusSide === 'left') setFocusSide('right')
  }, [focusSide, leftPaneMode])

  // Dimensions
  const popW = width - 4
  const popH = height - 4
  const defaultLeftW = Math.min(LEFT_PANE_DEFAULT_MAX_WIDTH, Math.floor(popW * 0.28))
  const minLeftW = Math.min(LEFT_PANE_MIN_WIDTH, Math.max(defaultLeftW, popW - LEFT_PANE_RIGHT_MIN_WIDTH - 4))
  const maxLeftW = Math.max(defaultLeftW, Math.min(Math.floor(popW * LEFT_PANE_EXPANDED_RATIO), popW - LEFT_PANE_RIGHT_MIN_WIDTH - 4))
  const leftPaneHidden = leftPaneMode === 'hidden'
  const leftPaneExpanded = leftPaneMode === 'expanded'
  const leftW = leftPaneHidden ? 0 : Math.max(minLeftW, Math.min(leftPaneWidth, maxLeftW))
  const dividerW = leftPaneHidden ? 0 : 1
  const rightW = Math.max(LEFT_PANE_RIGHT_MIN_WIDTH, popW - leftW - dividerW - 2)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)

  const leftInnerH = popH - 2
  const statusH = 4
  const branchesH = Math.max(3, Math.min(6, (data?.branches.length ?? 0) + 2))
  // Files: grow with content up to 60 % of the left panel, with a scrollbox inside.
  // Commits gets whatever is left via flexGrow.
  const fileTreeMaxH = Math.max(4, Math.floor((leftInnerH - statusH - branchesH) * 0.6))
  const fileTreeH = Math.min(Math.max(3, visibleNodes.length + 2), fileTreeMaxH)
  // Commits gets the remaining height after Status + Files + Branches (minus 3 section borders).
  const commitsH = Math.max(4, leftInnerH - statusH - fileTreeH - branchesH - 3)
  // Estimate remaining rows for Commits (used for manual slicing while Commits lacks scrollbox).
  const rightH = popH - 2
  const focusLabel = focusSide === 'right' ? 'shift-tab return left' : 'tab focus right'
  // Diff controls render with the same key-cyan / label-muted convention as the
  // keybinding groups beside them (and the transcript diff strip), instead of a
  // flat muted wall. `syntax` is a status chip (● = highlights loaded), not a
  // fake keybinding.
  const fileDiffSegs: React.ReactNode[] = fileDiffMode === 'viewer'
    ? (() => {
        const controls: Array<[string, string]> = [
          ['v', 'plain'],
          ['s', diffLayout],
          ['n', showLineNumbers ? '#' : 'no#'],
          ['m', showHunkHeaders ? '@@' : 'no@@'],
          ['{}', 'hunk'],
          ['⇧j/k', 'range'],
          ['a', 'note'],
          ['A', 'composer'],
          ['x', 'del'],
        ]
        const nodes: React.ReactNode[] = []
        controls.forEach(([k, l], i) => {
          if (i > 0) nodes.push(<span key={`fd-sep${i}`} fg={theme.dim}>{'  '}</span>)
          nodes.push(<span key={`fd-k${i}`} fg={theme.cyan}>{k}</span>)
          nodes.push(<span key={`fd-l${i}`} fg={theme.muted}>{` ${l}`}</span>)
        })
        nodes.push(<span key="fd-syn-dot" fg={diffHighlights ? theme.green : theme.dim}>{'   ● '}</span>)
        nodes.push(<span key="fd-syn" fg={theme.muted}>syntax</span>)
        return nodes
      })()
    : [
        <span key="fd-parsed-k" fg={theme.cyan}>v</span>,
        <span key="fd-parsed-l" fg={theme.muted}> parsed</span>,
      ]

  function statusColor(x: string, y: string): string {
    if (x === '?' && y === '?') return theme.red  // untracked
    if (x.trim()) return theme.green              // staged change
    if (y === 'M') return theme.amber             // unstaged modified
    if (y === 'D') return theme.red               // deleted
    return theme.muted
  }

  const allDiffLines = rightContent.split('\n')
  // Cap rendered lines so large diffs do not stall the render loop — each
  // line becomes a box/text pair and OpenTUI does not virtualize scrollbox
  // children, so ~10k+ lines can visibly hang the app on Windows.
  const MAX_DIFF_LINES = 1500
  const diffTruncated = allDiffLines.length > MAX_DIFF_LINES
  const diffLines = diffTruncated ? allDiffLines.slice(0, MAX_DIFF_LINES) : allDiffLines
  const rightDiffView = useMemo(
    () => {
      selectedFilePathRef.current = selectedFilePath
      const v = pane === 2 && fileDiffMode === 'viewer'
        ? buildPierreDiffView(rightContent, selectedFilePath ?? 'git-diff', diffHighlights, pierreAppearance)
        : null
      rightDiffViewRef.current = v
      return v
    },
    [diffHighlights, fileDiffMode, pane, pierreAppearance, rightContent, selectedFilePath],
  )
  const rightDiffRows = rightDiffView ? rightDiffView.rows.slice(0, MAX_DIFF_LINES) : []
  const rightDiffTruncated = rightDiffView ? rightDiffView.rows.length > MAX_DIFF_LINES : false
  const rightSplitRows = rightDiffView ? rightDiffView.splitRows.slice(0, MAX_DIFF_LINES) : []
  const rightSplitTruncated = rightDiffView ? rightDiffView.splitRows.length > MAX_DIFF_LINES : false
  const activeDiffRows = diffLayout === 'split' ? rightSplitRows : rightDiffRows
  const diffSelectionCurrentIndex = activeDiffRows.length > 0
    ? clampNumber(diffCursorRow, 0, activeDiffRows.length - 1)
    : 0
  const diffSelectionSpan = pane === 2 && fileDiffMode === 'viewer' && activeDiffRows.length > 0
    ? diffSelectionSpanFromRowRange(
        selectedFilePath,
        activeDiffRows,
        diffSelectionAnchorRow ?? diffSelectionCurrentIndex,
        diffSelectionCurrentIndex,
      )
    : null
  const diffSelectionCurrentSelection = diffSelectionSpan?.selection ?? null
  const diffSelectionStartIndex = diffSelectionSpan?.startIndex ?? diffSelectionCurrentIndex
  const diffSelectionEndIndex = diffSelectionSpan?.endIndex ?? diffSelectionCurrentIndex
  const diffNotesByEndIndex = useMemo(() => {
    const notesByEndIndex = new Map<number, Array<{ key: string; note: DiffNote; label: string; span: DiffSelectionSpan }>>()
    if (pane !== 2 || fileDiffMode !== 'viewer' || activeDiffRows.length === 0) return notesByEndIndex
    for (const [key, note] of diffNotes) {
      const span = diffSelectionSpanFromSelection(selectedFilePath, activeDiffRows, note.range)
      if (!span) continue
      const list = notesByEndIndex.get(span.endIndex) ?? []
      list.push({ key, note, label: span.label, span })
      notesByEndIndex.set(span.endIndex, list)
    }
    return notesByEndIndex
  }, [activeDiffRows, diffNotes, fileDiffMode, pane, selectedFilePath])
  const diffDraftSpan = useMemo(() => {
    if (pane !== 2 || fileDiffMode !== 'viewer' || !draftNote || activeDiffRows.length === 0) return null
    return diffSelectionSpanFromSelection(selectedFilePath, activeDiffRows, draftNote.range)
  }, [activeDiffRows, draftNote, fileDiffMode, pane, selectedFilePath])

  // Gutter width: max line number digit count across all stack rows
  const rightDiffLineNumbers = rightDiffRows.flatMap((row) => [row.oldLine, row.newLine].filter((value): value is number => value != null))
  const rightDiffGutterWidth = Math.max(
    rightDiffLineNumbers.length > 0 ? Math.max(...rightDiffLineNumbers).toString().length : 1,
    1,
  )

  // Stack view text column width
  const stackGutterCols = showLineNumbers ? rightDiffGutterWidth * 2 + 2 : 0
  // Always reserve DIFF_BADGE_WIDTH cols for the hover/note badge column.
  const rightDiffTextWidth = Math.max(rightW - stackGutterCols - 3 - DIFF_BADGE_WIDTH, 12)

  // Split view widths
  const splitHalfW = Math.floor((rightW - 1) / 2)
  const splitRightHalfW = rightW - 1 - splitHalfW
  const splitGutterCols = showLineNumbers ? rightDiffGutterWidth + 1 : 0
  const splitIndicatorCols = 3
  const splitLeftTextW = Math.max(splitHalfW - splitGutterCols - splitIndicatorCols, 6)
  const splitRightTextW = Math.max(splitRightHalfW - splitGutterCols - splitIndicatorCols, 6)

  function clampLeftPaneWidth(nextWidth: number): number {
    return Math.max(minLeftW, Math.min(nextWidth, maxLeftW))
  }

  function setPresetLeftPaneWidth(mode: Exclude<LeftPaneMode, 'hidden'>) {
    setLeftPaneMode(mode)
    setLeftPaneWidth(clampLeftPaneWidth(mode === 'expanded' ? maxLeftW : defaultLeftW))
    setFocusSide('left')
  }

  function beginDiffMouseSelection(event: MouseEvent, rowIndex: number) {
    if (event.button !== 0) return
    event.stopPropagation()
    setFocusSide('right')
    if (event.modifiers.shift) {
      setDiffSelectionAnchorRow((anchor) => anchor ?? diffSelectionCurrentIndex)
    } else {
      setDiffSelectionAnchorRow(rowIndex)
    }
    setDiffCursorRow(rowIndex)
  }

  function updateDiffMouseSelection(event: MouseEvent, rowIndex: number) {
    if (event.button !== 0 || (!event.isDragging && event.type !== 'drag')) return
    event.stopPropagation()
    setFocusSide('right')
    setDiffCursorRow(rowIndex)
  }

  function sendDiffNoteToComposer(note: DiffNote, label: string) {
    if (!onSendDiffNoteToComposer) return
    onSendDiffNoteToComposer(buildDiffCommentComposerPrompt({
      filePath: selectedFilePath ?? 'git diff',
      range: note.range,
      comment: note.text,
      context: rightContent,
      source: `Git popover ${label}`,
    }))
  }

  function activateMousePane(event: MouseEvent, nextPane: PaneId) {
    if (event.button !== 0) return
    event.stopPropagation()
    setPane(nextPane)
    setFocusSide('left')
  }


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
      flexDirection="row"
      title=" Git "
      titleColor={theme.cyan}
      titleAlignment="left"
    >
      {/* ── Left column ─────────────────────────────────── */}
      {!leftPaneHidden ? (
      <box width={leftW} flexDirection="column" border={['right']} borderStyle="single" borderColor={theme.border}>

        {/* [1] Status */}
        <box
          height={statusH}
          flexDirection="column"
          border={['bottom']} borderStyle="single"
          borderColor={pane === 1 ? theme.border2 : theme.border}
          backgroundColor={pane === 1 ? theme.surface2 : theme.surface}
          onMouseUp={(event) => activateMousePane(event, 1)}
        >
          <box paddingX={1} width={leftW - 2} backgroundColor={pane === 1 ? theme.cyan : 'transparent'}>
            <text fg={pane === 1 ? theme.surface : theme.muted}>[1] Status</text>
          </box>
          <box paddingX={1}>
            <text fg={theme.text} wrapMode="none">
              {loading ? 'loading…' : data ? `${data.branch}${data.upstream ? `  ↑${data.ahead}↓${data.behind}` : ''}` : '…'}
            </text>
          </box>
        </box>

        {/* [2] Files — tree view (scrollbox so large lists scroll naturally) */}
        <box
          height={fileTreeH}
          flexDirection="column"
          border={['bottom']} borderStyle="single"
          borderColor={pane === 2 ? theme.border2 : theme.border}
          backgroundColor={pane === 2 ? theme.surface2 : theme.surface}
        >
          <box paddingX={1} width={leftW - 2} flexDirection="row" backgroundColor={pane === 2 ? theme.cyan : 'transparent'} onMouseUp={(event) => activateMousePane(event, 2)}>
            <text fg={pane === 2 ? theme.surface : theme.muted}>[2] Files</text>
            {pane === 2 && fileCount > 0 ? (
              <box flexGrow={1}>
                <text fg={pane === 2 ? theme.surface2 : theme.dim}>{`  ${filePosition}/${fileCount}`}</text>
              </box>
            ) : null}
          </box>
          <scrollbox
            ref={fileTreeScrollRef}
            flexGrow={1}
            scrollY
            scrollbarOptions={{ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }}
          >
            {visibleNodes.map((node, i) => {
              const isCursor = i === treeCursor && pane === 2
              const indent = '  '.repeat(node.depth)
              let label: string
              let labelColor: string
              if (node.kind === 'dir') {
                label = `${indent}${node.expanded ? '▼' : '▶'} ${node.name}`
                labelColor = isCursor ? theme.text : theme.muted
              } else {
                const flags = node.x.trim() || node.y.trim() ? (node.x.trim() || node.y) : '??'
                label = `${indent}${flags} ${node.name}`
                labelColor = isCursor ? theme.text : statusColor(node.x, node.y)
              }
              return (
                <box
                  key={node.path}
                  width={Math.max(0, leftW - 3)}
                  paddingX={1}
                  flexDirection="row"
                  backgroundColor={isCursor ? theme.surface3 : 'transparent'}
                  onMouseUp={(event) => {
                    if (event.button !== 0) return
                    event.stopPropagation(); setPane(2); setFocusSide('left'); setTreeCursor(i)
                    if (node.kind === 'dir') {
                      setExpandedDirs((prev) => {
                        const next = new Set(prev)
                        const expanded = node.chainPaths.some((path) => next.has(path))
                        for (const path of node.chainPaths) {
                          if (expanded) next.delete(path)
                          else next.add(path)
                        }
                        return next
                      })
                    }
                  }}
                >
                  <text fg={theme.cyan} wrapMode="none">{isCursor ? '▎' : ' '}</text>
                  <text fg={labelColor} wrapMode="none">{label}</text>
                </box>
              )
            })}
            {(!data || data.status.length === 0) ? (
              <box paddingX={1}><text fg={theme.dim}>clean</text></box>
            ) : null}
          </scrollbox>
        </box>

        {/* [3] Branches */}
        <box
          height={branchesH}
          flexDirection="column"
          border={['bottom']} borderStyle="single"
          borderColor={pane === 3 ? theme.border2 : theme.border}
          backgroundColor={pane === 3 ? theme.surface2 : theme.surface}
        >
          <box paddingX={1} width={leftW - 2} backgroundColor={pane === 3 ? theme.cyan : 'transparent'} onMouseUp={(event) => activateMousePane(event, 3)}>
            <text fg={pane === 3 ? theme.surface : theme.muted}>[3] Branches</text>
          </box>
          <scrollbox
            ref={branchesScrollRef}
            flexGrow={1}
            scrollY
            scrollbarOptions={{ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }}
          >
            {(data?.branches ?? []).map((b, i) => {
              const isCurrent = b === data?.branch
              const isSel = i === branchIndex && pane === 3
              return (
                <box key={b} paddingX={1} flexDirection="row" backgroundColor={isSel ? theme.surface3 : 'transparent'} onMouseUp={(event) => {
                  if (event.button !== 0) return
                  event.stopPropagation(); setPane(3); setFocusSide('left'); setBranchIndex(i)
                }}>
                  <text fg={theme.cyan} wrapMode="none">{isSel ? '▎' : ' '}</text>
                  <text fg={isCurrent ? theme.green : isSel ? theme.text : theme.muted} wrapMode="none">
                    {isCurrent ? `* ${b}` : `  ${b}`}
                  </text>
                </box>
              )
            })}
          </scrollbox>
        </box>

        {/* [4] Commits */}
        <box height={commitsH} flexDirection="column" backgroundColor={pane === 4 ? theme.surface2 : theme.surface}>
          <box paddingX={1} width={leftW - 2} backgroundColor={pane === 4 ? theme.cyan : 'transparent'} onMouseUp={(event) => activateMousePane(event, 4)}>
            <text fg={pane === 4 ? theme.surface : theme.muted}>[4] Commits</text>
          </box>
          <scrollbox
            ref={commitsScrollRef}
            flexGrow={1}
            scrollY
            scrollbarOptions={{ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }}
          >
            {(data?.commits ?? []).map((c, i) => {
              const isSel = i === commitIndex && pane === 4
              const spaceIdx = c.indexOf(' ')
              const hash = spaceIdx > 0 ? c.slice(0, spaceIdx) : c
              const msg = spaceIdx > 0 ? c.slice(spaceIdx + 1) : ''
              return (
                <box key={c} paddingX={1} flexDirection="row" backgroundColor={isSel ? theme.surface3 : 'transparent'} onMouseUp={(event) => {
                  if (event.button !== 0) return
                  event.stopPropagation(); setPane(4); setFocusSide('left'); setCommitIndex(i)
                }}>
                  <text fg={theme.cyan} wrapMode="none">{isSel ? '▎' : ' '}</text>
                  <text fg={theme.amber} wrapMode="none">{hash} </text>
                  <text fg={isSel ? theme.text : theme.dim} wrapMode="none">
                    {msg.slice(0, leftW - hash.length - 6)}
                  </text>
                </box>
              )
            })}
          </scrollbox>
        </box>
      </box>
      ) : null}

      {!leftPaneHidden ? (
        <box
          width={1}
          height={popH - 2}
          backgroundColor={theme.surface}
        >
          {Array.from({ length: Math.max(1, popH - 2) }, (_, i) => (
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
            const groups: Array<[string, string]> = [
              ['1-4', 'sections'], ['[ ]', 'resize'], ['w', 'wide'], ['-', 'hide/show'],
              ['j/k', 'move/fast'], ['h/l', 'fold'], ['⏎', 'toggle'], ['r', 'refresh'], ['esc', 'close'],
            ]
            const segs: React.ReactNode[] = [
              <span key="focus" fg={theme.cyan}>{focusLabel}</span>,
              <span key="pane" fg={theme.dim}>{`  ${PANE_TITLES[pane]}  `}</span>,
              ...fileDiffSegs,
            ]
            groups.forEach(([k, l], i) => {
              segs.push(<span key={`d${i}`} fg={theme.dim}>{i === 0 ? '  │  ' : '  '}</span>)
              segs.push(<span key={`k${i}`} fg={theme.cyan}>{k}</span>)
              segs.push(<span key={`l${i}`} fg={theme.muted}>{` ${l}`}</span>)
            })
            return <text wrapMode="none">{segs}</text>
          })()}
        </box>
        <scrollbox
          ref={diffScrollRef}
          width={rightW}
          height={rightH - 1}
          backgroundColor={theme.surface}
          scrollY
          scrollbarOptions={{ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }}
          onMouseScroll={(event) => {
            const direction = event.scroll?.direction === 'up' ? -1 : event.scroll?.direction === 'down' ? 1 : 0
            if (direction === 0) return
            event.preventDefault(); event.stopPropagation(); setFocusSide('right')
            const amount = Math.max(2, Math.min(Math.round(Math.abs(event.scroll?.delta ?? 1)), Math.max(2, Math.floor(rightH / 2))))
            const rdv = rightDiffViewRef.current
            const totalRows = pane === 2 && fileDiffMode === 'viewer'
              ? (diffLayout === 'split' ? (rdv?.splitRows.length ?? 0) : (rdv?.rows.length ?? 0))
              : 0
            if (totalRows > 0) setDiffCursorRow((current) => clampNumber(current + direction * amount, 0, totalRows - 1))
            diffScrollRef.current?.scrollBy(direction * amount)
          }}
        >
          {contentLoading && diffLines.length === 1 && diffLines[0] === 'Loading…' ? (
            <box width={rightW}>
              <text fg={theme.dim} wrapMode="none">loading…</text>
            </box>
          ) : pane === 2 && fileDiffMode === 'viewer' && rightDiffView && diffLayout === 'stack' ? (
            <>
              {rightDiffRows.map((row, idx) => {
                if (!showHunkHeaders && row.tone === 'hunk') return null
                const isCursor = focusSide === 'right' && idx === diffCursorRow
                const rowFg = diffRowColor(row, theme)
                const anchor = stackRowAnchor(row, selectedFilePath)
                const point = diffSelectionPointForStackRow(row)
                const singleRowSelection = point
                  ? {
                      start: point.lineNumber,
                      side: point.side,
                      end: point.lineNumber,
                      endSide: point.side,
                    }
                  : null
                const isSelectedDiffRow = focusSide === 'right' && idx >= diffSelectionStartIndex && idx <= diffSelectionEndIndex
                const currentSelectionRange = isSelectedDiffRow ? (diffSelectionCurrentSelection ?? singleRowSelection) : singleRowSelection
                const hasDraft = diffDraftSpan?.endIndex === idx
                const noteCards = (diffNotesByEndIndex.get(idx) ?? []).filter(({ key }) => draftNote?.rowKey !== key)
                const isHovered = hoveredDiffRowKey === row.key && anchor !== null
                const rowBackground = isSelectedDiffRow ? theme.surface3 : diffRowBackground(row, theme)
                return (
                  <React.Fragment key={row.key}>
                    <box
                      width={rightW}
                      flexDirection="row"
                      backgroundColor={rowBackground}
                      onMouseDown={(event) => beginDiffMouseSelection(event, idx)}
                      onMouseDrag={(event) => updateDiffMouseSelection(event, idx)}
                      onMouseOver={(event) => {
                        activateDiffHover(row.key)
                        updateDiffMouseSelection(event, idx)
                      }}
                      onMouseMove={(event) => {
                        activateDiffHover(row.key)
                        updateDiffMouseSelection(event, idx)
                      }}
                      onMouseUp={(event) => {
                        if (event.button !== 0) return
                        event.stopPropagation()
                        setDiffCursorRow(idx)
                      }}
                    >
                      {showLineNumbers ? (
                        <>
                          <text fg={theme.dim} wrapMode="none">
                            {fitTerminalText(formatDiffLineNumber(row.oldLine, rightDiffGutterWidth), rightDiffGutterWidth)}
                          </text>
                          <text fg={theme.dim} wrapMode="none"> </text>
                          <text fg={theme.dim} wrapMode="none">
                            {fitTerminalText(formatDiffLineNumber(row.newLine, rightDiffGutterWidth), rightDiffGutterWidth)}
                          </text>
                        </>
                      ) : null}
                      <text fg={isCursor ? theme.cyan : rowFg} wrapMode="none">
                        {fitTerminalText(
                          isCursor
                            ? `▶${row.indicator ?? diffRowIndicator(row)} `
                            : ` ${row.indicator ?? diffRowIndicator(row)} `,
                          3,
                        )}
                      </text>
                      {row.spans && row.spans.length > 0 ? (
                        <text wrapMode="none">
                          {renderDiffSpans(row.spans, rowFg, rightDiffTextWidth)}
                        </text>
                      ) : (
                        <text fg={rowFg} wrapMode="none">
                          {fitTerminalText(row.text || ' ', rightDiffTextWidth)}
                        </text>
                      )}
                      {/* Badge column: [+] on hover, ● on noted, blank otherwise */}
                      {isHovered ? (
                        <box
                          width={DIFF_BADGE_WIDTH}
                          onMouseUp={(event) => {
                            event.stopPropagation()
                            setDiffCursorRow(idx)
                            if (currentSelectionRange) {
                              const key = diffSelectionKey(selectedFilePath, currentSelectionRange)
                              setDraftNote({
                                rowKey: key,
                                range: currentSelectionRange,
                                lineLabel: diffSelectionLineLabel(currentSelectionRange),
                                text: diffNotes.get(key)?.text ?? '',
                              })
                            }
                          }}
                        >
                          <text fg={theme.cyan} bg={theme.surface3} wrapMode="none">[+]</text>
                        </box>
                      ) : noteCards.length > 0 ? (
                        <text fg={theme.violet} wrapMode="none"> ● </text>
                      ) : (
                        <text fg={theme.dim} wrapMode="none">{'   '}</text>
                      )}
                    </box>
                    {hasDraft && draftNote ? renderNoteDraft(draftNote, rightW, selectedFilePath, theme) : null}
                    {noteCards.map(({ key, note, label }) => (
                      <React.Fragment key={key}>
                        {renderNoteCard(
                          note,
                          rightW,
                          selectedFilePath,
                          theme,
                          label,
                          onSendDiffNoteToComposer ? () => sendDiffNoteToComposer(note, label) : undefined,
                        )}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                )
              })}
              {rightDiffTruncated ? (
                <box width={rightW}>
                  <text fg={theme.amber} wrapMode="none">
                    {`... ${rightDiffView.rows.length - MAX_DIFF_LINES} more lines truncated`}
                  </text>
                </box>
              ) : null}
            </>
          ) : pane === 2 && fileDiffMode === 'viewer' && rightDiffView && diffLayout === 'split' ? (
            <>
              {rightSplitRows.map((row, idx) => {
                if (!showHunkHeaders && row.tone === 'hunk') return null
                const isCursor = focusSide === 'right' && idx === diffCursorRow
                const anchor = splitRowAnchor(row, selectedFilePath)
                const point = diffSelectionPointForSplitRow(row)
                const singleRowSelection = point
                  ? {
                      start: point.lineNumber,
                      side: point.side,
                      end: point.lineNumber,
                      endSide: point.side,
                    }
                  : null
                const isSelectedDiffRow = focusSide === 'right' && idx >= diffSelectionStartIndex && idx <= diffSelectionEndIndex
                const currentSelectionRange = isSelectedDiffRow ? (diffSelectionCurrentSelection ?? singleRowSelection) : singleRowSelection
                const hasDraft = diffDraftSpan?.endIndex === idx
                const noteCards = (diffNotesByEndIndex.get(idx) ?? []).filter(({ key }) => draftNote?.rowKey !== key)
                // Full-width header rows (file label, hunk header, tree summary)
                if (row.tone !== 'split-change' && row.tone !== 'split-context') {
                  const fg = row.tone === 'file' || row.tone === 'hunk' ? theme.cyan : theme.dim
                  const bg = isSelectedDiffRow
                    ? theme.surface3
                    : row.tone === 'hunk'
                      ? theme.diffMetaBg
                      : row.tone === 'file'
                        ? theme.surface2
                        : undefined
                  return (
                    <React.Fragment key={row.key}>
                      <box
                        width={rightW}
                        backgroundColor={bg}
                        onMouseDown={(event) => beginDiffMouseSelection(event, idx)}
                        onMouseDrag={(event) => updateDiffMouseSelection(event, idx)}
                        onMouseOver={(event) => updateDiffMouseSelection(event, idx)}
                        onMouseMove={(event) => updateDiffMouseSelection(event, idx)}
                        onMouseUp={(event) => {
                          if (event.button !== 0) return
                          event.stopPropagation()
                          setDiffCursorRow(idx)
                        }}
                      >
                        <text fg={isCursor ? theme.cyan : fg} wrapMode="none">
                          {fitTerminalText((isCursor ? '▶ ' : '') + (row.text ?? ''), rightW - 1)}
                        </text>
                      </box>
                      {hasDraft && draftNote ? renderNoteDraft(draftNote, rightW, selectedFilePath, theme) : null}
                      {noteCards.map(({ key, note, label }) => (
                        <React.Fragment key={key}>
                          {renderNoteCard(
                            note,
                            rightW,
                            selectedFilePath,
                            theme,
                            label,
                            onSendDiffNoteToComposer ? () => sendDiffNoteToComposer(note, label) : undefined,
                          )}
                        </React.Fragment>
                      ))}
                    </React.Fragment>
                  )
                }
                // Paired change/context rows — hover shows [+] badge on divider
                const isHoveredSplit = hoveredDiffRowKey === row.key && anchor !== null
                return (
                  <React.Fragment key={row.key}>
                    <box
                      width={rightW}
                      flexDirection="row"
                      backgroundColor={isSelectedDiffRow ? theme.surface3 : undefined}
                      onMouseDown={(event) => beginDiffMouseSelection(event, idx)}
                      onMouseDrag={(event) => updateDiffMouseSelection(event, idx)}
                      onMouseOver={(event) => {
                        activateDiffHover(row.key)
                        updateDiffMouseSelection(event, idx)
                      }}
                      onMouseMove={(event) => {
                        activateDiffHover(row.key)
                        updateDiffMouseSelection(event, idx)
                      }}
                      onMouseUp={(event) => {
                        if (event.button !== 0) return
                        event.stopPropagation()
                        setDiffCursorRow(idx)
                      }}
                    >
                      {renderSplitSide(row.left, splitHalfW, splitLeftTextW, theme, showLineNumbers, splitGutterCols, rightDiffGutterWidth)}
                      {isHoveredSplit ? (
                        <box
                          width={1}
                          onMouseUp={(event) => {
                            event.stopPropagation()
                            setDiffCursorRow(idx)
                            if (currentSelectionRange) {
                              const key = diffSelectionKey(selectedFilePath, currentSelectionRange)
                              setDraftNote({
                                rowKey: key,
                                range: currentSelectionRange,
                                lineLabel: diffSelectionLineLabel(currentSelectionRange),
                                text: diffNotes.get(key)?.text ?? '',
                              })
                            }
                          }}
                        >
                          <text fg={theme.cyan} bg={theme.surface3} wrapMode="none">+</text>
                        </box>
                      ) : (
                        <text fg={noteCards.length > 0 ? theme.violet : isCursor ? theme.cyan : theme.border}>
                          {noteCards.length > 0 ? '●' : '│'}
                        </text>
                      )}
                      {renderSplitSide(row.right, splitRightHalfW, splitRightTextW, theme, showLineNumbers, splitGutterCols, rightDiffGutterWidth)}
                    </box>
                    {hasDraft && draftNote ? renderNoteDraft(draftNote, rightW, selectedFilePath, theme) : null}
                    {noteCards.map(({ key, note, label }) => (
                      <React.Fragment key={key}>
                        {renderNoteCard(
                          note,
                          rightW,
                          selectedFilePath,
                          theme,
                          label,
                          onSendDiffNoteToComposer ? () => sendDiffNoteToComposer(note, label) : undefined,
                        )}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                )
              })}
              {rightSplitTruncated ? (
                <box width={rightW}>
                  <text fg={theme.amber} wrapMode="none">
                    {`... ${rightDiffView.splitRows.length - MAX_DIFF_LINES} more lines truncated`}
                  </text>
                </box>
              ) : null}
            </>
          ) : (
            <>
              {diffLines.map((line, i) => {
                const fg = line.startsWith('+') && !line.startsWith('+++')
                  ? theme.green
                  : line.startsWith('-') && !line.startsWith('---')
                    ? theme.red
                    : line.startsWith('@@')
                      ? theme.cyan
                      : line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')
                        ? theme.muted
                        : theme.text
                return (
                  <box key={i} width={rightW}>
                    <text fg={fg} wrapMode="none">{line || ' '}</text>
                  </box>
                )
              })}
              {pane === 2 && diffTruncated ? (
                <box width={rightW}>
                  <text fg={theme.amber} wrapMode="none">
                    {`… diff truncated — ${allDiffLines.length - MAX_DIFF_LINES} more lines not shown`}
                  </text>
                </box>
              ) : null}
            </>
          )}
        </scrollbox>
      </box>
    </box>
  )
}
