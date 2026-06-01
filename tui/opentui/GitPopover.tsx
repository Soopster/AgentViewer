/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import { fetchGitData, fetchGitPaneContent, type GitData, type GitStatusEntry } from '../../lib/gitProvider'
import { runGitCommand } from '../../lib/gitNodeProvider'
import {
  buildPierreDiffView,
  loadDiffHighlights,
  type TuiFileHighlights,
  type TuiPierreDiffRow,
  type TuiRenderSpan,
} from './pierreDiffView'

// ---------------------------------------------------------------------------
// Git data types
// ---------------------------------------------------------------------------

type TreeNode =
  | { kind: 'dir';  path: string; name: string; depth: number; expanded: boolean }
  | { kind: 'file'; path: string; name: string; depth: number; x: string; y: string }

function buildVisibleNodes(entries: GitStatusEntry[], expandedDirs: Set<string>): TreeNode[] {
  // Build a nested map: dirPath → { subdirs, files }
  interface DirData { subdirs: Map<string, DirData>; files: GitStatusEntry[] }
  const root: DirData = { subdirs: new Map(), files: [] }

  for (const entry of entries) {
    const parts = entry.path.split('/')
    let cur = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!
      if (!cur.subdirs.has(seg)) cur.subdirs.set(seg, { subdirs: new Map(), files: [] })
      cur = cur.subdirs.get(seg)!
    }
    cur.files.push(entry)
  }

  const nodes: TreeNode[] = []

  function flatten(dir: DirData, prefix: string, depth: number) {
    // Directories first (alphabetical), then root-level files
    const sortedDirs = [...dir.subdirs.entries()].sort(([a], [b]) => a.localeCompare(b))
    for (const [name, sub] of sortedDirs) {
      const dirPath = prefix ? `${prefix}/${name}` : name
      const expanded = expandedDirs.has(dirPath)
      nodes.push({ kind: 'dir', path: dirPath, name, depth, expanded })
      if (expanded) flatten(sub, dirPath, depth + 1)
    }
    for (const entry of dir.files) {
      const name = entry.path.split('/').at(-1) ?? entry.path
      nodes.push({ kind: 'file', path: entry.path, name, depth, x: entry.x, y: entry.y })
    }
  }

  flatten(root, '', 0)
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

// ---------------------------------------------------------------------------
// GitPopover component
// ---------------------------------------------------------------------------

type GitKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }
type FocusSide = 'left' | 'right'
type FileDiffMode = 'text' | 'viewer'
type LeftPaneMode = 'normal' | 'expanded' | 'hidden'

const LEFT_PANE_MIN_WIDTH = 24
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
}

