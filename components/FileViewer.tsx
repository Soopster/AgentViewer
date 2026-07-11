'use client'

import dynamic from 'next/dynamic'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowDownAZ,
  ChevronRight,
  File,
  FileCode2,
  FileCog,
  FileJson,
  FileLock2,
  FileText,
  Folder,
  FolderOpen,
  Eye,
  Image,
  Link2,
  Maximize2,
  Minimize2,
  Music,
  RefreshCw,
  Search,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CommandDialog } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const CodeViewer = dynamic(() => import('./CodeRenderers').then((module) => module.CodeViewer), {
  ssr: false,
  loading: () => <div className="p-4 font-mono text-xs text-[var(--text-3)]">Loading syntax highlighter…</div>,
})

type FileEntry = {
  name: string
  path: string
  kind: 'directory' | 'file' | 'symlink' | 'other'
  size: number
  modified: number
}

type DirectoryResponse = {
  kind: 'directory'
  path: string
  parent: string
  entries: FileEntry[]
  parentEntries: FileEntry[]
  truncated: boolean
}

type PreviewResponse =
  | DirectoryResponse
  | { kind: 'text'; path: string; size: number; content: string; truncated: boolean }
  | { kind: 'binary'; path: string; size: number; extension: string }

type SortMode = 'name' | 'modified' | 'size'
type IconTone = 'folder' | 'code' | 'config' | 'document' | 'media' | 'archive' | 'lock' | 'default'
type IconSpec = { icon: LucideIcon; tone: IconTone }

type Props = {
  open: boolean
  cwd: string
  canInsert: boolean
  onOpenChange: (open: boolean) => void
  onInsertPath?: (path: string) => void
}

const DEFAULT_ICON: IconSpec = { icon: File, tone: 'default' }
const NAME_ICONS: Readonly<Record<string, IconSpec>> = {
  '.dockerignore': { icon: FileCog, tone: 'config' },
  '.editorconfig': { icon: FileCog, tone: 'config' },
  '.env': { icon: FileCog, tone: 'config' },
  '.gitignore': { icon: FileCog, tone: 'config' },
  'bun.lock': { icon: FileLock2, tone: 'lock' },
  'cargo.lock': { icon: FileLock2, tone: 'lock' },
  'cargo.toml': { icon: FileCog, tone: 'config' },
  dockerfile: { icon: FileCog, tone: 'config' },
  'go.mod': { icon: FileCog, tone: 'config' },
  'go.sum': { icon: FileLock2, tone: 'lock' },
  license: { icon: FileText, tone: 'document' },
  makefile: { icon: FileCog, tone: 'config' },
  'package-lock.json': { icon: FileLock2, tone: 'lock' },
  'package.json': { icon: FileJson, tone: 'config' },
  'pnpm-lock.yaml': { icon: FileLock2, tone: 'lock' },
  readme: { icon: FileText, tone: 'document' },
  'readme.md': { icon: FileText, tone: 'document' },
  'tsconfig.json': { icon: FileCog, tone: 'config' },
}
const EXTENSION_ICONS: Readonly<Record<string, IconSpec>> = {
  c: { icon: FileCode2, tone: 'code' }, cpp: { icon: FileCode2, tone: 'code' }, css: { icon: FileCode2, tone: 'code' },
  csv: { icon: FileText, tone: 'document' }, gif: { icon: Image, tone: 'media' }, go: { icon: FileCode2, tone: 'code' },
  h: { icon: FileCode2, tone: 'code' }, html: { icon: FileCode2, tone: 'code' }, jpeg: { icon: Image, tone: 'media' },
  jpg: { icon: Image, tone: 'media' }, js: { icon: FileCode2, tone: 'code' }, json: { icon: FileJson, tone: 'config' },
  jsx: { icon: FileCode2, tone: 'code' }, lock: { icon: FileLock2, tone: 'lock' }, lua: { icon: FileCode2, tone: 'code' },
  md: { icon: FileText, tone: 'document' }, mjs: { icon: FileCode2, tone: 'code' }, mp3: { icon: Music, tone: 'media' },
  mp4: { icon: Video, tone: 'media' }, pdf: { icon: FileText, tone: 'document' }, png: { icon: Image, tone: 'media' },
  py: { icon: FileCode2, tone: 'code' }, rb: { icon: FileCode2, tone: 'code' }, rs: { icon: FileCode2, tone: 'code' },
  sh: { icon: FileCode2, tone: 'code' }, sql: { icon: FileCode2, tone: 'code' }, svg: { icon: Image, tone: 'media' },
  tar: { icon: Archive, tone: 'archive' }, toml: { icon: FileCog, tone: 'config' }, ts: { icon: FileCode2, tone: 'code' },
  tsx: { icon: FileCode2, tone: 'code' }, txt: { icon: FileText, tone: 'document' }, vue: { icon: FileCode2, tone: 'code' },
  yaml: { icon: FileCog, tone: 'config' }, yml: { icon: FileCog, tone: 'config' }, zip: { icon: Archive, tone: 'archive' },
  zsh: { icon: FileCode2, tone: 'code' },
}

