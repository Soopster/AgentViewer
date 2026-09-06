'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { CodeView, type CodeViewHandle, WorkerPoolContextProvider } from '@pierre/diffs/react'
import {
  parsePatchFiles,
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type LineAnnotation,
  type SelectedLineRange,
} from '@pierre/diffs'
import {
  Bot, Check, CheckCircle2, ChevronDown, ChevronRight, CircleDot, ExternalLink, FileDiff,
  GitCommitHorizontal, GitPullRequest, ListChecks, Maximize2, MessageSquare, MinusCircle,
  PanelLeftClose, PanelLeftOpen, RefreshCw, Send, SlidersHorizontal, X, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { isDocked, shouldIgnoreDockedKey, type SurfaceVariant } from './surfaceVariant'
import { PierreBuiltInIconSprite, PierreFileTypeIcon } from '@/components/PierreDiffView'
import { DIFF_WORKER_POOL_OPTIONS } from '@/components/pierreDiffWorker'
import type {
  PullRequestComment, PullRequestDetail, PullRequestFile, PullRequestMutation,
  PullRequestReviewComment, PullRequestWorkspace,
} from '@/lib/githubPr'

type Props = {
  open: boolean
  cwd: string
  onClose: () => void
  onAskAgent: (prompt: string) => void
  /** Attach this PR to the active session, so the session settles itself when
   *  the PR merges. Absent when no session is selected. */
  onLinkToSession?: (pr: { repo: string; number: number; url: string; cwd: string }) => void
  /** PR number already linked to the active session, if any. */
  linkedPrNumber?: number
  /** 'docked' drops the modal scrim and fills its container (right panel). */
  variant?: SurfaceVariant
}

type TabId = 'conversation' | 'commits' | 'checks' | 'files'

type ReviewMeta =
  | { kind: 'saved'; key: string; author: string; message: string; createdAt: string; url?: string }
  | { kind: 'pending'; key: string; range: SelectedLineRange; message: string }
  | { kind: 'draft'; key: string; range: SelectedLineRange }

type ReviewItem = CodeViewItem<ReviewMeta>
type ReviewDiffItem = CodeViewDiffItem<ReviewMeta>
type ReviewHandle = CodeViewHandle<ReviewMeta, undefined>

type PendingComment = { key: string; path: string; range: SelectedLineRange; body: string }

type Verdict = 'approve' | 'comment' | 'request-changes'

const STATUS_META: Record<string, { letter: string; color: string }> = {
  added: { letter: 'A', color: 'var(--green)' },
  removed: { letter: 'D', color: 'var(--red)' },
  modified: { letter: 'M', color: 'var(--cyan)' },
  renamed: { letter: 'R', color: 'var(--violet)' },
  copied: { letter: 'C', color: 'var(--violet)' },
  changed: { letter: 'M', color: 'var(--cyan)' },
}

const MONO = "'IBM Plex Mono', monospace"

const LEFT_PANE_MIN_WIDTH = 240
/** Docked in the right panel the whole shell is barely wider than the floating
 *  popover's file tree, so the tree gets a smaller floor to leave the diff room. */
const LEFT_PANE_DOCKED_MIN_WIDTH = 190
const LEFT_PANE_DEFAULT_WIDTH = 320
const LEFT_PANE_EXPANDED_WIDTH = 520
const LEFT_PANE_MAX_WIDTH_RATIO = 0.5

const CODE_VIEW_CSS = `
  :host {
    --diffs-font-family: 'IBM Plex Mono', monospace;
    --diffs-header-font-family: 'IBM Plex Sans', system-ui, sans-serif;
    --diffs-font-size: 12px;
    --diffs-line-height: 19px;
    --diffs-light-bg: var(--surface);
    --diffs-dark-bg: var(--surface);
    --diffs-light: var(--text);
    --diffs-dark: var(--text);
    --diffs-added-light: var(--green);
    --diffs-added-dark: var(--green);
    --diffs-deleted-light: var(--red);
    --diffs-deleted-dark: var(--red);
    --diffs-modified-light: var(--cyan);
    --diffs-modified-dark: var(--cyan);
    --diffs-bg-context-override: var(--surface);
    --diffs-bg-context-gutter-override: var(--surface-2);
    --diffs-bg-separator-override: var(--surface-2);
    --diffs-bg-addition-override: color-mix(in srgb, var(--green) 13%, var(--surface));
    --diffs-bg-deletion-override: color-mix(in srgb, var(--red) 14%, var(--surface));
    --diffs-fg-number-override: var(--text-3);
  }
  [data-diffs-header=default] {
    min-height: 34px;
    padding-inline: 10px;
    border-block: 1px solid var(--border);
    background: var(--surface-2);
  }
  [data-file-info] {
    color: var(--text-2);
    background: var(--surface-2);
    border-color: var(--border);
  }
`

// ─── Persistence helpers ──────────────────────────────────────────────────────

function loadStoredOptions(): { diffStyle: 'unified' | 'split'; wrap: boolean; lineNumbers: boolean } {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem('agent-viewer:pr-review-options')
      if (raw) return { diffStyle: 'unified', wrap: true, lineNumbers: true, ...JSON.parse(raw) }
    } catch { /* fall through to defaults */ }
  }
  return { diffStyle: 'unified', wrap: true, lineNumbers: true }
}

function loadStoredList<T>(storageKey: string): T[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) as T[] : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function saveStoredList<T>(storageKey: string, value: T[]) {
  try {
    if (value.length === 0) window.localStorage.removeItem(storageKey)
    else window.localStorage.setItem(storageKey, JSON.stringify(value))
  } catch { /* ignore quota */ }
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function loadWorkspace(cwd: string, number?: number, mutation?: PullRequestMutation): Promise<PullRequestWorkspace> {
  const response = await fetch('/api/github/pr', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, number, mutation }),
  })
  const result = await response.json() as { workspace?: PullRequestWorkspace; error?: string }
  if (!response.ok || !result.workspace) throw new Error(result.error || 'Unable to load pull requests.')
  return result.workspace
}

function buildAgentQuestion(workspace: PullRequestWorkspace, question: string): string {
  const pr = workspace.selected
  if (!pr) return question
  const files = pr.files.map((file) => `${file.filename} (+${file.additions} -${file.deletions})`).join('\n')
  return `Review GitHub PR #${pr.number}: ${pr.title}\n${pr.url}\nBase: ${pr.baseRefName} ← ${pr.headRefName}\n\nChanged files:\n${files}\n\nQuestion: ${question}`
}

function parseFileDiff(file: PullRequestFile): FileDiffMetadata | null {
  const oldPath = file.previousFilename ?? file.filename
  const oldRef = file.status === 'added' ? '/dev/null' : `a/${oldPath}`
  const newRef = file.status === 'removed' ? '/dev/null' : `b/${file.filename}`
  const patchText = `diff --git a/${oldPath} b/${file.filename}\n`
    + (file.patch ? `--- ${oldRef}\n+++ ${newRef}\n${file.patch}\n` : '')
  try {
    return parsePatchFiles(patchText, 'pr-review', false).flatMap((entry) => entry.files)[0] ?? null
  } catch {
    return null
  }
}

function rangeSide(range: SelectedLineRange): 'LEFT' | 'RIGHT' {
  return (range.endSide ?? range.side) === 'deletions' ? 'LEFT' : 'RIGHT'
}

function savedAnnotationsFor(path: string, comments: PullRequestComment[]): DiffLineAnnotation<ReviewMeta>[] {
  return comments
    .filter((comment) => comment.path === path && comment.line != null)
    .map((comment) => ({
      side: comment.side === 'LEFT' ? 'deletions' as const : 'additions' as const,
      lineNumber: comment.line as number,
      metadata: {
        kind: 'saved' as const,
        key: `gh-${comment.id}`,
        author: comment.author,
        message: comment.body,
        createdAt: comment.createdAt,
        url: comment.url,
      },
    }))
}

function pendingAnnotation(entry: PendingComment): DiffLineAnnotation<ReviewMeta> {
  return {
    side: (entry.range.endSide ?? entry.range.side) === 'deletions' ? 'deletions' : 'additions',
    lineNumber: entry.range.end,
    metadata: { kind: 'pending', key: entry.key, range: entry.range, message: entry.body },
  }
}

function buildReviewItems(pr: PullRequestDetail, pending: PendingComment[]): ReviewItem[] {
  const items: ReviewItem[] = []
  for (const file of pr.files) {
    const fileDiff = parseFileDiff(file)
    if (!fileDiff) continue
    items.push({
      id: file.filename,
      type: 'diff',
      fileDiff,
      annotations: [
        ...savedAnnotationsFor(file.filename, pr.comments),
        ...pending.filter((entry) => entry.path === file.filename).map(pendingAnnotation),
      ],
      version: 0,
    })
  }
  return items
}

function updateDiffItem(handle: ReviewHandle, itemId: string, mutate: (item: ReviewDiffItem) => boolean): boolean {
  const item = handle.getItem(itemId)
  if (!item || item.type !== 'diff') return false
  if (!mutate(item)) return false
  item.version = (item.version ?? 0) + 1
  return handle.updateItem(item)
}

