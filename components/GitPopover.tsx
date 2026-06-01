'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Clock3, Columns2, GitBranch, Hash, Info, ListTree, Maximize2, PanelLeftClose, PanelLeftOpen, RefreshCw, Rows3, WrapText, X } from 'lucide-react'
import type { SelectedLineRange } from '@pierre/diffs'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { prepareFileTreeInput } from '@pierre/trees'
import type { GitData, GitStatusEntry } from '@/lib/gitProvider'
import type { GitStatusEntry as TreeGitStatusEntry } from '@pierre/trees'
import { PierrePatchDiffView, type PierreChangeStyle, type PierreDiffPresentation, type PierreDiffStyle, type PierreInlineDiffStyle } from './PierreDiffView'

// ─── Types ────────────────────────────────────────────────────────────────────

type TreeNode =
  | { kind: 'dir'; path: string; name: string; depth: number; expanded: boolean }
  | { kind: 'file'; path: string; name: string; depth: number; x: string; y: string }

type PaneId = 1 | 2 | 3 | 4
type LeftPaneMode = 'normal' | 'expanded' | 'hidden'

const LEFT_PANE_MIN_WIDTH = 280
const LEFT_PANE_DEFAULT_WIDTH = 440
const LEFT_PANE_EXPANDED_WIDTH = 680
const LEFT_PANE_MAX_WIDTH_RATIO = 0.58
const LEFT_PANE_RESIZE_STEP = 36

// ─── Tree helpers ─────────────────────────────────────────────────────────────

function buildVisibleNodes(entries: GitStatusEntry[], expandedDirs: Set<string>): TreeNode[] {
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
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  return dirs
}

// ─── API helper ───────────────────────────────────────────────────────────────

async function fetchGitData(cwd: string): Promise<GitData> {
  try {
    const res = await fetch('/api/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, action: 'data' }),
    })
    const body = await res.json() as { data?: GitData }
    if (!res.ok || !body.data) throw new Error('Failed to load git data')
    return body.data
  } catch {
    return {
      branch: 'HEAD',
      upstream: null,
      ahead: 0,
      behind: 0,
      status: [],
      unstaged: '',
      staged: '',
      branches: [],
      commits: [],
    }
  }
}

async function fetchGitContent({
  cwd,
  data,
  pane,
  selectedFilePath,
  branchIndex,
  commitIndex,
}: {
  cwd: string
  data: GitData
  pane: PaneId
  selectedFilePath: string | null
  branchIndex: number
  commitIndex: number
}): Promise<string> {
  try {
    const res = await fetch('/api/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cwd,
        action: 'content',
        data,
        pane,
        selectedFilePath,
        branchIndex,
        commitIndex,
      }),
    })
    const body = await res.json() as { content?: string }
    return body.content ?? ''
  } catch {
    return ''
  }
}

function GitFileTreePane({
  data,
  selectedFilePath,
  onSelectFile,
}: {
  data: GitData
  selectedFilePath: string | null
  onSelectFile: (path: string) => void
}) {
  const filePaths = useMemo(() => data.status.map((entry) => entry.path), [data.status])
  const preparedInput = useMemo(
    () => prepareFileTreeInput(filePaths, { flattenEmptyDirectories: true, sort: 'default' }),
    [filePaths],
  )
  const expandedPaths = useMemo(() => allDirPaths(data.status), [data.status])
  const statusByPath = useMemo(() => data.status.map(toTreeGitStatus), [data.status])

  const { model } = useFileTree({
    preparedInput,
    icons: { set: 'complete', colored: true },
    gitStatus: statusByPath,
    initialExpandedPaths: [...expandedPaths],
    initialSelectedPaths: selectedFilePath ? [selectedFilePath] : undefined,
    search: false,
    stickyFolders: true,
    density: 'compact',
    overscan: 6,
    onSelectionChange: (selectedPaths) => {
      const next = [...selectedPaths].reverse().find((path) => filePaths.includes(path))
      if (next) onSelectFile(next)
    },
  })

  useEffect(() => {
    if (!selectedFilePath) return
    model.focusPath(selectedFilePath)
    model.scrollToPath(selectedFilePath, { offset: 'nearest' })
  }, [model, selectedFilePath])

  return (
    <div style={{ flex: 1, minHeight: 0, background: 'var(--surface)', overflow: 'hidden' }}>
      <FileTree
        model={model}
        style={{ height: '100%', minHeight: 0 }}
      />
    </div>
  )
}

