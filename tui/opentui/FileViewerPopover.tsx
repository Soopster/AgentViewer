/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable, SyntaxStyle } from '@opentui/core'
import { open, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, parse, resolve } from 'node:path'
import type { TuiThemePalette } from '../theme'
import { detectTuiCodeFiletypeFromPath } from '../codeFiletypes'

export type FileViewerKeyEvent = {
  name: string
  ctrl: boolean
  shift: boolean
  sequence: string
}

type Props = {
  cwd?: string | null
  theme: TuiThemePalette
  width: number
  height: number
  syntaxStyle: SyntaxStyle
  velocityScrollEnabled: boolean
  onClose: () => void
  onKeyHandlerReady: (handler: (key: FileViewerKeyEvent) => void) => void
  onInsertPath?: (path: string) => void
  onToggleVelocityScroll: () => void
}

type FileEntry = {
  name: string
  path: string
  kind: 'directory' | 'file' | 'symlink' | 'other'
  size: number
  modified: number
}

type SortMode = 'name' | 'modified' | 'size'
type Preview =
  | { kind: 'empty'; message: string }
  | { kind: 'directory'; entries: FileEntry[] }
  | { kind: 'text'; lines: string[]; truncated: boolean }
  | { kind: 'binary'; size: number; extension: string }
  | { kind: 'error'; message: string }

const MAX_DIRECTORY_ENTRIES = 2_000
const MAX_PREVIEW_BYTES = 512 * 1024
const MAX_PREVIEW_LINES = 4_000
const VELOCITY_SCROLL_RESET_MS = 160
const VELOCITY_SCROLL_RAMP_MS = 700
const VELOCITY_SCROLL_MAX_STEP = 8
const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.css', '.csv', '.env', '.go', '.h', '.hpp', '.html', '.ini', '.java', '.js', '.json',
  '.jsx', '.log', '.lua', '.md', '.mjs', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.svg', '.toml', '.ts',
  '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml', '.zsh',
])

type IconTone = 'folder' | 'code' | 'config' | 'document' | 'media' | 'archive' | 'git' | 'lock' | 'default'
type FileIcon = { glyph: string; tone: IconTone }

