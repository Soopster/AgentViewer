/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import {
  getTreeSitterClient,
  MacOSScrollAccel,
  type LineNumberRenderable,
  type SyntaxStyle,
  type TextareaRenderable,
} from '@opentui/core'
import type { MouseEvent } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import { detectTuiCodeFiletypeFromPath } from '../codeFiletypes'
import { listProjectFiles } from '../../lib/projectFiles'
import { runGitCommand } from '../../lib/gitNodeProvider'
import {
  EditorLspClient,
  type EditorCompletion,
  type EditorDiagnostic,
  type EditorLspStatus,
} from './editorLsp'

export type EditorKeyEvent = {
  name: string
  ctrl: boolean
  shift: boolean
  meta?: boolean
  sequence: string
  eventType?: 'press' | 'repeat' | 'release'
  repeated?: boolean
}

type Props = {
  cwd?: string | null
  initialPath?: string | null
  theme: TuiThemePalette
  width: number
  height: number
  syntaxStyle: SyntaxStyle
  onClose: () => void
  onKeyHandlerReady: (handler: (key: EditorKeyEvent) => boolean) => void
  onNotice?: (kind: 'info' | 'error', message: string) => void
}

type BufferTab = {
  path: string
  content: string
  savedContent: string
}

type TreeNode = {
  name: string
  path: string
  kind: 'directory' | 'file'
  children: TreeNode[]
}

type TreeRow = TreeNode & { depth: number }

type LocalCompletion = {
  label: string
  detail?: string
  insertText: string
  source: 'buffer' | 'path'
}

type Completion = EditorCompletion | LocalCompletion
type FocusPane = 'explorer' | 'editor'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_COMPLETIONS = 12
const AUTO_COMPLETE_DELAY_MS = 160
const SYNTAX_DELAY_MS = 90
const LSP_CHANGE_DELAY_MS = 120
const VELOCITY_SCROLL_RESET_MS = 420
const VELOCITY_SCROLL_HOLD_DELAY_MS = 360
const VELOCITY_SCROLL_RAMP_MS = 900
const VELOCITY_SCROLL_MAX_STEP = 8
const WORD_PATTERN = /[A-Za-z_$][\w$-]{1,}/g

const COMPLETION_KIND_GLYPHS: Readonly<Record<number, string>> = {
  2: 'ƒ', 3: 'ƒ', 4: '◫', 5: '◇', 6: '◆', 7: '◆', 8: '◇', 9: '◇', 10: '◆',
  11: '◆', 12: '◆', 13: '◇', 14: '◆', 15: '⌁', 17: '◇', 18: '◇', 21: '◇', 22: '◇', 25: '◇',
}

function fitText(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length <= width) return value
  if (width === 1) return '…'
  return `${value.slice(0, width - 1)}…`
}

function normalizeRelativePath(root: string, path: string): string | null {
  const absolute = resolve(root, path)
  const rel = relative(root, absolute)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== absolute) return null
  return rel.split(sep).join('/')
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'directory', children: [] }
  for (const filePath of paths) {
    const parts = filePath.split('/').filter(Boolean)
    let parent = root
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index]!
      const nodePath = parts.slice(0, index + 1).join('/')
      const kind: TreeNode['kind'] = index === parts.length - 1 ? 'file' : 'directory'
      let child = parent.children.find((entry) => entry.name === name)
      if (!child) {
        child = { name, path: nodePath, kind, children: [] }
        parent.children.push(child)
      }
      parent = child
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'directory' ? -1 : 1)
    for (const node of nodes) sort(node.children)
  }
  sort(root.children)
  return root.children
}

function flattenTree(nodes: TreeNode[], expanded: ReadonlySet<string>, depth = 0): TreeRow[] {
  const rows: TreeRow[] = []
  for (const node of nodes) {
    rows.push({ ...node, depth })
    if (node.kind === 'directory' && expanded.has(node.path)) rows.push(...flattenTree(node.children, expanded, depth + 1))
  }
  return rows
}

function wordPrefixAt(content: string, offset: number): { value: string; start: number } {
  const before = content.slice(0, Math.max(0, offset))
  const match = /[A-Za-z_$][\w$-]*$/.exec(before)
  const value = match?.[0] ?? ''
  return { value, start: offset - value.length }
}

function localCompletions(content: string, paths: string[], prefix: string): LocalCompletion[] {
  const normalized = prefix.toLowerCase()
  const seen = new Set<string>()
  const result: LocalCompletion[] = []
  for (const match of content.matchAll(WORD_PATTERN)) {
    const label = match[0]
    if (label.length <= prefix.length || !label.toLowerCase().startsWith(normalized) || seen.has(label)) continue
    seen.add(label)
    result.push({ label, insertText: label, detail: 'buffer', source: 'buffer' })
    if (result.length >= 60) break
  }
  for (const path of paths) {
    const label = basename(path)
    if (!label.toLowerCase().startsWith(normalized) || seen.has(label)) continue
    seen.add(label)
    result.push({ label, insertText: label, detail: path, source: 'path' })
    if (result.length >= 100) break
  }
  return result
}