// ─── Style helpers ────────────────────────────────────────────────────────────

function statusColor(x: string, y: string): string {
  if (x === '?' && y === '?') return 'var(--red)'
  if (x.trim()) return 'var(--green)'
  if (y === 'M') return 'var(--amber)'
  if (y === 'D') return 'var(--red)'
  return 'var(--text-2)'
}

function toTreeGitStatus(entry: GitStatusEntry): TreeGitStatusEntry {
  return {
    path: entry.path,
    status:
      entry.x === '?' && entry.y === '?' ? 'untracked'
        : entry.x === 'A' || entry.y === 'A' ? 'added'
          : entry.x === 'D' || entry.y === 'D' ? 'deleted'
            : entry.x === 'R' || entry.y === 'R' ? 'renamed'
              : entry.x === '!' || entry.y === '!' ? 'ignored'
                : 'modified',
  }
}

function formatSelectedRange(selection: SelectedLineRange): string {
  if (selection.start === selection.end) return `Line ${selection.start}`
  return `Lines ${selection.start}-${selection.end}`
}

const PANE_LABELS: Record<PaneId, string> = {
  1: 'Status',
  2: 'Files',
  3: 'Branches',
  4: 'Commits',
}

const PANE_ICONS: Record<PaneId, ReactNode> = {
  1: <Info size={15} />,
  2: <ListTree size={15} />,
  3: <GitBranch size={15} />,
  4: <Clock3 size={15} />,
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  open: boolean
  onClose: () => void
  cwd: string
}

