'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { isDocked, shouldIgnoreDockedKey, type SurfaceVariant } from './surfaceVariant'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Clock3, Columns2, GitBranch, Hash, History, Info, ListTree, Maximize2, Minus, PanelLeftClose, PanelLeftOpen, PencilLine, RefreshCw, Rows3, SlidersHorizontal, X } from 'lucide-react'
import type { SelectedLineRange } from '@pierre/diffs'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { prepareFileTreeInput, themeToTreeStyles } from '@pierre/trees'
import type { GitData, GitDiffSource, GitStatusEntry, GitTurnRef } from '@/lib/gitProvider'
import { DIFF_SOURCE_HEAD_ITEMS, diffSourceKey, diffSourceLabel, isSameSelection, resolveDiffSource, turnMenuItems, type DiffSourceSelection } from '@/lib/gitDiffSourceMenu'
import type { GitStatusEntry as TreeGitStatusEntry } from '@pierre/trees'
import { getCurrentTheme, subscribeTheme, THEME_META, type Theme } from '@/lib/themes'
import { PierrePatchDiffView, type PierreAnnotationMetadata, type PierreChangeStyle, type PierreDiffAnnotation, type PierreDiffPresentation, type PierreDiffStyle, type PierreInlineDiffStyle } from './PierreDiffView'
import { readJsonResponse } from '@/lib/httpResponse'

// ─── Types ────────────────────────────────────────────────────────────────────

type TreeNode =
  | { kind: 'dir'; path: string; name: string; depth: number; expanded: boolean }
  | { kind: 'file'; path: string; name: string; depth: number; x: string; y: string }

type DiffNote = {
  filePath: string
  range: SelectedLineRange
  text: string
  replies: DiffReply[]
  resolved: boolean
  createdAt: number
  updatedAt: number
}

type DiffReply = {
  id: string
  text: string
  createdAt: number
}

type DraftDiffNote = {
  key: string
  filePath: string
  range: SelectedLineRange
  text: string
  replyToKey?: string | null
}

type PaneId = 1 | 2 | 3 | 4

type LeftPaneMode = 'normal' | 'expanded' | 'hidden'
type PierreAnnotationKind = 'thread' | 'draft'

const LEFT_PANE_MIN_WIDTH = 280
/** Docked in the right panel the whole shell is barely wider than the floating
 *  popover's file tree, so the tree gets a smaller floor to leave the diff room. */
const LEFT_PANE_DOCKED_MIN_WIDTH = 190
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

async function fetchGitData(cwd: string, source: GitDiffSource): Promise<GitData> {
  try {
    const query = source.kind === 'turn'
      ? `&source=turn&sha=${encodeURIComponent(source.sha)}`
      : source.kind === 'branch' ? '&source=branch' : ''
    const res = await fetch(`/api/git?action=data&cwd=${encodeURIComponent(cwd)}${query}`)
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

async function fetchGitTurns(cwd: string, sessionId?: string | null): Promise<{ turns: GitTurnRef[]; scoped: boolean }> {
  try {
    const scope = sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ''
    const res = await fetch(`/api/git?action=turns&cwd=${encodeURIComponent(cwd)}${scope}`)
    const body = await res.json() as { turns?: GitTurnRef[]; scoped?: boolean }
    if (!res.ok || !body.turns) return { turns: [], scoped: false }
    return { turns: body.turns, scoped: !!body.scoped }
  } catch {
    return { turns: [], scoped: false }
  }
}

async function fetchGitContent({
  cwd,
  data,
  pane,
  selectedFilePath,
  branchIndex,
  commitIndex,
  source,
}: {
  cwd: string
  data: GitData
  pane: PaneId
  selectedFilePath: string | null
  branchIndex: number
  commitIndex: number
  source: GitDiffSource
}): Promise<string> {
  try {
    const res = await fetch('/api/git/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cwd,
        data,
        pane,
        selectedFilePath,
        branchIndex,
        commitIndex,
        sourceKind: source.kind,
        sourceSha: source.kind === 'turn' ? source.sha : undefined,
      }),
    })
    const body = await readJsonResponse<{ content?: string }>(res)
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
  const themeName = useSyncExternalStore<Theme>(subscribeTheme, getCurrentTheme, () => 'dark')
  const isDarkTheme = THEME_META[themeName].category === 'dark'
  const filePaths = useMemo(() => data.status.map((entry) => entry.path), [data.status])
  const preparedInput = useMemo(
    () => prepareFileTreeInput(filePaths, { flattenEmptyDirectories: true, sort: 'default' }),
    [filePaths],
  )
  const expandedPaths = useMemo(() => allDirPaths(data.status), [data.status])
  const statusByPath = useMemo(() => data.status.map(toTreeGitStatus), [data.status])
  const treeThemeStyles = useMemo(() => themeToTreeStyles({
    type: isDarkTheme ? 'dark' : 'light',
    bg: 'var(--surface)',
    fg: 'var(--text-2)',
    colors: {
      'sideBar.background': 'var(--surface)',
      'sideBar.foreground': 'var(--text-2)',
      'sideBarSectionHeader.foreground': 'var(--text-3)',
      'list.activeSelectionForeground': 'var(--text)',
      'list.activeSelectionBackground': 'color-mix(in srgb, var(--cyan) 12%, var(--surface))',
      'list.hoverBackground': 'color-mix(in srgb, var(--cyan) 8%, var(--surface))',
      'focusBorder': 'var(--cyan)',
      'scrollbarSlider.background': 'color-mix(in srgb, var(--text) 18%, var(--surface))',
      'gitDecoration.addedResourceForeground': 'var(--green)',
      'gitDecoration.modifiedResourceForeground': 'var(--amber)',
      'gitDecoration.deletedResourceForeground': 'var(--red)',
      'editor.foreground': 'var(--text-2)',
      'editor.background': 'var(--surface)',
      'editor.selectionBackground': 'color-mix(in srgb, var(--cyan) 12%, var(--surface))',
      'input.background': 'var(--surface-2)',
      'input.border': 'var(--border)',
    },
  }), [isDarkTheme])

  const { model } = useFileTree({
    preparedInput,
    icons: { set: 'complete', colored: true },
    gitStatus: statusByPath,
    initialExpandedPaths: [...expandedPaths],
    initialSelectedPaths: selectedFilePath ? [selectedFilePath] : undefined,
    search: true,
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
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          ...treeThemeStyles,
        }}
      />
    </div>
  )
}