function iconSpec(entry: FileEntry): IconSpec {
  if (entry.kind === 'directory') return { icon: Folder, tone: 'folder' }
  if (entry.kind === 'symlink') return { icon: Link2, tone: 'folder' }
  const lowerName = entry.name.toLowerCase()
  const named = NAME_ICONS[lowerName]
  if (named) return named
  const dot = lowerName.lastIndexOf('.')
  return EXTENSION_ICONS[dot >= 0 ? lowerName.slice(dot + 1) : ''] ?? DEFAULT_ICON
}

function toneClass(tone: IconTone): string {
  switch (tone) {
    case 'folder': return 'text-[var(--cyan)]'
    case 'code': return 'text-[var(--violet)]'
    case 'config': return 'text-[var(--amber)]'
    case 'document': return 'text-[var(--text-2)]'
    case 'media': return 'text-[var(--pink,var(--violet))]'
    case 'archive': return 'text-[var(--red)]'
    case 'lock': return 'text-[var(--amber)]'
    default: return 'text-[var(--text-3)]'
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`
}

function buildBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  const parts = path.split(/[\\/]/).filter(Boolean)
  const windowsDrive = /^[A-Za-z]:[\\/]/.test(path)
  let current = path.startsWith('/') ? '/' : ''
  return parts.map((part, index) => {
    if (windowsDrive && index === 0) current = `${part}\\`
    else if (current === '/') current = `/${part}`
    else if (current.endsWith('\\')) current = `${current}${part}`
    else current = current ? `${current}${windowsDrive ? '\\' : '/'}${part}` : part
    return { label: part, path: current }
  })
}

function sortEntries(entries: FileEntry[], sortMode: SortMode): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === 'directory' && b.kind !== 'directory') return -1
    if (a.kind !== 'directory' && b.kind === 'directory') return 1
    if (sortMode === 'modified' && a.modified !== b.modified) return b.modified - a.modified
    if (sortMode === 'size' && a.size !== b.size) return b.size - a.size
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

async function fetchPath(path: string, showHidden: boolean, signal?: AbortSignal): Promise<PreviewResponse> {
  const params = new URLSearchParams({ path })
  if (showHidden) params.set('hidden', '1')
  const response = await fetch(`/api/files?${params.toString()}`, { signal })
  const body = await response.json() as PreviewResponse | { error?: string }
  if (!response.ok || 'error' in body) throw new Error('error' in body ? body.error || 'Unable to read path' : `HTTP ${response.status}`)
  return body as PreviewResponse
}

function FileRow({ entry, selected, onClick, onDoubleClick }: {
  entry: FileEntry
  selected?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
}) {
  const spec = iconSpec(entry)
  const Icon = spec.icon
  return (
    <button
      type="button"
      className={cn(
        'flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-3 text-left font-mono text-[13px] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cyan)]',
        selected && 'bg-[var(--surface-3)] text-[var(--text)] shadow-[inset_2px_0_0_var(--cyan)]',
      )}
      style={{ paddingLeft: 10, paddingRight: 10 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <Icon className={cn('size-[17px] shrink-0', toneClass(spec.tone))} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {entry.kind !== 'directory' ? <span className="shrink-0 text-[10px] text-[var(--text-3)]">{formatSize(entry.size)}</span> : null}
    </button>
  )
}

export default function FileViewer({ open, cwd, canInsert, onOpenChange, onInsertPath }: Props) {
  const [directory, setDirectory] = useState(cwd)
  const [directoryData, setDirectoryData] = useState<DirectoryResponse | null>(null)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [cursor, setCursor] = useState(0)
  const [previewCursor, setPreviewCursor] = useState(0)
  const [focusedPane, setFocusedPane] = useState<'current' | 'preview'>('current')
  const [filter, setFilter] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const filterRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const previewListRef = useRef<HTMLDivElement>(null)
  const deferredFilter = useDeferredValue(filter.trim().toLowerCase())

  useEffect(() => {
    if (!open) return
    setDirectory(cwd)
    setFilter('')
    setCursor(0)
    setPreviewCursor(0)
    setFocusedPane('current')
    setPreviewExpanded(false)
  }, [cwd, open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void fetchPath(directory, showHidden, controller.signal)
      .then((result) => {
        if (result.kind !== 'directory') throw new Error('The selected path is not a directory')
        setDirectoryData(result)
        setCursor(0)
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : 'Unable to read directory')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [directory, open, refreshVersion, showHidden])

  const entries = useMemo(() => {
    const sorted = sortEntries(directoryData?.entries ?? [], sortMode)
    return deferredFilter ? sorted.filter((entry) => entry.name.toLowerCase().includes(deferredFilter)) : sorted
  }, [deferredFilter, directoryData?.entries, sortMode])
  const parentEntries = useMemo(() => sortEntries(directoryData?.parentEntries ?? [], sortMode), [directoryData?.parentEntries, sortMode])
  const selectedEntry = entries[Math.min(cursor, Math.max(0, entries.length - 1))] ?? null

  useEffect(() => {
    if (cursor >= entries.length) setCursor(Math.max(0, entries.length - 1))
  }, [cursor, entries.length])

  useEffect(() => {
    if (!open || !selectedEntry) {
      setPreview(null)
      return
    }
    const controller = new AbortController()
    setPreviewLoading(true)
    const timer = window.setTimeout(() => {
      void fetchPath(selectedEntry.path, showHidden, controller.signal)
        .then((result) => {
          setPreview(result)
          setPreviewCursor(0)
          if (result.kind !== 'directory') setFocusedPane('current')
        })
        .catch((reason) => {
          if (reason instanceof DOMException && reason.name === 'AbortError') return
          setPreview(null)
        })
        .finally(() => setPreviewLoading(false))
    }, 100)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, selectedEntry, showHidden])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-file-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const previewEntries = useMemo(
    () => preview?.kind === 'directory' ? sortEntries(preview.entries, sortMode) : [],
    [preview, sortMode],
  )
  const selectedPreviewEntry = previewEntries[Math.min(previewCursor, Math.max(0, previewEntries.length - 1))] ?? null

  useEffect(() => {
    if (previewCursor >= previewEntries.length) setPreviewCursor(Math.max(0, previewEntries.length - 1))
  }, [previewCursor, previewEntries.length])

  useEffect(() => {
    previewListRef.current?.querySelector<HTMLElement>(`[data-preview-index="${previewCursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [previewCursor])

  const activateEntry = useCallback((entry: FileEntry | null) => {
    if (!entry) return
    if (entry.kind === 'directory') {
      setDirectory(entry.path)
      setFilter('')
      setFocusedPane('current')
      return
    }
    if (canInsert && onInsertPath) {
      onInsertPath(entry.path)
      onOpenChange(false)
    }
  }, [canInsert, onInsertPath, onOpenChange])

  const goParent = useCallback(() => {
    if (!directoryData || directoryData.parent === directoryData.path) return
    setDirectory(directoryData.parent)
    setFilter('')
  }, [directoryData])

  const navigateToBreadcrumb = useCallback((path: string) => {
    setDirectory(path)
    setFilter('')
    setCursor(0)
    setPreviewCursor(0)
    setFocusedPane('current')
  }, [])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
      if (event.key === 'Escape') {
        event.preventDefault()
        if (previewExpanded) setPreviewExpanded(false)
        else if (typing && filter) setFilter('')
        else onOpenChange(false)
        return
      }
      if (typing) return
      if (event.key === 'Tab') {
        event.preventDefault()
        if (preview?.kind === 'directory') setFocusedPane((pane) => pane === 'current' ? 'preview' : 'current')
        return
      }
      if (event.key === '/') {
        event.preventDefault()
        filterRef.current?.focus()
        return
      }
      if (event.key === '.' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        setShowHidden((value) => !value)
        return
      }
      if (event.key === 's') {
        event.preventDefault()
        setSortMode((value) => value === 'name' ? 'modified' : value === 'modified' ? 'size' : 'name')
        return
      }
      if (event.key === 'r') {
        event.preventDefault()
        setRefreshVersion((value) => value + 1)
        return
      }
      if (event.key === 'e' && preview?.kind !== 'directory' && preview != null) {
        event.preventDefault()
        setPreviewExpanded((value) => !value)
        setFocusedPane('preview')
        return
      }
      if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault()
        if (focusedPane === 'preview' && preview?.kind === 'directory') setPreviewCursor((value) => Math.max(0, value - 1))
        else setCursor((value) => Math.max(0, value - 1))
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault()
        if (focusedPane === 'preview' && preview?.kind === 'directory') {
          setPreviewCursor((value) => Math.min(previewEntries.length - 1, value + 1))
        } else {
          setCursor((value) => Math.min(entries.length - 1, value + 1))
        }
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'h' || event.key === 'Backspace') {
        event.preventDefault()
        if (focusedPane === 'preview') setFocusedPane('current')
        else goParent()
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'l' || event.key === 'Enter') {
        event.preventDefault()
        activateEntry(focusedPane === 'preview' ? selectedPreviewEntry : selectedEntry)
        return
      }
      if (event.key === 'g') {
        event.preventDefault()
        if (focusedPane === 'preview') setPreviewCursor(0)
        else setCursor(0)
      }
      if (event.key === 'G') {
        event.preventDefault()
        if (focusedPane === 'preview') setPreviewCursor(Math.max(0, previewEntries.length - 1))
        else setCursor(Math.max(0, entries.length - 1))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activateEntry, entries.length, filter, focusedPane, goParent, onOpenChange, open, preview, previewEntries.length, previewExpanded, selectedEntry, selectedPreviewEntry])

  const breadcrumbs = useMemo(() => buildBreadcrumbs(directoryData?.path ?? directory), [directory, directoryData?.path])
  const currentName = breadcrumbs.at(-1)?.label ?? directory

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      centered
      insetPadding={8}
      className="flex-col rounded-2xl"
      style={{
        width: 'min(calc(100vw - 16px), 2000px)',
        height: 'calc(100vh - 16px)',
        maxWidth: 2000,
        maxHeight: 'calc(100vh - 16px)',
        borderColor: 'var(--border-2)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
      }}
    >
      <div
        className="flex h-16 shrink-0 items-center border-b border-[var(--border)]"
        style={{ gap: 12, padding: '0 16px', background: 'var(--surface-2)' }}
      >
        <div
          className="grid shrink-0 place-items-center"
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            color: 'var(--cyan)',
            background: 'color-mix(in srgb, var(--cyan) 16%, var(--surface-3))',
            border: '1px solid color-mix(in srgb, var(--cyan) 34%, var(--border))',
          }}
        >
          <FolderOpen className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="truncate text-[15px] font-bold text-[var(--text)]">File viewer</h2>
            <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-3)] px-2 py-0.5 font-mono text-[10px] text-[var(--cyan)]">
              {entries.length} items
            </span>
          </div>
          <nav aria-label="File path" className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden font-mono text-[11px] text-[var(--text-3)]">
            {breadcrumbs.map((breadcrumb, index) => (
              <span key={breadcrumb.path} className="flex min-w-0 items-center gap-1">
                {index > 0 ? <ChevronRight className="size-3 shrink-0" aria-hidden /> : null}
                <button
                  type="button"
                  onClick={() => navigateToBreadcrumb(breadcrumb.path)}
                  aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}
                  title={`Open ${breadcrumb.path}`}
                  className={cn(
                    'min-w-0 truncate rounded-sm px-0.5 hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cyan)]',
                    index === breadcrumbs.length - 1 && 'text-[var(--cyan)]',
                  )}
                >
                  {breadcrumb.label}
                </button>
              </span>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="outline" size="icon" onClick={() => setRefreshVersion((value) => value + 1)} aria-label="Refresh files">
            <RefreshCw aria-hidden />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={() => onOpenChange(false)} aria-label="Close file viewer">
            <X aria-hidden />
          </Button>
        </div>
      </div>

      <div
        className="flex shrink-0 items-center border-b border-[var(--border)]"
        style={{ gap: 10, minHeight: 54, padding: '8px 16px', background: 'var(--surface)' }}
      >
        <div className="relative shrink-0" style={{ width: 'clamp(260px, 26vw, 380px)' }}>
          <Search
            className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-[var(--text-3)]"
            style={{ left: 14 }}
            aria-hidden
          />
          <Input
            ref={filterRef}
            value={filter}
            onChange={(event) => { setFilter(event.target.value); setCursor(0) }}
            placeholder="Filter files…"
            aria-label="Filter files"
            className="h-10 rounded-lg bg-[var(--surface-2)] font-mono text-[13px]"
            style={{ paddingLeft: 42, paddingRight: 38 }}
          />
          <kbd
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-3)]"
            style={{ right: 10 }}
          >
            /
          </kbd>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowHidden((value) => !value)}
          style={{
            height: 34,
            padding: '0 12px',
            gap: 7,
            borderRadius: 8,
            borderColor: showHidden ? 'color-mix(in srgb, var(--cyan) 42%, var(--border))' : 'var(--border)',
            background: showHidden ? 'color-mix(in srgb, var(--cyan) 13%, var(--surface-2))' : 'var(--surface)',
            color: showHidden ? 'var(--cyan)' : 'var(--text-2)',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <Eye data-icon="inline-start" aria-hidden />
          Hidden {showHidden ? 'on' : 'off'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSortMode((value) => value === 'name' ? 'modified' : value === 'modified' ? 'size' : 'name')}
          style={{
            height: 34,
            padding: '0 12px',
            gap: 7,
            borderRadius: 8,
            borderColor: 'var(--border)',
            background: 'var(--surface)',
            color: 'var(--text-2)',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <ArrowDownAZ data-icon="inline-start" aria-hidden />
          Sort: {sortMode}
        </Button>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-[var(--text-3)]">Ctrl-F opens · Esc closes</span>
      </div>

      <div
        className="grid min-h-0 flex-1 bg-[var(--surface)]"
        style={{ gridTemplateColumns: previewExpanded ? 'minmax(0, 1fr)' : 'minmax(190px, 24%) minmax(300px, 34%) minmax(360px, 1fr)' }}
      >
        {!previewExpanded ? <section className="flex min-h-0 flex-col border-r border-[var(--border)]" aria-label="Parent directory">
          <div className="flex h-11 shrink-0 items-center text-xs font-bold text-[var(--text)]" style={{ padding: '0 14px', background: 'var(--surface-2)' }}>Parent</div>
          <Separator />
          <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: '12px 14px' }}>
            {parentEntries.map((entry) => (
              <FileRow key={entry.path} entry={entry} selected={entry.path === directoryData?.path} onDoubleClick={() => activateEntry(entry)} />
            ))}
          </div>
        </section> : null}

        {!previewExpanded ? <section className={cn('flex min-h-0 flex-col border-r border-[var(--border)]', focusedPane === 'current' && 'shadow-[inset_0_0_0_1px_var(--cyan)]')} aria-label="Current directory">
          <div className="flex h-11 shrink-0 items-center justify-between text-xs font-bold text-[var(--text)]" style={{ padding: '0 14px', background: 'var(--surface-2)' }}>
            <span className="truncate">{currentName}</span>
            <span className="font-mono text-[10px] font-normal text-[var(--text-3)]">{entries.length} items</span>
          </div>
          <Separator />
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" style={{ padding: '12px 14px' }}>
            {loading ? <div className="p-3 font-mono text-xs text-[var(--text-3)]">Loading…</div> : null}
            {!loading && entries.length === 0 ? <div className="p-3 font-mono text-xs text-[var(--text-3)]">No files found</div> : null}
            {entries.map((entry, index) => (
              <div key={entry.path} data-file-index={index}>
                <FileRow entry={entry} selected={index === cursor} onClick={() => { setCursor(index); setFocusedPane('current') }} onDoubleClick={() => activateEntry(entry)} />
              </div>
            ))}
            {directoryData?.truncated ? <div className="px-2 py-1 font-mono text-[10px] text-[var(--amber)]">Directory listing truncated</div> : null}
          </div>
        </section> : null}

        <section className={cn('flex min-h-0 flex-col', focusedPane === 'preview' && 'shadow-[inset_0_0_0_1px_var(--cyan)]')} aria-label="File preview">
          <div className="flex h-11 shrink-0 items-center justify-between gap-3 text-xs font-bold text-[var(--text)]" style={{ padding: '0 14px', background: 'var(--surface-2)' }}>
            <span className="truncate">{selectedEntry?.name ?? 'Preview'}</span>
            <div className="flex shrink-0 items-center gap-2">
              {selectedEntry?.kind === 'file' ? <span className="font-mono text-[10px] font-normal text-[var(--text-3)]">{formatSize(selectedEntry.size)}</span> : null}
              {preview && preview.kind !== 'directory' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => { setPreviewExpanded((value) => !value); setFocusedPane('preview') }}
                  aria-label={previewExpanded ? 'Restore file browser panes' : 'Expand file preview'}
                  title={previewExpanded ? 'Restore panes (E)' : 'Expand preview (E)'}
                  className="size-8 text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--cyan)]"
                >
                  {previewExpanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
                </Button>
              ) : null}
            </div>
          </div>
          <Separator />
          <div className="min-h-0 flex-1 overflow-auto bg-[var(--surface-2)]">
            {previewLoading ? <div className="p-4 font-mono text-xs text-[var(--text-3)]">Loading preview…</div> : null}
            {!previewLoading && preview?.kind === 'directory' ? (
              <div ref={previewListRef} style={{ padding: '12px 14px' }}>
                {previewEntries.map((entry, index) => (
                  <div key={entry.path} data-preview-index={index}>
                    <FileRow
                      entry={entry}
                      selected={focusedPane === 'preview' && index === previewCursor}
                      onClick={() => { setPreviewCursor(index); setFocusedPane('preview') }}
                      onDoubleClick={() => activateEntry(entry)}
                    />
                  </div>
                ))}
              </div>
            ) : null}
            {!previewLoading && preview?.kind === 'text' ? (
              <div style={{ boxSizing: 'border-box', minWidth: '100%', padding: 12, width: 'max-content' }}>
                <CodeViewer code={preview.content} filePath={preview.path} showLineNumbers expandToContentWidth />
                {preview.truncated ? <div className="border-t border-[var(--border)] p-2 font-mono text-[10px] text-[var(--amber)]">Preview truncated at 512 KB</div> : null}
              </div>
            ) : null}
            {!previewLoading && preview?.kind === 'binary' ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <File className="size-10 text-[var(--violet)]" aria-hidden />
                <div className="font-mono text-xs text-[var(--text-2)]">Binary preview</div>
                <div className="font-mono text-[10px] text-[var(--text-3)]">{preview.extension} · {formatSize(preview.size)}</div>
              </div>
            ) : null}
            {!previewLoading && !preview ? <div className="p-4 font-mono text-xs text-[var(--text-3)]">Select a file to preview</div> : null}
          </div>
        </section>
      </div>

      <div
        className="flex h-12 shrink-0 items-center border-t border-[var(--border)] font-mono text-[11px] text-[var(--text-3)]"
        style={{ gap: 18, padding: '0 16px', background: 'var(--surface-2)' }}
      >
        <span><kbd className="text-[var(--cyan)]">j/k</kbd> move</span>
        <span><kbd className="text-[var(--cyan)]">h/l</kbd> open</span>
        <span><kbd className="text-[var(--cyan)]">/</kbd> filter</span>
        <span><kbd className="text-[var(--cyan)]">tab</kbd> pane</span>
        <span><kbd className="text-[var(--cyan)]">.</kbd> hidden</span>
        <span><kbd className="text-[var(--cyan)]">s</kbd> sort</span>
        {preview?.kind !== 'directory' && preview != null ? <span><kbd className="text-[var(--cyan)]">e</kbd> {previewExpanded ? 'restore' : 'expand'}</span> : null}
        <span className="ml-auto">{sortMode} · hidden {showHidden ? 'on' : 'off'}</span>
        {error ? <span className="text-[var(--red)]">{error}</span> : null}
        <span className={canInsert ? 'text-[var(--text-2)]' : 'text-[var(--text-3)]'}>{canInsert ? 'Enter file · add to composer' : 'Select a session to insert files'}</span>
      </div>
    </CommandDialog>
  )
}
