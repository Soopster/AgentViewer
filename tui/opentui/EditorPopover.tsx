/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import {
  getTreeSitterClient,
  MacOSScrollAccel,
  type LineNumberRenderable,
  ScrollBarRenderable,
  type SyntaxStyle,
  type TextareaOptions,
  type TextareaRenderable,
} from '@opentui/core'
import type { MouseEvent } from '@opentui/core'
import { extend } from '@opentui/react'
import type { TuiThemePalette } from '../theme'
import { detectTuiCodeFiletypeFromPath } from '../codeFiletypes'
import { listProjectFiles } from '../../lib/projectFiles'
import { runGitCommand } from '../../lib/gitNodeProvider'
import {
  EditorLspClient,
  type EditorCompletion,
  type EditorDiagnostic,
  type EditorHover,
  type EditorLspStatus,
  type EditorSignatureHelp,
} from './editorLsp'
import { createScrollVelocityState, velocityScrollStep } from './scrollVelocity'

extend({ editorScrollbar: ScrollBarRenderable })

const EDITOR_TEXTAREA_KEY_BINDINGS: NonNullable<TextareaOptions['keyBindings']> = [
  { name: 'home', action: 'line-home' },
  { name: 'end', action: 'line-end' },
  { name: 'home', shift: true, action: 'select-line-home' },
  { name: 'end', shift: true, action: 'select-line-end' },
]

declare module '@opentui/react' {
  interface OpenTUIComponents {
    editorScrollbar: typeof ScrollBarRenderable
  }
}