function mergeCompletions(lsp: EditorCompletion[], local: LocalCompletion[], prefix: string): Completion[] {
  const normalized = prefix.toLowerCase()
  const seen = new Set<string>()
  const output: Completion[] = []
  for (const item of [...lsp, ...local]) {
    if (!item.label.toLowerCase().includes(normalized) || seen.has(item.label)) continue
    seen.add(item.label)
    output.push(item)
    if (output.length >= MAX_COMPLETIONS) break
  }
  return output
}

function lspStatusText(status: EditorLspStatus | null): string {
  if (!status) return 'LSP off'
  if (status.state === 'ready') return `LSP ${status.name}`
  if (status.state === 'starting') return `LSP ${status.name}…`
  if (status.state === 'unavailable') return 'LSP unavailable'
  return `LSP error`
}

function diagnosticCounts(diagnostics: EditorDiagnostic[]): { errors: number; warnings: number; info: number } {
  let errors = 0
  let warnings = 0
  let info = 0
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 1) errors += 1
    else if (diagnostic.severity === 2) warnings += 1
    else info += 1
  }
  return { errors, warnings, info }
}

function lineStartsFor(content: string): number[] {
  const starts = [0]
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return starts
}

function lineAtOffset(starts: number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (starts[middle]! <= offset) low = middle + 1
    else high = middle - 1
  }
  return Math.max(0, high)
}