type TreeEntry =
  | { type: 'dir'; name: string; path: string; children: TreeEntry[] }
  | { type: 'file'; name: string; file: PullRequestFile }

function buildFileTree(files: PullRequestFile[]): TreeEntry[] {
  type DirNode = { dirs: Map<string, DirNode>; files: Array<{ name: string; file: PullRequestFile }> }
  const root: DirNode = { dirs: new Map(), files: [] }
  for (const file of files) {
    const parts = file.filename.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part)
      if (!next) { next = { dirs: new Map(), files: [] }; node.dirs.set(part, next) }
      node = next
    }
    node.files.push({ name: parts[parts.length - 1], file })
  }
  const toEntries = (node: DirNode, prefix: string): TreeEntry[] => {
    const dirs = [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]): TreeEntry => {
      // Flatten single-child directory chains (a/b/c) the way GitHub and diffshub do.
      let label = name
      let path = prefix ? `${prefix}/${name}` : name
      let current = child
      while (current.files.length === 0 && current.dirs.size === 1) {
        const [nextName, nextChild] = [...current.dirs.entries()][0]
        label = `${label}/${nextName}`
        path = `${path}/${nextName}`
        current = nextChild
      }
      return { type: 'dir', name: label, path, children: toEntries(current, path) }
    })
    const leaves = [...node.files].sort((a, b) => a.name.localeCompare(b.name))
      .map((entry): TreeEntry => ({ type: 'file', name: entry.name, file: entry.file }))
    return [...dirs, ...leaves]
  }
  return toEntries(root, '')
}

function formatCommentTime(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function timeAgo(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatCommentTime(iso)
}

function countBadge(value: number, tone?: string) {
  return (
    <span style={{
      minWidth: 20, padding: '1px 6px', borderRadius: 999,
      background: 'var(--surface-2)', color: tone ?? 'var(--text-3)',
      fontFamily: MONO, fontSize: 10,
    }}>
      {value}
    </span>
  )
}

function reviewStateMeta(state: string): { label: string; color: string; icon: ReactNode } {
  const normalized = state.toUpperCase()
  if (normalized === 'APPROVED') return { label: 'approved', color: 'var(--green)', icon: <Check size={12} /> }
  if (normalized === 'CHANGES_REQUESTED') return { label: 'requested changes', color: 'var(--red)', icon: <XCircle size={12} /> }
  if (normalized === 'DISMISSED') return { label: 'dismissed', color: 'var(--text-3)', icon: <MinusCircle size={12} /> }
  return { label: 'commented', color: 'var(--text-3)', icon: <MessageSquare size={12} /> }
}

// ─── Small UI atoms ───────────────────────────────────────────────────────────

function HeaderIconButton({ title, onClick, disabled, children, href }: {
  title: string
  onClick?: () => void
  disabled?: boolean
  children: ReactNode
  href?: string
}) {
  const style: React.CSSProperties = {
    height: 34, width: 34, borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text-2)', display: 'grid', placeItems: 'center',
    cursor: disabled ? 'default' : 'pointer', flexShrink: 0, opacity: disabled ? 0.5 : 1,
  }
  if (href) {
    return <a href={href} target="_blank" rel="noreferrer" title={title} style={style}>{children}</a>
  }
  return <button type="button" className="av-hover-control" title={title} onClick={onClick} disabled={disabled} style={style}>{children}</button>
}

function Chip({ color, children, mono }: { color: string; children: ReactNode; mono?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999,
      background: `color-mix(in srgb, ${color} 13%, var(--surface-3))`,
      border: `1px solid color-mix(in srgb, ${color} 36%, var(--border))`,
      color, fontSize: 11, fontWeight: 650, whiteSpace: 'nowrap',
      fontFamily: mono ? MONO : undefined, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {children}
    </span>
  )
}

function DiffStatBlocks({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions
  const green = total === 0 ? 0 : Math.max(additions > 0 ? 1 : 0, Math.round((additions / total) * 5))
  const red = total === 0 ? 0 : Math.min(5 - green, Math.max(deletions > 0 ? 1 : 0, Math.round((deletions / total) * 5)))
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: 11 }}>
      <span style={{ color: 'var(--green)' }}>+{additions.toLocaleString()}</span>
      <span style={{ color: 'var(--red)' }}>−{deletions.toLocaleString()}</span>
      <span style={{ display: 'inline-flex', gap: 2 }} aria-hidden>
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} style={{
            width: 8, height: 8, borderRadius: 2,
            background: index < green ? 'var(--green)' : index < green + red ? 'var(--red)' : 'var(--surface-3)',
            border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
          }} />
        ))}
      </span>
    </span>
  )
}