export type EditorKeyEvent = {
  name: string
  ctrl: boolean
  shift: boolean
  meta?: boolean
  option?: boolean
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
type VimMode = 'insert' | 'normal' | 'visual'
type QuickMode = 'files' | 'buffers' | 'commands' | 'line'

type QuickResult = {
  id: string
  label: string
  detail: string
  kind: QuickMode
}

type EditorCommandId =
  | 'save'
  | 'find'
  | 'goto-line'
  | 'toggle-explorer'
  | 'focus-explorer'
  | 'close-tab'
  | 'next-diagnostic'
  | 'previous-diagnostic'
  | 'show-hover'
  | 'toggle-vim'
  | 'toggle-velocity'
  | 'toggle-word-wrap'

type EditorCommand = {
  id: EditorCommandId
  label: string
  detail: string
  keywords: string
}

type SearchMatch = { start: number; end: number }

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_COMPLETIONS = 12
const AUTO_COMPLETE_DELAY_MS = 160
const SYNTAX_DELAY_MS = 90
const LSP_CHANGE_DELAY_MS = 120
const SIGNATURE_DELAY_MS = 110
const WORD_PATTERN = /[A-Za-z_$][\w$-]{1,}/g

function packFooterShortcuts(shortcuts: readonly string[], width: number): string[] {
  const rows: string[] = []
  let current = ''
  for (const shortcut of shortcuts) {
    const candidate = current ? `${current}  ${shortcut}` : shortcut
    if (current && candidate.length > width) {
      rows.push(current)
      current = shortcut
    } else {
      current = candidate
    }
  }
  if (current) rows.push(current)
  return rows
}

const EDITOR_COMMANDS: readonly EditorCommand[] = [
  { id: 'save', label: 'File: Save', detail: 'Ctrl+S', keywords: 'write file' },
  { id: 'find', label: 'Edit: Find in File', detail: 'Ctrl+F', keywords: 'search text' },
  { id: 'goto-line', label: 'Go to Line', detail: 'Ctrl+G', keywords: 'jump row' },
  { id: 'next-diagnostic', label: 'Problems: Next Diagnostic', detail: 'F8', keywords: 'error warning issue' },
  { id: 'previous-diagnostic', label: 'Problems: Previous Diagnostic', detail: 'Shift+F8', keywords: 'error warning issue' },
  { id: 'show-hover', label: 'IntelliSense: Show Hover', detail: 'Ctrl+K', keywords: 'type documentation symbol' },
  { id: 'toggle-vim', label: 'Editor: Toggle Vim Mode', detail: 'Alt+V', keywords: 'normal insert visual modal' },
  { id: 'toggle-word-wrap', label: 'Editor: Toggle Word Wrap', detail: 'Alt+Z', keywords: 'wrap long lines columns' },
  { id: 'toggle-explorer', label: 'View: Toggle Explorer', detail: 'Ctrl+B', keywords: 'sidebar files' },
  { id: 'focus-explorer', label: 'View: Focus Explorer or Editor', detail: 'Ctrl+E', keywords: 'sidebar pane' },
  { id: 'close-tab', label: 'File: Close Active Tab', detail: 'Ctrl+W', keywords: 'buffer' },
  { id: 'toggle-velocity', label: 'Editor: Toggle Velocity Scrolling', detail: 'V', keywords: 'accelerate navigation' },
]

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

function completionContextAt(content: string, offset: number): {
  prefix: { value: string; start: number }
  memberAccess: boolean
  lastCharacter?: string
} {
  const prefix = wordPrefixAt(content, offset)
  const beforePrefix = content.slice(0, prefix.start)
  return {
    prefix,
    memberAccess: beforePrefix.endsWith('.') || beforePrefix.endsWith('::') || beforePrefix.endsWith('->'),
    lastCharacter: offset > 0 ? content[offset - 1] : undefined,
  }
}

function editorPositionAtOffset(content: string, offset: number): { line: number; character: number } {
  const safeOffset = Math.max(0, Math.min(offset, content.length))
  const lineStart = content.lastIndexOf('\n', safeOffset - 1) + 1
  let line = 0
  for (let index = 0; index < lineStart; index += 1) if (content.charCodeAt(index) === 10) line += 1
  return { line, character: safeOffset - lineStart }
}

function offsetAtEditorPosition(content: string, position: { line: number; character: number }): number {
  let lineStart = 0
  for (let line = 0; line < position.line; line += 1) {
    const next = content.indexOf('\n', lineStart)
    if (next < 0) return content.length
    lineStart = next + 1
  }
  const lineEnd = content.indexOf('\n', lineStart)
  return Math.min(lineEnd < 0 ? content.length : lineEnd, lineStart + Math.max(0, position.character))
}

function editorDocumentOffset(
  editor: TextareaRenderable,
  cursor?: { line: number; visualColumn: number },
): number {
  const logicalCursor = cursor ?? { line: editor.logicalCursor.row, visualColumn: editor.logicalCursor.col }
  return offsetAtEditorPosition(editor.plainText, { line: logicalCursor.line, character: logicalCursor.visualColumn })
}

function setEditorDocumentOffset(editor: TextareaRenderable, offset: number): void {
  const position = editorPositionAtOffset(editor.plainText, offset)
  editor.setCursor(position.line, position.character)
}

function applyCompletion(
  editor: TextareaRenderable,
  item: Completion,
  cursor?: { line: number; visualColumn: number },
): void {
  const content = editor.plainText
  const cursorOffset = editorDocumentOffset(editor, cursor)
  const prefix = wordPrefixAt(content, cursorOffset)
  const mainEdit = item.source === 'lsp' && item.textEdit
    ? item.textEdit
    : { range: { start: editorPositionAtOffset(content, prefix.start), end: editorPositionAtOffset(content, cursorOffset) }, newText: item.insertText }
  const edits = [
    { edit: mainEdit, main: true },
    ...(item.source === 'lsp' ? (item.additionalTextEdits ?? []).map((edit) => ({ edit, main: false })) : []),
  ].map(({ edit, main }) => ({
    start: offsetAtEditorPosition(content, edit.range.start),
    end: offsetAtEditorPosition(content, edit.range.end),
    newText: edit.newText,
    main,
  })).sort((a, b) => a.start - b.start || a.end - b.end)

  let sourceOffset = 0
  let nextContent = ''
  let nextCursor = cursorOffset
  for (const edit of edits) {
    if (edit.start < sourceOffset || edit.end < edit.start) continue
    nextContent += content.slice(sourceOffset, edit.start)
    nextContent += edit.newText
    sourceOffset = edit.end
    if (edit.main) nextCursor = nextContent.length
  }
  nextContent += content.slice(sourceOffset)
  editor.replaceText(nextContent)
  setEditorDocumentOffset(editor, nextCursor)
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
  const lspLabels = new Set(lsp.map((item) => item.label))
  const output: Completion[] = []
  for (const item of [...lsp, ...local]) {
    const filterValue = item.source === 'lsp' ? item.filterText ?? item.label : item.label
    const identity = item.source === 'lsp'
      ? `lsp:${item.label}:${item.detail ?? ''}:${item.insertText}`
      : item.label
    if (!filterValue.toLowerCase().includes(normalized)
      || seen.has(identity)
      || (item.source !== 'lsp' && lspLabels.has(item.label))) continue
    seen.add(identity)
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

function quickModeFor(query: string): QuickMode {
  if (query.startsWith('>')) return 'commands'
  if (query.startsWith('#')) return 'buffers'
  if (query.startsWith(':')) return 'line'
  return 'files'
}

function quickModeQuery(query: string): string {
  return quickModeFor(query) === 'files' ? query.trim() : query.slice(1).trim()
}

function fuzzyScore(value: string, query: string): number | null {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return 0
  const target = value.toLowerCase()
  let score = 0
  for (const term of terms) {
    const contiguous = target.indexOf(term)
    if (contiguous >= 0) {
      score += 1_000 - contiguous * 2 - Math.max(0, target.length - term.length)
      continue
    }
    let cursor = 0
    let first = -1
    let previous = -2
    for (const character of term) {
      const index = target.indexOf(character, cursor)
      if (index < 0) return null
      if (first < 0) first = index
      score += index === previous + 1 ? 18 : 4
      previous = index
      cursor = index + 1
    }
    score += 400 - first * 2 - (previous - first)
  }
  return score
}

function findLiteralMatches(content: string, query: string, matchCase: boolean): SearchMatch[] {
  if (!query) return []
  const haystack = matchCase ? content : content.toLocaleLowerCase()
  const needle = matchCase ? query : query.toLocaleLowerCase()
  const matches: SearchMatch[] = []
  let offset = 0
  while (offset <= haystack.length - needle.length && matches.length < 10_000) {
    const start = haystack.indexOf(needle, offset)
    if (start < 0) break
    matches.push({ start, end: start + needle.length })
    offset = start + Math.max(1, needle.length)
  }
  return matches
}

function formatClock(clock: Date): string {
  return `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`
}

function compactLspText(value: string, maxLines: number): string[] {
  return value
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
}

function lineBoundsAtOffset(content: string, offset: number): { start: number; end: number } {
  const clamped = Math.max(0, Math.min(content.length, offset))
  const previousBreak = content.lastIndexOf('\n', Math.max(0, clamped - 1))
  const nextBreak = content.indexOf('\n', clamped)
  return {
    start: previousBreak < 0 ? 0 : previousBreak + 1,
    end: nextBreak < 0 ? content.length : nextBreak,
  }
}

function indentationForNewLine(content: string, offset: number): string {
  const bounds = lineBoundsAtOffset(content, offset)
  return /^[\t ]*/.exec(content.slice(bounds.start, bounds.end))?.[0] ?? ''
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
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchCase, setSearchMatchCase] = useState(false)
  const [searchCursor, setSearchCursor] = useState(-1)
  const [diagnosticCursor, setDiagnosticCursor] = useState(-1)
  const [cursor, setCursor] = useState({ line: 0, visualColumn: 0 })
  const [completions, setCompletions] = useState<Completion[]>([])
  const [completionCursor, setCompletionCursor] = useState(0)
  const [diagnostics, setDiagnostics] = useState<EditorDiagnostic[]>([])
  const [lspStatus, setLspStatus] = useState<EditorLspStatus | null>(null)
  const [hoverInfo, setHoverInfo] = useState<EditorHover | null>(null)
  const [signatureInfo, setSignatureInfo] = useState<EditorSignatureHelp | null>(null)
  const [message, setMessage] = useState('Ready')
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const [velocityScrollEnabled, setVelocityScrollEnabled] = useState(false)
  const [wordWrapEnabled, setWordWrapEnabled] = useState(false)
  const [vimEnabled, setVimEnabled] = useState(false)
  const [vimMode, setVimMode] = useState<VimMode>('insert')
  const scrollAcceleration = useMemo(() => new MacOSScrollAccel({ maxMultiplier: 3 }), [])
  const paneScrollbarOptions = useMemo(
    () => ({ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }),
    [theme.muted, theme.surface2],
  )
  const editorRef = useRef<TextareaRenderable | null>(null)
  const cursorRef = useRef({ line: 0, visualColumn: 0 })
  const editorScrollbarRef = useRef<ScrollBarRenderable | null>(null)
  const syncingEditorScrollbarRef = useRef(false)
  const lineNumberRef = useRef<LineNumberRenderable | null>(null)
  const lspRef = useRef<EditorLspClient | null>(null)
  const syntaxRequestRef = useRef(0)
  const completionRequestRef = useRef(0)
  const completionResolveRequestRef = useRef(0)
  const hoverRequestRef = useRef(0)
  const signatureRequestRef = useRef(0)
  const velocityScrollStateRef = useRef<ReturnType<typeof createScrollVelocityState> | null>(null)
  const vimPendingRef = useRef<string | null>(null)
  const vimRegisterRef = useRef('')

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null
  const dirty = activeTab ? activeTab.content !== activeTab.savedContent : false
  const dirtyTabs = useMemo(() => tabs.filter((tab) => tab.content !== tab.savedContent), [tabs])
  const tree = useMemo(() => buildTree(projectFiles), [projectFiles])
  const treeRows = useMemo(() => flattenTree(tree, treeExpanded), [tree, treeExpanded])
  const quickMode = quickModeFor(quickQuery)
  const quickResults = useMemo<QuickResult[]>(() => {
    const query = quickModeQuery(quickQuery)
    if (quickMode === 'line') {
      const line = Number.parseInt(query, 10)
      if (!activeTab || !Number.isFinite(line) || line < 1) return []
      return [{ id: String(line), label: `Go to line ${line}`, detail: activeTab.path, kind: 'line' }]
    }
    if (quickMode === 'buffers') {
      return tabs
        .flatMap((tab) => {
          const score = fuzzyScore(`${basename(tab.path)} ${tab.path}`, query)
          return score == null ? [] : [{
            result: { id: tab.path, label: basename(tab.path), detail: tab.path, kind: 'buffers' as const },
            score,
          }]
        })
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.result)
    }
    if (quickMode === 'commands') {
      return EDITOR_COMMANDS
        .flatMap((command) => {
          const score = fuzzyScore(`${command.label} ${command.keywords}`, query)
          return score == null ? [] : [{
            result: { id: command.id, label: command.label, detail: command.detail, kind: 'commands' as const },
            score,
          }]
        })
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.result)
    }
    return projectFiles
      .flatMap((path) => {
        const score = fuzzyScore(`${basename(path)} ${path}`, query)
        return score == null ? [] : [{
          result: { id: path, label: basename(path), detail: path, kind: 'files' as const },
          score,
        }]
      })
      .sort((a, b) => b.score - a.score || a.result.detail.length - b.result.detail.length)
      .slice(0, 50)
      .map((entry) => entry.result)
  }, [activeTab, projectFiles, quickMode, quickQuery, tabs])
  const searchMatches = useMemo(
    () => findLiteralMatches(activeTab?.content ?? '', searchQuery, searchMatchCase),
    [activeTab?.content, searchMatchCase, searchQuery],
  )

  const editorWidth = Math.max(24, width - (explorerVisible ? Math.max(24, Math.min(38, Math.floor(width * 0.23))) : 0) - 2)
  const explorerWidth = explorerVisible ? Math.max(24, Math.min(38, Math.floor(width * 0.23))) : 0
  const footerShortcutRows = useMemo(() => packFooterShortcuts([
    '^S save',
    '^P open',
    '^F find',
    '^G line',
    '^B explorer',
    '^E focus',
    '^W close tab',
    '^Tab/^Pg tabs',
    '^Space complete',
    '^K hover',
    '^⇧Space signature',
    'F8/⇧F8 problems',
    `Alt+Z wrap ${wordWrapEnabled ? 'on' : 'off'}`,
    `Alt+V vim ${vimEnabled ? 'on' : 'off'}`,
    `V velocity ${velocityScrollEnabled ? 'on' : 'off'}`,
    '^Q exit',
  ], Math.max(20, width - 4)), [velocityScrollEnabled, vimEnabled, width, wordWrapEnabled])
  const footerHeight = 1 + footerShortcutRows.length
  const contentHeight = Math.max(6, height - 4 - footerHeight)

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
    setHoverInfo(null)
    setSignatureInfo(null)
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
    const editor = editorRef.current
    if (!activeTab || !editor || focusPane !== 'editor') return
    const request = ++signatureRequestRef.current
    const offset = editorDocumentOffset(editor, cursorRef.current)
    const trigger = editor.plainText[offset - 1]
    if (trigger !== '(' && trigger !== ',') return
    const timer = setTimeout(() => {
      void lspRef.current?.signatureHelp(
        editorPositionAtOffset(editor.plainText, offset),
        trigger,
      ).then((result) => {
        if (request !== signatureRequestRef.current) return
        setCompletions([])
        setHoverInfo(null)
        setSignatureInfo(result ?? null)
      })
    }, SIGNATURE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [activeTab, cursor.line, cursor.visualColumn, focusPane])

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
    const requestCursor = cursorRef.current
    const documentOffset = editorDocumentOffset(editor, requestCursor)
    const context = completionContextAt(content, documentOffset)
    const client = lspRef.current
    const serverTrigger = client?.isCompletionTriggerCharacter(context.lastCharacter) ?? false
    if (!force && context.prefix.value.length < 2 && !context.memberAccess && !serverTrigger) {
      setCompletions([])
      return
    }
    const request = ++completionRequestRef.current
    completionResolveRequestRef.current += 1
    const cursorOffset = documentOffset
    client?.change(content)
    const local = context.memberAccess ? [] : localCompletions(content, projectFiles, context.prefix.value)
    const lsp = await client?.completion(
      editorPositionAtOffset(content, cursorOffset),
      serverTrigger ? context.lastCharacter : undefined,
    ) ?? []
    if (request !== completionRequestRef.current
      || editorRef.current?.plainText !== content
      || cursorRef.current.line !== requestCursor.line
      || cursorRef.current.visualColumn !== requestCursor.visualColumn) return
    const merged = mergeCompletions(lsp, local, context.prefix.value)
    setCompletions(merged)
    const preselected = merged.findIndex((item) => item.source === 'lsp' && item.preselect)
    setCompletionCursor(preselected >= 0 ? preselected : 0)
  }, [activeTab, projectFiles])

  const requestHover = useCallback(async () => {
    const editor = editorRef.current
    if (!activeTab || !editor) return
    setCompletions([])
    setSignatureInfo(null)
    const request = ++hoverRequestRef.current
    const result = await lspRef.current?.hover(editorPositionAtOffset(editor.plainText, editorDocumentOffset(editor, cursorRef.current))) ?? null
    if (request !== hoverRequestRef.current) return
    setHoverInfo(result)
    setMessage(result ? 'LSP hover · Esc dismisses' : 'No hover information at cursor')
  }, [activeTab])

  const requestSignatureHelp = useCallback(async () => {
    const editor = editorRef.current
    if (!activeTab || !editor) return
    setCompletions([])
    setHoverInfo(null)
    const request = ++signatureRequestRef.current
    const result = await lspRef.current?.signatureHelp(editorPositionAtOffset(editor.plainText, editorDocumentOffset(editor, cursorRef.current))) ?? null
    if (request !== signatureRequestRef.current) return
    setSignatureInfo(result)
    setMessage(result ? 'LSP signature help · Esc dismisses' : 'No signature information at cursor')
  }, [activeTab])

  useEffect(() => {
    if (!activeTab || focusPane !== 'editor' || hoverInfo || signatureInfo) return
    const timer = setTimeout(() => { void requestCompletions(false) }, AUTO_COMPLETE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [activeTab, cursor, focusPane, hoverInfo, lspStatus?.state, requestCompletions, signatureInfo])

  useEffect(() => {
    const item = completions[completionCursor]
    if (!item || item.source !== 'lsp' || item.resolved) return
    const request = ++completionResolveRequestRef.current
    void lspRef.current?.resolveCompletion(item).then((resolved) => {
      if (!resolved || request !== completionResolveRequestRef.current) return
      setCompletions((current) => current.map((candidate) => candidate === item ? resolved : candidate))
    })
  }, [completionCursor, completions])

  const acceptCompletion = useCallback(() => {
    const editor = editorRef.current
    const item = completions[completionCursor]
    if (!editor || !item) return
    applyCompletion(editor, item, cursorRef.current)
    setCompletions([])
    setSignatureInfo(null)
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

  const openQuick = useCallback((seed = '') => {
    setSearchOpen(false)
    setCompletions([])
    setHoverInfo(null)
    setSignatureInfo(null)
    setQuickOpen(true)
    setQuickQuery(seed)
    setQuickCursor(0)
  }, [])

  const openSearch = useCallback(() => {
    const editor = editorRef.current
    const selected = editor?.getSelectedText() ?? ''
    setQuickOpen(false)
    setCompletions([])
    setHoverInfo(null)
    setSignatureInfo(null)
    setSearchOpen(true)
    setSearchQuery(selected.includes('\n') ? '' : selected)
    setSearchCursor(-1)
    setFocusPane('editor')
  }, [])

  const navigateSearch = useCallback((direction: 1 | -1) => {
    const editor = editorRef.current
    if (!editor || searchMatches.length === 0) {
      setMessage(searchQuery ? `No results for “${searchQuery}”` : 'Type to find in the active file')
      return
    }
    let next = searchCursor
    if (next < 0) {
      const offset = editorDocumentOffset(editor, cursorRef.current)
      next = direction > 0
        ? searchMatches.findIndex((match) => match.start >= offset)
        : searchMatches.findLastIndex((match) => match.end <= offset)
      if (next < 0) next = direction > 0 ? 0 : searchMatches.length - 1
    } else {
      next = (next + direction + searchMatches.length) % searchMatches.length
    }
    const match = searchMatches[next]!
    setSearchCursor(next)
    editor.setSelection(match.start, match.end)
    setMessage(`Find ${next + 1} of ${searchMatches.length}${searchMatchCase ? ' · match case' : ''}`)
  }, [searchCursor, searchMatchCase, searchMatches, searchQuery])

  const navigateDiagnostic = useCallback((direction: 1 | -1) => {
    const editor = editorRef.current
    if (!editor || diagnostics.length === 0) {
      setMessage('No diagnostics in the active file')
      return
    }
    const next = diagnosticCursor < 0
      ? (direction > 0 ? 0 : diagnostics.length - 1)
      : (diagnosticCursor + direction + diagnostics.length) % diagnostics.length
    const diagnostic = diagnostics[next]!
    setDiagnosticCursor(next)
    editor.setCursor(diagnostic.line, diagnostic.character)
    setMessage(`${next + 1}/${diagnostics.length} ${diagnostic.source ? `${diagnostic.source}: ` : ''}${diagnostic.message}`)
  }, [diagnosticCursor, diagnostics])

  const syncEditorScrollbar = useCallback(() => {
    const editor = editorRef.current
    const scrollbar = editorScrollbarRef.current
    if (!editor || !scrollbar) return
    syncingEditorScrollbarRef.current = true
    try {
      scrollbar.scrollSize = editor.editorView.getTotalVirtualLineCount()
      scrollbar.viewportSize = Math.max(1, editor.height)
      scrollbar.scrollPosition = editor.scrollY
    } finally {
      syncingEditorScrollbarRef.current = false
    }
  }, [])

  const reportToggle = useCallback((label: string, enabled: boolean) => {
    const text = `${label} ${enabled ? 'enabled' : 'disabled'}`
    setMessage(text)
    onNotice?.('info', text)
  }, [onNotice])

  const toggleExplorer = useCallback(() => {
    const next = !explorerVisible
    setExplorerVisible(next)
    setFocusPane('editor')
    reportToggle('Editor explorer', next)
  }, [explorerVisible, reportToggle])

  const toggleVelocityScrolling = useCallback(() => {
    const next = !velocityScrollEnabled
    velocityScrollStateRef.current = createScrollVelocityState()
    setVelocityScrollEnabled(next)
    reportToggle('Editor velocity scrolling', next)
  }, [reportToggle, velocityScrollEnabled])

  const toggleWordWrap = useCallback(() => {
    const next = !wordWrapEnabled
    setWordWrapEnabled(next)
    reportToggle('Editor word wrap', next)
    queueMicrotask(syncEditorScrollbar)
  }, [reportToggle, syncEditorScrollbar, wordWrapEnabled])

  const toggleSearchMatchCase = useCallback(() => {
    const next = !searchMatchCase
    setSearchMatchCase(next)
    setSearchCursor(-1)
    reportToggle('Editor find match case', next)
  }, [reportToggle, searchMatchCase])

  const toggleVimMode = useCallback(() => {
    const next = !vimEnabled
    setVimEnabled(next)
    setVimMode(next ? 'normal' : 'insert')
    vimPendingRef.current = null
    if (!next) editorRef.current?.clearSelection()
    reportToggle('Editor Vim mode', next)
  }, [reportToggle, vimEnabled])

  const executeEditorCommand = useCallback((id: EditorCommandId) => {
    switch (id) {
      case 'save': void saveActive(); break
      case 'find': openSearch(); break
      case 'goto-line': openQuick(':'); break
      case 'toggle-explorer': toggleExplorer(); break
      case 'focus-explorer': setFocusPane((current) => current === 'editor' ? 'explorer' : 'editor'); break
      case 'close-tab': closeActiveTab(); break
      case 'next-diagnostic': navigateDiagnostic(1); break
      case 'previous-diagnostic': navigateDiagnostic(-1); break
      case 'show-hover': void requestHover(); break
      case 'toggle-vim': toggleVimMode(); break
      case 'toggle-velocity': toggleVelocityScrolling(); break
      case 'toggle-word-wrap': toggleWordWrap(); break
    }
  }, [closeActiveTab, navigateDiagnostic, openQuick, openSearch, requestHover, saveActive, toggleExplorer, toggleVelocityScrolling, toggleVimMode, toggleWordWrap])

  const chooseQuickResultAt = useCallback((index: number) => {
    const result = quickResults[index]
    if (!result) return
    setQuickOpen(false)
    setQuickQuery('')
    if (result.kind === 'files') void openBuffer(result.id)
    else if (result.kind === 'buffers') activateTab(result.id)
    else if (result.kind === 'commands') executeEditorCommand(result.id as EditorCommandId)
    else {
      editorRef.current?.gotoLine(Math.max(0, Number.parseInt(result.id, 10) - 1))
      setFocusPane('editor')
      setMessage(`Moved to line ${result.id}`)
    }
  }, [activateTab, executeEditorCommand, openBuffer, quickResults])

  const acceptCompletionAt = useCallback((index: number) => {
    setCompletionCursor(index)
    const editor = editorRef.current
    const item = completions[index]
    if (!editor || !item) return
    applyCompletion(editor, item, cursorRef.current)
    setCompletions([])
    setSignatureInfo(null)
    setMessage(`${item.source === 'lsp' ? 'LSP' : item.source} completion: ${item.label}`)
  }, [completions])

  const handleVimKey = useCallback((key: EditorKeyEvent): boolean => {
    const editor = editorRef.current
    if (!editor || focusPane !== 'editor') return false
    const sequence = key.sequence ?? ''
    if (vimMode === 'insert') {
      if (key.name !== 'escape') return false
      setCompletions([])
      setHoverInfo(null)
      setSignatureInfo(null)
      setVimMode('normal')
      vimPendingRef.current = null
      editor.clearSelection()
      setMessage('Vim NORMAL · i insert · v visual · Alt+V disable')
      return true
    }

    if (key.name === 'escape') {
      editor.clearSelection()
      setVimMode('normal')
      vimPendingRef.current = null
      setMessage('Vim NORMAL')
      return true
    }

    if (vimMode === 'visual') {
      if (key.ctrl || key.meta || key.option) return false
      const select = { select: true }
      if (sequence === 'h' || key.name === 'left') { editor.moveCursorLeft(select); return true }
      if (sequence === 'j' || key.name === 'down') { editor.moveCursorDown(select); return true }
      if (sequence === 'k' || key.name === 'up') { editor.moveCursorUp(select); return true }
      if (sequence === 'l' || key.name === 'right') { editor.moveCursorRight(select); return true }
      if (sequence === 'w') { editor.moveWordForward(select); return true }
      if (sequence === 'b') { editor.moveWordBackward(select); return true }
      if (sequence === 'y') {
        vimRegisterRef.current = editor.getSelectedText()
        editor.clearSelection()
        setVimMode('normal')
        setMessage(`Yanked ${vimRegisterRef.current.length} character${vimRegisterRef.current.length === 1 ? '' : 's'}`)
        return true
      }
      if (sequence === 'd' || sequence === 'x') {
        editor.deleteSelection()
        setVimMode('normal')
        setMessage('Deleted selection')
        return true
      }
      return true
    }

    const documentOffset = editorDocumentOffset(editor, cursorRef.current)
    const bounds = lineBoundsAtOffset(editor.plainText, documentOffset)
    const pending = vimPendingRef.current
    vimPendingRef.current = null
    if (key.ctrl && key.name === 'r') { editor.redo(); setMessage('Redo'); return true }
    if (key.ctrl || key.meta || key.option) return false
    if (sequence === 'h' || key.name === 'left') { editor.moveCursorLeft(); return true }
    if (sequence === 'j' || key.name === 'down') { editor.moveCursorDown(); return true }
    if (sequence === 'k' || key.name === 'up') { editor.moveCursorUp(); return true }
    if (sequence === 'l' || key.name === 'right') { editor.moveCursorRight(); return true }
    if (sequence === 'w') { editor.moveWordForward(); return true }
    if (sequence === 'b') { editor.moveWordBackward(); return true }
    if (sequence === '0' || key.name === 'home') { setEditorDocumentOffset(editor, bounds.start); return true }
    if (sequence === '$' || key.name === 'end') { setEditorDocumentOffset(editor, bounds.end); return true }
    if (sequence === 'G' || (key.name === 'g' && key.shift)) { editor.gotoBufferEnd(); return true }
    if (sequence === 'g') {
      if (pending === 'g') { editor.gotoBufferHome(); return true }
      vimPendingRef.current = 'g'
      setMessage('Vim g… · g goes to first line')
      return true
    }
    if (sequence === 'i') { setVimMode('insert'); setMessage('Vim INSERT · Esc normal'); return true }
    if (sequence === 'a') { editor.moveCursorRight(); setVimMode('insert'); setMessage('Vim INSERT · Esc normal'); return true }
    if (sequence === 'I') { setEditorDocumentOffset(editor, bounds.start); setVimMode('insert'); setMessage('Vim INSERT · Esc normal'); return true }
    if (sequence === 'A') { setEditorDocumentOffset(editor, bounds.end); setVimMode('insert'); setMessage('Vim INSERT · Esc normal'); return true }
    if (sequence === 'o') {
      const indentation = indentationForNewLine(editor.plainText, documentOffset)
      setEditorDocumentOffset(editor, bounds.end)
      editor.insertText(`\n${indentation}`)
      setVimMode('insert')
      setMessage('Vim INSERT · opened line below')
      return true
    }
    if (sequence === 'O') {
      const indentation = indentationForNewLine(editor.plainText, documentOffset)
      setEditorDocumentOffset(editor, bounds.start)
      editor.insertText(`${indentation}\n`)
      setEditorDocumentOffset(editor, bounds.start + indentation.length)
      setVimMode('insert')
      setMessage('Vim INSERT · opened line above')
      return true
    }
    if (sequence === 'v') {
      editor.setSelection(documentOffset, Math.min(editor.plainText.length, documentOffset + 1))
      setVimMode('visual')
      setMessage('Vim VISUAL · y yank · d delete · Esc normal')
      return true
    }
    if (sequence === 'V') {
      editor.setSelection(bounds.start, Math.min(editor.plainText.length, bounds.end + 1))
      setVimMode('visual')
      setMessage('Vim VISUAL LINE · y yank · d delete · Esc normal')
      return true
    }
    if (sequence === 'x') { editor.deleteChar(); return true }
    if (sequence === 'u') { editor.undo(); setMessage('Undo'); return true }
    if (sequence === 'd') {
      if (pending === 'd') {
        vimRegisterRef.current = `${editor.plainText.slice(bounds.start, bounds.end)}\n`
        editor.deleteLine()
        setMessage('Deleted line')
      } else {
        vimPendingRef.current = 'd'
        setMessage('Vim d… · d deletes line')
      }
      return true
    }
    if (sequence === 'y') {
      if (pending === 'y') {
        vimRegisterRef.current = `${editor.plainText.slice(bounds.start, bounds.end)}\n`
        setMessage('Yanked line')
      } else {
        vimPendingRef.current = 'y'
        setMessage('Vim y… · y yanks line')
      }
      return true
    }
    if (sequence === 'p' && vimRegisterRef.current) {
      if (vimRegisterRef.current.endsWith('\n')) {
        setEditorDocumentOffset(editor, bounds.end)
        editor.insertText(`\n${vimRegisterRef.current.slice(0, -1)}`)
      } else {
        editor.moveCursorRight()
        editor.insertText(vimRegisterRef.current)
      }
      setMessage('Pasted Vim register')
      return true
    }
    return true
  }, [focusPane, vimMode])

  const handleKey = useCallback((key: EditorKeyEvent): boolean => {
    const sequence = key.sequence ?? ''
    if (key.option && key.name === 'v') {
      toggleVimMode()
      return true
    }
    if (key.option && key.name === 'z') {
      toggleWordWrap()
      return true
    }
    if (key.sequence === 'V' && !key.ctrl && !key.meta && !vimEnabled) {
      toggleVelocityScrolling()
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
      if (key.name === 'down' || (key.ctrl && key.name === 'n')) { setQuickCursor((value) => Math.min(Math.max(0, quickResults.length - 1), value + 1)); return true }
      if (key.name === 'return') { chooseQuickResultAt(quickCursor); return true }
      if (key.name === 'backspace' || key.name === 'delete') { setQuickQuery((value) => value.slice(0, -1)); setQuickCursor(0); return true }
      if (!key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ') { setQuickQuery((value) => value + sequence); setQuickCursor(0); return true }
      return true
    }
    if (searchOpen) {
      if (key.name === 'escape') { setSearchOpen(false); setSearchCursor(-1); editorRef.current?.clearSelection(); return true }
      if (key.name === 'return') { navigateSearch(key.shift ? -1 : 1); return true }
      if (key.name === 'backspace' || key.name === 'delete') { setSearchQuery((value) => value.slice(0, -1)); setSearchCursor(-1); return true }
      if (key.ctrl && key.name === 'f') { navigateSearch(key.shift ? -1 : 1); return true }
      if (key.option && key.name === 'c') { toggleSearchMatchCase(); return true }
      if (!key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ') { setSearchQuery((value) => value + sequence); setSearchCursor(-1); return true }
      return true
    }
    if (vimEnabled && handleVimKey(key)) return true
    if (hoverInfo || signatureInfo) {
      if (key.name === 'escape') {
        setHoverInfo(null)
        setSignatureInfo(null)
        return true
      }
      const retainsPopup = (key.ctrl && key.name === 'k')
        || (key.ctrl && key.shift && (key.name === 'space' || sequence === '\0'))
      if (!retainsPopup) {
        setHoverInfo(null)
        setSignatureInfo(null)
      }
    }
    if (completions.length > 0) {
      if (key.name === 'escape') { setCompletions([]); return true }
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) { setCompletionCursor((value) => Math.max(0, value - 1)); return true }
      if (key.name === 'down' || (key.ctrl && key.name === 'n')) { setCompletionCursor((value) => Math.min(completions.length - 1, value + 1)); return true }
      if (key.name === 'tab' || key.name === 'return') { acceptCompletion(); return true }
    }
    if (focusPane === 'editor' && (key.name === 'home' || key.name === 'end')) {
      const editor = editorRef.current
      if (!editor) return true
      const documentOffset = editorDocumentOffset(editor, cursorRef.current)
      const bounds = lineBoundsAtOffset(editor.plainText, documentOffset)
      const target = key.name === 'home' ? bounds.start : bounds.end
      if (key.shift) editor.setSelection(documentOffset, target)
      else {
        editor.clearSelection()
        setEditorDocumentOffset(editor, target)
      }
      return true
    }
    if (focusPane === 'editor' && key.name === 'return' && !key.ctrl && !key.meta) {
      const editor = editorRef.current
      if (!editor) return true
      const indentation = indentationForNewLine(editor.plainText, editorDocumentOffset(editor, cursorRef.current))
      editor.insertText(`\n${indentation}`)
      setSignatureInfo(null)
      return true
    }
    if (focusPane === 'editor' && velocityScrollEnabled && (key.name === 'up' || key.name === 'down')) {
      const editor = editorRef.current
      if (!editor) return true
      const lines = editor.plainText.split('\n')
      const current = editor.logicalCursor
      const direction = key.name === 'up' ? -1 : 1
      const step = velocityScrollStep(velocityScrollStateRef.current ??= createScrollVelocityState(), direction, key, 6)
      const row = Math.max(0, Math.min(lines.length - 1, current.row + direction * step))
      let offset = 0
      for (let index = 0; index < row; index += 1) offset += (lines[index]?.length ?? 0) + 1
      setEditorDocumentOffset(editor, offset + Math.min(current.col, lines[row]?.length ?? 0))
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
    if (key.ctrl && key.name === 'p') { openQuick(); return true }
    if (key.ctrl && key.name === 'f') { openSearch(); return true }
    if (key.ctrl && key.name === 'g') { openQuick(':'); return true }
    if (key.ctrl && key.name === 'b') { toggleExplorer(); return true }
    if (key.ctrl && key.name === 'w') { closeActiveTab(); return true }
    if (key.name === 'f8') { navigateDiagnostic(key.shift ? -1 : 1); return true }
    if (key.ctrl && key.name === 'k') { void requestHover(); return true }
    if (key.ctrl && key.shift && (key.name === 'space' || sequence === '\0')) { void requestSignatureHelp(); return true }
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
  }, [acceptCompletion, activateTreeRow, activeTab, chooseQuickResultAt, closeActiveTab, closeConfirm, completions.length, focusPane, handleVimKey, hoverInfo, navigateDiagnostic, navigateSearch, openQuick, openSearch, quickCursor, quickOpen, quickResults.length, requestClose, requestCompletions, requestHover, requestSignatureHelp, saveActive, searchOpen, signatureInfo, switchTab, toggleExplorer, toggleSearchMatchCase, toggleVelocityScrolling, toggleVimMode, toggleWordWrap, treeCursor, treeExpanded, treeRows, velocityScrollEnabled, vimEnabled])

  useEffect(() => {
    onKeyHandlerReady(handleKey)
  }, [handleKey, onKeyHandlerReady])

  useEffect(() => {
    if (focusPane === 'editor') editorRef.current?.focus()
  }, [activePath, focusPane])

  useEffect(() => {
    setDiagnosticCursor(-1)
    setSearchCursor(-1)
  }, [activePath, diagnostics])

  const setEditorRef = useCallback((node: TextareaRenderable | null) => {
    editorRef.current = node
    if (node) cursorRef.current = { line: node.logicalCursor.row, visualColumn: node.logicalCursor.col }
  }, [])

  const handleEditorCursorChange = useCallback((next: { line: number; visualColumn: number }) => {
    cursorRef.current = next
    setCursor(next)
  }, [])

  const setEditorScrollbarRef = useCallback((node: ScrollBarRenderable | null) => {
    editorScrollbarRef.current = node
    if (node) queueMicrotask(syncEditorScrollbar)
  }, [syncEditorScrollbar])

  const scrollEditorTo = useCallback((position: number) => {
    if (syncingEditorScrollbarRef.current) return
    const editor = editorRef.current
    if (!editor) return
    const viewport = editor.editorView.getViewport()
    // Match TextareaRenderable's own wheel path: moveCursor=true keeps the
    // requested viewport authoritative instead of snapping back to the caret.
    editor.editorView.setViewport(viewport.offsetX, position, viewport.width, viewport.height, true)
  }, [])

  useEffect(() => {
    if (!activePath) return undefined
    syncEditorScrollbar()
    const interval = setInterval(syncEditorScrollbar, 120)
    return () => clearInterval(interval)
  }, [activePath, syncEditorScrollbar])

  const updateActiveContent = useCallback(() => {
    const content = editorRef.current?.plainText
    if (content == null || !activePath) return
    completionRequestRef.current += 1
    completionResolveRequestRef.current += 1
    setCompletions([])
    setCloseConfirm(false)
    setTabs((current) => current.map((tab) => tab.path === activePath ? { ...tab, content } : tab))
  }, [activePath])

  const counts = useMemo(() => diagnosticCounts(diagnostics), [diagnostics])
  const selectedCompletion = completions[completionCursor]
  const completionWindowStart = Math.min(
    Math.max(0, completionCursor - 7),
    Math.max(0, completions.length - 8),
  )
  const visibleCompletions = completions.slice(completionWindowStart, completionWindowStart + 8)
  const completionDocumentation = selectedCompletion && 'documentation' in selectedCompletion
    ? compactLspText(selectedCompletion.documentation ?? '', 2)
    : []
  const hoverLines = hoverInfo ? compactLspText(hoverInfo.contents, 6) : []
  const signatureDocumentation = signatureInfo?.documentation
    ? compactLspText(signatureInfo.documentation, 2)
    : []
  const activeSignatureParameter = signatureInfo?.activeParameter == null
    ? null
    : signatureInfo.parameters[signatureInfo.activeParameter] ?? null
  const statusPath = activeTab ? activeTab.path : relative(process.cwd(), root) || basename(root)
  const showCompletionDetailPane = editorWidth >= 68 && Boolean(selectedCompletion && (selectedCompletion.detail || completionDocumentation.length > 0))
  const completionPopupWidth = showCompletionDetailPane
    ? Math.min(78, Math.max(58, editorWidth - 6))
    : Math.min(48, Math.max(28, editorWidth - 8))
  const completionDetailRows = selectedCompletion
    ? 1 + (selectedCompletion.detail ? 1 : 0) + completionDocumentation.length
    : 0
  const completionPopupHeight = Math.min(
    11,
    Math.max(
      4,
      2 + (showCompletionDetailPane
        ? Math.max(visibleCompletions.length, completionDetailRows)
        : visibleCompletions.length + completionDocumentation.length),
    ),
  )
  const completionTop = Math.max(3, Math.min(contentHeight - completionPopupHeight, cursor.line - (editorRef.current?.scrollY ?? 0) + 2))
  const completionLeft = explorerWidth + Math.max(5, Math.min(Math.max(5, editorWidth - completionPopupWidth - 2), cursor.visualColumn + 7))
  const editorModeLabel = focusPane === 'explorer' ? 'EXPLORER' : vimEnabled ? vimMode.toUpperCase() : 'INSERT'
  const editorModeColor = focusPane === 'explorer'
    ? theme.amber
    : vimEnabled && vimMode === 'normal' ? theme.amber : vimEnabled && vimMode === 'visual' ? theme.cyan : theme.violet
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
            <scrollbox
              id="project-editor-explorer-scrollbox"
              flexGrow={1}
              focused={focusPane === 'explorer'}
              scrollAcceleration={scrollAcceleration}
              viewportCulling
              scrollbarOptions={paneScrollbarOptions}
            >
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
            <box flexGrow={1} flexDirection="row">
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
                  wrapMode={wordWrapEnabled ? 'word' : 'none'}
                  syntaxStyle={syntaxStyle}
                  textColor={theme.text}
                  backgroundColor={theme.bg}
                  focusedBackgroundColor={theme.bg}
                  focusedTextColor={theme.text}
                  selectionBg={theme.surface3}
                  selectionFg={theme.text}
                  cursorColor={theme.amber}
                  cursorStyle={{ style: 'block', blinking: true }}
                  keyBindings={EDITOR_TEXTAREA_KEY_BINDINGS}
                  scrollMargin={4}
                  scrollSpeed={3}
                  tabIndicator="→"
                  tabIndicatorColor={theme.dim}
                  onContentChange={updateActiveContent}
                  onCursorChange={handleEditorCursorChange}
                />
              </line-number>
              <editorScrollbar
                id="project-editor-scrollbar"
                ref={setEditorScrollbarRef}
                orientation="vertical"
                width={1}
                flexShrink={0}
                showArrows={false}
                trackOptions={paneScrollbarOptions.trackOptions}
                onChange={scrollEditorTo}
              />
            </box>
          ) : (
            <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
              <text fg={theme.violet}>  Agent Viewer Editor</text>
              <text fg={theme.dim}>Select a file · Ctrl+P quick open · Ctrl+F find · Ctrl+Q close</text>
            </box>
          )}
        </box>
      </box>

      <box height={1} flexDirection="row" backgroundColor={theme.surface3}>
        <box paddingX={1} backgroundColor={editorModeColor}>
          <text fg={theme.bg}>{editorModeLabel}</text>
        </box>
        <text fg={theme.cyan}>{`   ${basename(root)} `}</text>
        {dirty ? <text fg={theme.amber}>● modified  </text> : <text fg={theme.green}>✓ saved  </text>}
        {counts.errors > 0 ? <text fg={theme.red}>{`× ${counts.errors} `}</text> : null}
        {counts.warnings > 0 ? <text fg={theme.amber}>{`▲ ${counts.warnings} `}</text> : null}
        {counts.info > 0 ? <text fg={theme.cyan}>{`● ${counts.info} `}</text> : null}
        <text fg={lspStatus?.state === 'ready' ? theme.green : theme.dim}>{` ${lspStatusText(lspStatus)}`}</text>
        <box flexGrow={1} />
        <text fg={theme.dim}>{`${detectTuiCodeFiletypeFromPath(activeTab?.path) ?? 'text'}  ${cursor.line + 1}:${cursor.visualColumn + 1}  ${formatClock(clock)} `}</text>
      </box>
      <box height={footerHeight} paddingX={1} backgroundColor={theme.surface2} flexDirection="column">
        <text fg={message.startsWith('Unable') || message.startsWith('Refused') ? theme.red : theme.dim} wrapMode="none">
          {fitText(message, Math.max(10, width - 4))}
        </text>
        {footerShortcutRows.map((row) => <text key={row} fg={theme.dim} wrapMode="none">{row}</text>)}
      </box>

      {quickOpen ? (
        <box position="absolute" top={2} left={Math.max(2, Math.floor(width * 0.2))} width={Math.max(30, Math.floor(width * 0.6))} height={Math.min(16, height - 5)} zIndex={60} border borderStyle="heavy" borderColor={theme.cyan} backgroundColor={theme.surface} flexDirection="column" title=" Quick open ">
          <box height={1} paddingX={1} backgroundColor={theme.surface2}>
            <text fg={theme.text}>{`› ${quickQuery || 'files · > commands · # buffers · : line'}`}</text>
          </box>
          <box height={1} paddingX={1} flexDirection="row">
            <text fg={theme.cyan}>{quickMode === 'files' ? 'FILES' : quickMode === 'buffers' ? 'BUFFERS' : quickMode === 'commands' ? 'COMMANDS' : 'GO TO LINE'}</text>
            <box flexGrow={1} />
            <text fg={theme.dim}>{`${quickResults.length} result${quickResults.length === 1 ? '' : 's'}`}</text>
          </box>
          <scrollbox flexGrow={1} scrollAcceleration={scrollAcceleration}>
            {quickResults.slice(0, 11).map((result, index) => (
              <box
                key={`${result.kind}:${result.id}`}
                height={1}
                paddingX={1}
                backgroundColor={index === quickCursor ? theme.surface3 : theme.surface}
                flexDirection="row"
                onMouseUp={(event: MouseEvent) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  chooseQuickResultAt(index)
                }}
              >
                <text fg={index === quickCursor ? theme.amber : theme.text} wrapMode="none">{fitText(result.label, Math.max(14, Math.floor(width * 0.25)))}</text>
                <box flexGrow={1} />
                <text fg={theme.dim} wrapMode="none">{fitText(result.detail, Math.max(10, Math.floor(width * 0.28)))}</text>
              </box>
            ))}
            {quickResults.length === 0 ? <text fg={theme.dim}>  No matching results</text> : null}
          </scrollbox>
        </box>
      ) : null}

      {searchOpen && activeTab ? (
        <box
          position="absolute"
          top={2}
          right={2}
          width={Math.max(32, Math.min(56, Math.floor(width * 0.48)))}
          height={4}
          zIndex={61}
          border
          borderStyle="rounded"
          borderColor={theme.amber}
          backgroundColor={theme.surface}
          flexDirection="column"
          title=" Find in file "
        >
          <box height={1} paddingX={1} backgroundColor={theme.surface2} flexDirection="row">
            <text fg={theme.text} wrapMode="none">{`⌕ ${searchQuery || 'type to search…'}`}</text>
            <box flexGrow={1} />
            <text fg={searchMatchCase ? theme.amber : theme.dim}>Aa</text>
            <text fg={theme.dim}>{`  ${searchMatches.length === 0 ? '0/0' : `${Math.max(0, searchCursor) + 1}/${searchMatches.length}`}`}</text>
          </box>
          <text fg={theme.dim}> Enter next · Shift+Enter previous · Alt+C match case · Esc close</text>
        </box>
      ) : null}

      {completions.length > 0 && activeTab && focusPane === 'editor' ? (
        <box position="absolute" top={completionTop} left={completionLeft} width={completionPopupWidth} height={completionPopupHeight} zIndex={55} border borderStyle="rounded" borderColor={theme.violet} backgroundColor={theme.surface} flexDirection="column" title={` completions ${completionCursor + 1}/${completions.length} `}>
          <box flexGrow={1} flexDirection="row">
            <box width={showCompletionDetailPane ? Math.min(34, completionPopupWidth - 24) : undefined} flexGrow={showCompletionDetailPane ? 0 : 1} flexDirection="column">
              {visibleCompletions.map((item, visibleIndex) => {
                const index = completionWindowStart + visibleIndex
                return (
                  <box
                    key={`${item.source}:${item.label}:${item.detail ?? ''}:${index}`}
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
                    <text fg={index === completionCursor ? theme.text : theme.muted} wrapMode="none">{fitText(item.label, showCompletionDetailPane ? 18 : Math.min(24, editorWidth - 16))}</text>
                    <box flexGrow={1} />
                    {!showCompletionDetailPane ? <text fg={theme.dim} wrapMode="none">{fitText(item.detail ?? item.source, 12)}</text> : null}
                  </box>
                )
              })}
              {!showCompletionDetailPane ? completionDocumentation.map((line, index) => (
                <text key={`${selectedCompletion?.label}:documentation:${index}`} fg={theme.dim} bg={theme.surface2} wrapMode="none">
                  {fitText(`  ${line}`, Math.min(46, editorWidth - 10))}
                </text>
              )) : null}
            </box>
            {showCompletionDetailPane && selectedCompletion ? (
              <box flexGrow={1} border borderStyle="single" borderColor={theme.border} backgroundColor={theme.surface2} paddingX={1} flexDirection="column">
                <text fg={theme.cyan} wrapMode="none">{fitText(selectedCompletion.label, completionPopupWidth - 38)}</text>
                {selectedCompletion.detail ? <text fg={theme.amber} wrapMode="none">{fitText(selectedCompletion.detail, completionPopupWidth - 38)}</text> : null}
                {completionDocumentation.map((line, index) => <text key={`completion-detail:${index}`} fg={theme.text} wrapMode="none">{fitText(line, completionPopupWidth - 38)}</text>)}
              </box>
            ) : null}
          </box>
        </box>
      ) : null}

      {signatureInfo && activeTab && focusPane === 'editor' ? (
        <box
          position="absolute"
          bottom={3}
          left={explorerWidth + 7}
          width={Math.min(72, Math.max(34, editorWidth - 10))}
          height={Math.min(5, 2 + signatureDocumentation.length + (activeSignatureParameter ? 1 : 0))}
          zIndex={56}
          border
          borderStyle="rounded"
          borderColor={theme.cyan}
          backgroundColor={theme.surface}
          paddingX={1}
          flexDirection="column"
          title=" signature help "
        >
          <text fg={theme.cyan} wrapMode="none">{fitText(signatureInfo.label, Math.min(68, editorWidth - 14))}</text>
          {activeSignatureParameter ? <text fg={theme.amber} wrapMode="none">{`parameter ${signatureInfo.activeParameter! + 1}: ${activeSignatureParameter}`}</text> : null}
          {signatureDocumentation.map((line, index) => <text key={`signature:${index}`} fg={theme.dim} wrapMode="none">{fitText(line, Math.min(68, editorWidth - 14))}</text>)}
        </box>
      ) : null}

      {hoverInfo && activeTab && focusPane === 'editor' ? (
        <box
          position="absolute"
          bottom={3}
          left={explorerWidth + 7}
          width={Math.min(72, Math.max(34, editorWidth - 10))}
          height={Math.min(8, hoverLines.length + 2)}
          zIndex={57}
          border
          borderStyle="rounded"
          borderColor={theme.violet}
          backgroundColor={theme.surface}
          paddingX={1}
          flexDirection="column"
          title=" hover · Esc close "
        >
          {hoverLines.map((line, index) => <text key={`hover:${index}`} fg={index === 0 ? theme.cyan : theme.text} wrapMode="none">{fitText(line, Math.min(68, editorWidth - 14))}</text>)}
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