// ─── Style helpers ────────────────────────────────────────────────────────────

function statusColor(x: string, y: string): string {
  if (x === '?' && y === '?') return 'var(--red)'
  if (y === 'A') return 'var(--green)'
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

function formatSelectedRangeForNote(selection: SelectedLineRange): string {
  const base = formatSelectedRange(selection)
  const sides = [selection.side, selection.endSide].filter((side): side is NonNullable<SelectedLineRange['side']> => side != null)
  if (sides.length === 0) return base
  if (sides.length === 1) return `${base} (${sides[0]})`
  return `${base} (${sides[0]} → ${sides[1]})`
}

function buildDiffNoteKey(filePath: string, range: SelectedLineRange): string {
  return [filePath, range.start, range.side ?? '', range.end, range.endSide ?? ''].join('\u0000')
}

function buildReplyId(key: string): string {
  return `${key}\u0000${Date.now().toString(36)}\u0000${Math.random().toString(36).slice(2, 8)}`
}

function compareSelectedRanges(left: SelectedLineRange, right: SelectedLineRange): number {
  return left.start - right.start
    || left.end - right.end
    || (left.side ?? '').localeCompare(right.side ?? '')
    || (left.endSide ?? '').localeCompare(right.endSide ?? '')
}

function buildAnnotationSide(selection: SelectedLineRange): PierreDiffAnnotation<PierreAnnotationMetadata>['side'] {
  const side = selection.side ?? selection.endSide ?? 'additions'
  return side === 'deletions' ? 'deletions' : 'additions'
}

function buildDiffAnnotations(notes: DiffNote[], draftNote: DraftDiffNote | null): PierreDiffAnnotation<PierreAnnotationMetadata>[] {
  const annotations = notes.map((note) => {
    const metadata: PierreAnnotationMetadata = {
      filePath: note.filePath,
      noteId: buildDiffNoteKey(note.filePath, note.range),
      text: note.text,
      rangeLabel: formatSelectedRangeForNote(note.range),
      kind: 'thread',
    }
    return {
      side: buildAnnotationSide(note.range),
      lineNumber: note.range.start,
      metadata,
    }
  })
  if (draftNote && !draftNote.replyToKey) {
    annotations.push({
      side: buildAnnotationSide(draftNote.range),
      lineNumber: draftNote.range.start,
      metadata: {
        filePath: draftNote.filePath,
        noteId: draftNote.key,
        text: draftNote.text,
        rangeLabel: formatSelectedRangeForNote(draftNote.range),
        kind: 'draft',
      },
    })
  }
  return annotations
}

function ToolbarSegmentButton({
  active,
  children,
  title,
  onClick,
}: {
  active: boolean
  children: ReactNode
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="av-hover-control"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      style={{
        height: 30,
        minWidth: 68,
        padding: '0 10px',
        border: 'none',
        borderRight: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
        background: active ? 'color-mix(in srgb, var(--surface) 86%, var(--text) 14%)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-2)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        font: 'inherit',
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

function ToolbarSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: readonly { value: string, label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div
      style={{
        position: 'relative',
        height: 30,
        border: '1px solid var(--border)',
        borderRadius: 999,
        background: 'var(--surface)',
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
      }}
    >
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          appearance: 'none',
          height: '100%',
          border: 'none',
          background: 'transparent',
          color: 'var(--text)',
          padding: '0 28px 0 10px',
          borderRadius: 999,
          font: 'inherit',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        style={{
          position: 'absolute',
          right: 9,
          pointerEvents: 'none',
          color: 'var(--text-2)',
        }}
      />
    </div>
  )
}

function CompactToggle({
  label,
  active,
  title,
  onClick,
}: {
  label: string
  active: boolean
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="av-hover-control"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      style={{
        minHeight: 28,
        padding: '0 9px',
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: active ? 'color-mix(in srgb, var(--surface) 88%, var(--text) 12%)' : 'var(--surface)',
        color: active ? 'var(--text)' : 'var(--text-2)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      <span>{label}</span>
      <span
        style={{
          width: 32,
          height: 18,
          borderRadius: 999,
          background: active ? 'var(--surface)' : 'var(--surface-2)',
          border: '1px solid var(--border)',
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 1,
            left: active ? 15 : 1,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: active ? 'var(--text)' : 'var(--text-3)',
            transition: 'left 0.12s ease',
          }}
        />
      </span>
    </button>
  )
}

function statusLabel(x: string, y: string): string {
  if (x === '?' && y === '?') return 'Untracked'
  if (y === 'A') return 'Added'
  if (x.trim() && y.trim()) return 'Staged + modified'
  if (x.trim()) return 'Staged'
  if (y === 'M') return 'Modified'
  if (y === 'D') return 'Deleted'
  return 'Changed'
}

function DiffSourceMenuRow({
  label,
  secondary,
  detail,
  selected,
  submenu,
  onClick,
  onHover,
}: {
  label: string
  /** What the turn was asked to do — the number alone identifies nothing. */
  secondary?: string
  detail?: string
  selected: boolean
  submenu?: boolean
  onClick: () => void
  onHover?: () => void
}) {
  return (
    <button
      type="button"
      className="av-hover-control"
      title={secondary ? `${label} — ${secondary}` : label}
      onClick={onClick}
      onMouseEnter={onHover}
      style={{
        width: '100%',
        minHeight: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        border: 'none',
        borderRadius: 6,
        background: selected ? 'color-mix(in srgb, var(--cyan) 14%, var(--surface-3))' : 'transparent',
        color: selected ? 'var(--text)' : 'var(--text-2)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 12,
        textAlign: 'left',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 7, overflow: 'hidden' }}>
        <span style={{ flexShrink: 0 }}>{label}</span>
        {secondary ? (
          <span style={{ flex: 1, minWidth: 0, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {secondary}
          </span>
        ) : null}
      </span>
      {detail ? (
        <span style={{ color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>{detail}</span>
      ) : null}
      {submenu ? <ChevronRight size={13} style={{ color: 'var(--text-3)' }} /> : null}
      {selected && !submenu ? <Check size={13} style={{ color: 'var(--cyan)' }} /> : null}
    </button>
  )
}

/** Picks which change set the panel is showing: the working tree, everything
 *  this branch changed, or one agent turn's checkpoint. */
function DiffSourceMenu({
  selection,
  turns,
  scoped,
  sessionScoped,
  onSelect,
}: {
  selection: DiffSourceSelection
  turns: GitTurnRef[]
  /** Whether `turns` is one session's or the whole repo's. */
  scoped: boolean
  /** Whether a session was asked for at all — with one, an unscoped list is a
   *  fallback worth captioning rather than the plain repo-wide view. */
  sessionScoped: boolean
  onSelect: (next: DiffSourceSelection) => void
}) {
  const [open, setOpen] = useState(false)
  const [turnsOpen, setTurnsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (containerRef.current?.contains(target)) return
      setOpen(false)
      setTurnsOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const choose = (next: DiffSourceSelection) => {
    onSelect(next)
    setOpen(false)
    setTurnsOpen(false)
  }

  const panelStyle = {
    position: 'absolute' as const,
    top: 'calc(100% + 6px)',
    zIndex: 40,
    minWidth: 190,
    padding: 4,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--surface-2)',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.34)',
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        className="av-hover-control"
        title="Choose what to diff"
        aria-expanded={open}
        onClick={() => { setOpen((value) => !value); setTurnsOpen(false) }}
        style={{
          height: 34,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 11px',
          borderRadius: 8,
          border: `1px solid ${selection.kind === 'working' ? 'var(--border)' : 'color-mix(in srgb, var(--cyan) 42%, var(--border))'}`,
          background: selection.kind === 'working' ? 'var(--surface)' : 'color-mix(in srgb, var(--cyan) 13%, var(--surface-2))',
          color: selection.kind === 'working' ? 'var(--text-2)' : 'var(--cyan)',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        <History size={15} />
        {diffSourceLabel(selection, turns)}
        <ChevronDown size={13} />
      </button>

      {open ? (
        <div style={{ ...panelStyle, left: 0 }}>
          {DIFF_SOURCE_HEAD_ITEMS.map((item) => (
            <DiffSourceMenuRow
              key={item.label}
              label={item.label}
              selected={isSameSelection(selection, item.selection)}
              onClick={() => choose(item.selection)}
              onHover={() => setTurnsOpen(false)}
            />
          ))}
          <div style={{ position: 'relative' }}>
            <DiffSourceMenuRow
              label="Turn"
              selected={selection.kind === 'turn'}
              submenu
              onClick={() => setTurnsOpen((value) => !value)}
              onHover={() => setTurnsOpen(true)}
            />
            {turnsOpen ? (
              <div
                style={{
                  ...panelStyle,
                  top: -4,
                  left: '100%',
                  marginLeft: 4,
                  maxHeight: 260,
                  overflowY: 'auto',
                  minWidth: 320,
                }}
              >
                {turns.length === 0 ? (
                  <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-3)' }}>
                    {sessionScoped ? 'No turns recorded for this session' : 'No turn checkpoints yet'}
                  </div>
                ) : null}
                {turns.length > 0 && sessionScoped && !scoped ? (
                  <div style={{ padding: '6px 10px 7px', fontSize: 11, color: 'var(--text-3)' }}>
                    No turns for this session — showing all turns in this repo
                  </div>
                ) : null}
                {turnMenuItems(turns).map((item) => (
                  <DiffSourceMenuRow
                    key={item.label}
                    label={item.label}
                    secondary={item.secondary}
                    detail={item.detail}
                    selected={isSameSelection(selection, item.selection)}
                    onClick={() => choose(item.selection)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
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
  /** Scopes the turn list to the session being read. Without it the menu offers
   *  every turn taken in the repo, which is what a repo-wide review wants. */
  sessionId?: string | null
  /** 'docked' drops the modal scrim and fills its container (right panel). */
  variant?: SurfaceVariant
}

export default function GitPopover({ open, onClose, cwd, sessionId, variant }: Props) {
  const [data, setData] = useState<GitData | null>(null)
  const [loading, setLoading] = useState(false)
  const [pane, setPane] = useState<PaneId>(2)
  const [focusSide, setFocusSide] = useState<'left' | 'right'>('left')
  const [branchIndex, setBranchIndex] = useState(0)
  const [commitIndex, setCommitIndex] = useState(0)
  const [rightContent, setRightContent] = useState('')
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>('normal')
  // Docked, the tree starts at its floor so the diff — the thing you docked the
  // panel to read — gets the rest; floating, the tree keeps its roomy default.
  const [leftPaneWidth, setLeftPaneWidth] = useState(
    variant === 'docked' ? LEFT_PANE_DOCKED_MIN_WIDTH : LEFT_PANE_DEFAULT_WIDTH,
  )
  const [diffStyle, setDiffStyle] = useState<PierreDiffStyle>('stacked')
  const [changeStyle, setChangeStyle] = useState<PierreChangeStyle>('classic')
  const [showBackgrounds, setShowBackgrounds] = useState(true)
  const [inlineDiffStyle, setInlineDiffStyle] = useState<PierreInlineDiffStyle>('word-alt')
  const [wrapDiff, setWrapDiff] = useState(true)
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [showHunkHeaders, setShowHunkHeaders] = useState(true)
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false)
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [diffNotes, setDiffNotes] = useState<Map<string, DiffNote>>(new Map())
  const [draftNote, setDraftNote] = useState<DraftDiffNote | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const [diffSourceSelection, setDiffSourceSelection] = useState<DiffSourceSelection>({ kind: 'working' })
  const [turns, setTurns] = useState<GitTurnRef[]>([])
  const [turnsScoped, setTurnsScoped] = useState(false)

  const rightContentRequestRef = useRef(0)
  const rightContentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const viewOptionsRef = useRef<HTMLDivElement>(null)
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
    showHunkHeaders,
    showBackgrounds,
  }), [changeStyle, diffStyle, inlineDiffStyle, showBackgrounds, showHunkHeaders, showLineNumbers, wrapDiff])
  const diffSource = useMemo<GitDiffSource>(
    () => resolveDiffSource(diffSourceSelection, turns),
    [diffSourceSelection, turns],
  )
  const sourceKey = diffSourceKey(diffSource)

  const reloadGitData = useCallback(() => {
    setLoading(true)
    return fetchGitData(cwd, diffSource)
      .then((next) => { setData(next); setLoading(false) })
      .catch(() => setLoading(false))
  }, [cwd, diffSource])

  // Turn checkpoints are their own list: the menu needs them before a selection
  // can resolve, and they change only when an agent turn starts.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void fetchGitTurns(cwd, sessionId).then((next) => {
      if (cancelled) return
      setTurns(next.turns)
      setTurnsScoped(next.scoped)
    })
    return () => { cancelled = true }
  }, [open, cwd, sessionId])

  // Fetch git data when the popover opens or the diff source changes
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setData(null)
    void fetchGitData(cwd, diffSource)
      .then((next) => { if (!cancelled) { setData(next); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sourceKey is diffSource's identity
  }, [open, cwd, sourceKey])

  // Place the right pane on the first file when data loads
  useEffect(() => {
    if (!data) return
    const firstFile = data.status[0]?.path ?? null
    setSelectedFilePath(firstFile)
    setBranchIndex(0)
    setCommitIndex(0)
  }, [data])

  useEffect(() => {
    setDraftNote(null)
  }, [pane, selectedFilePath])

  useEffect(() => {
    branchListRef.current?.querySelector('[data-cursor]')?.scrollIntoView({ block: 'nearest' })
  }, [branchIndex])

  useEffect(() => {
    commitListRef.current?.querySelector('[data-cursor]')?.scrollIntoView({ block: 'nearest' })
  }, [commitIndex])

  useEffect(() => {
    if (!viewOptionsOpen) return
    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (viewOptionsRef.current?.contains(target)) return
      setViewOptionsOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [viewOptionsOpen])

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
          source: diffSource,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sourceKey is diffSource's identity
  }, [open, data, pane, cwd, selectedFilePath, branchIndex, commitIndex, sourceKey])

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
        const nextWidth = clampLeftPaneWidth(leftPaneWidth + (e.key === ']' ? LEFT_PANE_RESIZE_STEP : -LEFT_PANE_RESIZE_STEP))
        setLeftPaneWidth(nextWidth)
        setLeftPaneMode(nextWidth >= LEFT_PANE_EXPANDED_WIDTH - 24 ? 'expanded' : 'normal')
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
        void reloadGitData()
        void fetchGitTurns(cwd, sessionId).then((next) => { setTurns(next.turns); setTurnsScoped(next.scoped) })
        return
      }
    },
    [cwd, data, focusSide, leftPaneHidden, leftPaneWidth, onClose, pane, reloadGitData, sessionId],
  )

  useEffect(() => {
    if (!open) return
    // Docked, the transcript and composer are alive beside this panel, so the
    // bare-letter bindings only apply while focus is inside the shell.
    const scoped = (event: KeyboardEvent) => {
      if (shouldIgnoreDockedKey(variant, shellRef.current)) return
      handleKey(event)
    }
    window.addEventListener('keydown', scoped)
    return () => window.removeEventListener('keydown', scoped)
  }, [open, handleKey, variant])

  useEffect(() => {
    if (leftPaneHidden && focusSide === 'left') setFocusSide('right')
  }, [focusSide, leftPaneHidden])

  // The pane width is only clamped when the *user* changes it, which is enough
  // for a full-screen popover whose shell never resizes. Docked, the shell is
  // whatever the panel is dragged to, so a width picked at 900px would leave
  // the diff a few pixels wide at 560px. Re-clamp whenever the shell resizes.
  useEffect(() => {
    const shell = shellRef.current
    if (!shell || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      setLeftPaneWidth((current) => {
        const next = clampLeftPaneWidth(current)
        return next === current ? current : next
      })
    })
    observer.observe(shell)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clampLeftPaneWidth reads refs only
  }, [variant])

  const diffLines = rightContent.split('\n')
  const changedFileCount = data?.status.length ?? 0
  const selectedEntry = data?.status.find((entry) => entry.path === selectedFilePath)
  const currentSelectionNote = useMemo(() => {
    if (!selectedFilePath || !selectedLines) return null
    return diffNotes.get(buildDiffNoteKey(selectedFilePath, selectedLines)) ?? null
  }, [diffNotes, selectedFilePath, selectedLines])
  const currentFileThreads = useMemo(
    () => [...diffNotes.values()]
      .filter((note) => note.filePath === selectedFilePath)
      .sort((left, right) => compareSelectedRanges(left.range, right.range)),
    [diffNotes, selectedFilePath],
  )
  const diffAnnotations = useMemo(() => buildDiffAnnotations([...diffNotes.values()], draftNote), [diffNotes, draftNote])
  const renderDiffAnnotation = useCallback((annotation: PierreDiffAnnotation<PierreAnnotationMetadata>) => {
    const metadata = annotation.metadata
    if (!metadata) return null

    const threadKey = metadata.noteId.endsWith('\u0000reply')
      ? metadata.noteId.slice(0, metadata.noteId.length - '\u0000reply'.length)
      : metadata.noteId
    const thread = diffNotes.get(threadKey)
    const isDraft = metadata.kind === 'draft'
    const formatAge = (time: number): string => {
      const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return `${minutes}m`
      const hours = Math.round(minutes / 60)
      if (hours < 48) return `${hours}h`
      const days = Math.round(hours / 24)
      return `${days}d`
    }

    if (isDraft) {
      return (
        <div style={{
          display: 'grid',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 12,
          border: '1px solid color-mix(in srgb, var(--cyan) 30%, var(--border))',
          background: 'color-mix(in srgb, var(--cyan) 8%, var(--surface-2))',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
            <label htmlFor="git-diff-comment" style={{
              color: 'var(--cyan)',
              fontSize: 12,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              Draft comment
            </label>
            <div style={{
              color: 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              whiteSpace: 'nowrap',
            }}>
              {metadata.rangeLabel}
            </div>
          </div>
          <textarea
            id="git-diff-comment"
            value={draftNote?.text ?? metadata.text}
            onChange={(event) => {
              if (!draftNote) return
              setDraftNote((current) => current ? { ...current, text: event.target.value } : current)
            }}
            placeholder="Write a comment..."
            rows={4}
            style={{
              width: '100%',
              minHeight: 84,
              resize: 'vertical',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              padding: '9px 10px',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              lineHeight: '18px',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="av-hover-control"
              onClick={() => setDraftNote(null)}
              style={{
                height: 28,
                padding: '0 10px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: 'var(--surface-3)',
                color: 'var(--text-2)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="av-hover-control"
              onClick={saveDraftNote}
              style={{
                height: 28,
                padding: '0 10px',
                borderRadius: 999,
                border: '1px solid color-mix(in srgb, var(--green) 34%, var(--border))',
                background: 'color-mix(in srgb, var(--green) 12%, var(--surface-3))',
                color: 'var(--green)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Save comment
            </button>
          </div>
        </div>
      )
    }

    if (!thread) return null

    return (
      <div style={{
        display: 'grid',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 12,
        border: thread.resolved ? '1px solid color-mix(in srgb, var(--text-3) 24%, var(--border))' : '1px solid color-mix(in srgb, var(--violet) 24%, var(--border))',
        background: thread.resolved ? 'color-mix(in srgb, var(--text-3) 6%, var(--surface-2))' : 'color-mix(in srgb, var(--violet) 8%, var(--surface-2))',
        opacity: thread.resolved ? 0.72 : 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--violet)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: 12,
              fontWeight: 700,
            }}>
              You
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                color: 'var(--text)',
                fontSize: 13,
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                You
              </div>
              <div style={{
                color: 'var(--text-3)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                whiteSpace: 'nowrap',
              }}>
                {metadata.rangeLabel}
                {' · '}
                {formatAge(thread.createdAt)}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="av-hover-control"
            onClick={() => toggleResolved(threadKey)}
            style={{
              height: 28,
              padding: '0 10px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {thread.resolved ? 'Reopen' : 'Resolve'}
          </button>
        </div>
        <div style={{
          color: 'var(--text)',
          fontSize: 12,
          lineHeight: '18px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {thread.text}
        </div>
        {thread.replies.length > 0 ? (
          <div style={{ display: 'grid', gap: 8, paddingLeft: 12, borderLeft: '1px solid color-mix(in srgb, var(--border) 70%, transparent)' }}>
            {thread.replies.map((reply) => (
              <div key={reply.id} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-2)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>
                    R
                  </div>
                  <div style={{ color: 'var(--text-3)', fontSize: 11 }}>Reply · {formatAge(reply.createdAt)}</div>
                </div>
                <div style={{ color: 'var(--text)', fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap' }}>
                  {reply.text}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {draftNote?.replyToKey === threadKey ? (
          <div style={{
            display: 'grid',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, var(--cyan) 28%, var(--border))',
            background: 'color-mix(in srgb, var(--cyan) 7%, var(--surface))',
          }}>
            <label htmlFor="git-diff-reply" style={{ color: 'var(--cyan)', fontSize: 12, fontWeight: 700 }}>
              Add reply
            </label>
            <textarea
              id="git-diff-reply"
              value={draftNote?.text ?? ''}
              onChange={(event) => setDraftNote((current) => current ? { ...current, text: event.target.value } : current)}
              placeholder="Write a reply..."
              rows={3}
              style={{
                width: '100%',
                minHeight: 72,
                resize: 'vertical',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                padding: '9px 10px',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                lineHeight: '18px',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex_end', gap: 8 }}>
              <button
                type="button"
                className="av-hover-control"
                onClick={() => setDraftNote(null)}
                style={{
                  height: 28,
                  padding: '0 10px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-3)',
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="av-hover-control"
                onClick={saveDraftNote}
                style={{
                  height: 28,
                  padding: '0 10px',
                  borderRadius: 999,
                  border: '1px solid color-mix(in srgb, var(--green) 34%, var(--border))',
                  background: 'color-mix(in srgb, var(--green) 12%, var(--surface-3))',
                  color: 'var(--green)',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Save reply
              </button>
            </div>
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="av-hover-control"
            onClick={() => openReplyDraft(thread)}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--cyan)',
              cursor: 'pointer',
              padding: 0,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Add reply...
          </button>
          <button
            type="button"
            className="av-hover-control"
            onClick={() => deleteNote(threadKey)}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-3)',
              cursor: 'pointer',
              padding: 0,
              fontSize: 11,
            }}
          >
            Delete
          </button>
        </div>
      </div>
    )
  }, [diffNotes, draftNote])
  if (!open) return null

  const sourceLabel = diffSourceLabel(diffSourceSelection, turns)
  const emptyChangeSetTitle = diffSource.kind === 'working' ? 'Working tree clean' : `No changes in ${sourceLabel.toLowerCase()}`
  const selectedTitle =
    pane === 1 ? 'Repository status'
      : pane === 2 ? (selectedFilePath ?? (changedFileCount === 0 ? emptyChangeSetTitle : 'Select a file'))
        : pane === 3 ? (data?.branches[branchIndex] ?? 'Branches')
          : (data?.commits[commitIndex] ?? 'Commits')

  function rowBackground(id: string, selected: boolean): string {
    if (selected) return 'color-mix(in srgb, var(--cyan) 14%, var(--surface-3))'
    if (hoveredRow === id) return 'var(--surface-2)'
    return 'transparent'
  }

  function clampLeftPaneWidth(width: number): number {
    const shellWidth = shellRef.current?.getBoundingClientRect().width ?? window.innerWidth
    const minWidth = variant === 'docked' ? LEFT_PANE_DOCKED_MIN_WIDTH : LEFT_PANE_MIN_WIDTH
    const maxWidth = Math.max(
      minWidth,
      Math.min(LEFT_PANE_EXPANDED_WIDTH, Math.floor(shellWidth * LEFT_PANE_MAX_WIDTH_RATIO)),
    )
    return Math.max(minWidth, Math.min(width, maxWidth))
  }

  function setPresetLeftPaneWidth(mode: Exclude<LeftPaneMode, 'hidden'>) {
    setLeftPaneMode(mode)
    setLeftPaneWidth(clampLeftPaneWidth(mode === 'expanded' ? LEFT_PANE_EXPANDED_WIDTH : LEFT_PANE_DEFAULT_WIDTH))
  }

  function openDraftNote() {
    if (!selectedFilePath || !selectedLines) return
    const key = buildDiffNoteKey(selectedFilePath, selectedLines)
    const existing = diffNotes.get(key)
    setDraftNote({
      key,
      filePath: selectedFilePath,
      range: selectedLines,
      text: existing?.text ?? '',
      replyToKey: null,
    })
  }

  function openDraftNoteForRange(range: SelectedLineRange) {
    if (!selectedFilePath) return
    const key = buildDiffNoteKey(selectedFilePath, range)
    const existing = diffNotes.get(key)
    setSelectedLines(range)
    setDraftNote({
      key,
      filePath: selectedFilePath,
      range,
      text: existing?.text ?? '',
      replyToKey: null,
    })
    setViewOptionsOpen(false)
  }

  function saveDraftNote() {
    if (!draftNote) return
    const text = draftNote.text.trim()
    setDiffNotes((prev) => {
      const next = new Map(prev)
      if (draftNote.replyToKey) {
        if (!text) return next
        const thread = next.get(draftNote.replyToKey)
        if (!thread) return next
        const now = Date.now()
        next.set(draftNote.replyToKey, {
          ...thread,
          replies: [...thread.replies, {
            id: buildReplyId(draftNote.replyToKey),
            text,
            createdAt: now,
          }],
          updatedAt: now,
        })
      } else if (text) {
        const existing = next.get(draftNote.key)
        next.set(draftNote.key, {
          filePath: draftNote.filePath,
          range: draftNote.range,
          text,
          replies: existing?.replies ?? [],
          resolved: existing?.resolved ?? false,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        })
      } else {
        next.delete(draftNote.key)
      }
      return next
    })
    setDraftNote(null)
    setSelectedLines(null)
  }

  function openReplyDraft(note: DiffNote) {
    setDraftNote({
      key: `${buildDiffNoteKey(note.filePath, note.range)}\u0000reply`,
      filePath: note.filePath,
      range: note.range,
      text: '',
      replyToKey: buildDiffNoteKey(note.filePath, note.range),
    })
  }

  function toggleResolved(noteKey: string) {
    setDiffNotes((prev) => {
      const next = new Map(prev)
      const note = next.get(noteKey)
      if (!note) return next
      next.set(noteKey, { ...note, resolved: !note.resolved, updatedAt: Date.now() })
      return next
    })
  }

  function deleteNote(key: string) {
    setDiffNotes((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
    setDraftNote((current) => (current?.key === key ? null : current))
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

  const docked = isDocked(variant)

  return (
    <div
      onClick={docked ? undefined : onClose}
      style={docked
        ? { display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }
        : {
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
        tabIndex={docked ? -1 : undefined}
        onClick={(e) => e.stopPropagation()}
        style={docked
          ? {
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              background: 'var(--surface)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              outline: 'none',
            }
          : {
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
            className="av-hover-control"
            onClick={() => {
              void reloadGitData()
              void fetchGitTurns(cwd, sessionId).then((next) => { setTurns(next.turns); setTurnsScoped(next.scoped) })
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
            className="av-hover-control"
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
              className="av-hover-control"
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
          <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
          <DiffSourceMenu
            selection={diffSourceSelection}
            turns={turns}
            scoped={turnsScoped}
            sessionScoped={!!sessionId}
            onSelect={(next) => {
              setDiffSourceSelection(next)
              setSelectedFilePath(null)
            }}
          />
          <span style={{ flex: 1 }} />
          {leftPaneHidden ? (
            <button
              type="button"
              className="av-hover-control"
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
                className="av-hover-control"
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
                className="av-hover-control"
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
                className="av-hover-control"
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
                <InfoCard label={sourceLabel} value={changedFileCount === 0 ? 'Clean' : `${changedFileCount} changed files`} tone={changedFileCount === 0 ? 'green' : 'amber'} />
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
                <EmptyState
                  title="No file changes"
                  description={diffSource.kind === 'working'
                    ? 'The working tree is clean.'
                    : `Nothing changed in ${sourceLabel.toLowerCase()}.`}
                />
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
                      className="av-hover-control"
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
                      className="av-hover-control"
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
              {diffAvailable ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 8,
                  flex: 1,
                  minWidth: 0,
                  position: 'relative',
                }} ref={viewOptionsRef}>
                  {selectedLines ? (
                    <button
                      type="button"
                      className="av-hover-control"
                      onClick={openDraftNote}
                      title={currentSelectionNote ? 'Edit comment for selected lines' : 'Add comment for selected lines'}
                      style={{
                        height: 30,
                        padding: '0 10px',
                        borderRadius: 999,
                        border: `1px solid ${currentSelectionNote ? 'color-mix(in srgb, var(--violet) 36%, var(--border))' : 'var(--border)'}`,
                        background: currentSelectionNote ? 'color-mix(in srgb, var(--violet) 10%, var(--surface-3))' : 'var(--surface-3)',
                        color: currentSelectionNote ? 'var(--violet)' : 'var(--text-2)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
                        fontSize: 11,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      <PencilLine size={12} />
                      {currentSelectionNote ? 'Edit comment' : 'Add comment'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="av-hover-control"
                    aria-expanded={viewOptionsOpen}
                    aria-haspopup="dialog"
                    onClick={() => setViewOptionsOpen((current) => !current)}
                    style={{
                      height: 30,
                      padding: '0 10px',
                      borderRadius: 999,
                      border: '1px solid var(--border)',
                      background: viewOptionsOpen ? 'color-mix(in srgb, var(--surface) 88%, var(--text) 12%)' : 'var(--surface)',
                      color: 'var(--text)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
                      fontSize: 11,
                      fontWeight: 700,
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                    >
                    <SlidersHorizontal size={12} />
                    <span>View options</span>
                  </button>
                  {viewOptionsOpen ? (
                    <div
                      role="dialog"
                      aria-label="View options"
                      style={{
                        position: 'absolute',
                        top: 36,
                        right: 0,
                        zIndex: 20,
                        width: 294,
                        padding: 10,
                        borderRadius: 14,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        boxShadow: '0 16px 40px color-mix(in srgb, var(--text) 16%, transparent)',
                        display: 'grid',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.04 }}>
                          Layout
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <ToolbarSegmentButton active={diffStyle === 'stacked'} title="Stacked view" onClick={() => setDiffStyle('stacked')}>
                            <Rows3 size={14} />
                            <span>Stacked</span>
                          </ToolbarSegmentButton>
                          <ToolbarSegmentButton active={diffStyle === 'split'} title="Split view" onClick={() => setDiffStyle('split')}>
                            <Columns2 size={14} />
                            <span>Split</span>
                          </ToolbarSegmentButton>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.04 }}>
                          Indicators
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                          <ToolbarSegmentButton active={changeStyle === 'bars'} title="Bars" onClick={() => setChangeStyle('bars')}>
                            <Rows3 size={14} />
                            <span>Bars</span>
                          </ToolbarSegmentButton>
                          <ToolbarSegmentButton active={changeStyle === 'classic'} title="Classic" onClick={() => setChangeStyle('classic')}>
                            <Hash size={14} />
                            <span>Classic</span>
                          </ToolbarSegmentButton>
                          <ToolbarSegmentButton active={changeStyle === 'none'} title="None" onClick={() => setChangeStyle('none')}>
                            <Minus size={14} />
                            <span>None</span>
                          </ToolbarSegmentButton>
                        </div>
                        <ToolbarSelect
                          value={inlineDiffStyle}
                          options={[
                            { value: 'word-alt', label: 'Word-Alt' },
                            { value: 'word', label: 'Word' },
                            { value: 'char', label: 'Char' },
                            { value: 'none', label: 'None' },
                          ]}
                          onChange={(value) => setInlineDiffStyle(value as PierreInlineDiffStyle)}
                        />
                      </div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.04 }}>
                          Display
                        </div>
                        <div style={{ display: 'grid', gap: 6 }}>
                          <CompactToggle
                            label="Backgrounds"
                            active={showBackgrounds}
                            title={showBackgrounds ? 'Disable backgrounds' : 'Enable backgrounds'}
                            onClick={() => setShowBackgrounds((value) => !value)}
                          />
                          <CompactToggle
                            label="Wrapping"
                            active={wrapDiff}
                            title={wrapDiff ? 'Scroll lines' : 'Wrap lines'}
                            onClick={() => setWrapDiff((value) => !value)}
                          />
                          <CompactToggle
                            label="Line numbers"
                            active={showLineNumbers}
                            title={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'}
                            onClick={() => setShowLineNumbers((value) => !value)}
                          />
                          <CompactToggle
                            label="Hunk headers"
                            active={showHunkHeaders}
                            title={showHunkHeaders ? 'Hide hunk headers' : 'Show hunk headers'}
                            onClick={() => setShowHunkHeaders((value) => !value)}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
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
                <>
                  {currentFileThreads.length > 0 ? (
                    <div style={{
                      padding: '8px 16px 12px',
                      color: 'var(--text-3)',
                      fontSize: 11,
                      lineHeight: '16px',
                    }}>
                      {currentFileThreads.length} annotation thread{currentFileThreads.length === 1 ? '' : 's'}
                    </div>
                  ) : null}
                  <PierrePatchDiffView
                    patch={rightContent}
                    maxHeight={null}
                    presentation={diffPresentation}
                    lineAnnotations={diffAnnotations}
                    renderAnnotation={renderDiffAnnotation}
                    onGutterUtilityClick={openDraftNoteForRange}
                    selectedLines={selectedLines}
                    onSelectedLinesChange={setSelectedLines}
                  />
                </>
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