function checkStateIcon(state: 'success' | 'failure' | 'pending' | 'neutral', size = 14): ReactNode {
  if (state === 'success') return <CheckCircle2 size={size} style={{ color: 'var(--green)' }} />
  if (state === 'failure') return <XCircle size={size} style={{ color: 'var(--red)' }} />
  if (state === 'neutral') return <MinusCircle size={size} style={{ color: 'var(--text-3)' }} />
  return <CircleDot size={size} style={{ color: 'var(--amber)' }} />
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PullRequestView({ open, cwd, onClose, onAskAgent, onLinkToSession, linkedPrNumber, variant }: Props) {
  const [workspace, setWorkspace] = useState<PullRequestWorkspace | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [tab, setTab] = useState<TabId>('files')
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set())
  const [fileFilter, setFileFilter] = useState('')
  const [activePath, setActivePath] = useState<string | null>(null)
  const [selectedLines, setSelectedLines] = useState<CodeViewLineSelection | null>(null)
  const [viewOptions, setViewOptions] = useState(loadStoredOptions)
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [question, setQuestion] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [prPickerOpen, setPrPickerOpen] = useState(false)
  const [leftPaneMode, setLeftPaneMode] = useState<'normal' | 'expanded' | 'hidden'>('normal')
  // Docked, the tree starts at its floor so the diff — the thing you docked the
  // panel to read — gets the rest; floating, the tree keeps its roomy default.
  const [leftPaneWidth, setLeftPaneWidth] = useState(
    variant === 'docked' ? LEFT_PANE_DOCKED_MIN_WIDTH : LEFT_PANE_DEFAULT_WIDTH,
  )
  const [viewedFiles, setViewedFiles] = useState<ReadonlySet<string>>(() => new Set())
  const [pending, setPending] = useState<PendingComment[]>([])
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false)
  const [reviewVerdict, setReviewVerdict] = useState<Verdict>('approve')
  const [reviewBody, setReviewBody] = useState('')
  const shellRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<ReviewHandle | null>(null)
  const activeDraftRef = useRef<{ itemId: string; key: string } | null>(null)
  const draftKeyRef = useRef(0)
  const scrollFrameRef = useRef(0)
  const pendingJumpRef = useRef<{ path: string; comment: PullRequestComment } | null>(null)

  const pr = workspace?.selected ?? null
  const prStoreKey = pr && workspace?.repo ? `${workspace.repo}#${pr.number}` : null

  useEffect(() => {
    try { window.localStorage.setItem('agent-viewer:pr-review-options', JSON.stringify(viewOptions)) } catch { /* ignore */ }
  }, [viewOptions])

  // Viewed + pending state persists per PR so an in-progress review survives closing the dialog.
  useEffect(() => {
    if (!prStoreKey) return
    setViewedFiles(new Set(loadStoredList<string>(`agent-viewer:pr-viewed:${prStoreKey}`)))
    setPending(loadStoredList<PendingComment>(`agent-viewer:pr-pending:${prStoreKey}`))
  }, [prStoreKey])
  useEffect(() => {
    if (prStoreKey) saveStoredList(`agent-viewer:pr-viewed:${prStoreKey}`, [...viewedFiles])
  }, [prStoreKey, viewedFiles])
  useEffect(() => {
    if (prStoreKey) saveStoredList(`agent-viewer:pr-pending:${prStoreKey}`, pending)
  }, [pending, prStoreKey])

  const refresh = useCallback(async (number?: number) => {
    setLoading(true); setError(null)
    try {
      const next = await loadWorkspace(cwd, number)
      setWorkspace(next)
      setSelectedLines(null)
      setActivePath(next.selected?.files[0]?.filename ?? null)
      setCollapsedDirs(new Set())
      activeDraftRef.current = null
      setRefreshNonce((nonce) => nonce + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }, [cwd])

  useEffect(() => { if (open) void refresh() }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      // Docked, the transcript and composer are alive beside this panel, so
      // j/k and Escape only apply while focus is inside the shell.
      if (shouldIgnoreDockedKey(variant, shellRef.current)) return
      const target = event.target as HTMLElement | null
      const typing = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
      if (event.key === 'Escape') {
        if (typing) return
        if (prPickerOpen) { setPrPickerOpen(false); return }
        if (viewOptionsOpen) { setViewOptionsOpen(false); return }
        if (reviewPanelOpen) { setReviewPanelOpen(false); return }
        onClose()
        return
      }
      if (typing || tab !== 'files') return
      // j/k: jump between files in the diff, like the git popover tree navigation.
      if (event.key === 'j' || event.key === 'k') {
        const ids = itemIdsRef.current
        if (ids.length === 0) return
        const current = Math.max(0, ids.indexOf(activePathRef.current ?? ids[0]))
        const next = ids[Math.min(ids.length - 1, Math.max(0, current + (event.key === 'j' ? 1 : -1)))]
        if (next) {
          setActivePath(next)
          viewerRef.current?.scrollTo({ type: 'item', id: next, align: 'start' })
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open, prPickerOpen, reviewPanelOpen, tab, variant, viewOptionsOpen])

  const items = useMemo(() => (pr ? buildReviewItems(pr, pending) : []), [pr]) // eslint-disable-line react-hooks/exhaustive-deps -- pending is injected imperatively after mount; items only seed the uncontrolled CodeView
  const itemIds = useMemo(() => items.map((item) => item.id), [items])
  const itemIdsRef = useRef(itemIds)
  const activePathRef = useRef(activePath)

  useEffect(() => {
    itemIdsRef.current = itemIds
  }, [itemIds])

  useEffect(() => {
    activePathRef.current = activePath
  }, [activePath])

  const filteredFiles = useMemo(() => {
    if (!pr) return []
    const query = fileFilter.trim().toLowerCase()
    if (!query) return pr.files
    return pr.files.filter((file) => file.filename.toLowerCase().includes(query))
  }, [fileFilter, pr])
  const tree = useMemo(() => buildFileTree(filteredFiles), [filteredFiles])
  const mountKey = pr ? `${pr.number}:${pr.headRefOid}:${refreshNonce}` : 'empty'

  const conversation = useMemo(() => {
    if (!pr) return []
    return [
      ...pr.reviews.filter((review) => review.body || review.state !== 'COMMENTED').map((review) => ({
        id: `review-${review.id}`, author: review.author, body: review.body, state: review.state, createdAt: review.submittedAt,
      })),
      ...pr.comments.filter((item) => !item.path).map((item) => ({
        id: `comment-${item.id}`, author: item.author, body: item.body, state: '', createdAt: item.createdAt,
      })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [pr])

  const inlineThreads = useMemo(() => {
    if (!pr) return []
    const byPath = new Map<string, PullRequestComment[]>()
    for (const item of pr.comments) {
      if (!item.path) continue
      const list = byPath.get(item.path) ?? []
      list.push(item)
      byPath.set(item.path, list)
    }
    const order = new Map(pr.files.map((file, index) => [file.filename, index]))
    return [...byPath.entries()]
      .sort(([a], [b]) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b))
      .map(([path, comments]) => ({ path, comments: comments.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.createdAt.localeCompare(b.createdAt)) }))
  }, [pr])
  const inlineCommentCount = useMemo(() => inlineThreads.reduce((total, thread) => total + thread.comments.length, 0), [inlineThreads])

  const reviewers = useMemo(() => {
    if (!pr) return []
    const latest = new Map<string, string>()
    for (const review of pr.reviews) {
      if (review.state === 'COMMENTED' && latest.has(review.author)) continue
      latest.set(review.author, review.state)
    }
    const rows = [...latest.entries()].map(([login, state]) => ({ login, state }))
    for (const requested of pr.reviewRequests) {
      if (!latest.has(requested)) rows.push({ login: requested, state: 'PENDING' })
    }
    return rows
  }, [pr])

  const checkSummary = useMemo(() => {
    if (!pr) return null
    const counts = { success: 0, failure: 0, pending: 0, neutral: 0 }
    for (const check of pr.checks) counts[check.state] += 1
    return counts
  }, [pr])

  const viewedCount = useMemo(() => (pr ? pr.files.filter((file) => viewedFiles.has(file.filename)).length : 0), [pr, viewedFiles])

  const mutate = useCallback(async (mutation: PullRequestMutation, label: string) => {
    if (!workspace?.repo || !pr) return false
    setBusyAction(label); setError(null)
    try {
      const next = await loadWorkspace(cwd, pr.number, mutation)
      setWorkspace(next)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally { setBusyAction(null) }
  }, [cwd, pr, workspace?.repo])

  // ── Draft / pending comment plumbing ───────────────────────────────────────

  const removeAnnotation = useCallback((itemId: string, key: string) => {
    const handle = viewerRef.current
    if (!handle) return
    updateDiffItem(handle, itemId, (item) => {
      if (!item.annotations) return false
      const next = item.annotations.filter((annotation) => annotation.metadata.key !== key)
      if (next.length === item.annotations.length) return false
      item.annotations = next
      return true
    })
  }, [])

  const removeDraft = useCallback((itemId: string, key: string) => {
    removeAnnotation(itemId, key)
    if (activeDraftRef.current?.itemId === itemId && activeDraftRef.current.key === key) activeDraftRef.current = null
    setSelectedLines(null)
  }, [removeAnnotation])

  const createDraft = useCallback((range: SelectedLineRange, itemId: string) => {
    const handle = viewerRef.current
    if (!handle) return
    const side = range.endSide ?? range.side
    if (!side) return
    const previous = activeDraftRef.current
    if (previous) removeDraft(previous.itemId, previous.key)
    const key = `draft-${draftKeyRef.current++}`
    const added = updateDiffItem(handle, itemId, (item) => {
      item.annotations = [
        ...(item.annotations ?? []).filter((annotation) => annotation.metadata.kind !== 'draft'),
        { side, lineNumber: range.end, metadata: { kind: 'draft', key, range } },
      ]
      return true
    })
    if (added) activeDraftRef.current = { itemId, key }
  }, [removeDraft])

  // "Add single comment": posts to GitHub immediately (outside any review).
  const submitSingle = useCallback(async (itemId: string, key: string, range: SelectedLineRange, message: string) => {
    if (!pr) return
    const side = rangeSide(range)
    const posted = await mutate({
      action: 'inline-comment', number: pr.number, body: message,
      commitId: pr.headRefOid, path: itemId, line: range.end, side,
      ...(range.start !== range.end ? { startLine: range.start, startSide: side } : {}),
    }, `draft-${key}`)
    if (!posted) return
    const author = workspace?.viewer ?? 'you'
    const handle = viewerRef.current
    if (handle) {
      updateDiffItem(handle, itemId, (item) => {
        if (!item.annotations) return false
        item.annotations = item.annotations.map((annotation) => annotation.metadata.key === key
          ? { ...annotation, metadata: { kind: 'saved' as const, key, author, message, createdAt: new Date().toISOString() } }
          : annotation)
        return true
      })
    }
    if (activeDraftRef.current?.itemId === itemId && activeDraftRef.current.key === key) activeDraftRef.current = null
    setSelectedLines(null)
  }, [mutate, pr, workspace?.viewer])

  // "Add review comment": queues the comment locally until the review is submitted.
  const addPending = useCallback((itemId: string, key: string, range: SelectedLineRange, message: string) => {
    const entry: PendingComment = { key, path: itemId, range, body: message }
    setPending((prev) => [...prev, entry])
    const handle = viewerRef.current
    if (handle) {
      updateDiffItem(handle, itemId, (item) => {
        if (!item.annotations) return false
        item.annotations = item.annotations.map((annotation) => annotation.metadata.key === key
          ? pendingAnnotation(entry)
          : annotation)
        return true
      })
    }
    if (activeDraftRef.current?.itemId === itemId && activeDraftRef.current.key === key) activeDraftRef.current = null
    setSelectedLines(null)
  }, [])

  const removePending = useCallback((itemId: string, key: string) => {
    setPending((prev) => prev.filter((entry) => entry.key !== key))
    removeAnnotation(itemId, key)
  }, [removeAnnotation])

  const discardPending = useCallback(() => {
    for (const entry of pending) removeAnnotation(entry.path, entry.key)
    setPending([])
  }, [pending, removeAnnotation])

  const submitReview = useCallback(async () => {
    if (!pr) return
    const comments: PullRequestReviewComment[] = pending.map((entry) => ({
      path: entry.path,
      line: entry.range.end,
      side: rangeSide(entry.range),
      body: entry.body,
      ...(entry.range.start !== entry.range.end ? { startLine: entry.range.start, startSide: rangeSide(entry.range) } : {}),
    }))
    const submitted = await mutate({
      action: 'submit-review', number: pr.number, body: reviewBody,
      verdict: reviewVerdict, commitId: pr.headRefOid, comments,
    }, 'submit-review')
    if (!submitted) return
    // Convert pending annotations to saved cards in place so scroll position survives.
    const author = workspace?.viewer ?? 'you'
    const handle = viewerRef.current
    if (handle) {
      for (const entry of pending) {
        updateDiffItem(handle, entry.path, (item) => {
          if (!item.annotations) return false
          item.annotations = item.annotations.map((annotation) => annotation.metadata.key === entry.key
            ? { ...annotation, metadata: { kind: 'saved' as const, key: entry.key, author, message: entry.body, createdAt: new Date().toISOString() } }
            : annotation)
          return true
        })
      }
    }
    setPending([])
    setReviewBody('')
    setReviewPanelOpen(false)
  }, [mutate, pending, pr, reviewBody, reviewVerdict, workspace?.viewer])

  // ── Navigation ─────────────────────────────────────────────────────────────

  const toggleItemCollapsed = useCallback((itemId: string) => {
    const handle = viewerRef.current
    const instance = handle?.getInstance()
    if (!handle || !instance) return
    const itemTop = instance.getTopForItem(itemId)
    updateDiffItem(handle, itemId, (item) => { item.collapsed = item.collapsed !== true; return true })
    if (itemTop != null && itemTop < instance.getScrollTop()) {
      handle.scrollTo({ type: 'item', id: itemId, align: 'start' })
    }
  }, [])

  const setFileViewed = useCallback((itemId: string, viewed: boolean) => {
    setViewedFiles((prev) => {
      const next = new Set(prev)
      if (viewed) next.add(itemId)
      else next.delete(itemId)
      return next
    })
    // GitHub collapses a file when marked viewed and re-expands on unmark.
    const handle = viewerRef.current
    if (handle) updateDiffItem(handle, itemId, (item) => { item.collapsed = viewed; return true })
  }, [])

  const jumpToFile = useCallback((path: string) => {
    setActivePath(path)
    setTab('files')
    viewerRef.current?.scrollTo({ type: 'item', id: path, align: 'start' })
  }, [])

  const jumpToComment = useCallback((path: string, target: PullRequestComment) => {
    if (target.line == null) return
    setActivePath(path)
    if (tab !== 'files') {
      // The viewer only exists on the files tab — finish the jump once it mounts.
      pendingJumpRef.current = { path, comment: target }
      setTab('files')
      return
    }
    const handle = viewerRef.current
    if (!handle) return
    const side = target.side === 'LEFT' ? 'deletions' as const : 'additions' as const
    handle.scrollTo({ type: 'line', id: path, lineNumber: target.line, side, align: 'center' })
    setSelectedLines({ id: path, range: { start: target.line, end: target.line, side } })
  }, [tab])

  useEffect(() => {
    if (tab !== 'files') return
    const jump = pendingJumpRef.current
    if (!jump) return
    pendingJumpRef.current = null
    const frame = requestAnimationFrame(() => {
      const handle = viewerRef.current
      if (!handle || jump.comment.line == null) return
      const side = jump.comment.side === 'LEFT' ? 'deletions' as const : 'additions' as const
      handle.scrollTo({ type: 'line', id: jump.path, lineNumber: jump.comment.line, side, align: 'center' })
      setSelectedLines({ id: jump.path, range: { start: jump.comment.line, end: jump.comment.line, side } })
    })
    return () => cancelAnimationFrame(frame)
  }, [tab])

  const handleViewerScroll = useCallback((scrollTop: number) => {
    cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = requestAnimationFrame(() => {
      const instance = viewerRef.current?.getInstance()
      if (!instance) return
      let current: string | null = null
      for (const id of itemIdsRef.current) {
        const top = instance.getTopForItem(id)
        if (top == null || top > scrollTop + 40) break
        current = id
      }
      if (current) setActivePath((prev) => (prev === current ? prev : current))
    })
  }, [])
  useEffect(() => () => cancelAnimationFrame(scrollFrameRef.current), [])

  // ── CodeView wiring ────────────────────────────────────────────────────────

  const codeViewOptions = useMemo((): CodeViewOptions<ReviewMeta, undefined> => ({
    themeType: 'system',
    diffStyle: viewOptions.diffStyle,
    diffIndicators: 'classic',
    overflow: viewOptions.wrap ? 'wrap' : 'scroll',
    disableLineNumbers: !viewOptions.lineNumbers,
    hunkSeparators: 'line-info-basic',
    lineDiffType: 'word',
    lineHoverHighlight: 'number',
    enableLineSelection: true,
    enableGutterUtility: true,
    stickyHeaders: true,
    unsafeCSS: CODE_VIEW_CSS,
    onGutterUtilityClick(range, context) {
      if (context.item.type !== 'diff') return
      createDraft(range, context.item.id)
    },
  }), [createDraft, viewOptions])

  const renderAnnotation = useCallback((annotation: LineAnnotation<ReviewMeta> | DiffLineAnnotation<ReviewMeta>, item: ReviewItem) => {
    if (!('side' in annotation) || item.type !== 'diff') return null
    const metadata = annotation.metadata
    if (metadata.kind === 'draft') {
      return (
        <DraftCommentCard
          busy={busyAction === `draft-${metadata.key}`}
          reviewStarted={pending.length > 0}
          onCancel={() => removeDraft(item.id, metadata.key)}
          onSubmitSingle={(message) => void submitSingle(item.id, metadata.key, metadata.range, message)}
          onSubmitPending={(message) => addPending(item.id, metadata.key, metadata.range, message)}
        />
      )
    }
    if (metadata.kind === 'pending') {
      return <PendingCommentCard message={metadata.message} onDelete={() => removePending(item.id, metadata.key)} />
    }
    return <SavedCommentCard author={metadata.author} createdAt={metadata.createdAt} message={metadata.message} url={metadata.url} />
  }, [addPending, busyAction, pending.length, removeDraft, removePending, submitSingle])

  const renderHeaderPrefix = useCallback((item: ReviewItem) => {
    if (item.type !== 'diff') return null
    const empty = item.fileDiff.splitLineCount === 0 && item.fileDiff.unifiedLineCount === 0
    return (
      <button
        type="button"
        className="av-hover-control"
        disabled={empty}
        aria-expanded={!empty && item.collapsed !== true}
        aria-label={item.collapsed ? 'Expand diff' : 'Collapse diff'}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleItemCollapsed(item.id) }}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, marginRight: 4, border: 0, borderRadius: 6, background: 'transparent', color: 'var(--text-3)', cursor: empty ? 'default' : 'pointer', opacity: empty ? 0.4 : 1 }}
      >
        {item.collapsed || empty ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </button>
    )
  }, [toggleItemCollapsed])

  const renderHeaderMetadata = useCallback((item: ReviewItem) => {
    if (item.type !== 'diff') return null
    const viewed = viewedFiles.has(item.id)
    return (
      <label
        onClick={(event) => event.stopPropagation()}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 10, color: viewed ? 'var(--green)' : 'var(--text-3)', fontSize: 11, fontWeight: 650, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      >
        <input
          type="checkbox"
          checked={viewed}
          onChange={(event) => setFileViewed(item.id, event.target.checked)}
          style={{ accentColor: 'var(--green)', width: 13, height: 13, cursor: 'pointer' }}
        />
        Viewed
      </label>
    )
  }, [setFileViewed, viewedFiles])

  // ── Left pane resize ───────────────────────────────────────────────────────

  function clampLeftPaneWidth(width: number): number {
    const shellWidth = shellRef.current?.getBoundingClientRect().width ?? window.innerWidth
    const minWidth = variant === 'docked' ? LEFT_PANE_DOCKED_MIN_WIDTH : LEFT_PANE_MIN_WIDTH
    const maxWidth = Math.max(minWidth, Math.min(LEFT_PANE_EXPANDED_WIDTH, Math.floor(shellWidth * LEFT_PANE_MAX_WIDTH_RATIO)))
    return Math.max(minWidth, Math.min(width, maxWidth))
  }

  // The pane width is only clamped when the *user* changes it, which is enough
  // for a full-screen popover whose shell never resizes. Docked, the shell is
  // whatever the panel is dragged to, so re-clamp whenever the shell resizes.
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

  function setPresetLeftPaneWidth(mode: 'normal' | 'expanded') {
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
      setLeftPaneWidth(clampLeftPaneWidth(startWidth + moveEvent.clientX - startX))
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

  if (!open) return null

  const decision = pr?.reviewDecision ?? ''
  const decisionMeta = decision === 'APPROVED'
    ? { label: 'Approved', color: 'var(--green)' }
    : decision === 'CHANGES_REQUESTED'
      ? { label: 'Changes requested', color: 'var(--red)' }
      : { label: 'Review pending', color: 'var(--amber)' }
  const leftPaneHidden = leftPaneMode === 'hidden'
  const failingChecks = checkSummary ? checkSummary.failure : 0

  const tabButton = (id: TabId, icon: ReactNode, label: string, badge?: ReactNode) => (
    <button
      key={id}
      type="button"
      className="av-hover-control"
      onClick={() => setTab(id)}
      style={{
        height: 34, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 12px', borderRadius: 8,
        border: `1px solid ${tab === id ? 'color-mix(in srgb, var(--cyan) 42%, var(--border))' : 'var(--border)'}`,
        background: tab === id ? 'color-mix(in srgb, var(--cyan) 13%, var(--surface-2))' : 'var(--surface)',
        color: tab === id ? 'var(--cyan)' : 'var(--text-2)',
        cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {label}
      {badge}
    </button>
  )

  const docked = isDocked(variant)

  return (
    <div
      onClick={docked ? undefined : onClose}
      role={docked ? undefined : 'dialog'}
      aria-modal={docked ? undefined : true}
      aria-labelledby="pr-view-title"
      style={docked
        ? { display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }
        : { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}
    >
      <PierreBuiltInIconSprite />
      <div
        ref={shellRef}
        tabIndex={docked ? -1 : undefined}
        onClick={(event) => event.stopPropagation()}
        style={docked
          ? {
              flex: 1, minWidth: 0, minHeight: 0, background: 'var(--surface)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              color: 'var(--text)', outline: 'none',
            }
          : {
              width: 'min(1680px, calc(100vw - 16px))', height: 'calc(100vh - 16px)',
              background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 12,
              boxShadow: '0 24px 60px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
              color: 'var(--text)',
            }}
      >
        {/* ── Header ─────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', flexShrink: 0 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center',
            background: 'color-mix(in srgb, var(--violet) 18%, var(--surface-3))', color: 'var(--violet)',
            border: '1px solid color-mix(in srgb, var(--violet) 34%, var(--border))', flexShrink: 0,
          }}>
            <GitPullRequest size={18} />
          </div>
          <div style={{ minWidth: 0, flex: 1, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <button
                type="button"
                className="av-hover-control"
                id="pr-view-title"
                onClick={() => setPrPickerOpen((value) => !value)}
                aria-expanded={prPickerOpen}
                title="Switch pull request"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, padding: 0, border: 0, background: 'transparent', color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pr ? pr.title : loading ? 'Loading pull requests…' : 'Pull requests'}
                </span>
                {pr ? <span style={{ color: 'var(--text-3)', fontWeight: 500, fontSize: 14, flexShrink: 0 }}>#{pr.number}</span> : null}
                <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--text-3)' }} />
              </button>
              {pr ? (
                <>
                  <Chip color={pr.isDraft ? 'var(--text-3)' : 'var(--green)'}>
                    <GitPullRequest size={12} />
                    {pr.isDraft ? 'Draft' : pr.state === 'OPEN' ? 'Open' : pr.state.toLowerCase()}
                  </Chip>
                  <Chip color={decisionMeta.color}>{decisionMeta.label}</Chip>
                  <Chip color="var(--violet)" mono>{pr.headRefName} → {pr.baseRefName}</Chip>
                  {onLinkToSession && workspace?.repo ? (
                    linkedPrNumber === pr.number ? (
                      <Chip color="var(--violet)">Linked to session</Chip>
                    ) : (
                      <button
                        type="button"
                        className="av-hover-control"
                        title="Link this pull request to the active session, so it settles when the PR merges"
                        onClick={() => onLinkToSession({ repo: workspace.repo as string, number: pr.number, url: pr.url, cwd })}
                        style={{
                          fontFamily: MONO, fontSize: 10, padding: '2px 7px', borderRadius: 999,
                          border: '1px solid var(--border-2)', background: 'var(--surface-3)',
                          color: 'var(--text-2)', cursor: 'pointer',
                        }}
                      >
                        LINK TO SESSION
                      </button>
                    )
                  ) : null}
                </>
              ) : null}
            </div>
            <div style={{ marginTop: 3, color: 'var(--text-3)', fontFamily: MONO, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {workspace?.repo ?? cwd}
              {pr ? ` · ${pr.author.login} · ${pr.commits.length} commit${pr.commits.length === 1 ? '' : 's'} · updated ${timeAgo(pr.updatedAt)}${loading ? ' · refreshing…' : ''}` : ''}
            </div>
            {prPickerOpen ? (
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, minWidth: 340, maxWidth: 520, maxHeight: 340, overflow: 'auto', marginTop: 8, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', boxShadow: '0 12px 32px rgba(0,0,0,0.35)' }}>
                {workspace?.pullRequests.map((item) => (
                  <button
                    key={item.number}
                    type="button"
                    className="av-hover-control"
                    onClick={() => { setPrPickerOpen(false); if (item.number !== pr?.number) void refresh(item.number) }}
                    style={{ display: 'block', width: '100%', padding: '9px 12px', border: 0, borderLeft: item.number === pr?.number ? '3px solid var(--violet)' : '3px solid transparent', background: item.number === pr?.number ? 'var(--surface-3)' : 'transparent', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 650 }}>#{item.number} {item.title}</div>
                    <div style={{ marginTop: 2, color: 'var(--text-3)', fontSize: 10 }}>{item.author.login} · {item.isDraft ? 'draft' : item.state.toLowerCase()} · {item.headRefName}</div>
                  </button>
                ))}
                {workspace && workspace.pullRequests.length === 0 ? <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 12 }}>No open pull requests.</div> : null}
              </div>
            ) : null}
          </div>
          {pr ? <DiffStatBlocks additions={pr.additions} deletions={pr.deletions} /> : null}
          {pr?.url ? <HeaderIconButton title="Open on GitHub" href={pr.url}><ExternalLink size={15} /></HeaderIconButton> : null}
          <HeaderIconButton title="Refresh pull request" onClick={() => void refresh(pr?.number)} disabled={loading}><RefreshCw size={15} /></HeaderIconButton>
          <HeaderIconButton title="Close" onClick={onClose}><X size={16} /></HeaderIconButton>
        </div>

        {/* ── Tabs row ───────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
          borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0,
          // Docked, four tabs plus the view controls exceed the panel width;
          // scroll the row rather than clipping the last tab off the edge.
          overflowX: docked ? 'auto' : undefined,
        }}>
          {tabButton('conversation', <MessageSquare size={15} />, 'Conversation', pr ? countBadge(conversation.length + inlineCommentCount) : null)}
          {tabButton('commits', <GitCommitHorizontal size={15} />, 'Commits', pr ? countBadge(pr.commits.length) : null)}
          {tabButton('checks', <ListChecks size={15} />, 'Checks', pr ? countBadge(pr.checks.length, failingChecks > 0 ? 'var(--red)' : checkSummary && checkSummary.success > 0 ? 'var(--green)' : undefined) : null)}
          {tabButton('files', <FileDiff size={15} />, 'Files changed', pr ? countBadge(pr.files.length) : null)}
          <span style={{ flex: 1 }} />
          {tab === 'files' && pr ? (
            <>
              <span style={{ color: 'var(--text-3)', fontSize: 11, fontFamily: MONO, whiteSpace: 'nowrap' }}>
                {viewedCount}/{pr.files.length} viewed
              </span>
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="av-hover-control"
                  onClick={() => setViewOptionsOpen((value) => !value)}
                  aria-expanded={viewOptionsOpen}
                  style={{
                    height: 34, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 11px', borderRadius: 8,
                    border: `1px solid ${viewOptionsOpen ? 'color-mix(in srgb, var(--cyan) 42%, var(--border))' : 'var(--border)'}`,
                    background: viewOptionsOpen ? 'color-mix(in srgb, var(--cyan) 13%, var(--surface-2))' : 'var(--surface)',
                    color: viewOptionsOpen ? 'var(--cyan)' : 'var(--text-2)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  }}
                >
                  <SlidersHorizontal size={14} />
                  View options
                </button>
                {viewOptionsOpen ? (
                  <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 40, marginTop: 8, width: 240, padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', boxShadow: '0 12px 32px rgba(0,0,0,0.35)', display: 'grid', gap: 10 }}>
                    <div role="group" aria-label="Diff style" style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {(['unified', 'split'] as const).map((style) => (
                        <button
                          key={style}
                          type="button"
                          className="av-hover-control"
                          aria-pressed={viewOptions.diffStyle === style}
                          onClick={() => setViewOptions((options) => ({ ...options, diffStyle: style }))}
                          style={{ flex: 1, padding: '6px 10px', border: 0, background: viewOptions.diffStyle === style ? 'var(--surface-3)' : 'transparent', color: viewOptions.diffStyle === style ? 'var(--text)' : 'var(--text-3)', fontSize: 11, fontWeight: 650, cursor: 'pointer' }}
                        >
                          {style === 'unified' ? 'Unified' : 'Split'}
                        </button>
                      ))}
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={viewOptions.wrap} onChange={(event) => setViewOptions((options) => ({ ...options, wrap: event.target.checked }))} style={{ accentColor: 'var(--cyan)' }} />
                      Wrap long lines
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={viewOptions.lineNumbers} onChange={(event) => setViewOptions((options) => ({ ...options, lineNumbers: event.target.checked }))} style={{ accentColor: 'var(--cyan)' }} />
                      Line numbers
                    </label>
                  </div>
                ) : null}
              </div>
              {leftPaneHidden ? (
                <button
                  type="button"
                  className="av-hover-control"
                  onClick={() => setPresetLeftPaneWidth('normal')}
                  title="Show file tree"
                  style={{ height: 34, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                >
                  <PanelLeftOpen size={15} />
                  Files
                </button>
              ) : (
                <>
                  <HeaderIconButton title={leftPaneMode === 'expanded' ? 'Restore file tree width' : 'Expand file tree'} onClick={() => setPresetLeftPaneWidth(leftPaneMode === 'expanded' ? 'normal' : 'expanded')}><Maximize2 size={15} /></HeaderIconButton>
                  <HeaderIconButton title="Hide file tree" onClick={() => setLeftPaneMode('hidden')}><PanelLeftClose size={15} /></HeaderIconButton>
                </>
              )}
            </>
          ) : null}
          {pr ? (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="av-hover-control"
                onClick={() => setReviewPanelOpen((value) => !value)}
                aria-expanded={reviewPanelOpen}
                style={{
                  height: 34, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 13px', borderRadius: 8,
                  border: '1px solid color-mix(in srgb, var(--green) 45%, var(--border))',
                  background: 'color-mix(in srgb, var(--green) 16%, var(--surface-2))',
                  color: 'var(--green)', cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                }}
              >
                Review changes
                {pending.length > 0 ? (
                  <span style={{ minWidth: 18, padding: '1px 6px', borderRadius: 999, background: 'color-mix(in srgb, var(--amber) 22%, var(--surface-3))', color: 'var(--amber)', fontFamily: MONO, fontSize: 10 }}>
                    {pending.length}
                  </span>
                ) : null}
                <ChevronDown size={13} />
              </button>
              {reviewPanelOpen ? (
                <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 40, marginTop: 8, width: 400, padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', boxShadow: '0 12px 32px rgba(0,0,0,0.35)', display: 'grid', gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Finish your review</div>
                  {pending.length > 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--amber)' }}>
                      {pending.length} pending comment{pending.length === 1 ? '' : 's'} will be submitted with this review.
                    </div>
                  ) : null}
                  <Textarea className="px-3! py-2!" value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} placeholder="Leave a review summary… (optional for approvals)" rows={4} />
                  <div role="radiogroup" aria-label="Review verdict" style={{ display: 'grid', gap: 6 }}>
                    {([
                      { value: 'approve' as const, label: 'Approve', detail: 'Submit feedback and approve merging these changes.', color: 'var(--green)' },
                      { value: 'comment' as const, label: 'Comment', detail: 'Submit general feedback without explicit approval.', color: 'var(--text-2)' },
                      { value: 'request-changes' as const, label: 'Request changes', detail: 'Submit feedback that must be addressed before merging.', color: 'var(--red)' },
                    ]).map((option) => (
                      <label key={option.value} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 9px', borderRadius: 8, border: `1px solid ${reviewVerdict === option.value ? `color-mix(in srgb, ${option.color} 40%, var(--border))` : 'var(--border)'}`, background: reviewVerdict === option.value ? `color-mix(in srgb, ${option.color} 8%, var(--surface-2))` : 'transparent', cursor: 'pointer' }}>
                        <input type="radio" name="pr-review-verdict" value={option.value} checked={reviewVerdict === option.value} onChange={() => setReviewVerdict(option.value)} style={{ marginTop: 2, accentColor: option.color }} />
                        <span>
                          <span style={{ display: 'block', fontSize: 12, fontWeight: 650, color: option.color }}>{option.label}</span>
                          <span style={{ display: 'block', marginTop: 1, fontSize: 11, color: 'var(--text-3)' }}>{option.detail}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    {pending.length > 0 ? (
                      <button type="button" className="av-hover-control" onClick={discardPending} style={{ border: 'none', background: 'transparent', color: 'var(--red)', cursor: 'pointer', padding: 0, fontSize: 11, fontWeight: 600 }}>
                        Discard pending
                      </button>
                    ) : <span />}
                    <Button
                      size="sm"
                      className="min-w-32 px-4!"
                      disabled={!!busyAction || (reviewVerdict !== 'approve' && !reviewBody.trim() && pending.length === 0)}
                      onClick={() => void submitReview()}
                    >
                      {busyAction === 'submit-review' ? 'Submitting…' : `Submit review${pending.length > 0 ? ` (${pending.length})` : ''}`}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <span style={{ color: 'var(--text-3)', fontSize: 11, fontFamily: MONO, whiteSpace: 'nowrap' }}>Esc closes</span>
        </div>

        {error || workspace?.error ? (
          <div style={{ padding: '8px 16px', color: 'var(--red)', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12, flexShrink: 0 }}>
            {error || workspace?.error}
          </div>
        ) : null}

        {/* ── Body ───────────────────────────────────────── */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {tab === 'files' ? (
            <>
              {!leftPaneHidden && (
                <div style={{ width: leftPaneWidth, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface)', position: 'relative' }}>
                  <button
                    type="button"
                    className="av-hover-control"
                    aria-label="Resize file tree"
                    title="Drag to resize file tree"
                    onPointerDown={startLeftPaneResize}
                    style={{ position: 'absolute', top: 0, right: -4, bottom: 0, width: 8, zIndex: 3, border: 'none', padding: 0, background: 'transparent', cursor: 'col-resize' }}
                  />
                  <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'grid', gap: 8 }}>
                    <label htmlFor="pull-request-file-filter" style={{ fontSize: 10, color: 'var(--text-3)' }}>Filter files</label>
                    <input
                      id="pull-request-file-filter"
                      type="search"
                      value={fileFilter}
                      onChange={(event) => setFileFilter(event.target.value)}
                      placeholder="Filter changed files…"
                      style={{ width: '100%', height: 28, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12, outline: 'none' }}
                    />
                    {pr && pr.files.length > 0 ? (
                      <div title={`${viewedCount} of ${pr.files.length} files viewed`} style={{ height: 4, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round((viewedCount / pr.files.length) * 100)}%`, height: '100%', borderRadius: 999, background: 'var(--green)', transition: 'width 0.15s ease' }} />
                      </div>
                    ) : null}
                  </div>
                  <div style={{ minHeight: 0, flex: 1, overflow: 'auto', padding: '6px 4px' }}>
                    {tree.length === 0 && !loading ? (
                      <div style={{ padding: 12, color: 'var(--text-3)', fontSize: 12 }}>
                        {pr ? (fileFilter ? 'No files match the filter.' : 'No files changed.') : 'Select an open pull request.'}
                      </div>
                    ) : null}
                    <FileTreeLevel
                      entries={tree}
                      depth={0}
                      activePath={activePath}
                      collapsedDirs={collapsedDirs}
                      viewedFiles={viewedFiles}
                      onToggleDir={(path) => setCollapsedDirs((prev) => {
                        const next = new Set(prev)
                        if (next.has(path)) next.delete(path); else next.add(path)
                        return next
                      })}
                      onSelectFile={jumpToFile}
                    />
                  </div>
                  {pr ? (
                    <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 11, color: 'var(--text-2)', display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
                      <span>{pr.files.length} files</span>
                      <span style={{ color: 'var(--green)', fontFamily: MONO }}>+{pr.additions.toLocaleString()}</span>
                      <span style={{ color: 'var(--red)', fontFamily: MONO }}>−{pr.deletions.toLocaleString()}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ color: 'var(--text-3)', fontFamily: MONO }}>j/k files</span>
                    </div>
                  ) : null}
                </div>
              )}
              <main style={{ display: 'flex', minWidth: 0, minHeight: 0, flex: 1, flexDirection: 'column', background: 'var(--surface)' }}>
                {pr && items.length > 0 ? (
                  <WorkerPoolContextProvider poolOptions={DIFF_WORKER_POOL_OPTIONS} highlighterOptions={{}}>
                    <CodeView<ReviewMeta>
                      key={mountKey}
                      ref={viewerRef}
                      initialItems={items}
                      options={codeViewOptions}
                      selectedLines={selectedLines}
                      onSelectedLinesChange={setSelectedLines}
                      onScroll={handleViewerScroll}
                      renderAnnotation={renderAnnotation}
                      renderHeaderPrefix={renderHeaderPrefix}
                      renderHeaderMetadata={renderHeaderMetadata}
                      style={{ position: 'relative', height: '100%', minHeight: 0, flex: 1, overflowY: 'auto', overflowX: 'clip', overscrollBehavior: 'contain' }}
                    />
                  </WorkerPoolContextProvider>
                ) : (
                  <div style={{ margin: 'auto', color: 'var(--text-3)' }}>{loading ? 'Loading pull requests…' : pr ? 'No textual diff available.' : 'Select an open pull request.'}</div>
                )}
              </main>
            </>
          ) : tab === 'conversation' ? (
            <ConversationTab
              pr={pr}
              loading={loading}
              conversation={conversation}
              inlineThreads={inlineThreads}
              reviewers={reviewers}
              checkSummary={checkSummary}
              comment={comment}
              question={question}
              busyAction={busyAction}
              onCommentChange={setComment}
              onQuestionChange={setQuestion}
              onSubmitComment={() => {
                if (!pr) return
                void mutate({ action: 'comment', number: pr.number, body: comment }, 'comment').then((posted) => { if (posted) setComment('') })
              }}
              onAskAgent={() => {
                if (!workspace || !question.trim()) return
                onAskAgent(buildAgentQuestion(workspace, question.trim()))
                setQuestion('')
                onClose()
              }}
              onJumpToComment={jumpToComment}
              onJumpToFile={jumpToFile}
              onOpenChecks={() => setTab('checks')}
            />
          ) : tab === 'commits' ? (
            <CommitsTab pr={pr} loading={loading} />
          ) : (
            <ChecksTab pr={pr} loading={loading} checkSummary={checkSummary} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Conversation tab ─────────────────────────────────────────────────────────

function authorInitials(author: string): string {
  const normalized = author.replace(/\[bot\]$/i, '').replace(/[^a-z0-9]+/gi, ' ').trim()
  if (!normalized) return '?'
  const parts = normalized.split(/\s+/)
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ''}` : parts[0].slice(0, 2)).toUpperCase()
}

function ConversationMarker({ author, children }: { author?: string; children?: ReactNode }) {
  return (
    <div className="av-pr-timeline-marker" title={author} aria-hidden="true">
      {children ?? authorInitials(author ?? '')}
    </div>
  )
}

function ConversationTab({
  pr, loading, conversation, inlineThreads, reviewers, checkSummary,
  comment, question, busyAction,
  onCommentChange, onQuestionChange, onSubmitComment, onAskAgent, onJumpToComment, onJumpToFile, onOpenChecks,
}: {
  pr: PullRequestDetail | null
  loading: boolean
  conversation: Array<{ id: string; author: string; body: string; state: string; createdAt: string }>
  inlineThreads: Array<{ path: string; comments: PullRequestComment[] }>
  reviewers: Array<{ login: string; state: string }>
  checkSummary: { success: number; failure: number; pending: number; neutral: number } | null
  comment: string
  question: string
  busyAction: string | null
  onCommentChange: (value: string) => void
  onQuestionChange: (value: string) => void
  onSubmitComment: () => void
  onAskAgent: () => void
  onJumpToComment: (path: string, comment: PullRequestComment) => void
  onJumpToFile: (path: string) => void
  onOpenChecks: () => void
}) {
  if (!pr) {
    return <div style={{ margin: 'auto', color: 'var(--text-3)' }}>{loading ? 'Loading pull requests…' : 'Select an open pull request.'}</div>
  }
  return (
    <div className="av-pr-conversation-layout">
      <div className="av-pr-conversation-main">
        <div className="av-pr-timeline-item">
          <ConversationMarker author={pr.author.login} />
          <article className="av-pr-timeline-card">
            <div className="av-pr-timeline-card-header">
              <strong>{pr.author.login}</strong>
              <span>opened this pull request · {timeAgo(pr.updatedAt)}</span>
            </div>
            <div className="av-pr-timeline-card-body">
              {pr.body || <span style={{ color: 'var(--text-3)' }}>No description provided.</span>}
            </div>
          </article>
        </div>

        {conversation.map((item) => {
          const meta = item.state ? reviewStateMeta(item.state) : null
          return (
            <div key={item.id} className="av-pr-timeline-item">
              <ConversationMarker author={item.author} />
              <article className="av-pr-timeline-card">
                <div className="av-pr-timeline-card-header">
                  <strong>{item.author}</strong>
                  {meta ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: meta.color, fontWeight: 650 }}>
                      {meta.icon}
                      {meta.label}
                    </span>
                  ) : <span>commented</span>}
                  <span style={{ marginLeft: 'auto' }}>{timeAgo(item.createdAt)}</span>
                </div>
                <div className="av-pr-timeline-card-body av-pr-timeline-card-body--compact">
                  {item.body || <span style={{ color: 'var(--text-3)' }}>(no review message)</span>}
                </div>
              </article>
            </div>
          )
        })}

        {inlineThreads.map((thread) => (
          <div key={thread.path} className="av-pr-timeline-item">
            <ConversationMarker><FileDiff size={15} /></ConversationMarker>
            <section className="av-pr-timeline-card">
              <button
                type="button"
                className={cn('av-pr-inline-thread-header', 'av-hover-control')}
                onClick={() => onJumpToFile(thread.path)}
                title="Open in Files changed"
              >
                <PierreFileTypeIcon filePath={thread.path} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{thread.path}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-3)', flexShrink: 0 }}>{thread.comments.length} comment{thread.comments.length === 1 ? '' : 's'}</span>
              </button>
              {thread.comments.map((item) => (
<button
                  key={item.id}
                  type="button"
                  className={cn('av-pr-inline-thread-comment', 'av-hover-control')}
                  onClick={() => onJumpToComment(thread.path, item)}
                  title={item.line != null ? 'Jump to line in Files changed' : 'Comment on an outdated diff'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--text-3)', fontSize: 10 }}>
                    <strong style={{ color: 'var(--text-2)', fontSize: 11 }}>{item.author}</strong>
                    <span style={{ fontFamily: MONO }}>{item.line != null ? `L${item.line}` : 'outdated'} · {timeAgo(item.createdAt)}</span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.45, whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.body}</div>
                </button>
              ))}
            </section>
          </div>
        ))}

        <div className="av-pr-timeline-item">
          <ConversationMarker><MessageSquare size={15} /></ConversationMarker>
          <section className="av-pr-conversation-composer">
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Continue the conversation</div>
            <div style={{ marginTop: 2, color: 'var(--text-3)', fontSize: 11 }}>Post to GitHub or bring the active agent into the review.</div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label htmlFor="pr-conversation-comment" style={{ fontSize: 12, fontWeight: 650 }}>Add a comment</label>
            <Textarea id="pr-conversation-comment" className="px-3! py-2!" value={comment} onChange={(event) => onCommentChange(event.target.value)} placeholder="Leave a comment on the conversation…" rows={3} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button className="min-w-28 px-4!" size="sm" disabled={!comment.trim() || !!busyAction} onClick={onSubmitComment}>
              <Send data-icon="inline-start" />{busyAction === 'comment' ? 'Posting…' : 'Comment'}
            </Button>
          </div>
          <div className="av-pr-agent-assist">
            <div className="av-pr-agent-assist-header">
              <span className="av-pr-agent-assist-icon"><Bot aria-hidden="true" /></span>
              <div>
                <label htmlFor="pr-agent-question">Ask the active agent</label>
                <div>Add the PR and changed files to your next agent prompt.</div>
              </div>
              <span className="av-pr-agent-assist-badge">AI assist</span>
            </div>
            <Textarea id="pr-agent-question" className="av-pr-agent-assist-input px-3! py-2!" value={question} onChange={(event) => onQuestionChange(event.target.value)} placeholder="What should the agent investigate?" rows={3} />
            <div className="av-pr-agent-assist-footer">
              <span>Private to this Agent Viewer session</span>
              <Button className="av-pr-agent-assist-button min-w-32 px-4!" size="sm" disabled={!question.trim()} onClick={onAskAgent}>
                <Bot data-icon="inline-start" />
                Ask agent
              </Button>
            </div>
          </div>
          </section>
        </div>
      </div>

      <aside className="av-pr-conversation-sidebar">
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'capitalize', color: 'var(--text-3)', letterSpacing: '0.02em', marginBottom: 6 }}>Reviewers</div>
          {reviewers.length === 0 ? <div style={{ color: 'var(--text-3)' }}>No reviews yet.</div> : reviewers.map((reviewer) => {
            const meta = reviewer.state === 'PENDING'
              ? { label: 'requested', color: 'var(--amber)', icon: <CircleDot size={12} /> }
              : reviewStateMeta(reviewer.state)
            return (
              <div key={reviewer.login} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', color: 'var(--text-2)' }}>
                <span style={{ color: meta.color, display: 'inline-flex' }}>{meta.icon}</span>
                <span style={{ fontWeight: 600 }}>{reviewer.login}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 10 }}>{meta.label}</span>
              </div>
            )
          })}
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'capitalize', color: 'var(--text-3)', letterSpacing: '0.02em', marginBottom: 7 }}>Labels</div>
          {pr.labels.length === 0 ? <div style={{ color: 'var(--text-3)' }}>No labels.</div> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {pr.labels.map((label) => (
                <span key={label.name} style={{ padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 650, background: `color-mix(in srgb, #${label.color || '888888'} 22%, var(--surface))`, color: `color-mix(in srgb, #${label.color || '888888'} 80%, var(--text))`, border: `1px solid color-mix(in srgb, #${label.color || '888888'} 45%, var(--border))` }}>
                  {label.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'capitalize', color: 'var(--text-3)', letterSpacing: '0.02em', marginBottom: 6 }}>Checks</div>
          {pr.checks.length === 0 ? <div style={{ color: 'var(--text-3)' }}>No checks reported.</div> : (
            <button type="button" className="av-hover-control" onClick={onOpenChecks} style={{ display: 'flex', alignItems: 'center', gap: 8, border: 0, background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', padding: 0, font: 'inherit' }}>
              {checkSummary && checkSummary.failure > 0
                ? <>{checkStateIcon('failure')} <span>{checkSummary.failure} failing · {checkSummary.success} passing</span></>
                : checkSummary && checkSummary.pending > 0
                  ? <>{checkStateIcon('pending')} <span>{checkSummary.pending} pending · {checkSummary.success} passing</span></>
                  : <>{checkStateIcon('success')} <span>All {checkSummary?.success ?? 0} checks passing</span></>}
            </button>
          )}
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'capitalize', color: 'var(--text-3)', letterSpacing: '0.02em', marginBottom: 6 }}>Merge status</div>
          <div style={{ color: 'var(--text-2)', display: 'grid', gap: 4 }}>
            <span>{pr.mergeable === 'MERGEABLE' ? 'No conflicts with base branch' : pr.mergeable === 'CONFLICTING' ? 'Conflicts must be resolved' : 'Merge status unknown'}</span>
            <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{pr.reviewDecision ? pr.reviewDecision.toLowerCase().replace(/_/g, ' ') : 'review pending'}</span>
          </div>
        </div>
      </aside>
    </div>
  )
}

// ─── Commits tab ──────────────────────────────────────────────────────────────

function CommitsTab({ pr, loading }: { pr: PullRequestDetail | null; loading: boolean }) {
  if (!pr) {
    return <div style={{ margin: 'auto', color: 'var(--text-3)' }}>{loading ? 'Loading pull requests…' : 'Select an open pull request.'}</div>
  }
  const repoUrl = pr.url.replace(/\/pull\/\d+$/, '')
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '18px 20px' }}>
      <div style={{ width: 'min(880px, 100%)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <GitCommitHorizontal size={13} />
          {pr.commits.length} commit{pr.commits.length === 1 ? '' : 's'} on <span style={{ fontFamily: MONO, color: 'var(--violet)' }}>{pr.headRefName}</span>
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {pr.commits.map((commit, index) => (
            <div key={commit.oid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: index > 0 ? '1px solid var(--border)' : 'none', background: 'var(--surface-2)' }}>
              <GitCommitHorizontal size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{commit.messageHeadline}</div>
                <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text-3)' }}>{commit.author} · {timeAgo(commit.authoredDate)}</div>
              </div>
              <a
                href={`${repoUrl}/commit/${commit.oid}`}
                target="_blank"
                rel="noreferrer"
                title="Open commit on GitHub"
                style={{ fontFamily: MONO, fontSize: 11, color: 'var(--cyan)', textDecoration: 'none', padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}
              >
                {commit.oid.slice(0, 7)}
              </a>
            </div>
          ))}
          {pr.commits.length === 0 ? <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 12, background: 'var(--surface-2)' }}>No commits found.</div> : null}
        </div>
      </div>
    </div>
  )
}