// Nerd Font icons are all BMP private-use glyphs, keeping them safe for the
// OpenTUI/Windows renderer while matching the icon-rich Yazi presentation.
const FOLDER_ICON: FileIcon = { glyph: '\uf07b', tone: 'folder' }
const SYMLINK_ICON: FileIcon = { glyph: '\uf0c1', tone: 'folder' }
const DEFAULT_FILE_ICON: FileIcon = { glyph: '\uf15b', tone: 'default' }
const FILE_ICONS_BY_NAME: Readonly<Record<string, FileIcon>> = {
  '.dockerignore': { glyph: '\uf308', tone: 'config' },
  '.editorconfig': { glyph: '\ue615', tone: 'config' },
  '.env': { glyph: '\uf462', tone: 'config' },
  '.gitignore': { glyph: '\ue702', tone: 'git' },
  'bun.lock': { glyph: '\uf023', tone: 'lock' },
  'cargo.lock': { glyph: '\ue7a8', tone: 'lock' },
  'cargo.toml': { glyph: '\ue7a8', tone: 'config' },
  'dockerfile': { glyph: '\uf308', tone: 'config' },
  'go.mod': { glyph: '\ue626', tone: 'config' },
  'go.sum': { glyph: '\ue626', tone: 'lock' },
  'license': { glyph: '\uf084', tone: 'document' },
  'makefile': { glyph: '\ue673', tone: 'config' },
  'package-lock.json': { glyph: '\ue71e', tone: 'lock' },
  'package.json': { glyph: '\ue71e', tone: 'config' },
  'pnpm-lock.yaml': { glyph: '\uf023', tone: 'lock' },
  'readme': { glyph: '\uf48a', tone: 'document' },
  'readme.md': { glyph: '\uf48a', tone: 'document' },
  'tsconfig.json': { glyph: '\ue628', tone: 'config' },
}
const FILE_ICONS_BY_EXTENSION: Readonly<Record<string, FileIcon>> = {
  c: { glyph: '\ue61e', tone: 'code' },
  cc: { glyph: '\ue61d', tone: 'code' },
  cpp: { glyph: '\ue61d', tone: 'code' },
  css: { glyph: '\ue749', tone: 'code' },
  csv: { glyph: '\uf1c3', tone: 'document' },
  gif: { glyph: '\uf1c5', tone: 'media' },
  go: { glyph: '\ue626', tone: 'code' },
  h: { glyph: '\ue61e', tone: 'code' },
  html: { glyph: '\ue736', tone: 'code' },
  jpeg: { glyph: '\uf1c5', tone: 'media' },
  jpg: { glyph: '\uf1c5', tone: 'media' },
  js: { glyph: '\ue74e', tone: 'code' },
  json: { glyph: '\ue60b', tone: 'config' },
  jsx: { glyph: '\ue7ba', tone: 'code' },
  lock: { glyph: '\uf023', tone: 'lock' },
  lua: { glyph: '\ue620', tone: 'code' },
  md: { glyph: '\uf48a', tone: 'document' },
  mjs: { glyph: '\ue74e', tone: 'code' },
  mp3: { glyph: '\uf1c7', tone: 'media' },
  mp4: { glyph: '\uf1c8', tone: 'media' },
  pdf: { glyph: '\uf1c1', tone: 'document' },
  png: { glyph: '\uf1c5', tone: 'media' },
  py: { glyph: '\ue73c', tone: 'code' },
  rb: { glyph: '\ue739', tone: 'code' },
  rs: { glyph: '\ue7a8', tone: 'code' },
  sh: { glyph: '\uf489', tone: 'code' },
  sql: { glyph: '\uf1c0', tone: 'code' },
  svg: { glyph: '\uf1c5', tone: 'media' },
  tar: { glyph: '\uf1c6', tone: 'archive' },
  toml: { glyph: '\ue615', tone: 'config' },
  ts: { glyph: '\ue628', tone: 'code' },
  tsx: { glyph: '\ue7ba', tone: 'code' },
  txt: { glyph: '\uf15c', tone: 'document' },
  vue: { glyph: '\ue6a0', tone: 'code' },
  yaml: { glyph: '\ue615', tone: 'config' },
  yml: { glyph: '\ue615', tone: 'config' },
  zip: { glyph: '\uf1c6', tone: 'archive' },
  zsh: { glyph: '\uf489', tone: 'code' },
}

function formatSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`
}

function fitText(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length <= width) return value
  if (width === 1) return '…'
  return `${value.slice(0, width - 1)}…`
}

function entryIcon(entry: FileEntry): FileIcon {
  if (entry.kind === 'directory') return FOLDER_ICON
  if (entry.kind === 'symlink') return SYMLINK_ICON
  const lowerName = entry.name.toLowerCase()
  const named = FILE_ICONS_BY_NAME[lowerName]
  if (named) return named
  const extension = extname(lowerName).slice(1)
  return FILE_ICONS_BY_EXTENSION[extension] ?? DEFAULT_FILE_ICON
}

function iconColor(icon: FileIcon, theme: TuiThemePalette): string {
  switch (icon.tone) {
    case 'folder': return theme.cyan
    case 'code': return theme.violet
    case 'config': return theme.amber
    case 'document': return theme.muted
    case 'media': return theme.pink
    case 'archive': return theme.red
    case 'git': return theme.green
    case 'lock': return theme.amber
    default: return theme.dim
  }
}

async function readDirectory(path: string, showHidden: boolean, sortMode: SortMode): Promise<FileEntry[]> {
  const dirents = await readdir(path, { withFileTypes: true })
  const visible = showHidden ? dirents : dirents.filter((entry) => !entry.name.startsWith('.'))
  const entries = await Promise.all(visible.slice(0, MAX_DIRECTORY_ENTRIES).map(async (entry): Promise<FileEntry> => {
    const entryPath = join(path, entry.name)
    const info = await stat(entryPath).catch(() => null)
    return {
      name: entry.name,
      path: entryPath,
      kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'symlink' : 'other',
      size: info?.size ?? 0,
      modified: info?.mtimeMs ?? 0,
    }
  }))
  return entries.sort((a, b) => {
    if (a.kind === 'directory' && b.kind !== 'directory') return -1
    if (a.kind !== 'directory' && b.kind === 'directory') return 1
    if (sortMode === 'modified' && a.modified !== b.modified) return b.modified - a.modified
    if (sortMode === 'size' && a.size !== b.size) return b.size - a.size
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

async function loadPreview(entry: FileEntry | null, showHidden: boolean, sortMode: SortMode): Promise<Preview> {
  if (!entry) return { kind: 'empty', message: 'Empty directory' }
  try {
    if (entry.kind === 'directory') {
      return { kind: 'directory', entries: await readDirectory(entry.path, showHidden, sortMode) }
    }
    if (entry.kind !== 'file') return { kind: 'binary', size: entry.size, extension: 'special file' }
    const handle = await open(entry.path, 'r')
    const sample = Buffer.alloc(Math.min(entry.size, MAX_PREVIEW_BYTES))
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0).finally(() => handle.close())
    const content = sample.subarray(0, bytesRead)
    const extension = extname(entry.name).toLowerCase()
    const looksBinary = !TEXT_EXTENSIONS.has(extension) && content.subarray(0, 8_192).includes(0)
    if (looksBinary) return { kind: 'binary', size: entry.size, extension: extension.slice(1) || 'binary' }
    const allLines = content.toString('utf8').replace(/\r\n/g, '\n').split('\n')
    return {
      kind: 'text',
      lines: allLines.slice(0, MAX_PREVIEW_LINES),
      truncated: entry.size > MAX_PREVIEW_BYTES || allLines.length > MAX_PREVIEW_LINES,
    }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'Unable to preview file' }
  }
}

export function FileViewerPopover({
  cwd,
  theme,
  width,
  height,
  syntaxStyle,
  velocityScrollEnabled,
  onClose,
  onKeyHandlerReady,
  onInsertPath,
  onToggleVelocityScroll,
}: Props) {
  const initialDirectory = resolve(cwd || process.cwd())
  const [directory, setDirectory] = useState(initialDirectory)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [parentEntries, setParentEntries] = useState<FileEntry[]>([])
  const [cursor, setCursor] = useState(0)
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<Preview>({ kind: 'empty', message: 'Loading…' })
  const [previewLoading, setPreviewLoading] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [filterMode, setFilterMode] = useState(false)
  const [filter, setFilter] = useState('')
  const [previewFocused, setPreviewFocused] = useState(false)
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const listScrollRef = useRef<ScrollBoxRenderable>(null)
  const previewScrollRef = useRef<ScrollBoxRenderable>(null)
  const requestRef = useRef(0)
  const velocityScrollStateRef = useRef<{ direction: -1 | 1; streakStart: number; lastEventTime: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void readDirectory(directory, showHidden, sortMode)
      .then((next) => {
        if (cancelled) return
        setEntries(next)
        setCursor(0)
        listScrollRef.current?.scrollTo(0)
      })
      .catch((error) => {
        if (!cancelled) setPreview({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to read directory' })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [directory, refreshVersion, showHidden, sortMode])

  useEffect(() => {
    let cancelled = false
    void readDirectory(dirname(directory), showHidden, sortMode)
      .then((next) => { if (!cancelled) setParentEntries(next) })
      .catch(() => { if (!cancelled) setParentEntries([]) })
    return () => { cancelled = true }
  }, [directory, refreshVersion, showHidden, sortMode])

  const filteredEntries = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return query ? entries.filter((entry) => entry.name.toLowerCase().includes(query)) : entries
  }, [entries, filter])
  const selectedEntry = filteredEntries[Math.min(cursor, Math.max(0, filteredEntries.length - 1))] ?? null

  useEffect(() => {
    if (cursor >= filteredEntries.length) setCursor(Math.max(0, filteredEntries.length - 1))
  }, [cursor, filteredEntries.length])

  useEffect(() => {
    const request = ++requestRef.current
    setPreviewLoading(true)
    const timer = setTimeout(() => {
      void loadPreview(selectedEntry, showHidden, sortMode).then((next) => {
        if (requestRef.current !== request) return
        setPreview(next)
        setPreviewLoading(false)
        previewScrollRef.current?.scrollTo(0)
      })
    }, 80)
    return () => clearTimeout(timer)
  }, [selectedEntry, showHidden, sortMode])

  useEffect(() => {
    listScrollRef.current?.scrollTo(Math.max(0, cursor - 2))
  }, [cursor])

  const goParent = useCallback(() => {
    const parent = dirname(directory)
    if (parent === directory) return
    const previousName = basename(directory)
    setDirectory(parent)
    setFilter('')
    // The directory refresh resets the cursor; select the previous child once loaded.
    setTimeout(() => {
      setCursor((current) => {
        const index = entries.findIndex((entry) => entry.name === previousName)
        return index >= 0 ? index : current
      })
    }, 0)
  }, [directory, entries])

  const enterSelected = useCallback(() => {
    if (!selectedEntry) return
    if (selectedEntry.kind === 'directory') {
      setDirectory(selectedEntry.path)
      setFilter('')
      setPreviewFocused(false)
    } else if (onInsertPath) {
      onInsertPath(selectedEntry.path)
      onClose()
    }
  }, [onClose, onInsertPath, selectedEntry])

  const velocityScrollStep = useCallback((direction: -1 | 1): number => {
    if (!velocityScrollEnabled) return 1
    const now = performance.now()
    const state = velocityScrollStateRef.current
    if (!state || state.direction !== direction || now - state.lastEventTime > VELOCITY_SCROLL_RESET_MS) {
      velocityScrollStateRef.current = { direction, streakStart: now, lastEventTime: now }
      return 1
    }
    state.lastEventTime = now
    const progress = Math.max(0, Math.min(1, (now - state.streakStart) / VELOCITY_SCROLL_RAMP_MS))
    return Math.max(1, Math.round(1 + (VELOCITY_SCROLL_MAX_STEP - 1) * progress * progress))
  }, [velocityScrollEnabled])

  const handleKey = useCallback((key: FileViewerKeyEvent) => {
    if (filterMode) {
      if (key.name === 'escape') { setFilterMode(false); setFilter(''); return }
      if (key.name === 'return') { setFilterMode(false); return }
      if (key.name === 'backspace') { setFilter((value) => value.slice(0, -1)); setCursor(0); return }
      if (!key.ctrl && key.sequence.length === 1 && key.sequence >= ' ') {
        setFilter((value) => value + key.sequence)
        setCursor(0)
      }
      return
    }
    if (key.name === 'escape') {
      if (previewExpanded) { setPreviewExpanded(false); return }
      onClose()
      return
    }
    if (key.sequence === 'q') { onClose(); return }
    if (key.name === 'tab') {
      if (!previewExpanded) setPreviewFocused((value) => !value)
      return
    }
    if (key.sequence === '/') { setFilterMode(true); setFilter(''); return }
    if (key.sequence === '.') { setShowHidden((value) => !value); return }
    if (key.sequence === 's') {
      setSortMode((value) => value === 'name' ? 'modified' : value === 'modified' ? 'size' : 'name')
      return
    }
    if ((key.name === 'v' && key.shift) || key.sequence === 'V') {
      velocityScrollStateRef.current = null
      onToggleVelocityScroll()
      return
    }
    if (key.sequence === 'e' && preview.kind !== 'directory' && preview.kind !== 'empty' && preview.kind !== 'error') {
      setPreviewExpanded((value) => !value)
      setPreviewFocused(true)
      return
    }
    if (key.sequence === 'r') { setRefreshVersion((value) => value + 1); return }
    if (key.name === 'left' || key.sequence === 'h' || key.name === 'backspace') {
      if (previewExpanded) setPreviewExpanded(false)
      else goParent()
      return
    }
    if (key.name === 'right' || key.sequence === 'l' || key.name === 'return') { enterSelected(); return }
    const direction = key.name === 'up' || key.sequence === 'k' ? -1 : key.name === 'down' || key.sequence === 'j' ? 1 : 0
    if (direction !== 0) {
      if (previewFocused) previewScrollRef.current?.scrollBy(direction * velocityScrollStep(direction))
      else setCursor((value) => Math.max(0, Math.min(filteredEntries.length - 1, value + direction)))
      return
    }
    if (key.ctrl && key.name === 'u') previewScrollRef.current?.scrollBy(-10)
    if (key.ctrl && key.name === 'd') previewScrollRef.current?.scrollBy(10)
    if (key.sequence === 'g') previewFocused ? previewScrollRef.current?.scrollTo(0) : setCursor(0)
    if (key.sequence === 'G') previewFocused
      ? previewScrollRef.current?.scrollTo(Number.MAX_SAFE_INTEGER)
      : setCursor(Math.max(0, filteredEntries.length - 1))
  }, [enterSelected, filterMode, filteredEntries.length, goParent, onClose, onToggleVelocityScroll, preview, previewExpanded, previewFocused, velocityScrollStep])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const popW = Math.max(72, width - 4)
  const popH = Math.max(18, height - 4)
  const leftW = Math.max(20, Math.floor((popW - 2) * 0.22))
  const middleW = Math.max(26, Math.floor((popW - 2) * 0.34))
  const previewW = previewExpanded ? popW - 2 : Math.max(24, popW - leftW - middleW - 4)
  const contentH = popH - 5
  const parentPath = dirname(directory)
  const parentSegments = directory === parse(directory).root ? [directory] : directory.split('/').filter(Boolean)
  const lineNumberWidth = preview.kind === 'text' ? String(preview.lines.length).length : 1
  const previewFiletype = preview.kind === 'text' ? detectTuiCodeFiletypeFromPath(selectedEntry?.path) : undefined
  const previewContent = preview.kind === 'text' ? preview.lines.join('\n') : ''

  return (
    <box
      position="absolute"
      top={Math.max(0, Math.floor((height - popH) / 2))}
      left={Math.max(0, Math.floor((width - popW) / 2))}
      width={popW}
      height={popH}
      zIndex={50}
      border
      borderStyle="rounded"
      borderColor={theme.cyan}
      backgroundColor={theme.surface}
      flexDirection="column"
      title=" Files "
      titleColor={theme.cyan}
    >
      <box height={1} paddingX={1} backgroundColor={theme.surface2}>
        <text wrapMode="none">
          <span fg={theme.dim}>/</span>
          {parentSegments.map((segment, index) => (
            <span key={`${segment}:${index}`} fg={index === parentSegments.length - 1 ? theme.cyan : theme.muted}>{`${segment}/`}</span>
          ))}
        </text>
      </box>
      <box flexDirection="row" height={contentH}>
        {!previewExpanded ? <box width={leftW} border borderStyle="single" borderColor={theme.border} title=" Parent " flexDirection="column">
          <text fg={theme.dim}>{fitText(parentPath, leftW - 2)}</text>
          <scrollbox style={{ height: contentH - 3 }}>
            {parentEntries.map((entry) => {
              const selected = entry.path === directory
              const icon = entryIcon(entry)
              return (
                <text key={entry.path} wrapMode="none">
                  <span fg={selected ? theme.cyan : theme.dim}>{`${selected ? '›' : ' '} `}</span>
                  <span fg={iconColor(icon, theme)}>{`${icon.glyph} `}</span>
                  <span fg={selected ? theme.text : entry.kind === 'directory' ? theme.cyan : theme.muted}>{fitText(entry.name, leftW - 6)}</span>
                </text>
              )
            })}
          </scrollbox>
        </box> : null}
        {!previewExpanded ? <box width={middleW} border borderStyle="single" borderColor={!previewFocused ? theme.cyan : theme.border} title={` ${filteredEntries.length} items `}>
          {loading ? <text fg={theme.dim}>Loading…</text> : (
            <scrollbox ref={listScrollRef} style={{ height: contentH - 2 }}>
              {filteredEntries.map((entry, index) => {
                const selected = index === cursor
                const meta = entry.kind === 'directory' ? '' : formatSize(entry.size)
                const nameWidth = Math.max(4, middleW - meta.length - 7)
                const icon = entryIcon(entry)
                return (
                  <box key={entry.path} height={1} flexDirection="row" backgroundColor={selected ? theme.surface3 : undefined}>
                    <text wrapMode="none">
                      <span fg={selected ? theme.cyan : theme.dim}>{`${selected ? '›' : ' '} `}</span>
                      <span fg={iconColor(icon, theme)}>{`${icon.glyph} `}</span>
                      <span fg={selected ? theme.text : entry.kind === 'directory' ? theme.cyan : theme.text}>{fitText(entry.name, nameWidth)}</span>
                    </text>
                    <box flexGrow={1} />
                    <text fg={theme.dim}>{meta}</text>
                  </box>
                )
              })}
            </scrollbox>
          )}
        </box> : null}
        <box width={previewW} border borderStyle="single" borderColor={previewFocused ? theme.cyan : theme.border} title={` ${fitText(selectedEntry?.name ?? 'Preview', previewW - 6)} `}>
          {previewLoading ? <text fg={theme.dim}>Loading preview…</text> : preview.kind === 'directory' ? (
            <scrollbox ref={previewScrollRef} style={{ height: contentH - 2 }}>
              {preview.entries.map((entry) => {
                const icon = entryIcon(entry)
                return (
                  <text key={entry.path} wrapMode="none">
                    <span fg={iconColor(icon, theme)}>{`${icon.glyph} `}</span>
                    <span fg={entry.kind === 'directory' ? theme.cyan : theme.muted}>{fitText(entry.name, previewW - 5)}</span>
                  </text>
                )
              })}
            </scrollbox>
          ) : preview.kind === 'text' ? (
            <scrollbox ref={previewScrollRef} style={{ height: contentH - 2 }}>
              <box flexDirection="row">
                <box width={lineNumberWidth + 1} flexDirection="column">
                  {preview.lines.map((_, index) => (
                    <text key={index} fg={theme.dim} wrapMode="none">
                      {`${String(index + 1).padStart(lineNumberWidth)} `}
                    </text>
                  ))}
                </box>
                {previewFiletype ? (
                  <code
                    content={previewContent}
                    filetype={previewFiletype}
                    syntaxStyle={syntaxStyle}
                    drawUnstyledText={true}
                    selectable
                    style={{ height: preview.lines.length }}
                    width={Math.max(12, previewW - lineNumberWidth - 4)}
                  />
                ) : (
                  <box flexDirection="column">
                    {preview.lines.map((line, index) => (
                      <text key={index} fg={theme.text} wrapMode="none" selectable>
                        {fitText(line.replace(/\t/g, '  '), previewW - lineNumberWidth - 4)}
                      </text>
                    ))}
                  </box>
                )}
              </box>
              {preview.truncated ? <text fg={theme.amber}>… preview truncated</text> : null}
            </scrollbox>
          ) : preview.kind === 'binary' ? (
            <box padding={1} flexDirection="column">
              <text fg={theme.violet}>Binary preview</text>
              <text fg={theme.muted}>{preview.extension}</text>
              <text fg={theme.dim}>{formatSize(preview.size)}</text>
            </box>
          ) : <text fg={preview.kind === 'error' ? theme.red : theme.dim}>{preview.message}</text>}
        </box>
      </box>
      <box height={1} paddingX={1} backgroundColor={theme.surface2}>
        <text wrapMode="none">
          <span fg={filterMode ? theme.amber : theme.cyan}>{filterMode ? `/${filter}` : 'j/k'}</span>
          <span fg={theme.muted}>{filterMode ? '  type to filter · enter accept · esc clear' : ` move  h/l open  / filter  . hidden  s sort  tab preview  e ${previewExpanded ? 'restore' : 'expand'}  V velocity  q close`}</span>
          {!filterMode ? <span fg={velocityScrollEnabled ? theme.green : theme.dim}>{`  [${sortMode} · vel ${velocityScrollEnabled ? 'on' : 'off'}]`}</span> : null}
        </text>
      </box>
      <box height={1} paddingX={1}>
        <text fg={theme.dim} wrapMode="none">
          {selectedEntry ? fitText(`${selectedEntry.path}${selectedEntry.kind === 'file' ? `  ${formatSize(selectedEntry.size)}` : ''}`, popW - 4) : 'No selection'}
        </text>
      </box>
    </box>
  )
}