export function GitPopover({ cwd, theme, width, height, onClose, onKeyHandlerReady }: Props) {
  const repoCwd = cwd || process.cwd()
  const [data, setData] = useState<GitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [contentLoading, setContentLoading] = useState(false)
  const [pane, setPane] = useState<PaneId>(2)
  const [focusSide, setFocusSide] = useState<FocusSide>('left')
  const [fileDiffMode, setFileDiffMode] = useState<FileDiffMode>('viewer')
  const [diffHighlights, setDiffHighlights] = useState<Map<string, TuiFileHighlights> | null>(null)
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>('normal')
  const [leftPaneWidth, setLeftPaneWidth] = useState(LEFT_PANE_DEFAULT_MAX_WIDTH)
  const [treeCursor, setTreeCursor] = useState(0)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [branchIndex, setBranchIndex] = useState(0)
  const [commitIndex, setCommitIndex] = useState(0)
  const [fileScrollTop, setFileScrollTop] = useState(0)
  const [branchScrollTop, setBranchScrollTop] = useState(0)
  const [commitScrollTop, setCommitScrollTop] = useState(0)
  const diffScrollRef = useRef<ScrollBoxRenderable>(null)
  const rightContentRequestRef = useRef(0)
  const rightContentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    setFileScrollTop(0)
    setBranchScrollTop(0)
    setCommitScrollTop(0)
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

  // Auto-scroll left panes to keep cursors visible
  useEffect(() => {
    const viewportH = Math.max(1, Math.max(5, Math.min(14, visibleNodes.length + 3)) - 2)
    setFileScrollTop((top) => {
      if (treeCursor < top) return treeCursor
      if (treeCursor >= top + viewportH) return treeCursor - viewportH + 1
      return top
    })
  }, [treeCursor, visibleNodes.length])

  useEffect(() => {
    const viewportH = Math.max(1, Math.max(4, Math.min(8, (data?.branches.length ?? 0) + 3)) - 2)
    setBranchScrollTop((top) => {
      if (branchIndex < top) return branchIndex
      if (branchIndex >= top + viewportH) return branchIndex - viewportH + 1
      return top
    })
  }, [branchIndex, data?.branches.length])

  useEffect(() => {
    const popH = Math.min(height - 4, 60)
    const treeH = Math.max(5, Math.min(14, visibleNodes.length + 3))
    const branchesH = Math.max(4, Math.min(8, (data?.branches.length ?? 0) + 3))
    const commitsH = Math.max(popH - 2 - 4 - treeH - branchesH, 4)
    const viewportH = Math.max(1, commitsH - 1)
    setCommitScrollTop((top) => {
      if (commitIndex < top) return commitIndex
      if (commitIndex >= top + viewportH) return commitIndex - viewportH + 1
      return top
    })
  }, [commitIndex, data?.branches.length, height, visibleNodes.length])

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

  const handleKey = useCallback((key: GitKeyEvent) => {
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
      if (focusSide === 'left' && pane === 2) setTreeCursor((i) => Math.min(i + 1, visibleNodes.length - 1))
      else if (focusSide === 'left' && pane === 3 && data) setBranchIndex((i) => Math.min(i + 1, data.branches.length - 1))
      else if (focusSide === 'left' && pane === 4 && data) setCommitIndex((i) => Math.min(i + 1, data.commits.length - 1))
      else diffScrollRef.current?.scrollBy(1)
      return
    }
    if (key.name === 'k' || key.name === 'up') {
      if (focusSide === 'left' && pane === 2) setTreeCursor((i) => Math.max(i - 1, 0))
      else if (focusSide === 'left' && pane === 3 && data) setBranchIndex((i) => Math.max(i - 1, 0))
      else if (focusSide === 'left' && pane === 4 && data) setCommitIndex((i) => Math.max(i - 1, 0))
      else diffScrollRef.current?.scrollBy(-1)
      return
    }

    // Enter / space: toggle dir expansion
    if ((key.name === 'return' || key.sequence === ' ') && pane === 2 && focusSide === 'left') {
      const node = visibleNodes[treeCursor]
      if (node?.kind === 'dir') {
        setExpandedDirs((prev) => {
          const next = new Set(prev)
          if (next.has(node.path)) next.delete(node.path)
          else next.add(node.path)
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
        setExpandedDirs((prev) => { const next = new Set(prev); next.delete(node.path); return next })
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
        setExpandedDirs((prev) => { const next = new Set(prev); next.add(node.path); return next })
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
      return
    }
  }, [data, expandedDirs, focusSide, leftPaneMode, onClose, pane, repoCwd, treeCursor, visibleNodes])

  // Register key handler with parent
  useEffect(() => {
    onKeyHandlerReady(handleKey)
  }, [handleKey, onKeyHandlerReady])

  useEffect(() => {
    if (leftPaneMode === 'hidden' && focusSide === 'left') setFocusSide('right')
  }, [focusSide, leftPaneMode])

  // Dimensions
  const popW = Math.min(width - 4, 160)
  const popH = Math.min(height - 4, 60)
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
  const treeH = Math.max(5, Math.min(14, (visibleNodes.length) + 3))
  const branchesH = Math.max(4, Math.min(8, (data?.branches.length ?? 0) + 3))
  const commitsH = Math.max(leftInnerH - statusH - treeH - branchesH, 4)
  const rightH = popH - 2
  const focusLabel = focusSide === 'right' ? 'shift-tab return left' : 'tab focus right'
  const fileDiffLabel = fileDiffMode === 'viewer'
    ? `v plain  ${diffHighlights ? '●' : '○'} syntax`
    : 'v parsed'

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
    () => (pane === 2 && fileDiffMode === 'viewer'
      ? buildPierreDiffView(rightContent, selectedFilePath ?? 'git-diff', diffHighlights, pierreAppearance)
      : null),
    [diffHighlights, fileDiffMode, pane, pierreAppearance, rightContent, selectedFilePath],
  )
  const rightDiffRows = rightDiffView ? rightDiffView.rows.slice(0, MAX_DIFF_LINES) : []
  const rightDiffTruncated = rightDiffView ? rightDiffView.rows.length > MAX_DIFF_LINES : false
  const rightDiffLineNumbers = rightDiffRows.flatMap((row) => [row.oldLine, row.newLine].filter((value): value is number => value != null))
  const rightDiffGutterWidth = Math.max(
    rightDiffLineNumbers.length > 0 ? Math.max(...rightDiffLineNumbers).toString().length : 1,
    1,
  )
  const rightDiffTextWidth = Math.max(rightW - (rightDiffGutterWidth * 2) - 5, 12)

  function clampLeftPaneWidth(nextWidth: number): number {
    return Math.max(minLeftW, Math.min(nextWidth, maxLeftW))
  }

  function setPresetLeftPaneWidth(mode: Exclude<LeftPaneMode, 'hidden'>) {
    setLeftPaneMode(mode)
    setLeftPaneWidth(clampLeftPaneWidth(mode === 'expanded' ? maxLeftW : defaultLeftW))
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

        {/* [2] Files — tree view */}
        <box
          height={treeH}
          flexDirection="column"
          border={['bottom']} borderStyle="single"
          borderColor={pane === 2 ? theme.border2 : theme.border}
          backgroundColor={pane === 2 ? theme.surface2 : theme.surface}
        >
          <box paddingX={1} width={leftW - 2} flexDirection="row" backgroundColor={pane === 2 ? theme.cyan : 'transparent'}>
            <text fg={pane === 2 ? theme.surface : theme.muted}>[2] Files</text>
            {pane === 2 && fileCount > 0 ? (
              <box flexGrow={1}>
                <text fg={pane === 2 ? theme.surface2 : theme.dim}>{`  ${filePosition}/${fileCount}`}</text>
              </box>
            ) : null}
          </box>

          <box flexDirection="row">
            <box flexGrow={1} flexDirection="column">
              {visibleNodes.slice(fileScrollTop, fileScrollTop + (treeH - 2)).map((node, i) => {
                const absoluteIdx = fileScrollTop + i
                const isCursor = absoluteIdx === treeCursor && pane === 2
                const indent = '  '.repeat(node.depth)
                let label: string
                let labelColor: string
                if (node.kind === 'dir') {
                  label = `${indent}${node.expanded ? '▼' : '▶'} ${node.name}`
                  labelColor = isCursor ? theme.text : theme.muted
                } else {
                  const flags = `${node.x.trim() || node.y.trim() ? (node.x.trim() || node.y) : '??'}`
                  label = `${indent}${flags} ${node.name}`
                  labelColor = isCursor ? theme.text : statusColor(node.x, node.y)
                }
                return (
                  <box
                    key={node.path}
                    paddingX={1}
                    backgroundColor={isCursor ? theme.surface3 : 'transparent'}
                  >
                    <text fg={labelColor} wrapMode="none">{label}</text>
                  </box>
                )
              })}
              {(!data || data.status.length === 0) ? (
                <box paddingX={1}><text fg={theme.dim}>clean</text></box>
              ) : null}
            </box>
            <PanelScrollbar total={visibleNodes.length} viewportH={treeH - 2} scrollTop={fileScrollTop} theme={theme} />
          </box>
        </box>

        {/* [3] Branches */}
        <box
          height={branchesH}
          flexDirection="column"
          border={['bottom']} borderStyle="single"
          borderColor={pane === 3 ? theme.border2 : theme.border}
          backgroundColor={pane === 3 ? theme.surface2 : theme.surface}
        >
          <box paddingX={1} width={leftW - 2} backgroundColor={pane === 3 ? theme.cyan : 'transparent'}>
            <text fg={pane === 3 ? theme.surface : theme.muted}>[3] Branches</text>
          </box>
          <box flexDirection="row">
            <box flexGrow={1} flexDirection="column">
              {(data?.branches ?? []).slice(branchScrollTop, branchScrollTop + (branchesH - 2)).map((b, i) => {
                const isCurrent = b === data?.branch
                const isSel = (branchScrollTop + i) === branchIndex && pane === 3
                return (
                  <box key={b} paddingX={1} backgroundColor={isSel ? theme.surface3 : 'transparent'}>
                    <text fg={isCurrent ? theme.green : isSel ? theme.text : theme.muted} wrapMode="none">
                      {isCurrent ? `* ${b}` : `  ${b}`}
                    </text>
                  </box>
                )
              })}
            </box>
            <PanelScrollbar total={data?.branches.length ?? 0} viewportH={branchesH - 2} scrollTop={branchScrollTop} theme={theme} />
          </box>
        </box>

        {/* [4] Commits */}
        <box flexGrow={1} flexDirection="column" backgroundColor={pane === 4 ? theme.surface2 : theme.surface}>
          <box paddingX={1} width={leftW - 2} backgroundColor={pane === 4 ? theme.cyan : 'transparent'}>
            <text fg={pane === 4 ? theme.surface : theme.muted}>[4] Commits</text>
          </box>
          <box flexDirection="row">
            <box flexGrow={1} flexDirection="column">
              {(data?.commits ?? []).slice(commitScrollTop, commitScrollTop + (commitsH - 1)).map((c, i) => {
                const isSel = (commitScrollTop + i) === commitIndex && pane === 4
                const spaceIdx = c.indexOf(' ')
                const hash = spaceIdx > 0 ? c.slice(0, spaceIdx) : c
                const msg = spaceIdx > 0 ? c.slice(spaceIdx + 1) : ''
                return (
                  <box key={c} paddingX={1} flexDirection="row" backgroundColor={isSel ? theme.surface3 : 'transparent'}>
                    <text fg={theme.amber} wrapMode="none">{hash} </text>
                    <text fg={isSel ? theme.text : theme.dim} wrapMode="none">
                      {msg.slice(0, leftW - hash.length - 5)}
                    </text>
                  </box>
                )
              })}
            </box>
            <PanelScrollbar total={data?.commits.length ?? 0} viewportH={commitsH - 1} scrollTop={commitScrollTop} theme={theme} />
          </box>
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
        <box paddingX={1} flexDirection="row">
          <text fg={theme.cyan}>{`${focusLabel}  ·  ${PANE_TITLES[pane]}  ·  1-4 sections  ·  ${fileDiffLabel}  ·  [ ] resize  ·  w wide  ·  - hide/show  ·  j/k move  ·  h/l collapse/expand  ·  enter toggle  ·  r refresh  ·  esc close`}</text>
        </box>
        <scrollbox
          ref={diffScrollRef}
          width={rightW}
          height={rightH - 1}
          backgroundColor={theme.surface}
          scrollY
          scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
        >
          {contentLoading && diffLines.length === 1 && diffLines[0] === 'Loading…' ? (
            <box width={rightW}>
              <text fg={theme.dim} wrapMode="none">loading…</text>
            </box>
          ) : pane === 2 && fileDiffMode === 'viewer' && rightDiffView ? (
            <>
              {rightDiffRows.map((row) => (
                <box
                  key={row.key}
                  width={rightW}
                  flexDirection="row"
                  backgroundColor={diffRowBackground(row, theme)}
                >
                  <text fg={theme.dim} wrapMode="none">
                    {fitTerminalText(formatDiffLineNumber(row.oldLine, rightDiffGutterWidth), rightDiffGutterWidth)}
                  </text>
                  <text fg={theme.dim} wrapMode="none"> </text>
                  <text fg={theme.dim} wrapMode="none">
                    {fitTerminalText(formatDiffLineNumber(row.newLine, rightDiffGutterWidth), rightDiffGutterWidth)}
                  </text>
                  <text fg={diffRowColor(row, theme)} wrapMode="none">
                    {fitTerminalText(` ${row.indicator ?? diffRowIndicator(row)} `, 3)}
                  </text>
                  {row.spans && row.spans.length > 0 ? (
                    <text wrapMode="none">
                      {renderDiffSpans(row.spans, diffRowColor(row, theme), rightDiffTextWidth)}
                    </text>
                  ) : (
                    <text fg={diffRowColor(row, theme)} wrapMode="none">
                      {fitTerminalText(row.text || ' ', rightDiffTextWidth)}
                    </text>
                  )}
                </box>
              ))}
              {rightDiffTruncated ? (
                <box width={rightW}>
                  <text fg={theme.amber} wrapMode="none">
                    {`... diff truncated - ${rightDiffView.rows.length - MAX_DIFF_LINES} more lines not shown`}
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