// ─── Checks tab ───────────────────────────────────────────────────────────────

function ChecksTab({ pr, loading, checkSummary }: {
  pr: PullRequestDetail | null
  loading: boolean
  checkSummary: { success: number; failure: number; pending: number; neutral: number } | null
}) {
  if (!pr) {
    return <div style={{ margin: 'auto', color: 'var(--text-3)' }}>{loading ? 'Loading pull requests…' : 'Select an open pull request.'}</div>
  }
  const summaryParts: string[] = []
  if (checkSummary) {
    if (checkSummary.failure > 0) summaryParts.push(`${checkSummary.failure} failing`)
    if (checkSummary.pending > 0) summaryParts.push(`${checkSummary.pending} pending`)
    if (checkSummary.success > 0) summaryParts.push(`${checkSummary.success} successful`)
    if (checkSummary.neutral > 0) summaryParts.push(`${checkSummary.neutral} skipped`)
  }
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '18px 20px' }}>
      <div style={{ width: 'min(880px, 100%)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ListChecks size={13} />
          {pr.checks.length === 0 ? 'No checks reported for the latest commit.' : summaryParts.join(' · ')}
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {pr.checks.map((check, index) => (
            <div key={`${check.name}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: index > 0 ? '1px solid var(--border)' : 'none', background: 'var(--surface-2)' }}>
              <span style={{ flexShrink: 0, display: 'inline-flex' }}>{checkStateIcon(check.state)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {check.workflow ? <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>{check.workflow} / </span> : null}
                  {check.name}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text-3)' }}>{check.rawState}</div>
              </div>
              {check.detailsUrl ? (
                <a href={check.detailsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--cyan)', textDecoration: 'none', flexShrink: 0 }}>
                  Details
                </a>
              ) : null}
            </div>
          ))}
          {pr.checks.length === 0 ? <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 12, background: 'var(--surface-2)' }}>Nothing to show — this commit has no CI checks.</div> : null}
        </div>
      </div>
    </div>
  )
}

// ─── File tree ────────────────────────────────────────────────────────────────

function FileTreeLevel({ entries, depth, activePath, collapsedDirs, viewedFiles, onToggleDir, onSelectFile }: {
  entries: TreeEntry[]
  depth: number
  activePath: string | null
  collapsedDirs: ReadonlySet<string>
  viewedFiles: ReadonlySet<string>
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
}) {
  return (
    <>
      {entries.map((entry) => {
        if (entry.type === 'dir') {
          const collapsed = collapsedDirs.has(entry.path)
          return (
            <div key={`dir-${entry.path}`}>
              <button
                type="button"
                className="av-hover-control"
                onClick={() => onToggleDir(entry.path)}
                aria-expanded={!collapsed}
                style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', padding: `3px 6px 3px ${8 + depth * 14}px`, border: 0, background: 'transparent', color: 'var(--text-3)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}
              >
                {collapsed ? <ChevronRight size={12} style={{ flexShrink: 0 }} /> : <ChevronDown size={12} style={{ flexShrink: 0 }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
              </button>
              {!collapsed ? (
                <FileTreeLevel entries={entry.children} depth={depth + 1} activePath={activePath} collapsedDirs={collapsedDirs} viewedFiles={viewedFiles} onToggleDir={onToggleDir} onSelectFile={onSelectFile} />
              ) : null}
            </div>
          )
        }
        const meta = STATUS_META[entry.file.status] ?? { letter: 'M', color: 'var(--cyan)' }
        const active = activePath === entry.file.filename
        const viewed = viewedFiles.has(entry.file.filename)
        return (
          <button
            key={`file-${entry.file.filename}`}
            type="button"
            className="av-hover-control"
            onClick={() => onSelectFile(entry.file.filename)}
            aria-current={active}
            title={entry.file.filename}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: `3px 8px 3px ${8 + depth * 14 + 16}px`, border: 0, borderLeft: active ? '2px solid var(--cyan)' : '2px solid transparent', background: active ? 'var(--surface-3)' : 'transparent', color: active ? 'var(--text)' : 'var(--text-2)', fontSize: 12, cursor: 'pointer', textAlign: 'left', opacity: viewed && !active ? 0.55 : 1 }}
          >
            <PierreFileTypeIcon filePath={entry.file.filename} />
            <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: MONO, fontSize: 11, textDecoration: viewed ? 'line-through' : 'none', textDecorationColor: 'var(--text-3)' }}>{entry.name}</span>
            <span style={{ flexShrink: 0, display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 10, fontFamily: MONO }}>
              {viewed ? <Check size={11} style={{ color: 'var(--green)' }} /> : null}
              <span style={{ color: 'var(--green)' }}>+{entry.file.additions}</span>
              <span style={{ color: 'var(--red)' }}>−{entry.file.deletions}</span>
              <span style={{ width: 12, textAlign: 'center', color: meta.color, fontWeight: 700 }}>{meta.letter}</span>
            </span>
          </button>
        )
      })}
    </>
  )
}

// ─── Annotation cards ─────────────────────────────────────────────────────────

function DraftCommentCard({ busy, reviewStarted, onCancel, onSubmitSingle, onSubmitPending }: {
  busy: boolean
  reviewStarted: boolean
  onCancel: () => void
  onSubmitSingle: (message: string) => void
  onSubmitPending: (message: string) => void
}) {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => { textareaRef.current?.focus({ preventScroll: true }) }, [])
  const trimmed = message.trim()
  return (
    <div style={{ margin: '6px 10px', padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', maxWidth: 720, fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <label htmlFor="pull-request-review-comment" style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--text-3)' }}>Review comment</label>
      <textarea
        id="pull-request-review-comment"
        ref={textareaRef}
        value={message}
        rows={2}
        placeholder="Add a review comment…"
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onCancel(); return }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (trimmed) onSubmitPending(trimmed) }
        }}
        style={{ width: '100%', resize: 'vertical', padding: 6, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 12, lineHeight: 1.45, fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="button" size="sm" variant="outline" disabled={!trimmed || busy} onClick={() => onSubmitSingle(trimmed)}>
          {busy ? 'Posting…' : 'Add single comment'}
        </Button>
        <Button type="button" size="sm" disabled={!trimmed || busy} onClick={() => onSubmitPending(trimmed)}>
          {reviewStarted ? 'Add review comment' : 'Start a review'}
        </Button>
      </div>
    </div>
  )
}

function PendingCommentCard({ message, onDelete }: { message: string; onDelete: () => void }) {
  return (
    <div style={{ margin: '6px 10px', padding: 10, border: '1px solid color-mix(in srgb, var(--amber) 40%, var(--border))', borderRadius: 10, background: 'color-mix(in srgb, var(--amber) 7%, var(--surface-2))', maxWidth: 720, fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '1px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--amber) 20%, var(--surface-3))', color: 'var(--amber)', fontSize: 10, fontWeight: 700 }}>
          Pending
        </span>
        <button type="button" className="av-hover-control" onClick={onDelete} style={{ border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', padding: 0, fontSize: 11 }}>
          Delete
        </button>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.45, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{message}</div>
      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-3)' }}>Will be posted when you submit your review.</div>
    </div>
  )
}

function SavedCommentCard({ author, createdAt, message, url }: { author: string; createdAt: string; message: string; url?: string }) {
  return (
    <div style={{ margin: '6px 10px', padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', maxWidth: 720, fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 12, color: 'var(--text)' }}>{author}</strong>
        <span style={{ color: 'var(--text-3)', fontSize: 10 }}>
          {formatCommentTime(createdAt)}
          {url ? <> · <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>view</a></> : null}
        </span>
      </div>
      <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.45, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{message}</div>
    </div>
  )
}