export function EditorPopover({
  cwd,
  initialPath,
  theme,
  width,
  height,
  syntaxStyle,
  onClose,
  onKeyHandlerReady,
  onNotice,
}: Props) {
  const root = resolve(cwd || process.cwd())
  const [projectFiles, setProjectFiles] = useState<string[]>([])
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(() => new Set())
  const [treeCursor, setTreeCursor] = useState(0)
  const [tabs, setTabs] = useState<BufferTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [focusPane, setFocusPane] = useState<FocusPane>('explorer')
  const [explorerVisible, setExplorerVisible] = useState(true)
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickQuery, setQuickQuery] = useState('')
  const [quickCursor, setQuickCursor] = useState(0)
  const [cursor, setCursor] = useState({ line: 0, visualColumn: 0 })
  const [completions, setCompletions] = useState<Completion[]>([])
  const [completionCursor, setCompletionCursor] = useState(0)
  const [diagnostics, setDiagnostics] = useState<EditorDiagnostic[]>([])
  const [lspStatus, setLspStatus] = useState<EditorLspStatus | null>(null)
  const [message, setMessage] = useState('Ready')
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const [velocityScrollEnabled, setVelocityScrollEnabled] = useState(false)
  const scrollAcceleration = useMemo(() => new MacOSScrollAccel({ maxMultiplier: 3 }), [])
  const editorRef = useRef<TextareaRenderable | null>(null)
  const lineNumberRef = useRef<LineNumberRenderable | null>(null)
  const lspRef = useRef<EditorLspClient | null>(null)
  const syntaxRequestRef = useRef(0)
  const completionRequestRef = useRef(0)
  const velocityScrollStateRef = useRef<{ direction: -1 | 1; streakStart: number; lastEventTime: number } | null>(null)

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null
  const dirty = activeTab ? activeTab.content !== activeTab.savedContent : false
  const dirtyTabs = useMemo(() => tabs.filter((tab) => tab.content !== tab.savedContent), [tabs])
  const tree = useMemo(() => buildTree(projectFiles), [projectFiles])
  const treeRows = useMemo(() => flattenTree(tree, treeExpanded), [tree, treeExpanded])
  const filteredQuickFiles = useMemo(() => {
    const query = quickQuery.trim().toLowerCase()
    if (!query) return projectFiles.slice(0, 50)
    return projectFiles
      .filter((path) => path.toLowerCase().includes(query))
      .sort((a, b) => {
        const aBase = basename(a).toLowerCase().startsWith(query) ? 0 : 1
        const bBase = basename(b).toLowerCase().startsWith(query) ? 0 : 1
        return aBase - bBase || a.length - b.length
      })
      .slice(0, 50)
  }, [projectFiles, quickQuery])

  const editorWidth = Math.max(24, width - (explorerVisible ? Math.max(24, Math.min(38, Math.floor(width * 0.23))) : 0) - 2)
  const explorerWidth = explorerVisible ? Math.max(24, Math.min(38, Math.floor(width * 0.23))) : 0
  const contentHeight = Math.max(6, height - 5)

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    void listProjectFiles(root, runGitCommand).then((entries) => {
      if (cancelled) return
      const paths = entries.map((entry) => entry.path)
      setProjectFiles(paths)
      const topDirs = new Set(paths.filter((path) => path.includes('/')).map((path) => path.split('/')[0]!))
      setTreeExpanded(topDirs)
      if (initialPath) {
        const rel = normalizeRelativePath(root, initialPath)
        if (rel && paths.includes(rel)) void openBuffer(rel)
      }
    }).catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to scan project'))
    return () => { cancelled = true }
  // `openBuffer` is event-like and intentionally reads current tabs through a
  // functional update; rescanning should only follow the root/path inputs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath, root])

  const openBuffer = useCallback(async (relativePath: string) => {
    const safePath = normalizeRelativePath(root, relativePath)
    if (!safePath) {
      setMessage('Refused path outside workspace')
      return
    }
    const existing = tabs.find((tab) => tab.path === safePath)
    if (existing) {
      setActivePath(safePath)
      setFocusPane('editor')
      return
    }
    try {
      const absolute = join(root, safePath)
      const content = await readFile(absolute, 'utf8')
      if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error('File exceeds 2 MB editor limit')
      if (content.includes('\0')) throw new Error('Binary files cannot be edited')
      setTabs((current) => [...current, { path: safePath, content, savedContent: content }])
      setActivePath(safePath)
      setFocusPane('editor')
      setMessage(`Opened ${safePath}`)
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to open file'
      setMessage(text)
      onNotice?.('error', text)
    }
  }, [onNotice, root, tabs])

  const saveActive = useCallback(async () => {
    if (!activeTab) return
    try {
      await writeFile(join(root, activeTab.path), activeTab.content, 'utf8')
      setTabs((current) => current.map((tab) => tab.path === activeTab.path ? { ...tab, savedContent: tab.content } : tab))
      lspRef.current?.saved(activeTab.content)
      setMessage(`Written ${activeTab.path}`)
      onNotice?.('info', `Saved ${activeTab.path}`)
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to save file'
      setMessage(text)
      onNotice?.('error', text)
    }
  }, [activeTab, onNotice, root])

  const closeActiveTab = useCallback(() => {
    if (!activeTab) return
    if (dirty) {
      setMessage('Unsaved changes — save with Ctrl+S before closing the tab')
      return
    }
    const index = tabs.findIndex((tab) => tab.path === activeTab.path)
    const next = tabs.filter((tab) => tab.path !== activeTab.path)
    setTabs(next)
    setActivePath(next[Math.min(index, Math.max(0, next.length - 1))]?.path ?? null)
    if (next.length === 0) setFocusPane('explorer')
  }, [activeTab, dirty, tabs])

  const activateTab = useCallback((path: string) => {
    setActivePath(path)
    setFocusPane('editor')
  }, [])

  const switchTab = useCallback((delta: number) => {
    if (tabs.length < 2 || !activePath) return
    const index = tabs.findIndex((tab) => tab.path === activePath)
    const nextIndex = (index + delta + tabs.length) % tabs.length
    activateTab(tabs[nextIndex]!.path)
  }, [activateTab, activePath, tabs])

  const closeTab = useCallback((path: string) => {
    const tab = tabs.find((candidate) => candidate.path === path)
    if (!tab) return
    if (tab.content !== tab.savedContent) {
      setMessage('Unsaved changes — save with Ctrl+S before closing the tab')
      return
    }
    const index = tabs.findIndex((candidate) => candidate.path === path)
    const next = tabs.filter((candidate) => candidate.path !== path)
    setTabs(next)
    if (path === activePath) setActivePath(next[Math.min(index, Math.max(0, next.length - 1))]?.path ?? null)
    if (next.length === 0) setFocusPane('explorer')
  }, [activePath, tabs])

  const requestClose = useCallback(() => {
    const modifiedPaths = tabs.filter((tab) => tab.content !== tab.savedContent).map((tab) => tab.path)
    if (modifiedPaths.length > 0 && !closeConfirm) {
      setCloseConfirm(true)
      setMessage(`${modifiedPaths.length} modified file${modifiedPaths.length === 1 ? '' : 's'} — review the exit warning`)
      return
    }
    onClose()
  }, [closeConfirm, onClose, tabs])

  useEffect(() => {
    if (!tabs.some((tab) => tab.content !== tab.savedContent)) setCloseConfirm(false)
  }, [tabs])

  useEffect(() => {
    lspRef.current?.stop()
    lspRef.current = null
    setDiagnostics([])
    setLspStatus(null)
    if (!activeTab) return
    const filetype = detectTuiCodeFiletypeFromPath(activeTab.path) ?? 'plaintext'
    const client = new EditorLspClient(root, filetype, join(root, activeTab.path))
    lspRef.current = client
    client.onStatus(setLspStatus)
    client.onDiagnostics(setDiagnostics)
    void client.start(activeTab.content)
    return () => client.stop()
  // Starting an LSP is a buffer lifecycle event, not an every-keystroke event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.path, root])

  useEffect(() => {
    if (!activeTab) return
    const timer = setTimeout(() => lspRef.current?.change(activeTab.content), LSP_CHANGE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [activeTab])

  useEffect(() => {
    if (!activeTab) return
    const request = ++syntaxRequestRef.current
    const filetype = detectTuiCodeFiletypeFromPath(activeTab.path)
    const timer = setTimeout(() => {
      if (!filetype) return
      void getTreeSitterClient().highlightOnce(activeTab.content, filetype).then((result) => {
        const editor = editorRef.current
        if (request !== syntaxRequestRef.current || !editor) return
        editor.clearAllHighlights()
        const lineStarts = lineStartsFor(activeTab.content)
        for (const highlight of result.highlights ?? []) {
          const styleId = syntaxStyle.resolveStyleId(highlight[2]) ?? syntaxStyle.resolveStyleId('default')
          if (styleId == null) continue
          const firstLine = lineAtOffset(lineStarts, highlight[0])
          const lastLine = lineAtOffset(lineStarts, Math.max(highlight[0], highlight[1] - 1))
          for (let line = firstLine; line <= lastLine; line += 1) {
            const lineStart = lineStarts[line] ?? 0
            const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1]! - 1 : activeTab.content.length
            editor.addHighlight(line, {
              start: Math.max(0, highlight[0] - lineStart),
              end: Math.max(0, Math.min(highlight[1], lineEnd) - lineStart),
              styleId,
              priority: 10,
            })
          }
        }
      }).catch(() => {})
    }, SYNTAX_DELAY_MS)
    return () => clearTimeout(timer)
  }, [activeTab, syntaxStyle])

  useEffect(() => {
    const lineNumber = lineNumberRef.current
    if (!lineNumber) return
    const colors = new Map<number, { gutter?: string; content?: string }>()
    colors.set(cursor.line, { gutter: theme.surface3, content: theme.surface2 })
    for (const diagnostic of diagnostics) {
      colors.set(diagnostic.line, {
        gutter: diagnostic.severity === 1 ? theme.red : diagnostic.severity === 2 ? theme.amber : theme.cyan,
      })
    }
    lineNumber.setLineColors(colors)
  }, [cursor.line, diagnostics, theme.amber, theme.cyan, theme.red, theme.surface2, theme.surface3])

  const requestCompletions = useCallback(async (force = false) => {
    const editor = editorRef.current
    if (!activeTab || !editor) return
    const content = editor.plainText
    const prefix = wordPrefixAt(content, editor.cursorOffset)
    if (!force && prefix.value.length < 2) {
      setCompletions([])
      return
    }
    const request = ++completionRequestRef.current
    const local = localCompletions(content, projectFiles, prefix.value)
    const lsp = await lspRef.current?.completion({ line: cursor.line, character: cursor.visualColumn }) ?? []
    if (request !== completionRequestRef.current) return
    setCompletions(mergeCompletions(lsp, local, prefix.value))
    setCompletionCursor(0)
  }, [activeTab, cursor.line, cursor.visualColumn, projectFiles])

  useEffect(() => {
    if (!activeTab || focusPane !== 'editor') return
    const timer = setTimeout(() => { void requestCompletions(false) }, AUTO_COMPLETE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [activeTab, cursor, focusPane, requestCompletions])

  const acceptCompletion = useCallback(() => {
    const editor = editorRef.current
    const item = completions[completionCursor]
    if (!editor || !item) return
    const prefix = wordPrefixAt(editor.plainText, editor.cursorOffset)
    editor.setSelection(prefix.start, editor.cursorOffset)
    editor.insertText(item.insertText)
    setCompletions([])
    setMessage(`${item.source === 'lsp' ? 'LSP' : item.source} completion: ${item.label}`)
  }, [completionCursor, completions])

  const activateTreeRow = useCallback(() => {
    const row = treeRows[treeCursor]
    if (!row) return
    if (row.kind === 'directory') {
      setTreeExpanded((current) => {
        const next = new Set(current)
        if (next.has(row.path)) next.delete(row.path)
        else next.add(row.path)
        return next
      })
      return
    }
    void openBuffer(row.path)
  }, [openBuffer, treeCursor, treeRows])

  const chooseQuickFile = useCallback(() => {
    const path = filteredQuickFiles[quickCursor]
    if (!path) return
    setQuickOpen(false)
    setQuickQuery('')
    void openBuffer(path)
  }, [filteredQuickFiles, openBuffer, quickCursor])

  const chooseQuickFileAt = useCallback((index: number) => {
    const path = filteredQuickFiles[index]
    if (!path) return
    setQuickOpen(false)
    setQuickQuery('')
    void openBuffer(path)
  }, [filteredQuickFiles, openBuffer])

  const acceptCompletionAt = useCallback((index: number) => {
    setCompletionCursor(index)
    const editor = editorRef.current
    const item = completions[index]
    if (!editor || !item) return
    const prefix = wordPrefixAt(editor.plainText, editor.cursorOffset)
    editor.setSelection(prefix.start, editor.cursorOffset)
    editor.insertText(item.insertText)
    setCompletions([])
    setMessage(`${item.source === 'lsp' ? 'LSP' : item.source} completion: ${item.label}`)
  }, [completions])

  const velocityScrollStep = useCallback((direction: -1 | 1, isRepeat: boolean): number => {
    if (!velocityScrollEnabled) {
      velocityScrollStateRef.current = null
      return 1
    }
    const now = performance.now()
    const state = velocityScrollStateRef.current
    if (!state || state.direction !== direction || now - state.lastEventTime > VELOCITY_SCROLL_RESET_MS) {
      velocityScrollStateRef.current = { direction, streakStart: now, lastEventTime: now }
      return 1
    }
    state.lastEventTime = now
    const heldFor = now - state.streakStart
    if (!isRepeat && heldFor < VELOCITY_SCROLL_HOLD_DELAY_MS) return 1
    if (heldFor < VELOCITY_SCROLL_HOLD_DELAY_MS) return 1
    const progress = Math.max(0, Math.min(1, (heldFor - VELOCITY_SCROLL_HOLD_DELAY_MS) / VELOCITY_SCROLL_RAMP_MS))
    return Math.max(1, Math.round(1 + (VELOCITY_SCROLL_MAX_STEP - 1) * progress * progress))
  }, [velocityScrollEnabled])

  const handleKey = useCallback((key: EditorKeyEvent): boolean => {
    const sequence = key.sequence ?? ''
    if (key.sequence === 'V' && !key.ctrl && !key.meta) {
      velocityScrollStateRef.current = null
      setVelocityScrollEnabled((value) => !value)
      return true
    }
    if (key.ctrl && key.name === 'tab') {
      switchTab(key.shift ? -1 : 1)
      return true
    }
    if (key.ctrl && (key.name === 'pageup' || key.name === 'pagedown')) {
      switchTab(key.name === 'pageup' ? -1 : 1)
      return true
    }
    if (quickOpen) {
      if (key.name === 'escape') { setQuickOpen(false); setQuickQuery(''); return true }
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) { setQuickCursor((value) => Math.max(0, value - 1)); return true }
      if (key.name === 'down' || (key.ctrl && key.name === 'n')) { setQuickCursor((value) => Math.min(filteredQuickFiles.length - 1, value + 1)); return true }
      if (key.name === 'return') { chooseQuickFile(); return true }
      if (key.name === 'backspace' || key.name === 'delete') { setQuickQuery((value) => value.slice(0, -1)); setQuickCursor(0); return true }
      if (!key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ') { setQuickQuery((value) => value + sequence); setQuickCursor(0); return true }
      return true
    }
    if (completions.length > 0) {
      if (key.name === 'escape') { setCompletions([]); return true }
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) { setCompletionCursor((value) => Math.max(0, value - 1)); return true }
      if (key.name === 'down' || (key.ctrl && key.name === 'n')) { setCompletionCursor((value) => Math.min(completions.length - 1, value + 1)); return true }
      if (key.name === 'tab' || key.name === 'return') { acceptCompletion(); return true }
    }
    if (focusPane === 'editor' && velocityScrollEnabled && (key.name === 'up' || key.name === 'down')) {
      const isRepeat = key.eventType === 'repeat' || key.repeated === true
      const editor = editorRef.current
      if (!editor) return true
      const lines = editor.plainText.split('\n')
      const current = editor.logicalCursor
      const step = velocityScrollStep(key.name === 'up' ? -1 : 1, isRepeat)
      const direction = key.name === 'up' ? -1 : 1
      const row = Math.max(0, Math.min(lines.length - 1, current.row + direction * step))
      let offset = 0
      for (let index = 0; index < row; index += 1) offset += (lines[index]?.length ?? 0) + 1
      editor.cursorOffset = offset + Math.min(current.col, lines[row]?.length ?? 0)
      return true
    }
    if (key.name === 'escape' && closeConfirm) {
      setCloseConfirm(false)
      setMessage('Exit cancelled; modified files remain open')
      return true
    }
    if (key.ctrl && key.name === 'e') {
      setFocusPane((current) => current === 'editor' ? 'explorer' : 'editor')
      return true
    }
    if (key.ctrl && key.name === 'q') { requestClose(); return true }
    if (key.ctrl && key.name === 's') { void saveActive(); return true }
    if (key.ctrl && key.name === 'p') { setQuickOpen(true); setQuickQuery(''); setQuickCursor(0); return true }
    if (key.ctrl && key.name === 'b') { setExplorerVisible((value) => !value); setFocusPane('editor'); return true }
    if (key.ctrl && key.name === 'w') { closeActiveTab(); return true }
    if (key.ctrl && (key.name === 'space' || sequence === '\0')) { void requestCompletions(true); return true }
    if (key.name === 'escape') {
      if (focusPane === 'explorer' && activeTab) { setFocusPane('editor'); editorRef.current?.focus() }
      else setMessage('Ctrl+Q closes editor · Ctrl+P opens files')
      return true
    }
    if (focusPane === 'explorer') {
      if (key.name === 'up' || sequence === 'k') { setTreeCursor((value) => Math.max(0, value - 1)); return true }
      if (key.name === 'down' || sequence === 'j') { setTreeCursor((value) => Math.min(treeRows.length - 1, value + 1)); return true }
      if (key.name === 'right' || sequence === 'l' || key.name === 'return') { activateTreeRow(); return true }
      if (key.name === 'left' || sequence === 'h') {
        const row = treeRows[treeCursor]
        if (row?.kind === 'directory' && treeExpanded.has(row.path)) {
          setTreeExpanded((current) => { const next = new Set(current); next.delete(row.path); return next })
        }
        return true
      }
      return true
    }
    return false
  }, [acceptCompletion, activateTreeRow, activeTab, chooseQuickFile, closeActiveTab, completionCursor, completions.length, filteredQuickFiles.length, focusPane, quickOpen, requestClose, requestCompletions, saveActive, switchTab, treeCursor, treeExpanded, treeRows, velocityScrollEnabled, velocityScrollStep])

  useEffect(() => {
    onKeyHandlerReady(handleKey)
  }, [handleKey, onKeyHandlerReady])

  useEffect(() => {
    if (focusPane === 'editor') editorRef.current?.focus()
  }, [activePath, focusPane])

  const setEditorRef = useCallback((node: TextareaRenderable | null) => {
    editorRef.current = node
  }, [])

  const updateActiveContent = useCallback(() => {
    const content = editorRef.current?.plainText
    if (content == null || !activePath) return
    setCloseConfirm(false)
    setTabs((current) => current.map((tab) => tab.path === activePath ? { ...tab, content } : tab))
  }, [activePath])

  const counts = useMemo(() => diagnosticCounts(diagnostics), [diagnostics])
  const statusPath = activeTab ? activeTab.path : relative(process.cwd(), root) || basename(root)
  const completionTop = Math.max(3, Math.min(contentHeight - Math.min(completions.length, 7) - 1, cursor.line - (editorRef.current?.scrollY ?? 0) + 2))
  const completionLeft = explorerWidth + Math.max(7, Math.min(editorWidth - 34, cursor.visualColumn + 7))

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width={width}
      height={height}
      backgroundColor={theme.bg}
      border
      borderStyle="heavy"
      borderColor={theme.violet}
      title="  EDITOR "
      titleColor={theme.violet}
      zIndex={50}
      flexDirection="column"
    >
      <box height={1} flexDirection="row" backgroundColor={theme.surface3}>
        {tabs.length === 0 ? <text fg={theme.dim}>  No buffers · choose a file from Explorer</text> : null}
        {tabs.map((tab) => {
          const selected = tab.path === activePath
          const tabDirty = tab.content !== tab.savedContent
          return (
            <box
              key={tab.path}
              paddingX={1}
              backgroundColor={selected ? theme.surface2 : theme.surface3}
              onMouseUp={(event: MouseEvent) => {
                if (event.button !== 0) return
                event.stopPropagation()
                activateTab(tab.path)
              }}
            >
              <text fg={selected ? theme.cyan : theme.dim} wrapMode="none">{`${selected ? '●' : '○'} ${basename(tab.path)}${tabDirty ? ' +' : ''} `}</text>
              <text
                fg={tabDirty ? theme.amber : theme.dim}
                onMouseUp={(event: MouseEvent) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  closeTab(tab.path)
                }}
              >×</text>
            </box>
          )
        })}
      </box>

      <box height={contentHeight} flexDirection="row">
        {explorerVisible ? (
          <box width={explorerWidth} border borderStyle={focusPane === 'explorer' ? 'heavy' : 'single'} borderColor={focusPane === 'explorer' ? theme.amber : theme.border} flexDirection="column">
            <box height={1} paddingX={1} flexDirection="row">
              <text fg={theme.amber}>EXPLORER</text>
              <box flexGrow={1} />
              <text fg={theme.dim}>{projectFiles.length}</text>
            </box>
            <box height={1} paddingX={1} backgroundColor={theme.surface2}>
              <text fg={theme.cyan} wrapMode="none">{fitText(`▾ ${basename(root)}`, explorerWidth - 4)}</text>
            </box>
            <scrollbox flexGrow={1} focused={focusPane === 'explorer'} scrollAcceleration={scrollAcceleration}>
              {treeRows.map((row, index) => {
                const selected = index === treeCursor
                const indent = '  '.repeat(row.depth)
                const glyph = row.kind === 'directory' ? (treeExpanded.has(row.path) ? '▾' : '▸') : '◇'
                const fg = row.kind === 'directory' ? theme.cyan : detectTuiCodeFiletypeFromPath(row.path) ? theme.text : theme.muted
                return (
                  <box
                    key={row.path}
                    height={1}
                    paddingX={1}
                    backgroundColor={selected ? theme.surface3 : theme.bg}
                    onMouseUp={(event: MouseEvent) => {
                      if (event.button !== 0) return
                      event.stopPropagation()
                      setFocusPane('explorer')
                      if (row.kind === 'directory') {
                        setTreeExpanded((current) => {
                          const next = new Set(current)
                          if (next.has(row.path)) next.delete(row.path)
                          else next.add(row.path)
                          return next
                        })
                      } else {
                        void openBuffer(row.path)
                      }
                    }}
                  >
                    <text fg={selected ? theme.amber : fg} wrapMode="none">
                      {fitText(`${indent}${glyph} ${row.name}`, explorerWidth - 4)}
                    </text>
                  </box>
                )
              })}
            </scrollbox>
          </box>
        ) : null}

        <box flexGrow={1} flexDirection="column" backgroundColor={theme.bg}>
          {activeTab ? (
            <line-number
              key={activeTab.path}
              ref={lineNumberRef}
              minWidth={4}
              paddingRight={1}
              showLineNumbers
              fg={theme.dim}
              bg={theme.surface}
              flexGrow={1}
            >
              <textarea
                id="project-editor-textarea"
                ref={setEditorRef}
                initialValue={activeTab.content}
                focused={focusPane === 'editor'}
                flexGrow={1}
                wrapMode="none"
                syntaxStyle={syntaxStyle}
                textColor={theme.text}
                backgroundColor={theme.bg}
                focusedBackgroundColor={theme.bg}
                focusedTextColor={theme.text}
                selectionBg={theme.surface3}
                selectionFg={theme.text}
                cursorColor={theme.amber}
                cursorStyle={{ style: 'block', blinking: true }}
                scrollMargin={4}
                scrollSpeed={3}
                tabIndicator="→"
                tabIndicatorColor={theme.dim}
                onContentChange={updateActiveContent}
                onCursorChange={setCursor}
              />
            </line-number>
          ) : (
            <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
              <text fg={theme.violet}>  Agent Viewer Editor</text>
              <text fg={theme.dim}>Select a file · Ctrl+P quick open · Ctrl+Q close</text>
            </box>
          )}
        </box>
      </box>

      <box height={1} flexDirection="row" backgroundColor={theme.surface3}>
        <box paddingX={1} backgroundColor={focusPane === 'editor' ? theme.violet : theme.amber}>
          <text fg={theme.bg}>{focusPane === 'editor' ? 'INSERT' : 'EXPLORER'}</text>
        </box>
        <text fg={theme.cyan}>{`   ${basename(root)} `}</text>
        {dirty ? <text fg={theme.amber}>● modified  </text> : <text fg={theme.green}>✓ saved  </text>}
        {counts.errors > 0 ? <text fg={theme.red}>{`× ${counts.errors} `}</text> : null}
        {counts.warnings > 0 ? <text fg={theme.amber}>{`▲ ${counts.warnings} `}</text> : null}
        {counts.info > 0 ? <text fg={theme.cyan}>{`● ${counts.info} `}</text> : null}
        <text fg={lspStatus?.state === 'ready' ? theme.green : theme.dim}>{` ${lspStatusText(lspStatus)}`}</text>
        <box flexGrow={1} />
        <text fg={theme.dim}>{`${detectTuiCodeFiletypeFromPath(activeTab?.path) ?? 'text'}  ${cursor.line + 1}:${cursor.visualColumn + 1}  ${clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} `}</text>
      </box>
      <box height={1} paddingX={1} backgroundColor={theme.surface2} flexDirection="row">
        <text fg={message.startsWith('Unable') || message.startsWith('Refused') ? theme.red : theme.dim} wrapMode="none">{fitText(message, Math.max(10, width - 55))}</text>
        <box flexGrow={1} />
        <text fg={theme.dim}>^S save  ^P files  ^Space complete  ^E focus  ^B explorer  V velocity {velocityScrollEnabled ? 'on' : 'off'}  ^W close tab  ^Q exit</text>
      </box>

      {quickOpen ? (
        <box position="absolute" top={2} left={Math.max(2, Math.floor(width * 0.2))} width={Math.max(30, Math.floor(width * 0.6))} height={Math.min(16, height - 5)} zIndex={60} border borderStyle="heavy" borderColor={theme.cyan} backgroundColor={theme.surface} flexDirection="column" title=" Quick open ">
          <box height={1} paddingX={1} backgroundColor={theme.surface2}>
            <text fg={theme.text}>{`› ${quickQuery || 'type a file name…'}`}</text>
          </box>
          <scrollbox flexGrow={1} scrollAcceleration={scrollAcceleration}>
            {filteredQuickFiles.slice(0, 12).map((path, index) => (
              <box
                key={path}
                height={1}
                paddingX={1}
                backgroundColor={index === quickCursor ? theme.surface3 : theme.surface}
                onMouseUp={(event: MouseEvent) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  chooseQuickFileAt(index)
                }}
              >
                <text fg={index === quickCursor ? theme.amber : theme.text} wrapMode="none">{fitText(path, Math.max(20, Math.floor(width * 0.6) - 4))}</text>
              </box>
            ))}
          </scrollbox>
        </box>
      ) : null}

      {completions.length > 0 && activeTab && focusPane === 'editor' ? (
        <box position="absolute" top={completionTop} left={completionLeft} width={Math.min(42, Math.max(26, editorWidth - 8))} height={Math.min(completions.length + 2, 10)} zIndex={55} border borderStyle="rounded" borderColor={theme.violet} backgroundColor={theme.surface} flexDirection="column" title=" completions ">
          {completions.slice(0, 8).map((item, index) => (
            <box
              key={`${item.source}:${item.label}`}
              height={1}
              paddingX={1}
              backgroundColor={index === completionCursor ? theme.surface3 : theme.surface}
              flexDirection="row"
              onMouseUp={(event: MouseEvent) => {
                if (event.button !== 0) return
                event.stopPropagation()
                acceptCompletionAt(index)
              }}
            >
              <text fg={item.source === 'lsp' ? theme.violet : item.source === 'path' ? theme.cyan : theme.amber}>{`${item.source === 'lsp' ? COMPLETION_KIND_GLYPHS[item.kind ?? 0] ?? '◇' : item.source === 'path' ? '󰈙' : 'ω'} `}</text>
              <text fg={index === completionCursor ? theme.text : theme.muted} wrapMode="none">{fitText(item.label, Math.min(24, editorWidth - 16))}</text>
              <box flexGrow={1} />
              <text fg={theme.dim} wrapMode="none">{fitText(item.detail ?? item.source, 12)}</text>
            </box>
          ))}
        </box>
      ) : null}

      {closeConfirm && dirtyTabs.length > 0 ? (
        <box
          position="absolute"
          top={Math.max(3, Math.floor(height * 0.28))}
          left={Math.max(3, Math.floor(width * 0.2))}
          width={Math.max(36, Math.min(width - 6, Math.floor(width * 0.6)))}
          height={Math.min(8 + dirtyTabs.length, height - 8)}
          zIndex={70}
          border
          borderStyle="heavy"
          borderColor={theme.amber}
          backgroundColor={theme.surface}
          paddingX={1}
          flexDirection="column"
          title=" unsaved changes "
          titleColor={theme.amber}
        >
          <text fg={theme.amber}>Modified files will be discarded if you exit:</text>
          {dirtyTabs.slice(0, 6).map((tab) => <text key={tab.path} fg={theme.text}>• {fitText(tab.path, Math.max(20, width - 18))}</text>)}
          {dirtyTabs.length > 6 ? <text fg={theme.dim}>{`…and ${dirtyTabs.length - 6} more`}</text> : null}
          <box flexGrow={1} />
          <text fg={theme.dim}>Ctrl+Q discard and exit · Esc cancel · Ctrl+S save current</text>
        </box>
      ) : null}

      {diagnostics.length > 0 && activeTab ? (
        <box position="absolute" bottom={2} left={explorerWidth + 7} width={Math.min(70, editorWidth - 8)} height={1} zIndex={54} backgroundColor={theme.surface3} paddingX={1}>
          <text fg={diagnostics[0]!.severity === 1 ? theme.red : theme.amber} wrapMode="none">
            {fitText(`${diagnostics[0]!.source ? `${diagnostics[0]!.source}: ` : ''}${diagnostics[0]!.message}`, Math.min(68, editorWidth - 10))}
          </text>
        </box>
      ) : null}
      <box position="absolute" top={1} right={1} height={1} backgroundColor={theme.surface3} paddingX={1}>
        <text fg={theme.dim} wrapMode="none">{fitText(statusPath, Math.max(12, Math.floor(width * 0.35)))}</text>
      </box>
    </box>
  )
}