export default function GitPopover({ open, onClose, cwd }: Props) {
  const [data, setData] = useState<GitData | null>(null)
  const [loading, setLoading] = useState(false)
  const [pane, setPane] = useState<PaneId>(2)
  const [focusSide, setFocusSide] = useState<'left' | 'right'>('left')
  const [branchIndex, setBranchIndex] = useState(0)
  const [commitIndex, setCommitIndex] = useState(0)
  const [rightContent, setRightContent] = useState('')
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>('normal')
  const [leftPaneWidth, setLeftPaneWidth] = useState(LEFT_PANE_DEFAULT_WIDTH)
  const [diffStyle, setDiffStyle] = useState<PierreDiffStyle>('stacked')
  const [changeStyle, setChangeStyle] = useState<PierreChangeStyle>('classic')
  const [inlineDiffStyle, setInlineDiffStyle] = useState<PierreInlineDiffStyle>('word-alt')
  const [wrapDiff, setWrapDiff] = useState(true)
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

  const rightContentRequestRef = useRef(0)
  const rightContentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const branchListRef = useRef<HTMLDivElement>(null)
  const commitListRef = useRef<HTMLDivElement>(null)
  const diffAvailable = pane === 2 && rightContent.trim().length > 0
  const leftPaneHidden = leftPaneMode === 'hidden'
  const leftPaneExpanded = leftPaneMode === 'expanded'
  const diffPresentation = useMemo<PierreDiffPresentation>(() => ({
    diffStyle,
    changeStyle,
    inlineDiffStyle,
    wrap: wrapDiff,
    showLineNumbers,
  }), [changeStyle, diffStyle, inlineDiffStyle, showLineNumbers, wrapDiff])

  // Fetch git data when popover opens
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setData(null)
    void fetchGitData(cwd)
      .then((next) => { if (!cancelled) { setData(next); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, cwd])

  // Place the right pane on the first file when data loads
  useEffect(() => {
    if (!data) return
    const firstFile = data.status[0]?.path ?? null
    setSelectedFilePath(firstFile)
    setBranchIndex(0)
    setCommitIndex(0)
  }, [data])

  useEffect(() => {
    branchListRef.current?.querySelector('[data-cursor]')?.scrollIntoView({ block: 'nearest' })
  }, [branchIndex])

  useEffect(() => {
    commitListRef.current?.querySelector('[data-cursor]')?.scrollIntoView({ block: 'nearest' })
  }, [commitIndex])

  // Right panel content loader (debounced like TUI)
  useEffect(() => {
    if (!open || !data) {
      setRightContent('')
      setContentLoading(false)
      return
    }

    const requestId = ++rightContentRequestRef.current
    if (rightContentTimerRef.current) clearTimeout(rightContentTimerRef.current)

    setContentLoading(true)
    setSelectedLines(null)
    rightContentTimerRef.current = setTimeout(() => {
      void (async () => {
        const content = await fetchGitContent({
          cwd,
          data,
          pane,
          selectedFilePath,
          branchIndex,
          commitIndex,
        })

        if (rightContentRequestRef.current !== requestId) return
        setRightContent(content)
        setContentLoading(false)
        if (rightPanelRef.current) rightPanelRef.current.scrollTop = 0
      })()
    }, 180)

    return () => {
      if (rightContentTimerRef.current) clearTimeout(rightContentTimerRef.current)
    }
  }, [open, data, pane, cwd, selectedFilePath, branchIndex, commitIndex])

  // Keyboard handler
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }

      if (e.key === 'Tab') {
        e.preventDefault()
        setFocusSide((s) => (leftPaneHidden || s === 'left' ? 'right' : 'left'))
        return
      }

      if (e.key >= '1' && e.key <= '4') {
        setPane(parseInt(e.key, 10) as PaneId)
        return
      }

      if (e.key === '[' || e.key === ']') {
        e.preventDefault()
        if (leftPaneHidden) setLeftPaneMode('normal')
        setLeftPaneWidth((current) => {
          const nextWidth = clampLeftPaneWidth(current + (e.key === ']' ? LEFT_PANE_RESIZE_STEP : -LEFT_PANE_RESIZE_STEP))
          setLeftPaneMode(nextWidth >= LEFT_PANE_EXPANDED_WIDTH - 24 ? 'expanded' : 'normal')
          return nextWidth
        })
        return
      }

      const isDown = e.key === 'j' || e.key === 'ArrowDown'
      const isUp = e.key === 'k' || e.key === 'ArrowUp'

      if (isDown || isUp) {
        e.preventDefault()
        const delta = isDown ? 1 : -1
        if (focusSide === 'right') {
          if (rightPanelRef.current) rightPanelRef.current.scrollTop += delta * 20
        } else if (pane === 3 && data) {
          setBranchIndex((i) => Math.max(0, Math.min(i + delta, data.branches.length - 1)))
        } else if (pane === 4 && data) {
          setCommitIndex((i) => Math.max(0, Math.min(i + delta, data.commits.length - 1)))
        }
        return
      }

      if (pane === 2 && focusSide === 'left' && (e.key === 'Enter' || e.key === ' ' || e.key === 'h' || e.key === 'l' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        return
      }

      if (e.key === 'd') {
        if (rightPanelRef.current) rightPanelRef.current.scrollTop += 200
        return
      }
      if (e.key === 'u') {
        if (rightPanelRef.current) rightPanelRef.current.scrollTop -= 200
        return
      }

      if (e.key === 'r') {
        setLoading(true)
        void fetchGitData(cwd)
          .then((next) => { setData(next); setLoading(false) })
          .catch(() => setLoading(false))
        return
      }
    },
    [cwd, data, focusSide, leftPaneHidden, onClose, pane],
  )

  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, handleKey])

  useEffect(() => {
    if (leftPaneHidden && focusSide === 'left') setFocusSide('right')
  }, [focusSide, leftPaneHidden])

  if (!open) return null

  const diffLines = rightContent.split('\n')
  const changedFileCount = data?.status.length ?? 0
  const selectedEntry = data?.status.find((entry) => entry.path === selectedFilePath)
  const selectedTitle =
    pane === 1 ? 'Repository status'
      : pane === 2 ? (selectedFilePath ?? (changedFileCount === 0 ? 'Working tree clean' : 'Select a file'))
        : pane === 3 ? (data?.branches[branchIndex] ?? 'Branches')
          : (data?.commits[commitIndex] ?? 'Commits')

  function statusLabel(x: string, y: string): string {
    if (x === '?' && y === '?') return 'Untracked'
    if (x.trim() && y.trim()) return 'Staged + modified'
    if (x.trim()) return 'Staged'
    if (y === 'M') return 'Modified'
    if (y === 'D') return 'Deleted'
    return 'Changed'
  }

  function rowBackground(id: string, selected: boolean): string {
    if (selected) return 'color-mix(in srgb, var(--cyan) 14%, var(--surface-3))'
    if (hoveredRow === id) return 'var(--surface-2)'
    return 'transparent'
  }

  function clampLeftPaneWidth(width: number): number {
    const shellWidth = shellRef.current?.getBoundingClientRect().width ?? window.innerWidth
    const maxWidth = Math.max(
      LEFT_PANE_MIN_WIDTH,
      Math.min(LEFT_PANE_EXPANDED_WIDTH, Math.floor(shellWidth * LEFT_PANE_MAX_WIDTH_RATIO)),
    )
    return Math.max(LEFT_PANE_MIN_WIDTH, Math.min(width, maxWidth))
  }

  function setPresetLeftPaneWidth(mode: Exclude<LeftPaneMode, 'hidden'>) {
    setLeftPaneMode(mode)
    setLeftPaneWidth(clampLeftPaneWidth(mode === 'expanded' ? LEFT_PANE_EXPANDED_WIDTH : LEFT_PANE_DEFAULT_WIDTH))
  }

  function startLeftPaneResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = leftPaneWidth
    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = clampLeftPaneWidth(startWidth + moveEvent.clientX - startX)
      setLeftPaneWidth(nextWidth)
      setLeftPaneMode(nextWidth >= LEFT_PANE_EXPANDED_WIDTH - 24 ? 'expanded' : 'normal')
    }

    function handlePointerUp() {
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 8,
      }}
    >
      <div
        ref={shellRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1680px, calc(100vw - 16px))',
          height: 'calc(100vh - 16px)',
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-2)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              display: 'grid',
              placeItems: 'center',
              background: 'color-mix(in srgb, var(--violet) 18%, var(--surface-3))',
              color: 'var(--violet)',
              border: '1px solid color-mix(in srgb, var(--violet) 34%, var(--border))',
              flexShrink: 0,
            }}
          >
            <GitBranch size={18} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.01em' }}>
                Git status
              </div>
              {loading ? (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Loading…</span>
              ) : data ? (
                <>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    maxWidth: 220,
                    padding: '3px 8px',
                    borderRadius: 999,
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border)',
                    color: 'var(--violet)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    <GitBranch size={12} />
                    {data.branch}
                  </span>
                  <span style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: changedFileCount > 0 ? 'var(--amber)' : 'var(--green)',
                  }}>
                    {changedFileCount === 0 ? 'Clean' : `${changedFileCount} changed`}
                  </span>
                  {data.upstream && (
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
                      ↑{data.ahead} ↓{data.behind}
                    </span>
                  )}
                </>
              ) : null}
            </div>
            <div
              title={cwd}
              style={{
                marginTop: 3,
                color: 'var(--text-3)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {cwd}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              void fetchGitData(cwd)
                .then((next) => setData(next))
                .finally(() => setLoading(false))
            }}
            title="Refresh git status"
            style={{
              height: 34,
              width: 34,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-2)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              height: 34,
              width: 34,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-2)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
          }}
        >
          {([1, 2, 3, 4] as PaneId[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPane(p)}
              style={{
                height: 34,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '0 12px',
                borderRadius: 8,
                border: `1px solid ${pane === p ? 'color-mix(in srgb, var(--cyan) 42%, var(--border))' : 'var(--border)'}`,
                background: pane === p ? 'color-mix(in srgb, var(--cyan) 13%, var(--surface-2))' : 'var(--surface)',
                color: pane === p ? 'var(--cyan)' : 'var(--text-2)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {PANE_ICONS[p]}
              {PANE_LABELS[p]}
              {p === 2 && changedFileCount > 0 ? (
                <span style={{
                  minWidth: 20,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: pane === p ? 'color-mix(in srgb, var(--cyan) 18%, var(--surface-3))' : 'var(--surface-2)',
                  color: pane === p ? 'var(--cyan)' : 'var(--text-3)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                }}>
                  {changedFileCount}
                </span>
              ) : null}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {leftPaneHidden ? (
            <button
              type="button"
              onClick={() => {
                setPresetLeftPaneWidth('normal')
                setFocusSide('left')
              }}
              title="Show file pane"
              style={{
                height: 34,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '0 11px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-2)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <PanelLeftOpen size={15} />
              Show Files
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPresetLeftPaneWidth(leftPaneExpanded ? 'normal' : 'expanded')}
                title={leftPaneExpanded ? 'Restore file pane width' : 'Expand file pane'}
                style={{
                  height: 34,
                  width: 34,
                  borderRadius: 8,
                  border: `1px solid ${leftPaneExpanded ? 'color-mix(in srgb, var(--cyan) 42%, var(--border))' : 'var(--border)'}`,
                  background: leftPaneExpanded ? 'color-mix(in srgb, var(--cyan) 13%, var(--surface-2))' : 'var(--surface)',
                  color: leftPaneExpanded ? 'var(--cyan)' : 'var(--text-2)',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <Maximize2 size={15} />
              </button>
              <button
                type="button"
                onClick={() => setLeftPaneMode('hidden')}
                title="Hide file pane"
                style={{
                  height: 34,
                  width: 34,
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-2)',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <PanelLeftClose size={15} />
              </button>
            </>
          )}
          <span style={{ color: 'var(--text-3)', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>
            Ctrl+G opens · Esc closes
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {!leftPaneHidden && (
            <div
              style={{
                width: leftPaneWidth,
                flexShrink: 0,
                borderRight: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                background: 'var(--surface)',
                position: 'relative',
                transition: 'width 0.08s ease',
              }}
            >
              <button
                type="button"
                aria-label="Resize file pane"
                title="Drag to resize file pane"
                onPointerDown={startLeftPaneResize}
                style={{
                  position: 'absolute',
                  top: 0,
                  right: -4,
                  bottom: 0,
                  width: 8,
                  zIndex: 3,
                  border: 'none',
                  padding: 0,
                  background: 'transparent',
                  cursor: 'col-resize',
                }}
              />
              <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '12px 14px',
                borderBottom: '1px solid var(--border)',
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                {PANE_LABELS[pane]}
              </div>
            </div>

            {pane === 1 ? (
              <div style={{ padding: 14, display: 'grid', gap: 10, overflow: 'auto' }}>
                <InfoCard label="Branch" value={data?.branch ?? 'HEAD'} tone="violet" />
                <InfoCard label="Working tree" value={changedFileCount === 0 ? 'Clean' : `${changedFileCount} changed files`} tone={changedFileCount === 0 ? 'green' : 'amber'} />
                <InfoCard label="Upstream" value={data?.upstream ?? 'No upstream configured'} tone="muted" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <InfoCard label="Ahead" value={String(data?.ahead ?? 0)} tone="green" />
                <InfoCard label="Behind" value={String(data?.behind ?? 0)} tone="amber" />
                </div>
              </div>
            ) : pane === 2 ? (
              data && data.status.length > 0 ? (
                <GitFileTreePane
                  key={data.status.map((entry) => entry.path).join('\u0000')}
                  data={data}
                  selectedFilePath={selectedFilePath}
                  onSelectFile={(path) => setSelectedFilePath(path)}
                />
              ) : loading ? (
                <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
              ) : (
                <EmptyState title="No file changes" description="The working tree is clean." />
              )
            ) : pane === 3 ? (
              <div ref={branchListRef} style={{ overflow: 'auto', flex: 1, padding: 8 }}>
                {(data?.branches ?? []).map((branch, i) => {
                  const rowId = `branch:${branch}`
                  const isCurrent = branch === data?.branch
                  const isSel = i === branchIndex && pane === 3
                  return (
                    <button
                      key={branch}
                      type="button"
                      data-cursor={isSel ? '' : undefined}
                      onMouseEnter={() => setHoveredRow(rowId)}
                      onMouseLeave={() => setHoveredRow(null)}
                      onClick={() => { setPane(3); setBranchIndex(i) }}
                      style={{
                        width: '100%',
                        minHeight: 36,
                        border: 'none',
                        borderRadius: 8,
                        padding: '6px 10px',
                        background: rowBackground(rowId, isSel),
                        color: 'var(--text)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        textAlign: 'left',
                        font: 'inherit',
                      }}
                    >
                      <GitBranch size={15} style={{ color: isCurrent ? 'var(--green)' : 'var(--text-3)', flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontSize: 13 }}>
                        {branch}
                      </span>
                      {isCurrent ? (
                        <span style={{ color: 'var(--green)', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>current</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div ref={commitListRef} style={{ overflow: 'auto', flex: 1, padding: 8 }}>
                {(data?.commits ?? []).map((commit, i) => {
                  const rowId = `commit:${commit}`
                  const isSel = i === commitIndex && pane === 4
                  const spaceIdx = commit.indexOf(' ')
                  const hash = spaceIdx > 0 ? commit.slice(0, spaceIdx) : commit
                  const msg = spaceIdx > 0 ? commit.slice(spaceIdx + 1) : ''
                  return (
                    <button
                      key={commit}
                      type="button"
                      data-cursor={isSel ? '' : undefined}
                      onMouseEnter={() => setHoveredRow(rowId)}
                      onMouseLeave={() => setHoveredRow(null)}
                      onClick={() => { setPane(4); setCommitIndex(i) }}
                      style={{
                        width: '100%',
                        minHeight: 42,
                        border: 'none',
                        borderRadius: 8,
                        padding: '7px 10px',
                        background: rowBackground(rowId, isSel),
                        color: 'var(--text)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: 3,
                        textAlign: 'left',
                        font: 'inherit',
                      }}
                    >
                      <span style={{ color: 'var(--amber)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{hash}</span>
                      <span style={{ color: isSel ? 'var(--text)' : 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                        {msg}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            </div>
          )}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--surface-2)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                minWidth: 0,
              }}
            >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedTitle}
                  </div>
                  <div style={{ marginTop: 2, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>
                    {focusSide === 'right'
                    ? 'j/k scroll · d/u page · [/] resize files · tab focus list'
                    : 'click rows to inspect · [/] resize files · arrows and j/k also work'}
                </div>
                </div>
              {pane === 2 && selectedEntry ? (
                <span style={{
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: 'var(--surface-3)',
                  color: statusColor(selectedEntry.x, selectedEntry.y),
                  border: '1px solid var(--border)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  flexShrink: 0,
                }}>
                  {statusLabel(selectedEntry.x, selectedEntry.y)}
                </span>
              ) : null}
              {diffAvailable && selectedLines ? (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 8px',
                    borderRadius: 999,
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-2)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    flexShrink: 0,
                  }}
                >
                  <span>{formatSelectedRange(selectedLines)}</span>
                  <button
                    type="button"
                    title="Clear selection"
                    onClick={() => setSelectedLines(null)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-3)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : null}
              {diffAvailable ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      overflow: 'hidden',
                      background: 'var(--surface-3)',
                      flexShrink: 0,
                    }}
                    aria-label="Diff layout"
                  >
                    <button
                      type="button"
                      title="Stacked view"
                      aria-pressed={diffStyle === 'stacked'}
                      onClick={() => setDiffStyle('stacked')}
                      style={{
                        width: 32,
                        height: 28,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: 'none',
                        borderRight: '1px solid var(--border)',
                        background: diffStyle === 'stacked' ? 'var(--surface-2)' : 'transparent',
                        color: diffStyle === 'stacked' ? 'var(--text)' : 'var(--text-3)',
                        cursor: 'pointer',
                      }}
                    >
                      <Rows3 size={14} />
                    </button>
                    <button
                      type="button"
                      title="Split view"
                      aria-pressed={diffStyle === 'split'}
                      onClick={() => setDiffStyle('split')}
                      style={{
                        width: 32,
                        height: 28,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: 'none',
                        background: diffStyle === 'split' ? 'var(--surface-2)' : 'transparent',
                        color: diffStyle === 'split' ? 'var(--text)' : 'var(--text-3)',
                        cursor: 'pointer',
                      }}
                    >
                      <Columns2 size={14} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
                    {(['classic', 'backgrounds', 'bars'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setChangeStyle(value)}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: 999,
                          padding: '4px 9px',
                          fontSize: 10,
                          fontFamily: "'IBM Plex Mono', monospace",
                          color: changeStyle === value ? 'var(--text)' : 'var(--text-3)',
                          background: changeStyle === value ? 'var(--surface-2)' : 'var(--surface-3)',
                          cursor: 'pointer',
                        }}
                      >
                        {value}
                      </button>
                    ))}
                    {(['word-alt', 'word', 'char', 'none'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setInlineDiffStyle(value)}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: 999,
                          padding: '4px 9px',
                          fontSize: 10,
                          fontFamily: "'IBM Plex Mono', monospace",
                          color: inlineDiffStyle === value ? 'var(--text)' : 'var(--text-3)',
                          background: inlineDiffStyle === value ? 'var(--surface-2)' : 'var(--surface-3)',
                          cursor: 'pointer',
                        }}
                      >
                        {value}
                      </button>
                    ))}
                    <button
                      type="button"
                      title={wrapDiff ? 'Wrap lines' : 'Scroll lines'}
                      onClick={() => setWrapDiff((v) => !v)}
                      style={{
                        width: 32,
                        height: 28,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid var(--border)',
                        borderRadius: 999,
                        background: wrapDiff ? 'var(--surface-2)' : 'var(--surface-3)',
                        color: wrapDiff ? 'var(--text)' : 'var(--text-3)',
                        cursor: 'pointer',
                      }}
                    >
                      <WrapText size={14} />
                    </button>
                    <button
                      type="button"
                      title={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'}
                      onClick={() => setShowLineNumbers((v) => !v)}
                      style={{
                        width: 32,
                        height: 28,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid var(--border)',
                        borderRadius: 999,
                        background: showLineNumbers ? 'var(--surface-2)' : 'var(--surface-3)',
                        color: showLineNumbers ? 'var(--text)' : 'var(--text-3)',
                        cursor: 'pointer',
                      }}
                    >
                      <Hash size={14} />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div
              ref={rightPanelRef}
              onClick={() => setFocusSide('right')}
              style={{ flex: 1, overflow: 'auto', paddingTop: 10, paddingBottom: 10, background: 'var(--surface)' }}
            >
              {contentLoading ? (
                <div
                  style={{ padding: '0 16px', fontSize: 13, color: 'var(--text-3)' }}
                >
                  Loading…
                </div>
              ) : diffAvailable ? (
                <PierrePatchDiffView
                  patch={rightContent}
                  maxHeight={null}
                  presentation={diffPresentation}
                  selectedLines={selectedLines}
                  onSelectedLinesChange={setSelectedLines}
                />
              ) : (
                diffLines.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '0 16px',
                      color: 'var(--text)',
                      whiteSpace: 'pre',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12,
                      lineHeight: '19px',
                    }}
                  >
                    {line || ' '}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'violet' | 'green' | 'amber' | 'muted'
}) {
  const color =
    tone === 'violet' ? 'var(--violet)'
      : tone === 'green' ? 'var(--green)'
        : tone === 'amber' ? 'var(--amber)'
          : 'var(--text-2)'

  return (
    <div
      style={{
        padding: '11px 12px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
        minWidth: 0,
      }}
    >
      <div
        style={{
          marginBottom: 5,
          color: 'var(--text-3)',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </div>
      <div
        title={value}
        style={{
          color,
          fontSize: 13,
          fontWeight: 650,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div
      style={{
        minHeight: 140,
        borderRadius: 10,
        border: '1px dashed var(--border)',
        background: 'var(--surface-2)',
        display: 'grid',
        placeItems: 'center',
        padding: 18,
        textAlign: 'center',
      }}
    >
      <div>
        <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 700 }}>{title}</div>
        <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 5 }}>{description}</div>
      </div>
    </div>
  )
}
