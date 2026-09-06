/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  MacOSScrollAccel,
  type LineNumberRenderable,
  ScrollBarRenderable,
  type ScrollBoxRenderable,
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
  type EditorCodeAction,
  type EditorCompletion,
  type EditorDiagnostic,
  type EditorHover,
  type EditorLocation,
  type EditorLspStatus,
  type EditorSignatureHelp,
  type EditorTextEdit,
  type EditorWorkspaceEdit,
} from './editorLsp'
import { openEditorSyntaxBuffer, type EditorSyntaxBuffer, type EditorSyntaxLine } from './editorSyntaxBuffer'
import { createScrollVelocityState, velocityScrollStep } from './scrollVelocity'
import {
  type EditorProjectSearchResult,
} from './editorProjectSearch'
import { disposeEditorProjectSearchWorker, searchEditorProjectAsync } from './editorProjectSearchWorkerClient'
import {
  clearEditorRecovery,
  readEditorRecovery,
  writeEditorRecovery,
  type EditorRecoveryBuffer,
} from './editorRecovery'
import {
  addEditorCursorAtNextMatch,
  addEditorCursorOnAdjacentLine,
  applyEditorMultiCursorEdit,
  splitEditorSelectionIntoLineEndCursors,
  updateEditorBlockSelection,
  type EditorBlockSelectionState,
  type EditorMultiCursorEdit,
  type EditorMultiCursorState,
} from './editorMultiCursor'
import { createEditorFile, deleteEditorFile, renameEditorFile, resolveSafeEditorFile } from './editorFileOperations'
import { saveEditorFileSafely } from './editorFileSave'
import { createEditorDiskReader } from './editorDiskReader'
import {
  detectEditorLineEnding,
  normalizeEditorNewlines,
  type EditorLineEnding,
} from './editorLineEndings'
import {
  transformEditorCase,
  transformEditorLines,
  trimEditorTrailingWhitespace,
  detectEditorIndentUnit,
  type EditorLineTransform,
} from './editorTransforms'
import { expandEditorSearchReplacement, findEditorSearchMatches, type EditorSearchMatch } from './editorSearch'
import {
  parseEditorSnippet,
  transformEditorSnippetValue,
  type EditorSnippetTabstop,
} from './editorSnippet'
import {
  classifyEditorOffset,
  editorSyntaxForPath,
  indentForClosingBracket,
  matchingBracketAt,
} from './editorSyntaxContext'

extend({ editorScrollbar: ScrollBarRenderable })

const EDITOR_TEXTAREA_KEY_BINDINGS: NonNullable<TextareaOptions['keyBindings']> = [
  { name: 'home', action: 'line-home' },
  { name: 'end', action: 'line-end' },
  { name: 'home', shift: true, action: 'select-line-home' },
  { name: 'end', shift: true, action: 'select-line-end' },
]

const OCCURRENCE_HIGHLIGHT_REF = 41_001
const BRACKET_HIGHLIGHT_REF = 41_002
const MULTI_CURSOR_HIGHLIGHT_REF = 41_003
const SYNTAX_HIGHLIGHT_REF = 41_004
const OCCURRENCE_MIN_LENGTH = 2
const OCCURRENCE_MAX_MATCHES = 1_000
const OCCURRENCE_VIEWPORT_MARGIN_LINES = 120
// The line margin is meaningless in a minified file, where a hundred lines can
// be a megabyte: the scan has to be bounded in characters too, or occurrence
// matching walks the whole buffer on every keystroke. Decoration outside the
// viewport is invisible anyway; the margin only exists so a small scroll does
// not have to rescan.
const OCCURRENCE_MAX_SCAN_CHARS = 128 * 1024
// A minified bundle is a handful of lines of a hundred kilobytes each, and one
// of them carries thousands of tokens. Two rules bound what that can cost, both
// of them the rule editors settle on: a line wider than this is left
// undecorated, and a file that contains one is not parsed at all — the parser
// would re-derive thousands of ranges for that line on every keystroke and hand
// them over only to be discarded, which measured at 37ms of the 52ms a
// keystroke cost in a 900KB minified file.
const MAX_HIGHLIGHTED_LINE_CHARS = 10_000
// Lines painted per slice when backfilling a whole file's highlights, and the
// margin of off-screen lines painted in the first slice so a small scroll lands
// on colour that is already there.
const SYNTAX_BACKFILL_CHUNK_LINES = 2_000

function longestLineLength(content: string): number {
  let longest = 0
  let lineStart = 0
  for (let index = 0; index <= content.length; index += 1) {
    if (index !== content.length && content.charCodeAt(index) !== 10) continue
    if (index - lineStart > longest) longest = index - lineStart
    lineStart = index + 1
  }
  return longest
}

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
  onClipboardRead?: () => Promise<string>
  onClipboardWrite?: (text: string) => Promise<void>
}

type BufferTab = {
  path: string
  content: string
  savedContent: string
  // `content` and `savedContent` always use LF; this is what the file on disk
  // uses, restored on save. See editorLineEndings.ts.
  lineEnding: EditorLineEnding
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

type SymbolNavigationKind = 'definition' | 'references' | 'implementation'
type EditorFilePrompt = { kind: 'create' | 'rename' | 'delete'; source?: string; value: string }
type CompletionSession = {
  content: string
  cursorOffset: number
  line: number
  visualColumn: number
}

type SnippetSession = {
  tabstops: EditorSnippetTabstop[]
  active: number
  content: string
  parent?: SnippetSession
}

type AppliedCompletion = {
  error: string | null
  snippet?: SnippetSession
  continuedSnippet?: SnippetSession
}

type AppliedEditorEdit = { start: number; end: number; newText: string; main: boolean }

type SymbolNavigationResult = {
  location: EditorLocation
  path: string
  label: string
  detail: string
}

type EditorCommandId =
  | 'save'
  | 'save-all'
  | 'restart-lsp'
  | 'signature-help'
  | 'new-file'
  | 'rename-file'
  | 'delete-file'
  | 'find'
  | 'replace'
  | 'goto-line'
  | 'toggle-explorer'
  | 'focus-explorer'
  | 'close-tab'
  | 'next-diagnostic'
  | 'previous-diagnostic'
  | 'show-hover'
  | 'goto-definition'
  | 'find-references'
  | 'goto-implementation'
  | 'rename-symbol'
  | 'code-actions'
  | 'format-document'
  | 'project-search'
  | 'indent-lines'
  | 'outdent-lines'
  | 'toggle-comment'
  | 'goto-matching-bracket'
  | 'add-next-occurrence'
  | 'add-cursor-above'
  | 'add-cursor-below'
  | 'split-selection-lines'
  | 'move-lines-up'
  | 'move-lines-down'
  | 'sort-lines'
  | 'duplicate-lines'
  | 'uppercase'
  | 'lowercase'
  | 'trim-trailing-whitespace'
  | 'recovery-conflicts'
  | 'toggle-vim'
  | 'toggle-velocity'
  | 'toggle-word-wrap'
  | 'toggle-zen'
  | 'command-palette'
  | 'show-shortcuts'

type EditorCommand = {
  id: EditorCommandId
  label: string
  detail: string
  keywords: string
}

// The terminal edit buffer holds at most 1,048,576 characters and silently
// discards the rest — a 1.5 MB file used to open as a cheerful "Opened
// main.ts" over two thirds of its content. The editor's own limit is therefore
// the buffer's, checked in bytes, which for any non-ASCII file is the stricter
// of the two. `assertEditorBufferIntact` is the backstop for the limit itself
// being wrong.
const MAX_EDITOR_BUFFER_CHARS = 1024 * 1024
const MAX_FILE_BYTES = MAX_EDITOR_BUFFER_CHARS
const MAX_FILE_LABEL = '1 MB'
const MAX_COMPLETIONS = 12
const QUICK_VISIBLE_ROWS = 11
const SYMBOL_VISIBLE_ROWS = 11
const AUTO_COMPLETE_DELAY_MS = 160
const SYNTAX_DELAY_MS = 90
const LSP_CHANGE_DELAY_MS = 120
const SIGNATURE_DELAY_MS = 110
const WORD_PATTERN = /[A-Za-z_$][\w$-]{1,}/g
const AUTO_PAIR_CLOSE: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`',
}
const AUTO_PAIR_OPEN = new Set(Object.keys(AUTO_PAIR_CLOSE))
const AUTO_PAIR_CLOSERS = new Set(Object.values(AUTO_PAIR_CLOSE))

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
  { id: 'save-all', label: 'File: Save All', detail: 'Alt+S / Ctrl+Shift+S', keywords: 'write dirty modified buffers workspace' },
  { id: 'restart-lsp', label: 'Developer: Restart Language Server', detail: 'Alt+R / Ctrl+Shift+R', keywords: 'lsp recover reconnect typescript' },
  { id: 'signature-help', label: 'IntelliSense: Signature Help', detail: 'Alt+K / Ctrl+Shift+Space', keywords: 'parameters function call lsp' },
  { id: 'new-file', label: 'File: New File', detail: 'Ctrl+N', keywords: 'create explorer path' },
  { id: 'rename-file', label: 'File: Rename Explorer File', detail: 'Explorer F2', keywords: 'move path' },
  { id: 'delete-file', label: 'File: Delete Explorer File', detail: 'Explorer Delete', keywords: 'remove path' },
  { id: 'find', label: 'Edit: Find in File', detail: 'Ctrl+F', keywords: 'search text' },
  { id: 'replace', label: 'Edit: Replace in File', detail: 'Ctrl+R', keywords: 'search substitute replace all' },
  { id: 'goto-line', label: 'Go to Line', detail: 'Ctrl+G', keywords: 'jump row' },
  { id: 'next-diagnostic', label: 'Problems: Next Diagnostic', detail: 'F8', keywords: 'error warning issue' },
  { id: 'previous-diagnostic', label: 'Problems: Previous Diagnostic', detail: 'Shift+F8', keywords: 'error warning issue' },
  { id: 'show-hover', label: 'IntelliSense: Show Hover', detail: 'Ctrl+K', keywords: 'type documentation symbol' },
  { id: 'goto-definition', label: 'Go to Definition', detail: 'F12', keywords: 'lsp symbol declaration jump' },
  { id: 'find-references', label: 'Find All References', detail: 'Shift+F12', keywords: 'lsp symbol usages' },
  { id: 'goto-implementation', label: 'Go to Implementation', detail: 'Ctrl+F12', keywords: 'lsp symbol implementation jump' },
  { id: 'rename-symbol', label: 'Rename Symbol', detail: 'F2', keywords: 'lsp refactor workspace edit' },
  { id: 'code-actions', label: 'Quick Fix and Code Actions', detail: 'Alt+.', keywords: 'lsp fix refactor action' },
  { id: 'format-document', label: 'Format Document', detail: 'Shift+Alt+F', keywords: 'lsp formatting indent' },
  { id: 'project-search', label: 'Search: Find in Project', detail: 'Alt+/', keywords: 'live grep workspace quickfix text' },
  { id: 'indent-lines', label: 'Edit: Indent Lines', detail: 'Ctrl+]', keywords: 'shift selection right tab' },
  { id: 'outdent-lines', label: 'Edit: Outdent Lines', detail: 'Shift+Tab / Ctrl+[', keywords: 'shift selection left tab' },
  { id: 'toggle-comment', label: 'Edit: Toggle Line Comment', detail: 'Ctrl+/', keywords: 'comment uncomment selection' },
  { id: 'goto-matching-bracket', label: 'Go to Matching Bracket', detail: 'Ctrl+M', keywords: 'brace paren jump pair balance' },
  { id: 'add-next-occurrence', label: 'Selection: Add Next Occurrence', detail: 'Ctrl+D', keywords: 'multiple cursor select match occurrence' },
  { id: 'add-cursor-above', label: 'Selection: Add Cursor Above', detail: 'Ctrl+Alt+Up', keywords: 'multiple cursor vertical' },
  { id: 'add-cursor-below', label: 'Selection: Add Cursor Below', detail: 'Ctrl+Alt+Down', keywords: 'multiple cursor vertical' },
  { id: 'split-selection-lines', label: 'Selection: Add Cursors to Line Ends', detail: 'Alt+I / Ctrl+Shift+L', keywords: 'multiple cursor split selected lines' },
  { id: 'move-lines-up', label: 'Edit: Move Lines Up', detail: 'Alt+Up', keywords: 'reorder selection' },
  { id: 'move-lines-down', label: 'Edit: Move Lines Down', detail: 'Alt+Down', keywords: 'reorder selection' },
  { id: 'sort-lines', label: 'Edit: Sort Selected Lines', detail: '', keywords: 'alphabetical natural reorder' },
  { id: 'duplicate-lines', label: 'Edit: Duplicate Line or Selection', detail: '', keywords: 'copy repeat lines' },
  { id: 'uppercase', label: 'Transform: Uppercase', detail: 'Alt+U', keywords: 'case selected word' },
  { id: 'lowercase', label: 'Transform: Lowercase', detail: 'Alt+L', keywords: 'case selected word' },
  { id: 'trim-trailing-whitespace', label: 'Transform: Trim Trailing Whitespace', detail: '', keywords: 'spaces cleanup format' },
  { id: 'recovery-conflicts', label: 'Recovery: Review Conflicts', detail: '', keywords: 'crash hot exit unsaved restore disk conflict' },
  { id: 'toggle-vim', label: 'Editor: Toggle Vim Mode', detail: 'Alt+V', keywords: 'normal insert visual modal' },
  { id: 'toggle-word-wrap', label: 'Editor: Toggle Word Wrap', detail: 'Alt+Z', keywords: 'wrap long lines columns' },
  { id: 'toggle-explorer', label: 'View: Toggle Explorer', detail: 'Ctrl+B', keywords: 'sidebar files' },
  { id: 'toggle-zen', label: 'View: Maximise Editor (Zen Mode)', detail: 'Explorer Shift+Z / Esc', keywords: 'full screen fullscreen maximise maximize zen distraction free focus' },
  { id: 'focus-explorer', label: 'View: Focus Explorer or Editor', detail: 'Ctrl+E', keywords: 'sidebar pane' },
  { id: 'close-tab', label: 'File: Close Active Tab', detail: 'Ctrl+W', keywords: 'buffer' },
  { id: 'toggle-velocity', label: 'Editor: Toggle Velocity Scrolling', detail: 'Explorer Shift+V', keywords: 'accelerate navigation scroll' },
  { id: 'command-palette', label: 'View: Command Palette', detail: 'Ctrl+Shift+P', keywords: 'commands run action palette' },
  { id: 'show-shortcuts', label: 'Help: Keyboard Shortcuts', detail: 'F1 / Explorer ?', keywords: 'keys bindings reference cheatsheet help' },
]

type EditorShortcutGroup = { title: string; entries: readonly (readonly [string, string])[] }

// The full reference lives behind F1 rather than under the buffer: a wall of
// every binding is not something an engineer reads, and it costs three rows of
// the code they are actually looking at.
const EDITOR_SHORTCUT_GROUPS: readonly EditorShortcutGroup[] = [
  {
    title: 'File',
    entries: [
      ['^S', 'Save'], ['Alt+S / ^⇧S', 'Save all'], ['^N', 'New file'], ['^P', 'Open file'],
      ['^W', 'Close tab'], ['^Tab / ^PgUp/PgDn', 'Switch tabs'], ['^Q', 'Close editor'],
      ['F2 / Del (explorer)', 'Rename / delete file'],
    ],
  },
  {
    title: 'Edit',
    entries: [
      ['^Z / ^Y', 'Undo / redo'], ['^C / ^X / ^V', 'Copy / cut / paste'],
      ['^] / ^[', 'Indent / outdent lines'], ['Tab / ⇧Tab', 'Indent / outdent'],
      ['^/', 'Toggle comment'],
      ['Alt+↑/↓', 'Move lines'], ['Alt+U / Alt+L', 'Upper / lower case'],
    ],
  },
  {
    title: 'Selection',
    entries: [
      ['^D', 'Add next occurrence'], ['^Alt+↑/↓', 'Add cursor above/below'],
      ['⇧Alt+arrows', 'Block selection'], ['Alt+I / ^⇧L', 'Cursors at line ends'],
    ],
  },
  {
    title: 'Navigate',
    entries: [
      ['^G', 'Go to line'], ['^M', 'Matching bracket'], ['^T', 'Jump back'],
      ['F8 / ⇧F8', 'Next / previous problem'], ['Alt+←/→', 'Move by word'],
      ['Home / End', 'Line start / end'], ['^Home / ^End', 'Buffer start / end'],
      ['^B', 'Toggle explorer'], ['^E', 'Focus explorer / editor'],
    ],
  },
  {
    title: 'Search',
    entries: [
      ['^F', 'Find'], ['^R', 'Replace'], ['Alt+/', 'Search project'],
      ['^F / ^⇧F (in find)', 'Next / previous match'],
      ['Alt+C / Alt+R / Alt+S (in find)', 'Match case / regex / selection only'],
    ],
  },
  {
    title: 'Language',
    entries: [
      ['^Space', 'Completions'], ['Tab / ⏎', 'Accept (⏎ once list is engaged)'],
      ['^K', 'Hover'], ['Alt+K / ^⇧Space', 'Signature help'],
      ['F12 / ⇧F12 / ^F12', 'Definition / references / implementation'],
      ['F2', 'Rename symbol'], ['Alt+.', 'Quick fix'], ['⇧Alt+F', 'Format document'],
      ['Alt+R / ^⇧R', 'Restart language server'],
    ],
  },
  {
    title: 'View',
    entries: [
      ['^⇧P / Alt+P', 'Command palette'], ['⇧Z (explorer) / Esc', 'Maximise editor (zen) / restore'],
      ['Alt+Z', 'Word wrap'], ['Alt+V', 'Vim mode'],
      ['⇧V (explorer)', 'Velocity scrolling'], ['F1', 'This reference'],
    ],
  },
]

const COMPLETION_KIND_GLYPHS: Readonly<Record<number, string>> = {
  2: 'ƒ', 3: 'ƒ', 4: '◫', 5: '◇', 6: '◆', 7: '◆', 8: '◇', 9: '◇', 10: '◆',
  11: '◆', 12: '◆', 13: '◇', 14: '◆', 15: '⌁', 17: '◇', 18: '◇', 21: '◇', 22: '◇', 25: '◇',
}

/**
 * First row to render so `cursor` stays on screen in a fixed-height picker.
 * Without it a list renders a fixed slice and the selection walks off it —
 * "50 results" showing the same eleven rows however far you arrow down.
 */
function listWindowStart(cursor: number, total: number, visible: number): number {
  return Math.min(Math.max(0, cursor - visible + 3), Math.max(0, total - visible))
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

export type EditorGhostCandidate = { replaceStart: number; newText: string }

/**
 * What accepting a suggestion would actually do, as the offset it starts
 * replacing from and the text it puts there.
 *
 * This has to mirror `applyCompletion`, not approximate it: a language server
 * that returns a `textEdit` decides its own replaced range, which is often not
 * the word under the caret, and a ghost derived from `insertText` and the word
 * prefix would then be showing something Tab does not do.
 *
 * Returns null for a snippet, whose body is `${1:name}` placeholder syntax
 * rather than the text that will be inserted.
 */
export function editorGhostCandidate(
  content: string,
  cursorOffset: number,
  completion: Completion | undefined,
): EditorGhostCandidate | null {
  if (!completion) return null
  if (completion.source === 'lsp' && completion.insertTextFormat === 2) return null
  if (completion.source === 'lsp' && completion.textEdit) {
    const start = validOffsetAtEditorPosition(content, completion.textEdit.range.start)
    const end = validOffsetAtEditorPosition(content, completion.textEdit.range.end)
    // An edit that does not end at the caret is not something a ghost can
    // describe: the text it replaces is not the text the user is typing.
    if (start == null || end == null || end !== cursorOffset || start > cursorOffset) return null
    return { replaceStart: start, newText: completion.textEdit.newText }
  }
  return { replaceStart: wordPrefixAt(content, cursorOffset).start, newText: completion.insertText }
}

/**
 * The part of a suggestion the user has not typed yet, shown dim at the caret
 * the way an inline suggestion is in an editor with virtual text.
 *
 * It is drawn as an overlay rather than inserted into the buffer, so it can
 * only occupy space that is already blank: a terminal overlay cannot push real
 * code aside the way virtual text does, and painting over the rest of the line
 * would be worse than showing nothing. Hence the rule that the rest of the line
 * must be empty.
 *
 * Evaluated against the *live* buffer, not the content the suggestion was
 * requested for. The completion list is cleared on every keystroke and takes a
 * debounce plus a round trip to come back, so a ghost tied to the list flickers
 * out for ~120ms per character — at typing speed, it is only ever visible to
 * someone who has stopped. Re-checking the standing candidate against what is
 * now on screen is what makes it hold still while a word is being typed, and
 * what drops it the moment the word stops matching.
 */
export function editorGhostSuffix(
  content: string,
  cursorOffset: number,
  candidate: EditorGhostCandidate | null,
): string | null {
  if (!candidate) return null
  if (candidate.replaceStart > cursorOffset) return null
  // The rest of the line has to be blank for the overlay to sit in.
  for (let index = cursorOffset; index < content.length; index += 1) {
    const code = content.charCodeAt(index)
    if (code === 10) break
    if (code !== 32 && code !== 9) return null
  }
  const replaced = content.slice(candidate.replaceStart, cursorOffset)
  if (replaced.length === 0) return null
  if (!candidate.newText.startsWith(replaced)) return null
  const suffix = candidate.newText.slice(replaced.length)
  if (suffix.length === 0 || suffix.includes('\n')) return null
  return suffix
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

function validOffsetAtEditorPosition(content: string, position: { line: number; character: number }): number | null {
  if (!Number.isInteger(position.line) || !Number.isInteger(position.character)
    || position.line < 0 || position.character < 0) return null
  let lineStart = 0
  for (let line = 0; line < position.line; line += 1) {
    const next = content.indexOf('\n', lineStart)
    if (next < 0) return null
    lineStart = next + 1
  }
  const lineEnd = content.indexOf('\n', lineStart)
  const end = lineEnd < 0 ? content.length : lineEnd
  return lineStart + position.character <= end ? lineStart + position.character : null
}

function applyEditorTextEdits(content: string, edits: EditorTextEdit[]): string {
  const normalized = edits.map((edit) => ({
    start: offsetAtEditorPosition(content, edit.range.start),
    end: offsetAtEditorPosition(content, edit.range.end),
    newText: edit.newText,
  })).sort((left, right) => right.start - left.start || right.end - left.end)
  let boundary = content.length
  let output = content
  for (const edit of normalized) {
    if (edit.start < 0 || edit.end < edit.start || edit.end > boundary) {
      throw new Error('Language server returned overlapping or invalid text edits')
    }
    output = `${output.slice(0, edit.start)}${edit.newText}${output.slice(edit.end)}`
    boundary = edit.start
  }
  return output
}

function wordRangeAt(content: string, offset: number): { start: number; end: number; value: string } | null {
  const clamped = Math.max(0, Math.min(content.length, offset))
  let start = clamped
  let end = clamped
  while (start > 0 && /[\w$-]/.test(content[start - 1]!)) start -= 1
  while (end < content.length && /[\w$-]/.test(content[end]!)) end += 1
  return end > start ? { start, end, value: content.slice(start, end) } : null
}

function smartHomeOffset(content: string, offset: number): number {
  const bounds = lineBoundsAtOffset(content, offset)
  const line = content.slice(bounds.start, bounds.end)
  const indentation = /^[\t ]*/.exec(line)?.[0].length ?? 0
  const firstContent = bounds.start + indentation
  return offset === firstContent ? bounds.start : firstContent
}

function occurrenceRanges(
  content: string,
  value: string,
  startOffset: number,
  endOffset: number,
  wholeWord: boolean,
): Array<{ start: number; end: number }> {
  if (value.length < OCCURRENCE_MIN_LENGTH || value.length > 256 || value.includes('\n')) return []
  const ranges: Array<{ start: number; end: number }> = []
  let offset = Math.max(0, startOffset)
  const limit = Math.min(content.length, endOffset)
  while (offset <= limit - value.length && ranges.length < OCCURRENCE_MAX_MATCHES) {
    const start = content.indexOf(value, offset)
    if (start < 0 || start + value.length > limit) break
    const end = start + value.length
    const bounded = !wholeWord
      || ((start === 0 || !/[\w$-]/.test(content[start - 1]!))
        && (end === content.length || !/[\w$-]/.test(content[end]!)))
    if (bounded) ranges.push({ start, end })
    offset = start + Math.max(1, value.length)
  }
  return ranges
}

function selectedLineBounds(editor: TextareaRenderable): { start: number; end: number; hadSelection: boolean } {
  const content = editor.plainText
  const selection = editor.getSelection()
  const cursorOffset = editorDocumentOffset(editor)
  const selectionStart = selection?.start ?? cursorOffset
  const selectionEnd = selection?.end ?? cursorOffset
  const start = content.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
  let end = content.indexOf('\n', selectionEnd)
  if (selection && selectionEnd > selectionStart && content[selectionEnd - 1] === '\n') end = selectionEnd - 1
  if (end < 0) end = content.length
  return { start, end, hadSelection: Boolean(selection) }
}

function lineCommentToken(path: string): string {
  const filetype = detectTuiCodeFiletypeFromPath(path)
  if (filetype === 'python' || filetype === 'ruby' || filetype === 'bash' || filetype === 'yaml') return '#'
  if (filetype === 'lua') return '--'
  return '//'
}

// `content` and `lineStarts` are optional only because most callers do not
// have them. Reading `editor.plainText` materialises the whole buffer, so a
// caller that already holds the content — the highlight passes, which run on
// every keystroke — must pass it rather than ask for another copy.
function editorDocumentOffset(
  editor: TextareaRenderable,
  cursor?: { line: number; visualColumn: number },
  content?: string,
  lineStarts?: readonly number[],
): number {
  const logicalCursor = cursor ?? { line: editor.logicalCursor.row, visualColumn: editor.logicalCursor.col }
  const position = { line: logicalCursor.line, character: logicalCursor.visualColumn }
  if (content != null && lineStarts != null) {
    if (position.line >= lineStarts.length) return content.length
    const lineStart = lineStarts[position.line]!
    const lineEnd = position.line + 1 < lineStarts.length ? lineStarts[position.line + 1]! - 1 : content.length
    return Math.min(lineEnd, lineStart + Math.max(0, position.character))
  }
  return offsetAtEditorPosition(content ?? editor.plainText, position)
}

function setEditorDocumentOffset(editor: TextareaRenderable, offset: number): void {
  const position = editorPositionAtOffset(editor.plainText, offset)
  editor.setCursor(position.line, position.character)
}

function applyCompletion(
  editor: TextareaRenderable,
  item: Completion,
  path: string,
  parentSnippet?: SnippetSession,
): AppliedCompletion {
  const content = editor.plainText
  const cursorOffset = editorDocumentOffset(editor)
  const prefix = wordPrefixAt(content, cursorOffset)
  const rawMainEdit = item.source === 'lsp' && item.textEdit
    ? item.textEdit
    : { range: { start: editorPositionAtOffset(content, prefix.start), end: editorPositionAtOffset(content, cursorOffset) }, newText: item.insertText }
  const filename = basename(path)
  const parsedSnippet = item.source === 'lsp' && item.insertTextFormat === 2
    ? parseEditorSnippet(rawMainEdit.newText, {
      TM_FILENAME: filename,
      TM_FILENAME_BASE: filename.replace(/\.[^.]*$/, ''),
      TM_DIRECTORY: dirname(path),
      RELATIVE_FILEPATH: path,
      CURRENT_YEAR: String(new Date().getFullYear()),
    })
    : null
  const mainEdit = parsedSnippet ? { ...rawMainEdit, newText: parsedSnippet.text } : rawMainEdit
  const rawEdits = [
    { edit: mainEdit, main: true },
    ...(item.source === 'lsp' ? (item.additionalTextEdits ?? []).map((edit) => ({ edit, main: false })) : []),
  ]
  const edits: AppliedEditorEdit[] = []
  for (const { edit, main } of rawEdits) {
    const start = validOffsetAtEditorPosition(content, edit.range.start)
    const end = validOffsetAtEditorPosition(content, edit.range.end)
    if (start == null || end == null || end < start) return { error: 'Language server returned an invalid completion edit' }
    edits.push({ start, end, newText: edit.newText, main })
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end)
  for (let index = 1; index < edits.length; index += 1) {
    const previous = edits[index - 1]!
    const current = edits[index]!
    if (current.start < previous.end
      || (current.start === previous.start && (current.start === current.end || previous.start === previous.end))) {
      return { error: 'Language server returned overlapping completion edits' }
    }
  }

  let sourceOffset = 0
  let nextContent = ''
  let nextCursor = cursorOffset
  let snippetTabstops: EditorSnippetTabstop[] | undefined
  for (const edit of edits) {
    if (edit.start < sourceOffset || edit.end < edit.start) continue
    nextContent += content.slice(sourceOffset, edit.start)
    const insertionStart = nextContent.length
    nextContent += edit.newText
    sourceOffset = edit.end
    if (edit.main) {
      nextCursor = nextContent.length
      snippetTabstops = parsedSnippet?.tabstops.map((tabstop) => ({
        index: tabstop.index,
        ranges: tabstop.ranges.map((range) => ({
          ...range,
          start: insertionStart + range.start,
          end: insertionStart + range.end,
        })),
      }))
    }
  }
  nextContent += content.slice(sourceOffset)
  const continuedSnippet = parentSnippet
    ? rebaseSnippetHierarchy(parentSnippet, edits, nextContent)
    : undefined
  editor.replaceText(nextContent)
  setEditorDocumentOffset(editor, nextCursor)
  return {
    error: null,
    snippet: snippetTabstops
      ? { tabstops: snippetTabstops, active: 0, content: nextContent, parent: continuedSnippet }
      : undefined,
    continuedSnippet: snippetTabstops ? undefined : continuedSnippet,
  }
}

function rebaseSnippetSession(
  session: SnippetSession,
  edits: readonly AppliedEditorEdit[],
  nextContent: string,
): SnippetSession | null {
  const tabstops: EditorSnippetTabstop[] = []
  for (let tabstopIndex = 0; tabstopIndex < session.tabstops.length; tabstopIndex += 1) {
    const tabstop = session.tabstops[tabstopIndex]!
    const ranges = []
    for (let rangeIndex = 0; rangeIndex < tabstop.ranges.length; rangeIndex += 1) {
      const range = tabstop.ranges[rangeIndex]!
      let beforeDelta = 0
      let insideDelta = 0
      let valid = true
      for (const edit of edits) {
        const delta = edit.newText.length - (edit.end - edit.start)
        const activePrimary = tabstopIndex === session.active && rangeIndex === 0
        const insertionAtStart = edit.start === edit.end && edit.start === range.start
        const insertionAtEnd = edit.start === edit.end && edit.start === range.end
        if (edit.end < range.start || (edit.end === range.start && !(activePrimary && insertionAtStart))) {
          beforeDelta += delta
        } else if (edit.start > range.end || (edit.start === range.end && !(activePrimary && insertionAtEnd))) {
          continue
        } else if (edit.start >= range.start && edit.end <= range.end) {
          insideDelta += delta
        } else {
          valid = false
          break
        }
      }
      if (!valid) return null
      ranges.push({
        ...range,
        start: range.start + beforeDelta,
        end: range.end + beforeDelta + insideDelta,
      })
    }
    tabstops.push({ ...tabstop, ranges })
  }
  return { ...session, tabstops, content: nextContent }
}

function rebaseSnippetHierarchy(
  session: SnippetSession,
  edits: readonly AppliedEditorEdit[],
  nextContent: string,
): SnippetSession | undefined {
  const rebased = rebaseSnippetSession(session, edits, nextContent)
  if (!rebased) return undefined
  const parent = session.parent ? rebaseSnippetHierarchy(session.parent, edits, nextContent) : undefined
  return { ...rebased, parent }
}

function editorDiffAsEdit(before: string, after: string): AppliedEditorEdit[] {
  if (before === after) return []
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let beforeEnd = before.length
  let afterEnd = after.length
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1
    afterEnd -= 1
  }
  return [{ start, end: beforeEnd, newText: after.slice(start, afterEnd), main: true }]
}

function reconcileSnippetSession(session: SnippetSession, content: string, cursorOffset: number): SnippetSession | null {
  if (content === session.content) return session
  const activeRange = session.tabstops[session.active]?.ranges[0]
  if (!activeRange || cursorOffset < activeRange.start
    || session.content.slice(0, activeRange.start) !== content.slice(0, activeRange.start)
    || session.content.slice(activeRange.end) !== content.slice(cursorOffset)) return null
  const delta = cursorOffset - activeRange.end
  const tabstops = session.tabstops.map((tabstop, tabstopIndex) => ({
    ...tabstop,
    ranges: tabstop.ranges.map((range, rangeIndex) => {
      if (tabstopIndex === session.active && rangeIndex === 0) {
        return { ...range, start: range.start, end: cursorOffset }
      }
      if (range.end <= activeRange.start) return range
      if (range.start >= activeRange.end) return { ...range, start: range.start + delta, end: range.end + delta }
      return range
    }),
  }))
  return { ...session, tabstops, content }
}

function synchronizeSnippetMirrors(
  session: SnippetSession,
  content: string,
): { session: SnippetSession; content: string } | null {
  const tabstop = session.tabstops[session.active]
  const primary = tabstop?.ranges[0]
  if (!tabstop || !primary || tabstop.ranges.length < 2) return { session, content }
  const value = content.slice(primary.start, primary.end)
  let nextSession = session
  let nextContent = content
  for (let rangeIndex = tabstop.ranges.length - 1; rangeIndex >= 1; rangeIndex -= 1) {
    const target = nextSession.tabstops[session.active]?.ranges[rangeIndex]
    if (!target) return null
    const overlapsAnotherPlaceholder = nextSession.tabstops.some((candidate, candidateIndex) =>
      candidateIndex !== session.active && candidate.ranges.some((range) => range.start < target.end && target.start < range.end))
    if (overlapsAnotherPlaceholder) return null
    const replacement = target.transform ? transformEditorSnippetValue(value, target.transform) : value
    const delta = replacement.length - (target.end - target.start)
    nextContent = `${nextContent.slice(0, target.start)}${replacement}${nextContent.slice(target.end)}`
    nextSession = {
      ...nextSession,
      tabstops: nextSession.tabstops.map((candidate, candidateIndex) => ({
        ...candidate,
        ranges: candidate.ranges.map((range, candidateRangeIndex) => {
          if (candidateIndex === session.active && candidateRangeIndex === rangeIndex) {
            return { ...range, start: target.start, end: target.start + replacement.length }
          }
          if (range.end <= target.start) return range
          if (range.start >= target.end) return { ...range, start: range.start + delta, end: range.end + delta }
          return range
        }),
      })),
    }
  }
  return { session: { ...nextSession, content: nextContent }, content: nextContent }
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
    if (fuzzyScore(filterValue, normalized) == null
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
  if (status.state === 'unavailable') return `LSP unavailable: ${status.name}`
  return `LSP error: ${status.message} · Alt+R restarts`
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

// A keystroke asks for the line table two or three times over the same string
// — the parser's response, the overlay pass, the cursor readout. Building it is
// O(file) and allocates one number per line, so the last one is kept: the
// content is the same string object each time, which makes the check exact.
let lineStartsCacheContent: string | null = null
let lineStartsCacheValue: number[] = [0]

function lineStartsFor(content: string): number[] {
  if (lineStartsCacheContent === content) return lineStartsCacheValue
  const starts = [0]
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) starts.push(index + 1)
  }
  lineStartsCacheContent = content
  lineStartsCacheValue = starts
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

function smartNewLineInsertion(content: string, offset: number, path: string): { text: string; cursorOffset: number } {
  const bounds = lineBoundsAtOffset(content, offset)
  const before = content.slice(bounds.start, offset)
  const after = content.slice(offset, bounds.end)
  const baseIndent = /^[\t ]*/.exec(content.slice(bounds.start, bounds.end))?.[0] ?? ''
  const syntax = editorSyntaxForPath(path)
  const opener = /(\{|\[|\(|:)\s*$/.exec(before)?.[1]
  // An opener inside a string or comment is text, not structure: indenting
  // after `const label = "a {"` is the classic tell that an editor is only
  // pattern-matching the line.
  const openerIsCode = opener != null
    && classifyEditorOffset(content, bounds.start + before.trimEnd().length - 1, path) === 'code'
  const opensBlock = openerIsCode && (opener !== ':'
    // `:` opens a block where the language says so, and in C-family code only
    // for switch labels — a trailing type annotation or object key must not
    // pull the next line in.
    ? true
    : syntax.colonOpensBlock || /^\s*(?:case\b|default\b)/.test(before))
  const indentUnit = detectEditorIndentUnit(content, path)
  const innerIndent = opensBlock ? `${baseIndent}${indentUnit}` : baseIndent
  const betweenPair = opensBlock && /^\s*[}\])]/.test(after)
  // Continue a block comment the way every editor does, so writing a doc
  // comment does not mean retyping its leading star on every line.
  const blockComment = editorSyntaxForPath(path).blockComments[0]
  const blockOpenIndex = blockComment ? content.lastIndexOf(blockComment[0], offset) : -1
  const inBlockComment = blockComment != null
    && blockOpenIndex >= 0
    && content.lastIndexOf(blockComment[1], offset) < blockOpenIndex
  if (inBlockComment) {
    const starIndent = `${baseIndent}${before.trimStart().startsWith('*') ? '' : ' '}* `
    return { text: `\n${starIndent}`, cursorOffset: offset + 1 + starIndent.length }
  }
  const text = betweenPair
    ? `\n${innerIndent}\n${baseIndent}`
    : `\n${innerIndent}`
  return { text, cursorOffset: offset + 1 + innerIndent.length }
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
  onClipboardRead,
  onClipboardWrite,
}: Props) {
  const root = resolve(cwd || process.cwd())
  const [projectFiles, setProjectFiles] = useState<string[]>([])
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(() => new Set())
  const [treeCursor, setTreeCursor] = useState(0)
  const explorerScrollRef = useRef<ScrollBoxRenderable>(null)
  const [tabs, setTabs] = useState<BufferTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [focusPane, setFocusPane] = useState<FocusPane>('explorer')
  const [explorerVisible, setExplorerVisible] = useState(true)
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickQuery, setQuickQuery] = useState('')
  const [quickCursor, setQuickCursor] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchReplaceMode, setSearchReplaceMode] = useState(false)
  const [searchInput, setSearchInput] = useState<'find' | 'replace'>('find')
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [searchMatchCase, setSearchMatchCase] = useState(false)
  const [searchRegex, setSearchRegex] = useState(false)
  const [searchSelectionOnly, setSearchSelectionOnly] = useState(false)
  const [searchSelectionRange, setSearchSelectionRange] = useState<{ start: number; end: number } | null>(null)
  const [searchCursor, setSearchCursor] = useState(-1)
  const [diagnosticCursor, setDiagnosticCursor] = useState(-1)
  const [cursor, setCursor] = useState({ line: 0, visualColumn: 0 })
  const [selectionSummary, setSelectionSummary] = useState<{ characters: number; lines: number } | null>(null)
  const [completions, setCompletions] = useState<Completion[]>([])
  const [completionCursor, setCompletionCursor] = useState(0)
  const [diagnostics, setDiagnostics] = useState<EditorDiagnostic[]>([])
  const [lspStatus, setLspStatus] = useState<EditorLspStatus | null>(null)
  const [lspRestartToken, setLspRestartToken] = useState(0)
  const [hoverInfo, setHoverInfo] = useState<EditorHover | null>(null)
  const [signatureInfo, setSignatureInfo] = useState<EditorSignatureHelp | null>(null)
  const [symbolNavigationKind, setSymbolNavigationKind] = useState<SymbolNavigationKind | null>(null)
  const [symbolNavigationResults, setSymbolNavigationResults] = useState<SymbolNavigationResult[]>([])
  const [symbolNavigationCursor, setSymbolNavigationCursor] = useState(0)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameQuery, setRenameQuery] = useState('')
  const [renamePosition, setRenamePosition] = useState<{ line: number; character: number } | null>(null)
  const [codeActions, setCodeActions] = useState<EditorCodeAction[]>([])
  const [codeActionCursor, setCodeActionCursor] = useState(0)
  const [projectSearchOpen, setProjectSearchOpen] = useState(false)
  const [projectSearchQuery, setProjectSearchQuery] = useState('')
  const [projectSearchRegex, setProjectSearchRegex] = useState(false)
  const [projectSearchMatchCase, setProjectSearchMatchCase] = useState(false)
  const [projectSearchWholeWord, setProjectSearchWholeWord] = useState(false)
  const [projectSearchResults, setProjectSearchResults] = useState<EditorProjectSearchResult[]>([])
  const [projectSearchCursor, setProjectSearchCursor] = useState(0)
  const [projectSearchStatus, setProjectSearchStatus] = useState('Type to search project files and unsaved buffers')
  const [recoveryLoaded, setRecoveryLoaded] = useState(false)
  const [recoveryConflicts, setRecoveryConflicts] = useState<EditorRecoveryBuffer[]>([])
  const [recoveryConflictOpen, setRecoveryConflictOpen] = useState(false)
  const [recoveryConflictCursor, setRecoveryConflictCursor] = useState(0)
  const [multiCursor, setMultiCursor] = useState<EditorMultiCursorState | null>(null)
  const [blockSelection, setBlockSelection] = useState<EditorBlockSelectionState | null>(null)
  const [filePrompt, setFilePrompt] = useState<EditorFilePrompt | null>(null)
  const [diskConflicts, setDiskConflicts] = useState<Set<string>>(() => new Set())
  const [message, setMessage] = useState('Ready')
  // Set when a file's lines are too long to be worth parsing; shown in the
  // status bar so unhighlighted code reads as a decision, not a failure.
  const [syntaxSuspended, setSyntaxSuspended] = useState(false)
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const [velocityScrollEnabled, setVelocityScrollEnabled] = useState(false)
  const [wordWrapEnabled, setWordWrapEnabled] = useState(false)
  const [vimEnabled, setVimEnabled] = useState(false)
  // Zen mode gives the buffer every row and column the popover has: no chrome,
  // no explorer, no footer — the file, its gutter, and one status line.
  const [zenMode, setZenMode] = useState(false)
  const [vimMode, setVimMode] = useState<VimMode>('insert')
  const scrollAcceleration = useMemo(() => new MacOSScrollAccel({ maxMultiplier: 3 }), [])
  const paneScrollbarOptions = useMemo(
    () => ({ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }),
    [theme.muted, theme.surface2],
  )
  const editorRef = useRef<TextareaRenderable | null>(null)
  const tabsRef = useRef(tabs)
  const activePathRef = useRef(activePath)
  const cursorRef = useRef({ line: 0, visualColumn: 0 })
  const editorScrollbarRef = useRef<ScrollBarRenderable | null>(null)
  const syncingEditorScrollbarRef = useRef(false)
  const lineNumberRef = useRef<LineNumberRenderable | null>(null)
  const shortcutsScrollRef = useRef<ScrollBoxRenderable | null>(null)
  const lspRef = useRef<EditorLspClient | null>(null)
  const syntaxBufferRef = useRef<EditorSyntaxBuffer | null>(null)
  const verifiedBuffersRef = useRef(new WeakSet<TextareaRenderable>())
  const syntaxBackfillRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The suggestion the ghost is currently describing. It outlives the
  // completion list, which is cleared on every keystroke, so the hint holds
  // still while a word is typed instead of blinking once per character.
  const [ghostCandidate, setGhostCandidate] = useState<EditorGhostCandidate | null>(null)
  const ghostTextRef = useRef<string | null>(null)
  const completionRequestRef = useRef(0)
  const completionResolveRequestRef = useRef(0)
  const completionAbortRef = useRef<AbortController | null>(null)
  const completionResolveAbortRef = useRef<AbortController | null>(null)
  const completionSessionRef = useRef<CompletionSession | null>(null)
  const completionAcceptingRef = useRef(false)
  // An auto-opened list is a suggestion, not a prompt: Enter still means
  // newline until the engineer moves through it (or asked for it with
  // Ctrl+Space). Tab accepts either way, so nothing becomes unreachable.
  const completionEngagedRef = useRef(false)
  const [completionEngaged, setCompletionEngaged] = useState(false)
  // Escape must stick. Remember the word the user dismissed on so typing more
  // of that same word does not immediately pop the list back open.
  const completionDismissedAtRef = useRef<{ start: number; value: string } | null>(null)
  // Content the auto-trigger must not fire for: the buffer as it stood after
  // the last accepted completion, so accepting never re-suggests itself.
  const completionSuppressedContentRef = useRef<string | null>(null)
  const autoCompleteContentRef = useRef<string | null>(null)
  const autoCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoCompleteCursorRef = useRef<{ row: number; col: number } | null>(null)
  const snippetSessionRef = useRef<SnippetSession | null>(null)
  const hoverRequestRef = useRef(0)
  const signatureRequestRef = useRef(0)
  const velocityScrollStateRef = useRef<ReturnType<typeof createScrollVelocityState> | null>(null)
  const vimPendingRef = useRef<string | null>(null)
  const vimRegisterRef = useRef('')
  const pendingJumpRef = useRef<{ path: string; line: number; character: number } | null>(null)
  const jumpHistoryRef = useRef<Array<{ path: string; line: number; character: number }>>([])
  const applyWorkspaceEditRef = useRef<(edit: EditorWorkspaceEdit) => Promise<boolean>>(async () => false)
  const projectSearchRequestRef = useRef(0)
  const projectSearchAbortRef = useRef<AbortController | null>(null)
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const multiCursorStyleIdRef = useRef<number | null>(null)
  const occurrenceStyleIdRef = useRef<number | null>(null)
  const bracketStyleIdRef = useRef<number | null>(null)
  const occurrenceMergedStyleIdsRef = useRef<Map<number, number>>(new Map())
  const diskPollInFlightRef = useRef(false)

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null
  // The line-number gutter's own auto-sizing lags the textarea's real line
  // count for files loaded in one shot (it widens on later edits, not on the
  // initial multi-thousand-line buffer) — 3+ digit numbers render clipped
  // against a gutter still sized for 2 digits. Compute the floor ourselves
  // from the loaded content so it's correct from the first paint.
  const gutterMinWidth = useMemo(() => {
    if (!activeTab?.content) return 4
    // Reuse the editor's cached newline index instead of allocating a full
    // string array on every editor render and keystroke.
    const lineCount = lineStartsFor(activeTab.content).length
    return Math.max(4, String(lineCount).length + 2)
  }, [activeTab])
  const dirty = activeTab ? activeTab.content !== activeTab.savedContent : false
  const dirtyTabs = useMemo(() => tabs.filter((tab) => tab.content !== tab.savedContent), [tabs])
  const tree = useMemo(() => buildTree(projectFiles), [projectFiles])
  const treeRows = useMemo(() => flattenTree(tree, treeExpanded), [tree, treeExpanded])

  useEffect(() => {
    const sb = explorerScrollRef.current
    if (!sb) return
    const viewportH = sb.viewport.height
    if (viewportH <= 0) return
    const rowTop = treeCursor
    const rowBottom = treeCursor + 1
    if (rowTop < sb.scrollTop) sb.scrollTop = rowTop
    else if (rowBottom > sb.scrollTop + viewportH) sb.scrollTop = rowBottom - viewportH
  }, [treeCursor])
  const quickMode = quickModeFor(quickQuery)
  const quickResults = useMemo<QuickResult[]>(() => {
    const query = quickModeQuery(quickQuery)
    if (quickMode === 'line') {
      const line = Number.parseInt(query, 10)
      if (!activeTab || !Number.isFinite(line) || line < 1) return []
      return [{ id: String(line), label: `Go to line ${line}`, detail: activeTab.path, kind: 'line' }]
    }
    if (quickMode === 'buffers') {
      const ranked: Array<{ result: QuickResult; score: number }> = []
      for (const tab of tabs) {
        const score = fuzzyScore(`${basename(tab.path)} ${tab.path}`, query)
        if (score != null) ranked.push({
          result: { id: tab.path, label: basename(tab.path), detail: tab.path, kind: 'buffers' as const },
          score,
        })
      }
      return ranked
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.result)
    }
    if (quickMode === 'commands') {
      const ranked: Array<{ result: QuickResult; score: number }> = []
      for (const command of EDITOR_COMMANDS) {
        const score = fuzzyScore(`${command.label} ${command.keywords}`, query)
        if (score != null) ranked.push({
          result: { id: command.id, label: command.label, detail: command.detail, kind: 'commands' as const },
          score,
        })
      }
      return ranked
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.result)
    }
    const ranked: Array<{ result: QuickResult; score: number }> = []
    for (const path of projectFiles) {
      const score = fuzzyScore(`${basename(path)} ${path}`, query)
      if (score != null) ranked.push({
        result: { id: path, label: basename(path), detail: path, kind: 'files' as const },
        score,
      })
    }
    return ranked
      .sort((a, b) => b.score - a.score || a.result.detail.length - b.result.detail.length)
      .slice(0, 50)
      .map((entry) => entry.result)
  }, [activeTab, projectFiles, quickMode, quickQuery, tabs])
  const searchResult = useMemo(() => findEditorSearchMatches(activeTab?.content ?? '', searchQuery, {
    matchCase: searchMatchCase,
    regex: searchRegex,
    range: searchSelectionOnly ? searchSelectionRange : null,
  }), [activeTab?.content, searchMatchCase, searchQuery, searchRegex, searchSelectionOnly, searchSelectionRange])
  const searchMatches = searchResult.matches

  const explorerShown = explorerVisible && !zenMode
  const explorerWidth = explorerShown ? Math.max(24, Math.min(38, Math.floor(width * 0.23))) : 0
  // Zen mode drops the popover border, so the buffer gets those columns too.
  const editorWidth = Math.max(24, width - explorerWidth - (zenMode ? 0 : 2))
  const footerShortcutRows = useMemo(() => packFooterShortcuts([
    '^S save',
    '^P open',
    '^⇧P commands',
    '^F find',
    '^Space complete',
    '^/ comment',
    'F12 definition',
    '⇧Z zen',
    'F1 help',
    '^Q exit',
  ], Math.max(20, width - 4)), [width])
  const footerHeight = 1 + footerShortcutRows.length
  // Non-zen chrome: 2 border rows + 1 tab row + 1 status row + the footer.
  // Zen keeps only the status row.
  const contentTop = zenMode ? 0 : 2
  const contentHeight = zenMode ? Math.max(6, height - 1) : Math.max(6, height - 4 - footerHeight)

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    tabsRef.current = tabs
    activePathRef.current = activePath
  }, [activePath, tabs])

  useEffect(() => () => {
    disposeEditorProjectSearchWorker()
    if (autoCompleteTimerRef.current) clearTimeout(autoCompleteTimerRef.current)
  }, [])

  useEffect(() => {
    const existing = syntaxStyle.getStyleId('editor.multi-cursor')
    multiCursorStyleIdRef.current = existing ?? syntaxStyle.registerStyle('editor.multi-cursor', {
      bg: theme.surface3,
      underline: true,
    })
    const existingOccurrence = syntaxStyle.getStyleId('editor.occurrence')
    occurrenceStyleIdRef.current = existingOccurrence ?? syntaxStyle.registerStyle('editor.occurrence', {
      bg: theme.surface2,
      underline: true,
    })
    const existingBracket = syntaxStyle.getStyleId('editor.bracket-match')
    bracketStyleIdRef.current = existingBracket ?? syntaxStyle.registerStyle('editor.bracket-match', {
      bg: theme.surface3,
      bold: true,
    })
    occurrenceMergedStyleIdsRef.current.clear()
  }, [syntaxStyle, theme.surface2, theme.surface3])

  useEffect(() => {
    setMultiCursor(null)
    setBlockSelection(null)
    snippetSessionRef.current = null
    // The candidate is an offset into a particular buffer.
    setGhostCandidate(null)
  }, [activePath])

  useEffect(() => {
    let cancelled = false
    void readEditorRecovery(root).then(({ snapshot, conflicts }) => {
      if (cancelled) return
      setRecoveryConflicts(conflicts)
      setRecoveryConflictOpen(conflicts.length > 0)
      if (snapshot?.buffers.length) {
        setTabs(snapshot.buffers.map((buffer) => ({ ...buffer, lineEnding: buffer.lineEnding ?? '\n' })))
        const restoredActive = snapshot.activePath && snapshot.buffers.some((buffer) => buffer.path === snapshot.activePath)
          ? snapshot.activePath
          : snapshot.buffers[0]!.path
        pendingJumpRef.current = {
          path: restoredActive,
          line: snapshot.cursor.line,
          character: snapshot.cursor.character,
        }
        setActivePath(restoredActive)
        setFocusPane('editor')
        setMessage(`Recovered ${snapshot.buffers.length} unsaved file${snapshot.buffers.length === 1 ? '' : 's'}${conflicts.length ? ` · ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} kept` : ''}`)
      } else if (conflicts.length > 0) {
        setMessage(`${conflicts.length} recovery conflict${conflicts.length === 1 ? '' : 's'} kept because disk changed`)
      }
    }).catch((error) => {
      if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to read editor recovery')
    }).finally(() => {
      if (!cancelled) setRecoveryLoaded(true)
    })
    return () => { cancelled = true }
  }, [root])

  useEffect(() => {
    if (!recoveryLoaded) return
    const dirtyBuffers = tabs.filter((tab) => tab.content !== tab.savedContent)
    const retained = [
      ...dirtyBuffers.map((tab) => ({
        path: tab.path, content: tab.content, savedContent: tab.savedContent, lineEnding: tab.lineEnding,
      })),
      ...recoveryConflicts.filter((conflict) => !dirtyBuffers.some((tab) => tab.path === conflict.path)),
    ]
    recoveryTimerRef.current = setTimeout(() => {
      recoveryTimerRef.current = null
      const logicalCursor = editorRef.current?.logicalCursor
      const operation = retained.length === 0
        ? clearEditorRecovery(root)
        : writeEditorRecovery(root, {
            version: 1,
            savedAt: Date.now(),
            activePath,
            cursor: logicalCursor
              ? { line: logicalCursor.row, character: logicalCursor.col }
              : { line: cursorRef.current.line, character: cursorRef.current.visualColumn },
            buffers: retained,
          })
      void operation.catch((error) => {
        const text = error instanceof Error ? error.message : 'Unable to save editor recovery'
        setMessage(text)
        onNotice?.('error', text)
      })
    }, 300)
    return () => {
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current)
      recoveryTimerRef.current = null
    }
  }, [activePath, onNotice, recoveryConflicts, recoveryLoaded, root, tabs])

  useEffect(() => {
    if (!projectSearchOpen) return
    projectSearchAbortRef.current?.abort()
    const request = ++projectSearchRequestRef.current
    if (!projectSearchQuery) {
      setProjectSearchResults([])
      setProjectSearchCursor(0)
      setProjectSearchStatus('Type to search project files and unsaved buffers')
      return
    }
    setProjectSearchStatus('Searching…')
    const abortController = new AbortController()
    projectSearchAbortRef.current = abortController
    const timer = setTimeout(() => {
      const options = {
        regex: projectSearchRegex,
        matchCase: projectSearchMatchCase,
        wholeWord: projectSearchWholeWord,
        limit: 500,
        signal: abortController.signal,
      }
      void searchEditorProjectAsync(root, projectSearchQuery, options, tabs.map((tab) => ({
        path: tab.path,
        content: tab.content,
      }))).then((merged) => {
        if (request !== projectSearchRequestRef.current) return
        setProjectSearchResults(merged)
        setProjectSearchCursor(0)
        setProjectSearchStatus(`${merged.length}${merged.length === options.limit ? '+' : ''} match${merged.length === 1 ? '' : 'es'}`)
      }).catch((error) => {
        if (request !== projectSearchRequestRef.current) return
        if (error instanceof Error && error.name === 'AbortError') return
        setProjectSearchResults([])
        setProjectSearchCursor(0)
        setProjectSearchStatus(error instanceof Error ? error.message : 'Project search failed')
      })
    }, 140)
    return () => {
      clearTimeout(timer)
      abortController.abort()
    }
  }, [projectSearchMatchCase, projectSearchOpen, projectSearchQuery, projectSearchRegex, projectSearchWholeWord, root, tabs])

  useEffect(() => {
    if (!recoveryLoaded) return
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
  }, [initialPath, recoveryLoaded, root])

  useEffect(() => {
    let cancelled = false
    const diskReader = createEditorDiskReader(root)
    const poll = async () => {
      if (diskPollInFlightRef.current) return
      const snapshot = tabsRef.current
      diskReader.retain(snapshot.map((tab) => tab.path))
      if (snapshot.length === 0) return
      diskPollInFlightRef.current = true
      try {
        const readings = await Promise.all(snapshot.map(async (tab) => {
          try {
            return { tab, ...await diskReader.read(tab.path) }
          }
          catch { return { tab, disk: null as string | null, lineEnding: tab.lineEnding } }
        }))
        if (cancelled) return
        const conflicts = new Set<string>()
        const reloads = new Map<string, { expected: string; disk: string; lineEnding: EditorLineEnding }>()
        for (const { tab, disk, lineEnding } of readings) {
          if (disk === tab.savedContent && lineEnding === tab.lineEnding) continue
          if (disk != null && tab.content === tab.savedContent) reloads.set(tab.path, { expected: tab.savedContent, disk, lineEnding })
          else conflicts.add(tab.path)
        }
        setDiskConflicts((current) => current.size === conflicts.size && [...current].every((path) => conflicts.has(path))
          ? current
          : conflicts)
        if (reloads.size === 0) return
        const currentActivePath = activePathRef.current
        const activeReload = currentActivePath ? reloads.get(currentActivePath) : undefined
        const editor = editorRef.current
        if (activeReload && editor?.plainText === activeReload.expected) editor.setText(activeReload.disk)
        setTabs((current) => current.map((tab) => {
          const reload = reloads.get(tab.path)
          return reload && tab.content === reload.expected && tab.savedContent === reload.expected
            ? { ...tab, content: reload.disk, savedContent: reload.disk, lineEnding: reload.lineEnding }
            : tab
        }))
        const paths = [...reloads.keys()]
        setMessage(`Reloaded ${paths.length} externally changed file${paths.length === 1 ? '' : 's'}${paths.length === 1 ? `: ${paths[0]}` : ''}`)
      } finally {
        diskPollInFlightRef.current = false
      }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, 1_500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [root])

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
      const safeFile = await resolveSafeEditorFile(root, safePath)
      const raw = await readFile(safeFile.absolute, 'utf8')
      if (Buffer.byteLength(raw) > MAX_FILE_BYTES) throw new Error(`File exceeds the ${MAX_FILE_LABEL} editor limit`)
      if (raw.includes('\0')) throw new Error('Binary files cannot be edited')
      const lineEnding = detectEditorLineEnding(raw)
      const content = normalizeEditorNewlines(raw)
      setTabs((current) => current.some((tab) => tab.path === safePath)
        ? current
        : [...current, { path: safePath, content, savedContent: content, lineEnding }])
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
    const savedContent = activeTab.content
    const client = lspRef.current
    try {
      await saveEditorFileSafely(root, activeTab.path, savedContent, activeTab.savedContent, activeTab.lineEnding)
      setTabs((current) => current.map((tab) => tab.path === activeTab.path ? { ...tab, savedContent } : tab))
      setDiskConflicts((current) => {
        if (!current.has(activeTab.path)) return current
        const next = new Set(current); next.delete(activeTab.path); return next
      })
      if (lspRef.current === client) client?.saved(savedContent)
      // The recovery effect observes the committed tabs, including edits made
      // while this save was in flight. Clearing from this captured snapshot
      // could delete recovery for newer unsaved text.
      setMessage(`Written ${activeTab.path}`)
      onNotice?.('info', `Saved ${activeTab.path}`)
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to save file'
      setMessage(text)
      onNotice?.('error', text)
    }
  }, [activeTab, onNotice, root])

  const saveAll = useCallback(async () => {
    const modified = tabs.filter((tab) => tab.content !== tab.savedContent)
    if (modified.length === 0) {
      setMessage('All files are already saved')
      return
    }
    const activeClient = lspRef.current
    const results = await Promise.allSettled(modified.map(async (tab) => {
      await saveEditorFileSafely(root, tab.path, tab.content, tab.savedContent, tab.lineEnding)
      return { path: tab.path, content: tab.content }
    }))
    const savedContents = new Map(results.flatMap((result) => result.status === 'fulfilled'
      ? [[result.value.path, result.value.content] as const]
      : []))
    const savedPaths = new Set(savedContents.keys())
    setTabs((current) => current.map((tab) => {
      const savedContent = savedContents.get(tab.path)
      return savedContent == null ? tab : { ...tab, savedContent }
    }))
    setDiskConflicts((current) => {
      const next = new Set([...current].filter((path) => !savedPaths.has(path)))
      return next.size === current.size ? current : next
    })
    if (activeTab) {
      const savedContent = savedContents.get(activeTab.path)
      if (savedContent != null && lspRef.current === activeClient) activeClient?.saved(savedContent)
    }
    const failed = results.length - savedPaths.size
    if (failed > 0) {
      const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      const detail = firstFailure?.reason instanceof Error ? firstFailure.reason.message : 'write failed'
      const text = `Saved ${savedPaths.size}/${modified.length} files · ${failed} failed: ${detail}`
      setMessage(text)
      onNotice?.('error', text)
      return
    }
    const text = `Saved all ${savedPaths.size} modified file${savedPaths.size === 1 ? '' : 's'}`
    setMessage(text)
    onNotice?.('info', text)
  }, [activeTab, onNotice, root, tabs])

  const addNextOccurrence = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !activeTab) return
    const selection = editor.getSelection() ?? { start: editor.cursorOffset, end: editor.cursorOffset }
    const next = addEditorCursorAtNextMatch(editor.plainText, multiCursor, selection, editor.cursorOffset)
    if (!next) {
      setMessage('No identifier or additional occurrence at cursor')
      return
    }
    setBlockSelection(null)
    setMultiCursor(next)
    const active = next.ranges[next.activeIndex]!
    editor.setSelection(active.start, active.end)
    setMessage(next.ranges.length === 1
      ? 'Selected occurrence · Ctrl+D adds the next match'
      : `${next.ranges.length} cursors · type to edit all · Esc collapses`)
  }, [activeTab, multiCursor])

  const addAdjacentCursor = useCallback((direction: -1 | 1) => {
    const editor = editorRef.current
    if (!editor || !activeTab) return
    const next = addEditorCursorOnAdjacentLine(editor.plainText, multiCursor, editor.cursorOffset, direction)
    if (!next || next === multiCursor) {
      setMessage(direction < 0 ? 'No line above for another cursor' : 'No line below for another cursor')
      return
    }
    setBlockSelection(null)
    setMultiCursor(next)
    const active = next.ranges[next.activeIndex]!
    editor.setSelection(active.start, active.end)
    setMessage(`${next.ranges.length} cursors · type to edit all · Esc collapses`)
  }, [activeTab, multiCursor])

  const addLineEndCursors = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !activeTab) return
    const selection = editor.getSelection() ?? { start: editor.cursorOffset, end: editor.cursorOffset }
    const next = splitEditorSelectionIntoLineEndCursors(editor.plainText, selection)
    setBlockSelection(null)
    setMultiCursor(next)
    const active = next.ranges[next.activeIndex]!
    editor.setSelection(active.start, active.end)
    setMessage(`${next.ranges.length} line-end cursor${next.ranges.length === 1 ? '' : 's'} · type to edit all`)
  }, [activeTab])

  const extendBlockSelection = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    const editor = editorRef.current
    if (!editor || !activeTab) return
    const next = updateEditorBlockSelection(editor.plainText, blockSelection, editor.cursorOffset, direction)
    setBlockSelection(next.block)
    setMultiCursor(next.cursors)
    const active = next.cursors.ranges[next.cursors.activeIndex]!
    editor.setSelection(active.start, active.end)
    setMessage(`${next.cursors.ranges.length}-line block selection · type to edit columns`)
  }, [activeTab, blockSelection])

  const editAtAllCursors = useCallback((edit: EditorMultiCursorEdit): boolean => {
    const editor = editorRef.current
    if (!editor || !multiCursor) return false
    const result = applyEditorMultiCursorEdit(editor.plainText, multiCursor, edit)
    editor.replaceText(result.content)
    setBlockSelection(null)
    setMultiCursor(result.state)
    const active = result.state.ranges[result.state.activeIndex]!
    editor.setSelection(active.start, active.end)
    setMessage(`${result.state.ranges.length} cursors`)
    return true
  }, [multiCursor])

  const copyEditorSelection = useCallback(async (cut: boolean) => {
    const editor = editorRef.current
    const path = activePathRef.current
    if (!editor || !path) return
    if (!onClipboardWrite) {
      setMessage('Clipboard integration is unavailable')
      return
    }
    const selection = editor.getSelection()
    const cursorOffset = editorDocumentOffset(editor)
    const bounds = lineBoundsAtOffset(editor.plainText, cursorOffset)
    const range = selection ?? {
      start: bounds.start,
      end: bounds.end < editor.plainText.length ? bounds.end + 1 : bounds.end,
    }
    const sourceContent = editor.plainText
    const text = sourceContent.slice(range.start, range.end)
    if (!text) return
    try {
      await onClipboardWrite(text)
      if (cut && editorRef.current === editor && activePathRef.current === path) {
        if (editor.plainText !== sourceContent) {
          setMessage('Copied selection · buffer changed before cut completed')
          return
        }
        editor.setSelection(range.start, range.end)
        editor.deleteSelection()
      }
      setMessage(`${cut ? 'Cut' : 'Copied'} ${selection ? 'selection' : 'line'} · ${text.length} character${text.length === 1 ? '' : 's'}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'clipboard command failed'
      setMessage(`Clipboard failed: ${detail}`)
      onNotice?.('error', `Clipboard failed: ${detail}`)
    }
  }, [onClipboardWrite, onNotice])

  const pasteIntoEditor = useCallback(async () => {
    const editor = editorRef.current
    const path = activePathRef.current
    if (!editor || !path) return
    if (!onClipboardRead) {
      setMessage('Clipboard integration is unavailable')
      return
    }
    try {
      const text = (await onClipboardRead()).replace(/\r\n?/g, '\n')
      if (!text || editorRef.current !== editor || activePathRef.current !== path) return
      if (multiCursor) editAtAllCursors({ insert: text })
      else editor.insertText(text)
      setMessage(`Pasted ${text.length} character${text.length === 1 ? '' : 's'}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'clipboard command failed'
      setMessage(`Clipboard failed: ${detail}`)
      onNotice?.('error', `Clipboard failed: ${detail}`)
    }
  }, [editAtAllCursors, multiCursor, onClipboardRead, onNotice])

  const applyLineTransform = useCallback((transform: EditorLineTransform) => {
    const editor = editorRef.current
    if (!editor || !activeTab) return
    const selection = editor.getSelection() ?? { start: editor.cursorOffset, end: editor.cursorOffset }
    const result = transformEditorLines(editor.plainText, selection.start, selection.end, transform)
    if (result.content === editor.plainText) {
      setMessage(transform === 'move-up' ? 'Already at first line' : transform === 'move-down' ? 'Already at last line' : 'No line change')
      return
    }
    editor.replaceText(result.content)
    editor.setSelection(result.start, result.end)
    setMultiCursor(null)
    setBlockSelection(null)
    setMessage(`${transform === 'move-up' ? 'Moved lines up' : transform === 'move-down' ? 'Moved lines down' : transform === 'sort' ? 'Sorted lines' : 'Duplicated lines'} · undo with Ctrl+Z`)
  }, [activeTab])

  const applyCaseTransform = useCallback((mode: 'upper' | 'lower') => {
    const editor = editorRef.current
    if (!editor || !activeTab) return
    const selection = editor.getSelection() ?? { start: editor.cursorOffset, end: editor.cursorOffset }
    const result = transformEditorCase(editor.plainText, selection.start, selection.end, mode)
    editor.replaceText(result.content)
    editor.setSelection(result.start, result.end)
    setMultiCursor(null)
    setBlockSelection(null)
    setMessage(mode === 'upper' ? 'Converted selection to uppercase' : 'Converted selection to lowercase')
  }, [activeTab])

  const trimTrailingWhitespace = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !activeTab) return
    const cursorOffset = editor.cursorOffset
    const result = trimEditorTrailingWhitespace(editor.plainText)
    if (result.content === editor.plainText) { setMessage('No trailing whitespace'); return }
    editor.replaceText(result.content)
    setEditorDocumentOffset(editor, Math.min(cursorOffset, result.content.length))
    setMessage('Trimmed trailing whitespace · undo with Ctrl+Z')
  }, [activeTab])

  const editSelectedLines = useCallback((action: 'indent' | 'outdent' | 'comment') => {
    const editor = editorRef.current
    if (!editor || !activeTab) return
    const content = editor.plainText
    const bounds = selectedLineBounds(editor)
    const original = content.slice(bounds.start, bounds.end)
    const lines = original.split('\n')
    const token = lineCommentToken(activeTab.path)
    const indentUnit = detectEditorIndentUnit(content, activeTab.path)
    const allCommented = action === 'comment' && lines.filter((line) => line.trim()).every((line) => {
      const indent = /^[\t ]*/.exec(line)?.[0] ?? ''
      return line.slice(indent.length).startsWith(token)
    })
    const transformed = lines.map((line) => {
      if (action === 'indent') return `${indentUnit}${line}`
      if (action === 'outdent') {
        if (line.startsWith(indentUnit)) return line.slice(indentUnit.length)
        if (line.startsWith('\t')) return line.slice(1)
        return line.replace(new RegExp(`^ {1,${indentUnit.length}}`), '')
      }
      if (!line.trim()) return line
      const indent = /^[\t ]*/.exec(line)?.[0] ?? ''
      const body = line.slice(indent.length)
      if (allCommented) return `${indent}${body.slice(token.length).replace(/^ /, '')}`
      return `${indent}${token} ${body}`
    }).join('\n')
    if (transformed === original) return
    const cursorBefore = editor.logicalCursor
    editor.replaceText(`${content.slice(0, bounds.start)}${transformed}${content.slice(bounds.end)}`)
    if (bounds.hadSelection) editor.setSelection(bounds.start, bounds.start + transformed.length)
    else editor.setCursor(cursorBefore.row, Math.max(0, cursorBefore.col + transformed.length - original.length))
    setMessage(action === 'indent' ? 'Indented lines' : action === 'outdent' ? 'Outdented lines' : allCommented ? 'Uncommented lines' : 'Commented lines')
  }, [activeTab])

  const openRecoveryConflict = useCallback(async (conflict: EditorRecoveryBuffer) => {
    const safePath = normalizeRelativePath(root, conflict.path)
    if (!safePath) {
      setMessage('Recovery entry is outside this workspace')
      return
    }
    try {
      const safeFile = await resolveSafeEditorFile(root, safePath)
      const diskRaw = await readFile(safeFile.absolute, 'utf8')
      const diskContent = normalizeEditorNewlines(diskRaw)
      const diskLineEnding = conflict.lineEnding ?? detectEditorLineEnding(diskRaw)
      const existing = tabs.find((tab) => tab.path === safePath)
      if (existing && existing.content !== existing.savedContent) {
        setMessage(`${safePath} already has unsaved changes; save or close it before loading recovery`)
        return
      }
      setTabs((current) => {
        const found = current.some((tab) => tab.path === safePath)
        return found
          ? current.map((tab) => tab.path === safePath
              ? { ...tab, content: conflict.content, savedContent: diskContent, lineEnding: diskLineEnding }
              : tab)
          : [...current, { path: safePath, content: conflict.content, savedContent: diskContent, lineEnding: diskLineEnding }]
      })
      setRecoveryConflicts((current) => current.filter((entry) => entry !== conflict))
      setRecoveryConflictOpen(false)
      setActivePath(safePath)
      setFocusPane('editor')
      setMessage(`Loaded recovered ${safePath} · current disk content retained as the save baseline`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load recovery conflict')
    }
  }, [root, tabs])

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

  const openFilePrompt = useCallback((kind: EditorFilePrompt['kind']) => {
    const row = focusPane === 'explorer' ? treeRows[treeCursor] : undefined
    if (kind === 'create') {
      const directory = row?.kind === 'directory' ? row.path : row?.kind === 'file' ? dirname(row.path) : '.'
      setFilePrompt({ kind, value: directory === '.' ? '' : `${directory}/` })
      setMessage('Enter a workspace-relative path for the new file')
      return
    }
    const source = row?.kind === 'file' ? row.path : activeTab?.path
    if (!source) {
      setMessage(`Select a file to ${kind}`)
      return
    }
    if (kind === 'delete' && tabs.some((tab) => tab.path === source && tab.content !== tab.savedContent)) {
      setMessage('Save or discard the open file before deleting it')
      return
    }
    setFilePrompt({ kind, source, value: source })
    setMessage(kind === 'rename' ? `Rename ${source}` : `Confirm deletion of ${source}`)
  }, [activeTab?.path, focusPane, tabs, treeCursor, treeRows])

  const performFileOperation = useCallback(async () => {
    if (!filePrompt) return
    try {
      if (filePrompt.kind === 'create') {
        const path = await createEditorFile(root, filePrompt.value)
        setProjectFiles((current) => [...new Set([...current, path])].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })))
        setFilePrompt(null)
        await openBuffer(path)
        setMessage(`Created ${path}`)
        return
      }
      if (!filePrompt.source) return
      if (filePrompt.kind === 'rename') {
        const moved = await renameEditorFile(root, filePrompt.source, filePrompt.value)
        setProjectFiles((current) => current.map((path) => path === moved.from ? moved.to : path)
          .sort((left, right) => left.localeCompare(right, undefined, { numeric: true })))
        setTabs((current) => current.map((tab) => tab.path === moved.from ? { ...tab, path: moved.to } : tab))
        setDiskConflicts((current) => {
          if (!current.has(moved.from)) return current
          const next = new Set(current); next.delete(moved.from); next.add(moved.to); return next
        })
        if (activePath === moved.from) setActivePath(moved.to)
        setFilePrompt(null)
        setMessage(`Renamed ${moved.from} → ${moved.to}`)
        return
      }
      const deleted = await deleteEditorFile(root, filePrompt.source)
      const nextTabs = tabs.filter((tab) => tab.path !== deleted)
      setProjectFiles((current) => current.filter((path) => path !== deleted))
      setTabs(nextTabs)
      setDiskConflicts((current) => {
        if (!current.has(deleted)) return current
        const next = new Set(current); next.delete(deleted); return next
      })
      if (activePath === deleted) {
        setActivePath(nextTabs[0]?.path ?? null)
        if (nextTabs.length === 0) setFocusPane('explorer')
      }
      setFilePrompt(null)
      setMessage(`Deleted ${deleted}`)
    } catch (error) {
      const text = error instanceof Error ? error.message : `Unable to ${filePrompt.kind} file`
      setMessage(text)
      onNotice?.('error', text)
    }
  }, [activePath, filePrompt, onNotice, openBuffer, root, tabs])

  const requestClose = useCallback(() => {
    const modifiedPaths = tabs.filter((tab) => tab.content !== tab.savedContent).map((tab) => tab.path)
    if (modifiedPaths.length > 0 && !closeConfirm) {
      setCloseConfirm(true)
      setMessage(`${modifiedPaths.length} modified file${modifiedPaths.length === 1 ? '' : 's'} — review the exit warning`)
      return
    }
    if (modifiedPaths.length > 0 || recoveryConflicts.length === 0) {
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current)
      recoveryTimerRef.current = null
      void clearEditorRecovery(root).then(onClose, (error) => {
        onNotice?.('error', error instanceof Error ? error.message : 'Unable to clear editor recovery')
        onClose()
      })
    } else {
      onClose()
    }
  }, [closeConfirm, onClose, onNotice, recoveryConflicts.length, root, tabs])

  const applyWorkspaceEdit = useCallback(async (workspaceEdit: EditorWorkspaceEdit): Promise<boolean> => {
    try {
      const sourceTabs = tabsRef.current
      const sourceActivePath = activePathRef.current
      const updatedBuffers = await Promise.all(workspaceEdit.changes.map(async ({ uri, edits }) => {
        const absolutePath = fileURLToPath(uri)
        const path = normalizeRelativePath(root, absolutePath)
        if (!path) throw new Error('Language server edit targets a file outside this workspace')
        const openTab = sourceTabs.find((tab) => tab.path === path)
        const buffered = (path === sourceActivePath && editorRef.current
          ? editorRef.current.plainText
          : openTab?.content) ?? null
        // A file the edit touches but nobody has opened is read here, so its
        // own line ending has to be picked up here too.
        const raw = buffered == null
          ? await resolveSafeEditorFile(root, path).then((file) => readFile(file.absolute, 'utf8'))
          : null
        const content = buffered ?? (raw == null ? null : normalizeEditorNewlines(raw))
        const lineEnding = openTab?.lineEnding ?? (raw == null ? '\n' : detectEditorLineEnding(raw))
        if (content == null) throw new Error(`Unable to read ${path}`)
        if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error(`${path} exceeds the ${MAX_FILE_LABEL} editor limit`)
        if (content.includes('\0')) throw new Error(`${path} is binary and cannot be edited`)
        return {
          path,
          content: applyEditorTextEdits(content, edits),
          sourceContent: content,
          savedContent: openTab?.savedContent ?? content,
          lineEnding,
        }
      }))
      for (const update of updatedBuffers) {
        const currentTab = tabsRef.current.find((tab) => tab.path === update.path)
        const currentContent = update.path === activePathRef.current && editorRef.current
          ? editorRef.current.plainText
          : currentTab?.content
        if (currentContent != null && currentContent !== update.sourceContent) {
          throw new Error(`${update.path} changed while language server edits were being prepared; retry the action`)
        }
      }
      const updates = new Map(updatedBuffers.map((buffer) => [buffer.path, buffer]))
      setTabs((current) => {
        const existing = new Set(current.map((tab) => tab.path))
        return [
          ...current.map((tab) => {
            const update = updates.get(tab.path)
            return update ? { ...tab, content: update.content } : tab
          }),
          ...updatedBuffers.filter((buffer) => !existing.has(buffer.path)),
        ]
      })
      const currentActivePath = activePathRef.current
      const activeUpdate = currentActivePath ? updates.get(currentActivePath) : undefined
      if (activeUpdate && editorRef.current?.plainText !== activeUpdate.content) {
        editorRef.current?.replaceText(activeUpdate.content)
      }
      setMessage(`Applied edits to ${updatedBuffers.length} file${updatedBuffers.length === 1 ? '' : 's'} · save to write`)
      return true
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to apply language server edits'
      setMessage(text)
      onNotice?.('error', text)
      return false
    }
  }, [onNotice, root])
  useEffect(() => {
    applyWorkspaceEditRef.current = applyWorkspaceEdit
  }, [applyWorkspaceEdit])

  useEffect(() => {
    if (!tabs.some((tab) => tab.content !== tab.savedContent)) setCloseConfirm(false)
  }, [tabs])

  useEffect(() => {
    completionAbortRef.current?.abort()
    completionAbortRef.current = null
    completionResolveAbortRef.current?.abort()
    completionResolveAbortRef.current = null
    lspRef.current?.stop()
    lspRef.current = null
    setDiagnostics([])
    setLspStatus(null)
    setHoverInfo(null)
    setSignatureInfo(null)
    completionSessionRef.current = null
    if (!activeTab) return
    const filetype = detectTuiCodeFiletypeFromPath(activeTab.path) ?? 'plaintext'
    const client = new EditorLspClient(root, filetype, join(root, activeTab.path))
    lspRef.current = client
    client.onStatus((status) => {
      if (lspRef.current !== client) return
      setLspStatus(status)
      if (status.state === 'error') setMessage(`LSP ${status.name}: ${status.message}`)
    })
    client.onDiagnostics((next) => {
      if (lspRef.current === client) setDiagnostics(next)
    })
    client.onWorkspaceEdit((edit) => applyWorkspaceEditRef.current(edit))
    void client.start(activeTab.content)
    return () => client.stop()
  // Starting an LSP is a buffer lifecycle event, not an every-keystroke event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.path, root, lspRestartToken])

  const restartLsp = useCallback(() => {
    if (!activeTab) return
    setLspRestartToken((token) => token + 1)
    setMessage('Restarting language server…')
  }, [activeTab])

  useEffect(() => {
    if (!activeTab) return
    const timer = setTimeout(() => lspRef.current?.change(activeTab.content), LSP_CHANGE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [activeTab])

  useEffect(() => {
    const editor = editorRef.current
    if (!activeTab || !editor || focusPane !== 'editor') return
    const request = ++signatureRequestRef.current
    // One read, reused. `plainText` materialises the whole buffer on every
    // access — 1.1ms at 20,000 lines, 6.3ms just after an edit — and this
    // effect runs on every keystroke to inspect a single character.
    const content = editor.plainText
    const offset = editorDocumentOffset(editor, undefined, content)
    const trigger = content[offset - 1]
    if (trigger !== '(' && trigger !== ',') return
    const timer = setTimeout(() => {
      void lspRef.current?.signatureHelp(
        editorPositionAtOffset(content, offset),
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

  const applyBracketHighlights = useCallback((
    editor: TextareaRenderable,
    content: string,
    lineStarts: number[],
  ) => {
    editor.removeHighlightsByRef(BRACKET_HIGHLIGHT_REF)
    const styleId = bracketStyleIdRef.current
    if (styleId == null || focusPane !== 'editor' || !activePathRef.current) return
    const match = matchingBracketAt(content, editorDocumentOffset(editor, undefined, content, lineStarts), activePathRef.current)
    if (!match) return
    for (const offset of [match.open, match.close]) {
      const line = lineAtOffset(lineStarts, offset)
      const lineStart = lineStarts[line] ?? 0
      editor.addHighlight(line, {
        start: offset - lineStart,
        end: offset - lineStart + 1,
        styleId,
        priority: 60,
        hlRef: BRACKET_HIGHLIGHT_REF,
      })
    }
  }, [focusPane])

  const jumpToMatchingBracket = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !activePath) return
    const content = editor.plainText
    const offset = editorDocumentOffset(editor)
    const match = matchingBracketAt(content, offset, activePath)
    if (!match) {
      setMessage('No matching bracket at the cursor')
      return
    }
    // Land past the closer and on the opener, so a repeat press bounces back.
    const target = offset === match.close || offset === match.close + 1 ? match.open : match.close + 1
    editor.clearSelection()
    setEditorDocumentOffset(editor, target)
    setMessage(`Matching bracket · line ${editorPositionAtOffset(content, target).line + 1}`)
  }, [activePath])

  const applyOccurrenceHighlights = useCallback((
    editor: TextareaRenderable,
    content: string,
    lineStarts: number[],
  ) => {
    editor.removeHighlightsByRef(OCCURRENCE_HIGHLIGHT_REF)
    const styleId = occurrenceStyleIdRef.current
    if (styleId == null || focusPane !== 'editor' || multiCursor || content.length === 0) return

    const selection = editor.getSelection()
    const selected = selection && selection.end > selection.start
      ? content.slice(selection.start, selection.end)
      : null
    const cursorOffset = editorDocumentOffset(editor, undefined, content, lineStarts)
    const word = selected ? null : wordRangeAt(content, cursorOffset)
    const value = selected ?? word?.value ?? ''
    if (value.length < OCCURRENCE_MIN_LENGTH) return
    if (!selected && word) {
      const tokenLine = lineAtOffset(lineStarts, word.start)
      const tokenLineStart = lineStarts[tokenLine] ?? 0
      const tokenStart = word.start - tokenLineStart
      const tokenEnd = word.end - tokenLineStart
      const syntaxHighlight = editor.getLineHighlights(tokenLine).find((highlight) => (
        highlight.hlRef !== OCCURRENCE_HIGHLIGHT_REF
        && highlight.start <= tokenStart
        && highlight.end >= tokenEnd
      ))
      const syntaxName = syntaxHighlight == null
        ? null
        : syntaxStyle.getRegisteredNames().find((name) => syntaxStyle.resolveStyleId(name) === syntaxHighlight.styleId) ?? null
      // Fresh's scope-aware path highlights identifiers, not every textual
      // token. Keep the fallback out of keywords, literals, comments and
      // punctuation so occurrence decoration never degrades syntax colors.
      if (syntaxName && /(?:keyword|string|comment|number|operator|punctuation)/i.test(syntaxName)) return
    }

    const firstLine = Math.max(0, Math.floor(editor.scrollY) - OCCURRENCE_VIEWPORT_MARGIN_LINES)
    const lastLine = Math.min(
      lineStarts.length - 1,
      Math.ceil(editor.scrollY + editor.height) + OCCURRENCE_VIEWPORT_MARGIN_LINES,
    )
    const lineStartOffset = lineStarts[firstLine] ?? 0
    const lineEndOffset = lastLine + 1 < lineStarts.length ? lineStarts[lastLine + 1]! : content.length
    const startOffset = Math.max(lineStartOffset, cursorOffset - OCCURRENCE_MAX_SCAN_CHARS)
    const endOffset = Math.min(lineEndOffset, cursorOffset + OCCURRENCE_MAX_SCAN_CHARS)
    const ranges = occurrenceRanges(content, value, startOffset, endOffset, !selected)
      .filter((range) => !selection || range.start !== selection.start || range.end !== selection.end)
    if (ranges.length === 0 || (!selected && ranges.length < 2)) return

    for (const range of ranges) {
      const startLine = lineAtOffset(lineStarts, range.start)
      const lineStart = lineStarts[startLine] ?? 0
      const relativeStart = range.start - lineStart
      const relativeEnd = range.end - lineStart
      const baseHighlight = editor.getLineHighlights(startLine).find((highlight) => (
        highlight.hlRef !== OCCURRENCE_HIGHLIGHT_REF
        && highlight.start <= relativeStart
        && highlight.end >= relativeEnd
      ))
      let rangeStyleId = styleId
      if (baseHighlight) {
        const cached = occurrenceMergedStyleIdsRef.current.get(baseHighlight.styleId)
        if (cached != null) rangeStyleId = cached
        else {
          const baseName = syntaxStyle.getRegisteredNames().find((name) => syntaxStyle.resolveStyleId(name) === baseHighlight.styleId)
          const baseStyle = baseName ? syntaxStyle.getStyle(baseName) : undefined
          const mergedName = `editor.occurrence.${baseHighlight.styleId}`
          rangeStyleId = syntaxStyle.getStyleId(mergedName) ?? syntaxStyle.registerStyle(mergedName, {
            ...baseStyle,
            bg: theme.surface2,
            underline: true,
          })
          occurrenceMergedStyleIdsRef.current.set(baseHighlight.styleId, rangeStyleId)
        }
      }
      editor.addHighlight(startLine, {
        start: relativeStart,
        end: relativeEnd,
        styleId: rangeStyleId,
        priority: 40,
        hlRef: OCCURRENCE_HIGHLIGHT_REF,
      })
    }
  }, [focusPane, multiCursor, syntaxStyle, theme.surface2])

  const applyMultiCursorHighlights = useCallback((
    editor: TextareaRenderable,
    content: string,
    lineStarts: number[],
  ) => {
    editor.removeHighlightsByRef(MULTI_CURSOR_HIGHLIGHT_REF)
    const styleId = multiCursorStyleIdRef.current
    if (styleId == null || !multiCursor) return
    for (let index = 0; index < multiCursor.ranges.length; index += 1) {
      if (index === multiCursor.activeIndex) continue
      const range = multiCursor.ranges[index]!
      const highlightStart = range.start === range.end && range.start === content.length
        ? Math.max(0, range.start - 1)
        : range.start
      const highlightEnd = range.start === range.end
        ? Math.min(content.length, Math.max(highlightStart + 1, range.end))
        : range.end
      const firstLine = lineAtOffset(lineStarts, highlightStart)
      const lastLine = lineAtOffset(lineStarts, Math.max(highlightStart, highlightEnd - 1))
      for (let line = firstLine; line <= lastLine; line += 1) {
        const lineStart = lineStarts[line] ?? 0
        const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1]! - 1 : content.length
        editor.addHighlight(line, {
          start: Math.max(0, highlightStart - lineStart),
          end: Math.max(0, Math.min(highlightEnd, lineEnd) - lineStart),
          styleId,
          priority: 80,
          hlRef: MULTI_CURSOR_HIGHLIGHT_REF,
        })
      }
    }
  }, [multiCursor])

  // Decoration that is not syntax — occurrences, brackets, extra cursors — is
  // reapplied together, because clearing a line to re-syntax it also clears
  // whatever those had put there. All three are bounded by the viewport or by
  // the cursor count, never by the size of the file.
  const applyEditorOverlays = useCallback((
    editor: TextareaRenderable,
    content: string,
    lineStarts: number[],
  ) => {
    applyMultiCursorHighlights(editor, content, lineStarts)
    applyOccurrenceHighlights(editor, content, lineStarts)
    applyBracketHighlights(editor, content, lineStarts)
  }, [applyBracketHighlights, applyMultiCursorHighlights, applyOccurrenceHighlights])

  // One tree-sitter buffer for the file being edited, parsed once on open and
  // fed edits after that. The worker answers with only the lines it
  // re-highlighted, so a keystroke costs the same in a 20,000-line file as in
  // a 200-line one — see editorSyntaxBuffer.ts for the measurements this
  // replaced.
  useEffect(() => {
    const editor = editorRef.current
    if (!activePath || !editor) return
    const filetype = detectTuiCodeFiletypeFromPath(activePath)
    const initialContent = editor.plainText
    const machineGenerated = longestLineLength(initialContent) > MAX_HIGHLIGHTED_LINE_CHARS
    setSyntaxSuspended(machineGenerated)
    if (!filetype || machineGenerated) {
      editor.clearAllHighlights()
      applyEditorOverlays(editor, initialContent, lineStartsFor(initialContent))
      syntaxBufferRef.current = null
      return
    }
    const buffer = openEditorSyntaxBuffer({
      content: initialContent,
      filetype,
      onHighlights: (lines, full) => {
        const current = editorRef.current
        // Line indices are only meaningful against the content that produced
        // them. If the editor has moved on, the update already in flight will
        // answer with fresh lines; applying these would decorate the wrong text.
        if (!current || current.plainText !== buffer.content) return
        const content = buffer.content
        const lineStarts = lineStartsFor(content)

        const applyLine = (entry: EditorSyntaxLine, clearFirst: boolean) => {
          if (clearFirst) current.clearLineHighlights(entry.line)
          const lineStart = lineStarts[entry.line] ?? 0
          const lineEnd = entry.line + 1 < lineStarts.length ? lineStarts[entry.line + 1]! - 1 : content.length
          if (lineEnd - lineStart > MAX_HIGHLIGHTED_LINE_CHARS) return
          for (const range of entry.highlights) {
            const styleId = syntaxStyle.resolveStyleId(range.group) ?? syntaxStyle.resolveStyleId('default')
            if (styleId == null) continue
            current.addHighlight(entry.line, {
              start: range.startCol,
              end: range.endCol,
              styleId,
              priority: 10,
              hlRef: SYNTAX_HIGHLIGHT_REF,
            })
          }
        }

        if (!full) {
          for (const entry of lines) applyLine(entry, true)
          applyEditorOverlays(current, content, lineStarts)
          return
        }

        // The initial parse answers with every line in the file, and applying
        // 20,000 of them in one tick is a 45ms frame — the single visible hitch
        // in an otherwise flat typing profile. What is on screen is painted
        // now; the rest is backfilled in slices, so colour appears immediately
        // and the keystroke that happens to coincide with the parse is not the
        // one that pays for the whole file.
        if (syntaxBackfillRef.current != null) clearTimeout(syntaxBackfillRef.current)
        syntaxBackfillRef.current = null
        current.clearAllHighlights()
        const firstVisible = Math.max(0, Math.floor(current.scrollY) - SYNTAX_BACKFILL_CHUNK_LINES)
        const lastVisible = Math.ceil(current.scrollY + current.height) + SYNTAX_BACKFILL_CHUNK_LINES
        const deferred: EditorSyntaxLine[] = []
        for (const entry of lines) {
          if (entry.line >= firstVisible && entry.line <= lastVisible) applyLine(entry, false)
          else deferred.push(entry)
        }
        applyEditorOverlays(current, content, lineStarts)

        let index = 0
        const backfill = () => {
          syntaxBackfillRef.current = null
          const editor = editorRef.current
          // An edit landed while the file was still being painted: the parser
          // is already answering for the new content, and these lines describe
          // the old one.
          if (!editor || editor !== current || editor.plainText !== buffer.content) return
          const end = Math.min(deferred.length, index + SYNTAX_BACKFILL_CHUNK_LINES)
          for (; index < end; index += 1) applyLine(deferred[index]!, false)
          if (index >= deferred.length) return
          syntaxBackfillRef.current = setTimeout(backfill, 0)
        }
        if (deferred.length > 0) syntaxBackfillRef.current = setTimeout(backfill, 0)
      },
    })
    syntaxBufferRef.current = buffer
    return () => {
      if (syntaxBufferRef.current === buffer) syntaxBufferRef.current = null
      if (syntaxBackfillRef.current != null) clearTimeout(syntaxBackfillRef.current)
      syntaxBackfillRef.current = null
      buffer.dispose()
    }
  }, [activePath, applyEditorOverlays, syntaxStyle])

  // Edits reach the parser on a short debounce: a burst of keystrokes becomes
  // one edit rather than one round-trip each, and the delay can be short
  // because an incremental parse is ~1ms rather than the whole-file parse it
  // replaced.
  useEffect(() => {
    const content = activeTab?.content
    if (content == null) return
    const timer = setTimeout(() => {
      const buffer = syntaxBufferRef.current
      if (!buffer) return
      const previous = buffer.content
      buffer.update(previous, content)
    }, SYNTAX_DELAY_MS)
    return () => clearTimeout(timer)
  }, [activeTab?.content])

  // Extra cursors are drawn by the overlay pass, which the parser's responses
  // drive; a cursor change with no edit behind it needs its own repaint.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const content = editor.plainText
    applyMultiCursorHighlights(editor, content, lineStartsFor(content))
  }, [applyMultiCursorHighlights])

  useEffect(() => {
    const editor = editorRef.current
    if (!activeTab || !editor) return
    const timer = setTimeout(() => {
      // `activeTab.content` is the buffer's content, not a copy of it: every
      // change to the buffer runs `updateActiveContent`, which writes exactly
      // the string it read back onto the tab, and any edit landing before this
      // timer fires cancels and reschedules it. Reading `plainText` again here
      // would materialise the whole buffer a second time (6.3ms at 20,000
      // lines) and defeat `lineStartsFor`'s identity cache, since the parser's
      // pass over the same keystroke already built the table for this string.
      applyEditorOverlays(editor, activeTab.content, lineStartsFor(activeTab.content))
    }, 55)
    return () => clearTimeout(timer)
  }, [activeTab, applyEditorOverlays, cursor.line, cursor.visualColumn])

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

  // A windowed list has no overflow for the scrollbox to measure, so its
  // position indicator is drawn from the window itself.
  const renderListScrollbar = (start: number, visible: number, total: number) => {
    if (total <= visible) return null
    const thumb = Math.max(1, Math.round((visible / total) * visible))
    const maxStart = Math.max(1, total - visible)
    const top = Math.round((start / maxStart) * (visible - thumb))
    return (
      <box width={1} flexDirection="column">
        {Array.from({ length: visible }, (_, row) => {
          const onThumb = row >= top && row < top + thumb
          return (
            <text key={row} fg={onThumb ? theme.muted : theme.surface3} wrapMode="none">
              {onThumb ? '█' : '│'}
            </text>
          )
        })}
      </box>
    )
  }

  const closeCompletions = useCallback((dismissed?: { start: number; value: string }) => {
    completionSessionRef.current = null
    completionEngagedRef.current = false
    completionDismissedAtRef.current = dismissed ?? null
    setCompletions([])
    setCompletionEngaged(false)
    // The standing ghost is deliberately outliving the list, so it has to be
    // retired here: an Escape that left the hint on screen would be describing
    // a suggestion the user just refused.
    setGhostCandidate(null)
  }, [])

  const requestCompletions = useCallback(async (force = false) => {
    const editor = editorRef.current
    if (!activePath || !editor) return
    completionAbortRef.current?.abort()
    completionAbortRef.current = null
    completionResolveAbortRef.current?.abort()
    completionResolveAbortRef.current = null
    const request = ++completionRequestRef.current
    completionResolveRequestRef.current += 1
    const content = editor.plainText
    const logicalCursor = editor.logicalCursor
    const requestCursor = { line: logicalCursor.row, visualColumn: logicalCursor.col }
    const documentOffset = editorDocumentOffset(editor, requestCursor)
    const context = completionContextAt(content, documentOffset)
    const client = lspRef.current
    const serverTrigger = client?.isCompletionTriggerCharacter(context.lastCharacter) ?? false
    if (force) completionDismissedAtRef.current = null
    if (!force) {
      if (context.prefix.value.length < 2 && !context.memberAccess && !serverTrigger) {
        closeCompletions()
        return
      }
      // Escape stays dismissed while the user is still editing the same word.
      // A different word starting at the same offset is a new word, so the
      // dismissal is keyed on the text too, not the position alone.
      const dismissed = completionDismissedAtRef.current
      if (dismissed && dismissed.start === context.prefix.start
        && (dismissed.value.startsWith(context.prefix.value) || context.prefix.value.startsWith(dismissed.value))) {
        setCompletions([])
        setCompletionEngaged(false)
        return
      }
      // Word suggestions in prose are noise; Ctrl+Space still reaches them.
      if (classifyEditorOffset(content, context.prefix.start, activePath) !== 'code') {
        closeCompletions()
        return
      }
    }
    const cursorOffset = documentOffset
    client?.change(content)
    const local = context.memberAccess ? [] : localCompletions(content, projectFiles, context.prefix.value)
    const controller = client ? new AbortController() : null
    if (controller) completionAbortRef.current = controller
    const lsp = await client?.completion(
      editorPositionAtOffset(content, cursorOffset),
      serverTrigger ? context.lastCharacter : undefined,
      controller?.signal,
    ) ?? []
    if (completionAbortRef.current === controller) completionAbortRef.current = null
    const currentCursor = editorRef.current?.logicalCursor
    if (request !== completionRequestRef.current
      || editorRef.current?.plainText !== content
      || currentCursor?.row !== requestCursor.line
      || currentCursor.col !== requestCursor.visualColumn) return
    const merged = mergeCompletions(lsp, local, context.prefix.value)
    // One candidate the user has already finished typing adds nothing but a
    // popup over the code they are reading.
    const redundant = !force && merged.length === 1 && merged[0]!.label === context.prefix.value
    if (redundant || merged.length === 0) {
      closeCompletions()
      return
    }
    completionSessionRef.current = {
      content,
      cursorOffset,
      line: requestCursor.line,
      visualColumn: requestCursor.visualColumn,
    }
    completionEngagedRef.current = force
    setCompletionEngaged(force)
    setCompletions(merged)
    const preselected = merged.findIndex((item) => item.source === 'lsp' && item.preselect)
    setCompletionCursor(preselected >= 0 ? preselected : 0)
  }, [activePath, closeCompletions, projectFiles])

  const requestHover = useCallback(async () => {
    const editor = editorRef.current
    if (!activeTab || !editor) return
    setCompletions([])
    setSignatureInfo(null)
    const request = ++hoverRequestRef.current
    const result = await lspRef.current?.hover(editorPositionAtOffset(editor.plainText, editorDocumentOffset(editor))) ?? null
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
    const result = await lspRef.current?.signatureHelp(editorPositionAtOffset(editor.plainText, editorDocumentOffset(editor))) ?? null
    if (request !== signatureRequestRef.current) return
    setSignatureInfo(result)
    setMessage(result ? 'LSP signature help · Esc dismisses' : 'No signature information at cursor')
  }, [activeTab])

  const requestRename = useCallback(async () => {
    const editor = editorRef.current
    const client = lspRef.current
    if (!activeTab || !editor || !client) return
    setCompletions([])
    setHoverInfo(null)
    setSignatureInfo(null)
    client.change(editor.plainText)
    const offset = editorDocumentOffset(editor)
    const position = editorPositionAtOffset(editor.plainText, offset)
    const prepared = await client.prepareRename(position)
    const fallback = wordRangeAt(editor.plainText, offset)
    const value = prepared?.placeholder
      ?? (prepared ? editor.plainText.slice(
        offsetAtEditorPosition(editor.plainText, prepared.range.start),
        offsetAtEditorPosition(editor.plainText, prepared.range.end),
      ) : fallback?.value)
    if (!value) {
      setMessage('No renameable symbol at cursor')
      return
    }
    setRenamePosition(position)
    setRenameQuery(value)
    setRenameOpen(true)
    setMessage(`Rename “${value}” across workspace · Enter applies · Esc cancels`)
  }, [activeTab])

  const performRename = useCallback(async () => {
    const client = lspRef.current
    const newName = renameQuery.trim()
    if (!client || !renamePosition || !newName) {
      setMessage('Rename requires a non-empty symbol name')
      return
    }
    const edit = await client.rename(renamePosition, newName)
    if (!edit || edit.changes.length === 0) {
      setMessage('Language server returned no rename edits')
      return
    }
    if (await applyWorkspaceEditRef.current(edit)) {
      setRenameOpen(false)
      setRenamePosition(null)
      setMessage(`Renamed symbol to “${newName}” in ${edit.changes.length} file${edit.changes.length === 1 ? '' : 's'}`)
    }
  }, [renamePosition, renameQuery])

  const formatDocument = useCallback(async () => {
    const editor = editorRef.current
    const client = lspRef.current
    if (!activeTab || !editor || !client) return
    client.change(editor.plainText)
    setMessage('Formatting document…')
    const edit = await client.formatting()
    if (!edit || edit.changes.length === 0) {
      setMessage('Document is already formatted or no formatter is available')
      return
    }
    if (await applyWorkspaceEditRef.current(edit)) setMessage(`Formatted ${activeTab.path} · save to write`)
  }, [activeTab])

  const requestCodeActions = useCallback(async () => {
    const editor = editorRef.current
    const client = lspRef.current
    if (!activeTab || !editor || !client) return
    client.change(editor.plainText)
    const selection = editor.getSelection()
    const offset = editorDocumentOffset(editor)
    const range = selection
      ? { start: editorPositionAtOffset(editor.plainText, selection.start), end: editorPositionAtOffset(editor.plainText, selection.end) }
      : { start: editorPositionAtOffset(editor.plainText, offset), end: editorPositionAtOffset(editor.plainText, offset) }
    setMessage('Loading code actions…')
    const actions = await client.codeActions(range, diagnostics)
    if (actions.length === 0) {
      setMessage('No code actions available at cursor')
      return
    }
    setCodeActions(actions)
    setCodeActionCursor(0)
    setMessage(`${actions.length} code action${actions.length === 1 ? '' : 's'} · Enter applies · Esc closes`)
  }, [activeTab, diagnostics])

  const applyCodeAction = useCallback(async (action: EditorCodeAction) => {
    const client = lspRef.current
    if (!client) return
    if (action.edit && !await applyWorkspaceEditRef.current(action.edit)) return
    if (action.command) await client.executeCommand(action.command)
    setCodeActions([])
    setMessage(`Applied code action: ${action.title}`)
  }, [])

  const jumpToEditorLocation = useCallback(async (location: EditorLocation, recordHistory = true) => {
    let absolutePath: string
    try {
      absolutePath = fileURLToPath(location.uri)
    } catch {
      setMessage('Language server returned an unsupported location')
      return
    }
    const path = normalizeRelativePath(root, absolutePath)
    if (!path) {
      setMessage('Language server location is outside this workspace')
      return
    }
    if (recordHistory && activePath) {
      const logicalCursor = editorRef.current?.logicalCursor
      jumpHistoryRef.current.push({
        path: activePath,
        line: logicalCursor?.row ?? cursorRef.current.line,
        character: logicalCursor?.col ?? cursorRef.current.visualColumn,
      })
      if (jumpHistoryRef.current.length > 100) jumpHistoryRef.current.shift()
    }
    pendingJumpRef.current = {
      path,
      line: location.range.start.line,
      character: location.range.start.character,
    }
    setSymbolNavigationKind(null)
    setSymbolNavigationResults([])
    setProjectSearchOpen(false)
    if (path === activePath && editorRef.current) {
      editorRef.current.setCursor(location.range.start.line, location.range.start.character)
      pendingJumpRef.current = null
    } else {
      await openBuffer(path)
    }
    setMessage(`Jumped to ${path}:${location.range.start.line + 1}:${location.range.start.character + 1}`)
  }, [activePath, openBuffer, root])

  const requestSymbolNavigation = useCallback(async (kind: SymbolNavigationKind) => {
    const editor = editorRef.current
    const client = lspRef.current
    if (!activeTab || !editor || !client) return
    setCompletions([])
    setHoverInfo(null)
    setSignatureInfo(null)
    client.change(editor.plainText)
    const position = editorPositionAtOffset(editor.plainText, editorDocumentOffset(editor))
    setMessage(`Finding ${kind}…`)
    const rawLocations = kind === 'definition'
      ? await client.definition(position)
      : kind === 'references'
        ? await client.references(position)
        : await client.implementation(position)
    const results = rawLocations.flatMap((location) => {
      try {
        const path = normalizeRelativePath(root, fileURLToPath(location.uri))
        if (!path) return []
        return [{
          location,
          path,
          label: basename(path),
          detail: `${path}:${location.range.start.line + 1}:${location.range.start.character + 1}`,
        }]
      } catch {
        return []
      }
    })
    if (results.length === 0) {
      setMessage(`No ${kind} found at cursor`)
      return
    }
    if (results.length === 1) {
      await jumpToEditorLocation(results[0]!.location)
      return
    }
    setSymbolNavigationKind(kind)
    setSymbolNavigationResults(results)
    setSymbolNavigationCursor(0)
    setMessage(`${results.length} ${kind} locations · Enter opens · Esc closes`)
  }, [activeTab, jumpToEditorLocation, root])

  const jumpBack = useCallback(async () => {
    const previous = jumpHistoryRef.current.pop()
    if (!previous) {
      setMessage('Jump history is empty')
      return
    }
    await jumpToEditorLocation({
      uri: pathToFileURL(join(root, previous.path)).href,
      range: {
        start: { line: previous.line, character: previous.character },
        end: { line: previous.line, character: previous.character },
      },
    }, false)
  }, [jumpToEditorLocation, root])

  useEffect(() => {
    if (!activePath || focusPane !== 'editor' || hoverInfo || signatureInfo) return
    const content = activeTab?.content ?? ''
    // The debounce lives in a ref rather than this effect's cleanup because
    // the caret commits separately from the buffer: a cleanup-owned timer is
    // cancelled by the cursor re-render that immediately follows every
    // keystroke, and the request never fires.
    if (autoCompleteContentRef.current === content) {
      // Moving the caret is navigation, not a request for suggestions. Real
      // editors close the list on cursor movement rather than re-querying, so
      // arrowing through code never paints a popup over it.
      if (completionSessionRef.current) closeCompletions()
      return
    }
    const previous = autoCompleteContentRef.current
    autoCompleteContentRef.current = content
    // A dismissal covers one word. Once the buffer changes ahead of that word
    // it is no longer the word the user dismissed, so the dismissal lapses.
    const dismissed = completionDismissedAtRef.current
    if (dismissed && previous != null
      && previous.slice(0, dismissed.start) !== content.slice(0, dismissed.start)) {
      completionDismissedAtRef.current = null
    }
    if (autoCompleteTimerRef.current) clearTimeout(autoCompleteTimerRef.current)
    autoCompleteTimerRef.current = null
    if (completionSuppressedContentRef.current === content) {
      completionSuppressedContentRef.current = null
      return
    }
    completionSuppressedContentRef.current = null
    // Capture the caret this edit landed on. A pending request whose caret has
    // since moved belongs to a position the user has left, so it is dropped
    // rather than allowed to open a list somewhere they navigated to.
    const editedAt = editorRef.current?.logicalCursor
    autoCompleteCursorRef.current = editedAt ? { row: editedAt.row, col: editedAt.col } : null
    autoCompleteTimerRef.current = setTimeout(() => {
      autoCompleteTimerRef.current = null
      const live = editorRef.current?.logicalCursor
      const scheduled = autoCompleteCursorRef.current
      if (!live || !scheduled || live.row !== scheduled.row || live.col !== scheduled.col) {
        closeCompletions()
        return
      }
      void requestCompletions(false)
    }, AUTO_COMPLETE_DELAY_MS)
  }, [activePath, activeTab?.content, closeCompletions, cursor.line, cursor.visualColumn, focusPane, hoverInfo, lspStatus?.state, requestCompletions, signatureInfo])

  useEffect(() => {
    const item = completions[completionCursor]
    if (!item || item.source !== 'lsp' || item.resolved) return
    completionResolveAbortRef.current?.abort()
    const controller = new AbortController()
    completionResolveAbortRef.current = controller
    const request = ++completionResolveRequestRef.current
    void lspRef.current?.resolveCompletion(item, controller.signal).then((resolved) => {
      if (completionResolveAbortRef.current === controller) completionResolveAbortRef.current = null
      if (!resolved || controller.signal.aborted || request !== completionResolveRequestRef.current) return
      setCompletions((current) => current.map((candidate) => candidate === item ? resolved : candidate))
    })
    return () => {
      controller.abort()
      if (completionResolveAbortRef.current === controller) completionResolveAbortRef.current = null
    }
  }, [completionCursor, completions])

  const focusSnippetTabstop = useCallback((session: SnippetSession) => {
    const editor = editorRef.current
    const tabstop = session.tabstops[session.active]
    const range = tabstop?.ranges[0]
    if (!editor || !tabstop || !range) {
      snippetSessionRef.current = null
      return
    }
    if (tabstop.index === 0) {
      editor.clearSelection()
      setEditorDocumentOffset(editor, range.start)
      snippetSessionRef.current = session.parent ?? null
      setMessage(session.parent ? 'Nested snippet complete · outer placeholders resumed' : 'Snippet complete')
      return
    }
    snippetSessionRef.current = session
    if (range.start === range.end) {
      editor.clearSelection()
      setEditorDocumentOffset(editor, range.start)
    } else {
      editor.setSelection(range.start, range.end)
    }
    const editableCount = session.tabstops.filter((candidate) => candidate.index !== 0).length
    setMessage(`Snippet ${Math.min(session.active + 1, editableCount)}/${editableCount} · Tab next · Shift+Tab previous · Esc exits`)
  }, [])

  const activateSnippet = useCallback((session: SnippetSession | undefined) => {
    if (!session || session.tabstops.length === 0) {
      snippetSessionRef.current = null
      return
    }
    focusSnippetTabstop(session)
  }, [focusSnippetTabstop])

  const navigateSnippet = useCallback((direction: 1 | -1) => {
    const editor = editorRef.current
    const existing = snippetSessionRef.current
    if (!editor || !existing) return false
    const reconciled = reconcileSnippetSession(existing, editor.plainText, editorDocumentOffset(editor))
    const synchronized = reconciled ? synchronizeSnippetMirrors(reconciled, editor.plainText) : null
    if (!synchronized) {
      snippetSessionRef.current = null
      setMessage('Snippet placeholders dismissed after cursor moved outside the active field')
      return false
    }
    if (synchronized.content !== editor.plainText) editor.replaceText(synchronized.content)
    const parent = existing.parent
      ? rebaseSnippetHierarchy(
        existing.parent,
        editorDiffAsEdit(existing.content, synchronized.content),
        synchronized.content,
      )
      : undefined
    const session = { ...synchronized.session, parent }
    const next = direction > 0
      ? Math.min(session.tabstops.length - 1, session.active + 1)
      : Math.max(0, session.active - 1)
    focusSnippetTabstop({ ...session, active: next, content: synchronized.content })
    return true
  }, [focusSnippetTabstop])

  const applyCompletionItem = useCallback(async (item: Completion) => {
    const editor = editorRef.current
    if (!editor) return
    const session = completionSessionRef.current
    const currentCursor = editor.logicalCursor
    if (!session || editor.plainText !== session.content || editorDocumentOffset(editor) !== session.cursorOffset
      || currentCursor.row !== session.line || currentCursor.col !== session.visualColumn) {
      completionSessionRef.current = null
      setCompletions([])
      setMessage('Completion dismissed after the buffer or cursor changed')
      return
    }
    if (completionAcceptingRef.current) return
    completionAcceptingRef.current = true
    completionAbortRef.current?.abort()
    completionResolveAbortRef.current?.abort()
    let acceptedItem = item
    if (item.source === 'lsp' && !item.resolved) {
      const controller = new AbortController()
      completionResolveAbortRef.current = controller
      acceptedItem = await lspRef.current?.resolveCompletion(item, controller.signal) ?? item
      if (completionResolveAbortRef.current === controller) completionResolveAbortRef.current = null
      const latestEditor = editorRef.current
      const latestCursor = latestEditor?.logicalCursor
      if (!latestEditor || controller.signal.aborted || completionSessionRef.current !== session
        || latestEditor.plainText !== session.content
        || editorDocumentOffset(latestEditor) !== session.cursorOffset
        || latestCursor?.row !== session.line || latestCursor.col !== session.visualColumn) {
        completionSessionRef.current = null
        setCompletions([])
        setMessage('Completion dismissed after the buffer or cursor changed')
        completionAcceptingRef.current = false
        return
      }
    }
    const currentSnippet = snippetSessionRef.current
    const reconciledSnippet = currentSnippet
      ? reconcileSnippetSession(currentSnippet, editor.plainText, editorDocumentOffset(editor)) ?? undefined
      : undefined
    const completion = applyCompletion(editor, acceptedItem, activePath ?? '', reconciledSnippet)
    completionSessionRef.current = null
    completionEngagedRef.current = false
    completionDismissedAtRef.current = null
    // The accepted word is now the prefix under the cursor, and re-querying it
    // just re-suggests what was taken. Skip exactly the edit we made.
    completionSuppressedContentRef.current = editor.plainText
    setCompletionEngaged(false)
    setCompletions([])
    setSignatureInfo(null)
    if (completion.error) setMessage(completion.error)
    else if (completion.snippet) activateSnippet(completion.snippet)
    else {
      snippetSessionRef.current = completion.continuedSnippet ?? null
      setMessage(`${item.source === 'lsp' ? 'LSP' : item.source} completion: ${item.label}`)
    }
    completionAcceptingRef.current = false
  }, [activateSnippet, activePath])

  const acceptCompletion = useCallback(() => {
    const item = completions[completionCursor]
    if (!item) return
    setGhostCandidate(null)
    void applyCompletionItem(item)
  }, [applyCompletionItem, completionCursor, completions])

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

  const openSearch = useCallback((replace = false) => {
    const editor = editorRef.current
    const selected = editor?.getSelectedText() ?? ''
    const selection = editor?.getSelection() ?? null
    setQuickOpen(false)
    setCompletions([])
    setHoverInfo(null)
    setSignatureInfo(null)
    setSearchOpen(true)
    setSearchReplaceMode(replace)
    setSearchInput('find')
    setSearchQuery(selected.includes('\n') ? '' : selected)
    setSearchSelectionRange(selection)
    setSearchSelectionOnly(false)
    if (!replace) setReplaceQuery('')
    setSearchCursor(-1)
    setFocusPane('editor')
  }, [])

  const openProjectSearch = useCallback(() => {
    const selected = editorRef.current?.getSelectedText() ?? ''
    setQuickOpen(false)
    setSearchOpen(false)
    setCompletions([])
    setHoverInfo(null)
    setSignatureInfo(null)
    setProjectSearchQuery(selected.includes('\n') ? '' : selected)
    setProjectSearchCursor(0)
    setProjectSearchOpen(true)
  }, [])

  const replaceSearchMatch = useCallback((replaceAll: boolean) => {
    const editor = editorRef.current
    if (!editor || !searchQuery || searchMatches.length === 0) {
      setMessage(searchQuery ? `No results for “${searchQuery}”` : 'Type text to replace')
      return
    }
    const content = editor.plainText
    const replacementFor = (match: EditorSearchMatch) => searchRegex
      ? expandEditorSearchReplacement(content, match, replaceQuery)
      : replaceQuery
    if (replaceAll) {
      let nextContent = ''
      let sourceOffset = 0
      let replacementDelta = 0
      for (const match of searchMatches) {
        const replacement = replacementFor(match)
        nextContent += content.slice(sourceOffset, match.start)
        nextContent += replacement
        replacementDelta += replacement.length - (match.end - match.start)
        sourceOffset = match.end
      }
      nextContent += content.slice(sourceOffset)
      editor.replaceText(nextContent)
      if (searchSelectionOnly && searchSelectionRange) {
        setSearchSelectionRange({ ...searchSelectionRange, end: Math.max(searchSelectionRange.start, searchSelectionRange.end + replacementDelta) })
      }
      setSearchCursor(-1)
      setMessage(`Replaced ${searchMatches.length} occurrence${searchMatches.length === 1 ? '' : 's'}`)
      return
    }
    let index = searchCursor
    if (index < 0 || index >= searchMatches.length) {
      const offset = editorDocumentOffset(editor)
      index = searchMatches.findIndex((match) => match.start >= offset)
      if (index < 0) index = 0
    }
    const match = searchMatches[index]!
    const replacement = replacementFor(match)
    editor.replaceText(`${content.slice(0, match.start)}${replacement}${content.slice(match.end)}`)
    if (searchSelectionOnly && searchSelectionRange) {
      setSearchSelectionRange({ ...searchSelectionRange, end: Math.max(searchSelectionRange.start, searchSelectionRange.end + replacement.length - (match.end - match.start)) })
    }
    setEditorDocumentOffset(editor, match.start + replacement.length)
    setSearchCursor(-1)
    setMessage(`Replaced occurrence ${index + 1} of ${searchMatches.length}`)
  }, [replaceQuery, searchCursor, searchMatches, searchQuery, searchRegex, searchSelectionOnly, searchSelectionRange])

  const navigateSearch = useCallback((direction: 1 | -1) => {
    const editor = editorRef.current
    if (!editor || searchMatches.length === 0) {
      setMessage(searchQuery ? `No results for “${searchQuery}”` : 'Type to find in the active file')
      return
    }
    let next = searchCursor
    if (next < 0) {
      const offset = editorDocumentOffset(editor)
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
    setMessage(`Find ${next + 1} of ${searchMatches.length}${searchMatchCase ? ' · match case' : ''}${searchRegex ? ' · regex' : ''}${searchSelectionOnly ? ' · selection' : ''}`)
  }, [searchCursor, searchMatchCase, searchMatches, searchQuery, searchRegex, searchSelectionOnly])

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

  const toggleZenMode = useCallback(() => {
    const next = !zenMode
    setZenMode(next)
    if (next) setFocusPane('editor')
    setMessage(next ? 'Zen mode · Esc restores the editor chrome' : 'Zen mode disabled')
    onNotice?.('info', next ? 'Editor zen mode enabled' : 'Editor zen mode disabled')
  }, [onNotice, zenMode])

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
      case 'save-all': void saveAll(); break
      case 'restart-lsp': restartLsp(); break
      case 'signature-help': void requestSignatureHelp(); break
      case 'new-file': openFilePrompt('create'); break
      case 'rename-file': openFilePrompt('rename'); break
      case 'delete-file': openFilePrompt('delete'); break
      case 'find': openSearch(); break
      case 'replace': openSearch(true); break
      case 'goto-line': openQuick(':'); break
      case 'toggle-explorer': toggleExplorer(); break
      case 'focus-explorer': setFocusPane((current) => current === 'editor' ? 'explorer' : 'editor'); break
      case 'close-tab': closeActiveTab(); break
      case 'next-diagnostic': navigateDiagnostic(1); break
      case 'previous-diagnostic': navigateDiagnostic(-1); break
      case 'show-hover': void requestHover(); break
      case 'goto-definition': void requestSymbolNavigation('definition'); break
      case 'find-references': void requestSymbolNavigation('references'); break
      case 'goto-implementation': void requestSymbolNavigation('implementation'); break
      case 'rename-symbol': void requestRename(); break
      case 'code-actions': void requestCodeActions(); break
      case 'format-document': void formatDocument(); break
      case 'project-search': openProjectSearch(); break
      case 'indent-lines': editSelectedLines('indent'); break
      case 'outdent-lines': editSelectedLines('outdent'); break
      case 'toggle-comment': editSelectedLines('comment'); break
      case 'goto-matching-bracket': jumpToMatchingBracket(); break
      case 'show-shortcuts': setShortcutsOpen(true); break
      case 'command-palette': openQuick('>'); break
      case 'add-next-occurrence': addNextOccurrence(); break
      case 'add-cursor-above': addAdjacentCursor(-1); break
      case 'add-cursor-below': addAdjacentCursor(1); break
      case 'split-selection-lines': addLineEndCursors(); break
      case 'move-lines-up': applyLineTransform('move-up'); break
      case 'move-lines-down': applyLineTransform('move-down'); break
      case 'sort-lines': applyLineTransform('sort'); break
      case 'duplicate-lines': applyLineTransform('duplicate'); break
      case 'uppercase': applyCaseTransform('upper'); break
      case 'lowercase': applyCaseTransform('lower'); break
      case 'trim-trailing-whitespace': trimTrailingWhitespace(); break
      case 'recovery-conflicts':
        if (recoveryConflicts.length > 0) setRecoveryConflictOpen(true)
        else setMessage('No recovery conflicts')
        break
      case 'toggle-vim': toggleVimMode(); break
      case 'toggle-velocity': toggleVelocityScrolling(); break
      case 'toggle-word-wrap': toggleWordWrap(); break
      case 'toggle-zen': toggleZenMode(); break
    }
  }, [addAdjacentCursor, addLineEndCursors, addNextOccurrence, applyCaseTransform, applyLineTransform, closeActiveTab, editSelectedLines, formatDocument, jumpToMatchingBracket, navigateDiagnostic, openFilePrompt, openProjectSearch, openQuick, openSearch, recoveryConflicts.length, requestCodeActions, requestHover, requestRename, requestSignatureHelp, requestSymbolNavigation, restartLsp, saveActive, saveAll, toggleExplorer, toggleVelocityScrolling, toggleVimMode, toggleWordWrap, toggleZenMode, trimTrailingWhitespace])

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
    const item = completions[index]
    if (item) void applyCompletionItem(item)
  }, [applyCompletionItem, completions])

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

    const documentOffset = editorDocumentOffset(editor)
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
    const alt = Boolean(key.option || key.meta)
    if (alt && key.name === 'v') {
      toggleVimMode()
      return true
    }
    if (alt && key.name === 'z') {
      toggleWordWrap()
      return true
    }
    if (key.sequence === 'Z' && !key.ctrl && !key.meta && !alt && focusPane === 'explorer') {
      toggleZenMode()
      return true
    }
    if (key.sequence === 'V' && !key.ctrl && !key.meta && !vimEnabled && focusPane === 'explorer') {
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
    if (symbolNavigationKind) {
      if (key.name === 'escape') {
        setSymbolNavigationKind(null)
        setSymbolNavigationResults([])
        return true
      }
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) {
        setSymbolNavigationCursor((value) => Math.max(0, value - 1))
        return true
      }
      if (key.name === 'down' || (key.ctrl && key.name === 'n')) {
        setSymbolNavigationCursor((value) => Math.min(symbolNavigationResults.length - 1, value + 1))
        return true
      }
      if (key.name === 'return') {
        const result = symbolNavigationResults[symbolNavigationCursor]
        if (result) void jumpToEditorLocation(result.location)
        return true
      }
      return true
    }
    if (recoveryConflictOpen) {
      if (key.name === 'escape') { setRecoveryConflictOpen(false); return true }
      if (key.name === 'up' || sequence === 'k') { setRecoveryConflictCursor((value) => Math.max(0, value - 1)); return true }
      if (key.name === 'down' || sequence === 'j') { setRecoveryConflictCursor((value) => Math.min(recoveryConflicts.length - 1, value + 1)); return true }
      if (key.name === 'return') {
        const conflict = recoveryConflicts[recoveryConflictCursor]
        if (conflict) void openRecoveryConflict(conflict)
        return true
      }
      if (!key.ctrl && !key.meta && sequence === 'D') {
        setRecoveryConflicts([])
        setRecoveryConflictOpen(false)
        setMessage('Discarded all recovery conflicts')
        return true
      }
      if (!key.ctrl && !key.meta && sequence === 'd') {
        const conflict = recoveryConflicts[recoveryConflictCursor]
        const next = recoveryConflicts.filter((entry) => entry !== conflict)
        setRecoveryConflicts(next)
        setRecoveryConflictCursor((value) => Math.min(value, Math.max(0, next.length - 1)))
        if (next.length === 0) setRecoveryConflictOpen(false)
        setMessage(conflict ? `Discarded recovery for ${conflict.path}` : 'No recovery conflict selected')
        return true
      }
      return true
    }
    if (filePrompt) {
      if (key.name === 'escape') {
        setFilePrompt(null)
        setMessage('File operation cancelled')
        return true
      }
      if (key.name === 'return') {
        void performFileOperation()
        return true
      }
      if (filePrompt.kind !== 'delete') {
        if (key.name === 'backspace' || key.name === 'delete') {
          setFilePrompt((current) => current ? { ...current, value: current.value.slice(0, -1) } : null)
          return true
        }
        if (!key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ') {
          setFilePrompt((current) => current ? { ...current, value: current.value + sequence } : null)
          return true
        }
      }
      return true
    }
    if (renameOpen) {
      if (key.name === 'escape') {
        setRenameOpen(false)
        setRenamePosition(null)
        setMessage('Rename cancelled')
        return true
      }
      if (key.name === 'return') { void performRename(); return true }
      if (key.name === 'backspace' || key.name === 'delete') { setRenameQuery((value) => value.slice(0, -1)); return true }
      if (!key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ') { setRenameQuery((value) => value + sequence); return true }
      return true
    }
    if (codeActions.length > 0) {
      if (key.name === 'escape') { setCodeActions([]); return true }
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) { setCodeActionCursor((value) => Math.max(0, value - 1)); return true }
      if (key.name === 'down' || (key.ctrl && key.name === 'n')) { setCodeActionCursor((value) => Math.min(codeActions.length - 1, value + 1)); return true }
      if (key.name === 'return') {
        const action = codeActions[codeActionCursor]
        if (action) void applyCodeAction(action)
        return true
      }
      return true
    }
    if (projectSearchOpen) {
      if (key.name === 'escape' || (alt && (key.name === '/' || sequence === '/'))) {
        setProjectSearchOpen(false)
        return true
      }
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) { setProjectSearchCursor((value) => Math.max(0, value - 1)); return true }
      if (key.name === 'down' || (key.ctrl && key.name === 'n')) { setProjectSearchCursor((value) => Math.min(projectSearchResults.length - 1, value + 1)); return true }
      if (key.name === 'return') {
        const result = projectSearchResults[projectSearchCursor]
        if (result) void jumpToEditorLocation({
          uri: pathToFileURL(join(root, result.path)).href,
          range: {
            start: { line: result.line, character: result.character },
            end: { line: result.line, character: result.character },
          },
        })
        return true
      }
      if (alt && key.name === 'r') { setProjectSearchRegex((value) => !value); return true }
      if (alt && key.name === 'c') { setProjectSearchMatchCase((value) => !value); return true }
      if (alt && key.name === 'w') { setProjectSearchWholeWord((value) => !value); return true }
      if (key.ctrl && key.name === 'u') { setProjectSearchQuery(''); return true }
      if (key.name === 'backspace' || key.name === 'delete') { setProjectSearchQuery((value) => value.slice(0, -1)); return true }
      if (!key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ') { setProjectSearchQuery((value) => value + sequence); return true }
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
      if (key.name === 'tab' && searchReplaceMode) {
        setSearchInput((current) => current === 'find' ? 'replace' : 'find')
        return true
      }
      if (key.name === 'return') {
        if (searchResult.error) { setMessage(`Invalid regular expression: ${searchResult.error}`); return true }
        if (searchReplaceMode && alt) replaceSearchMatch(true)
        else if (searchReplaceMode && searchInput === 'replace') replaceSearchMatch(false)
        else navigateSearch(key.shift ? -1 : 1)
        return true
      }
      if (key.name === 'backspace' || key.name === 'delete') {
        if (searchReplaceMode && searchInput === 'replace') setReplaceQuery((value) => value.slice(0, -1))
        else setSearchQuery((value) => value.slice(0, -1))
        setSearchCursor(-1)
        return true
      }
      if (key.ctrl && key.name === 'f') { navigateSearch(key.shift ? -1 : 1); return true }
      if (key.ctrl && key.name === 'r') { setSearchReplaceMode(true); setSearchInput('replace'); return true }
      if (alt && key.name === 'c') { toggleSearchMatchCase(); return true }
      if (alt && key.name === 'r') { setSearchRegex((value) => !value); setSearchCursor(-1); return true }
      if (alt && key.name === 's') {
        if (!searchSelectionRange) setMessage('Select text before opening find to search within a selection')
        else { setSearchSelectionOnly((value) => !value); setSearchCursor(-1) }
        return true
      }
      if (!key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ') {
        if (searchReplaceMode && searchInput === 'replace') setReplaceQuery((value) => value + sequence)
        else setSearchQuery((value) => value + sequence)
        setSearchCursor(-1)
        return true
      }
      return true
    }
    if (focusPane === 'editor' && key.ctrl && key.name === 'c') {
      void copyEditorSelection(false)
      return true
    }
    if (focusPane === 'editor' && key.ctrl && key.name === 'x') {
      void copyEditorSelection(true)
      return true
    }
    if (focusPane === 'editor' && key.ctrl && key.name === 'v') {
      void pasteIntoEditor()
      return true
    }
    if (focusPane === 'editor' && key.ctrl && key.name === 'z') {
      setMultiCursor(null)
      setBlockSelection(null)
      if (key.shift) editorRef.current?.redo()
      else editorRef.current?.undo()
      setMessage(key.shift ? 'Redo' : 'Undo')
      return true
    }
    if (focusPane === 'editor' && key.ctrl && key.name === 'y') {
      setMultiCursor(null)
      setBlockSelection(null)
      editorRef.current?.redo()
      setMessage('Redo')
      return true
    }
    if (focusPane === 'editor'
      && (key.name === 'left' || key.name === 'right')
      && !(alt && key.shift)
      && ((key.ctrl && !alt) || (!key.ctrl && alt))) {
      const editor = editorRef.current
      if (!editor) return true
      const options = key.shift ? { select: true } : undefined
      if (key.name === 'left') editor.moveWordBackward(options)
      else editor.moveWordForward(options)
      return true
    }
    if (focusPane === 'editor' && key.ctrl && (key.name === 'home' || key.name === 'end')) {
      const editor = editorRef.current
      if (!editor) return true
      if (key.name === 'home') editor.gotoBufferHome(key.shift ? { select: true } : undefined)
      else editor.gotoBufferEnd(key.shift ? { select: true } : undefined)
      return true
    }
    if (focusPane === 'editor' && key.ctrl && key.name === 'd') {
      addNextOccurrence()
      return true
    }
    if (focusPane === 'editor' && key.ctrl && alt && (key.name === 'up' || key.name === 'down')) {
      addAdjacentCursor(key.name === 'up' ? -1 : 1)
      return true
    }
    if (focusPane === 'editor' && alt && key.shift
      && (key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down')) {
      extendBlockSelection(key.name)
      return true
    }
    if (focusPane === 'editor' && alt && !key.shift && !key.ctrl && (key.name === 'up' || key.name === 'down')) {
      applyLineTransform(key.name === 'up' ? 'move-up' : 'move-down')
      return true
    }
    if (focusPane === 'editor' && alt && !key.ctrl && (key.name === 'u' || key.name === 'l')) {
      applyCaseTransform(key.name === 'u' ? 'upper' : 'lower')
      return true
    }
    if (focusPane === 'editor' && ((key.ctrl && key.shift && key.name === 'l') || (alt && !key.ctrl && !key.shift && key.name === 'i'))) {
      addLineEndCursors()
      return true
    }
    if (focusPane === 'editor' && multiCursor) {
      if (key.name === 'escape') {
        setMultiCursor(null)
        setBlockSelection(null)
        editorRef.current?.clearSelection()
        editorRef.current?.removeHighlightsByRef(OCCURRENCE_HIGHLIGHT_REF)
        setMessage('Collapsed to primary cursor')
        return true
      }
      if (key.name === 'backspace') return editAtAllCursors('backspace')
      if (key.name === 'delete') return editAtAllCursors('delete')
      if (key.name === 'return' && !key.ctrl && !key.meta) return editAtAllCursors({ insert: '\n' })
      if (key.name === 'tab' && !key.shift && !key.ctrl && !key.meta) return editAtAllCursors({ insert: '  ' })
      if (!key.ctrl && !alt && sequence.length === 1) {
        const close = AUTO_PAIR_CLOSE[sequence]
        return editAtAllCursors(close ? { insert: `${sequence}${close}`, caretOffset: 1 } : { insert: sequence })
      }
      if ((key.ctrl && (key.name === 'z' || key.name === 'y'))
        || ['left', 'right', 'up', 'down', 'home', 'end', 'pageup', 'pagedown'].includes(key.name)) {
        setMultiCursor(null)
        setBlockSelection(null)
      }
    }
    if (key.name === 'f2') {
      if (focusPane === 'explorer') openFilePrompt('rename')
      else void requestRename()
      return true
    }
    if (key.name === 'f12') {
      void requestSymbolNavigation(key.ctrl ? 'implementation' : key.shift ? 'references' : 'definition')
      return true
    }
    if (alt && key.shift && key.name === 'f') { void formatDocument(); return true }
    if (alt && (key.name === '.' || sequence === '.')) { void requestCodeActions(); return true }
    if (alt && (key.name === '/' || sequence === '/')) { openProjectSearch(); return true }
    if (focusPane === 'editor' && key.ctrl && (key.name === '/' || sequence === '\x1f')) { editSelectedLines('comment'); return true }
    if (focusPane === 'editor' && key.ctrl && key.name === ']') { editSelectedLines('indent'); return true }
    if (focusPane === 'editor' && key.ctrl && key.name === '[') { editSelectedLines('outdent'); return true }
    if (vimEnabled && handleVimKey(key)) return true
    if (hoverInfo || signatureInfo) {
      if (key.name === 'escape') {
        setHoverInfo(null)
        setSignatureInfo(null)
        return true
      }
      const retainsPopup = (key.ctrl && key.name === 'k')
        || (alt && key.name === 'k')
        || (key.ctrl && key.shift && (key.name === 'space' || sequence === '\0'))
      if (!retainsPopup) {
        setHoverInfo(null)
        setSignatureInfo(null)
      }
    }
    if (shortcutsOpen) {
      if (key.name === 'escape' || key.name === 'return' || sequence === '?' || sequence === 'q') {
        setShortcutsOpen(false)
        return true
      }
      const scroll = shortcutsScrollRef.current
      if (scroll) {
        const step = key.name === 'pageup' || key.name === 'pagedown' ? Math.max(1, scroll.height - 2) : 1
        if (key.name === 'up' || key.name === 'pageup') scroll.scrollTop = Math.max(0, scroll.scrollTop - step)
        if (key.name === 'down' || key.name === 'pagedown') scroll.scrollTop += step
      }
      return true
    }
    // `?` is the reference key wherever it is not text: the explorer pane and
    // Vim's normal mode. Inside the buffer it must still type a question mark,
    // so the command palette carries it there.
    if (sequence === '?' && !key.ctrl && !alt
      && (focusPane === 'explorer' || (vimEnabled && vimMode !== 'insert'))) {
      setShortcutsOpen(true)
      return true
    }
    if (completions.length > 0) {
      if (key.name === 'escape') {
        const editor = editorRef.current
        const prefix = editor ? wordPrefixAt(editor.plainText, editorDocumentOffset(editor)) : null
        closeCompletions(prefix?.value ? prefix : undefined)
        return true
      }
      const engage = () => {
        completionEngagedRef.current = true
        setCompletionEngaged(true)
      }
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) {
        engage()
        setCompletionCursor((value) => Math.max(0, value - 1))
        return true
      }
      if (key.name === 'down' || (key.ctrl && key.name === 'n')) {
        engage()
        setCompletionCursor((value) => Math.min(completions.length - 1, value + 1))
        return true
      }
      if (key.name === 'tab') { acceptCompletion(); return true }
      // An unengaged list is only a suggestion, so Enter keeps meaning newline.
      if (key.name === 'return' && completionEngagedRef.current) { acceptCompletion(); return true }
      if (key.name === 'return') closeCompletions()
    }
    if (focusPane === 'editor' && snippetSessionRef.current) {
      if (key.name === 'escape') {
        const current = snippetSessionRef.current
        const content = editorRef.current?.plainText ?? current.content
        const parent = current.parent
          ? rebaseSnippetHierarchy(current.parent, editorDiffAsEdit(current.content, content), content)
          : undefined
        snippetSessionRef.current = parent ?? null
        editorRef.current?.clearSelection()
        setMessage(parent ? 'Nested snippet dismissed · outer placeholders resumed' : 'Snippet placeholders dismissed')
        return true
      }
      if (key.name === 'tab' && !key.ctrl && !key.meta) {
        if (navigateSnippet(key.shift ? -1 : 1)) return true
      }
      if (['left', 'right', 'up', 'down', 'home', 'end', 'pageup', 'pagedown'].includes(key.name)
        || (key.ctrl && (key.name === 'z' || key.name === 'y'))) {
        snippetSessionRef.current = null
      }
    }
    // A standing ghost is acceptable even with no list on screen. The hint
    // outlives the completion list by design, so between the keystroke and the
    // list coming back there is a window where the suggestion is plainly
    // visible and Tab would otherwise indent — which makes the hint look like
    // something you cannot act on.
    if (focusPane === 'editor' && key.name === 'tab' && !key.shift && !key.ctrl && !key.meta
      && completions.length === 0 && ghostTextRef.current && !editorRef.current?.hasSelection()) {
      editorRef.current?.insertText(ghostTextRef.current)
      setGhostCandidate(null)
      return true
    }
    if (focusPane === 'editor' && key.name === 'tab' && (key.shift || editorRef.current?.hasSelection())) {
      editSelectedLines(key.shift ? 'outdent' : 'indent')
      return true
    }
    // Plain Tab with nothing selected. Neither the popover nor the textarea
    // claimed this before — the textarea has no Tab action at all — so the key
    // did nothing whatsoever, in an editor, which is the one place Tab is
    // expected to work. It advances to the next tab stop rather than inserting
    // a whole indent unit, so a caret sitting mid-indent lands on the stop
    // instead of overshooting it.
    if (focusPane === 'editor' && key.name === 'tab' && !key.ctrl && !key.meta && !alt) {
      const editor = editorRef.current
      if (!editor || !activeTab) return true
      const indentUnit = detectEditorIndentUnit(activeTab.content, activeTab.path)
      const insertion = indentUnit === '\t'
        ? '\t'
        : ' '.repeat(indentUnit.length - (cursorRef.current.visualColumn % indentUnit.length))
      editor.insertText(insertion)
      return true
    }
    if (focusPane === 'editor' && (key.name === 'home' || key.name === 'end')) {
      const editor = editorRef.current
      if (!editor) return true
      const documentOffset = editorDocumentOffset(editor)
      const bounds = lineBoundsAtOffset(editor.plainText, documentOffset)
      const target = key.name === 'home' ? smartHomeOffset(editor.plainText, documentOffset) : bounds.end
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
      const offset = editorDocumentOffset(editor)
      const insertion = smartNewLineInsertion(editor.plainText, offset, activeTab?.path ?? '')
      editor.insertText(insertion.text)
      setEditorDocumentOffset(editor, insertion.cursorOffset)
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
    if (key.ctrl && key.name === 'n') { openFilePrompt('create'); return true }
    if ((key.ctrl && key.shift && key.name === 's') || (alt && !key.ctrl && key.name === 's')) { void saveAll(); return true }
    if (key.ctrl && key.name === 's') { void saveActive(); return true }
    if ((key.ctrl && key.shift && key.name === 'r') || (alt && !key.ctrl && key.name === 'r')) { restartLsp(); return true }
    if ((key.ctrl && key.shift && key.name === 'p') || (alt && !key.ctrl && key.name === 'p')) { openQuick('>'); return true }
    if (key.ctrl && key.name === 'p') { openQuick(); return true }
    if (key.ctrl && key.name === 'f') { openSearch(); return true }
    if (key.ctrl && key.name === 'r') { openSearch(true); return true }
    if (key.ctrl && key.name === 'g') { openQuick(':'); return true }
    if (key.ctrl && key.name === 'b') { toggleExplorer(); return true }
    if (key.name === 'f1') { setShortcutsOpen(true); return true }
    if (key.ctrl && key.name === 'w') { closeActiveTab(); return true }
    if (key.ctrl && key.name === 't') { void jumpBack(); return true }
    if (key.ctrl && key.name === 'm') { jumpToMatchingBracket(); return true }
    if (key.name === 'f8') { navigateDiagnostic(key.shift ? -1 : 1); return true }
    if (key.ctrl && key.name === 'k') { void requestHover(); return true }
    if ((key.ctrl && key.shift && (key.name === 'space' || sequence === '\0')) || (alt && !key.ctrl && key.name === 'k')) { void requestSignatureHelp(); return true }
    if (key.ctrl && (key.name === 'space' || sequence === '\0')) { void requestCompletions(true); return true }
    if (focusPane === 'editor' && key.name === 'escape' && editorRef.current?.hasSelection()) {
      editorRef.current.clearSelection()
      editorRef.current.removeHighlightsByRef(OCCURRENCE_HIGHLIGHT_REF)
      setMultiCursor(null)
      setBlockSelection(null)
      setMessage('Selection cleared')
      return true
    }
    if (key.name === 'escape') {
      if (focusPane === 'explorer' && activeTab) { setFocusPane('editor'); editorRef.current?.focus() }
      else if (zenMode) toggleZenMode()
      else setMessage('Ctrl+Q closes editor · Ctrl+P opens files')
      return true
    }
    if (focusPane === 'explorer') {
      if (key.name === 'delete' || key.name === 'backspace') { openFilePrompt('delete'); return true }
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
    if (focusPane === 'editor' && key.name === 'backspace' && !key.ctrl && !alt && !multiCursor) {
      // Deleting the opener of a pair the editor inserted should take the
      // closer with it, or every auto-pair leaves an orphan behind.
      const editor = editorRef.current
      if (editor && !editor.hasSelection()) {
        const content = editor.plainText
        const offset = editorDocumentOffset(editor)
        const opener = content[offset - 1]
        if (opener && AUTO_PAIR_CLOSE[opener] === content[offset]) {
          editor.replaceText(`${content.slice(0, offset - 1)}${content.slice(offset + 1)}`)
          setEditorDocumentOffset(editor, offset - 1)
          return true
        }
      }
    }
    if (focusPane === 'editor' && !key.ctrl && !alt && sequence.length === 1) {
      const editor = editorRef.current
      if (!editor) return false
      // Only brackets and quotes have anything to do here. Everything else —
      // which is nearly every character typed — used to pay for a whole-buffer
      // read before falling through to the textarea untouched.
      const closesPair = AUTO_PAIR_CLOSERS.has(sequence)
      const opensPair = AUTO_PAIR_OPEN.has(sequence)
      if (!closesPair && !opensPair) return false
      const content = editor.plainText
      let offset = editorDocumentOffset(editor, undefined, content)
      // Typing a closer on an otherwise blank line snaps that line back to its
      // opener's indentation, so a block closes where it started instead of
      // wherever the previous line happened to leave the caret.
      if (closesPair && !editor.hasSelection()) {
        const lineStart = content.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
        const aligned = indentForClosingBracket(content, offset, sequence, activeTab?.path ?? '')
        if (aligned != null && aligned !== content.slice(lineStart, offset)) {
          editor.replaceText(`${content.slice(0, lineStart)}${aligned}${content.slice(offset)}`)
          offset = lineStart + aligned.length
          setEditorDocumentOffset(editor, offset)
          // The realignment consumed this key, so the closer is placed here
          // rather than left to a fall-through that would not see the new caret.
          if (editor.plainText[offset] === sequence) setEditorDocumentOffset(editor, offset + 1)
          else {
            editor.insertText(sequence)
            setEditorDocumentOffset(editor, offset + 1)
          }
          return true
        }
      }
      if (closesPair && content[offset] === sequence && !editor.hasSelection()) {
        setEditorDocumentOffset(editor, offset + 1)
        return true
      }
      if (opensPair) {
        const close = AUTO_PAIR_CLOSE[sequence]!
        const selection = editor.getSelection()
        const quote = sequence === '"' || sequence === "'" || sequence === '`'
        if (quote && !selection) {
          const previous = content[offset - 1]
          const next = content[offset]
          // Keep apostrophes in identifiers/prose and escaped quotes literal.
          // Pair only where a closing delimiter is syntactically plausible.
          if (previous === '\\' || (previous != null && /[\w$]/.test(previous))
            || (next != null && !/[\s)\]}>;,.:]/.test(next))) return false
        }
        if (selection) {
          editor.replaceText(`${content.slice(0, selection.start)}${sequence}${content.slice(selection.start, selection.end)}${close}${content.slice(selection.end)}`)
          editor.setSelection(selection.start + 1, selection.end + 1)
        } else {
          editor.insertText(`${sequence}${close}`)
          setEditorDocumentOffset(editor, offset + 1)
        }
        return true
      }
    }
    return false
  }, [acceptCompletion, activateTreeRow, activeTab, addAdjacentCursor, closeCompletions, jumpToMatchingBracket, shortcutsOpen, vimMode, addLineEndCursors, addNextOccurrence, applyCaseTransform, applyCodeAction, applyLineTransform, chooseQuickResultAt, closeActiveTab, closeConfirm, codeActionCursor, codeActions, completions.length, copyEditorSelection, editAtAllCursors, editSelectedLines, extendBlockSelection, filePrompt, focusPane, formatDocument, handleVimKey, hoverInfo, jumpBack, jumpToEditorLocation, multiCursor, navigateDiagnostic, navigateSearch, navigateSnippet, openFilePrompt, openProjectSearch, openQuick, openRecoveryConflict, openSearch, pasteIntoEditor, performFileOperation, performRename, projectSearchCursor, projectSearchOpen, projectSearchResults, quickCursor, quickOpen, quickResults.length, recoveryConflictCursor, recoveryConflictOpen, recoveryConflicts, renameOpen, replaceSearchMatch, requestClose, requestCodeActions, requestCompletions, requestHover, requestRename, requestSignatureHelp, requestSymbolNavigation, restartLsp, root, saveActive, saveAll, searchInput, searchOpen, searchReplaceMode, searchResult.error, searchSelectionRange, signatureInfo, switchTab, symbolNavigationCursor, symbolNavigationKind, symbolNavigationResults, toggleExplorer, toggleSearchMatchCase, toggleVelocityScrolling, toggleVimMode, toggleWordWrap, toggleZenMode, treeCursor, zenMode, treeExpanded, treeRows, velocityScrollEnabled, vimEnabled])

  useEffect(() => {
    onKeyHandlerReady(handleKey)
  }, [handleKey, onKeyHandlerReady])

  useEffect(() => {
    if (focusPane === 'editor') editorRef.current?.focus()
  }, [activePath, focusPane])

  useEffect(() => {
    const pending = pendingJumpRef.current
    const editor = editorRef.current
    if (!pending || pending.path !== activePath || !editor) return
    editor.setCursor(pending.line, pending.character)
    pendingJumpRef.current = null
  }, [activePath])

  useEffect(() => {
    setDiagnosticCursor(-1)
    setSearchCursor(-1)
  }, [activePath, diagnostics])

  const setEditorRef = useCallback((node: TextareaRenderable | null) => {
    editorRef.current = node
    if (node) cursorRef.current = { line: node.logicalCursor.row, visualColumn: node.logicalCursor.col }
  }, [])

  // The size limit above is the buffer's documented capacity, but a limit is a
  // claim about someone else's code. This checks the claim: a buffer that took
  // less than it was handed is not an editable view of the file — every offset,
  // line number and language-server position computed from it would be wrong,
  // and saving would write the truncation over the rest of the file. The tab is
  // closed rather than shown, because a silently short buffer looks exactly
  // like a short file.
  //
  // Each mount is checked once. The textarea is keyed by path, so a new
  // renderable is a newly loaded file, and the check runs before the first edit
  // can make the buffer and the tab legitimately differ.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeTab || verifiedBuffersRef.current.has(editor)) return
    verifiedBuffersRef.current.add(editor)
    if (editor.plainText.length === activeTab.content.length) return
    const path = activeTab.path
    const text = `${path} did not fit the editor buffer`
      + ` (${editor.plainText.length} of ${activeTab.content.length} characters) and was not opened`
    setTabs((current) => current.filter((tab) => tab.path !== path))
    setActivePath((current) => (current === path ? null : current))
    setMessage(text)
    onNotice?.('error', text)
  }, [activeTab, onNotice])

  const handleEditorCursorChange = useCallback((next: { line: number; visualColumn: number }) => {
    cursorRef.current = next
    setCursor(next)
    const editor = editorRef.current
    const selection = editor?.getSelection()
    const summary = !editor || !selection || selection.end <= selection.start
      ? null
      : {
        characters: selection.end - selection.start,
        lines: editor.plainText.slice(selection.start, selection.end).split('\n').length,
      }
    // Caret movement is the hot path; only re-render when the readout changes.
    setSelectionSummary((current) => (
      current?.characters === summary?.characters && current?.lines === summary?.lines ? current : summary
    ))
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
    completionSessionRef.current = null
    completionAbortRef.current?.abort()
    completionAbortRef.current = null
    completionResolveAbortRef.current?.abort()
    completionResolveAbortRef.current = null
    // Typing drops engagement but keeps an Escape dismissal standing; the
    // auto-trigger decides whether this edit is allowed to reopen the list.
    completionEngagedRef.current = false
    setCompletionEngaged(false)
    setCompletions([])
    setCloseConfirm(false)
    setTabs((current) => current.map((tab) => tab.path === activePath ? { ...tab, content } : tab))
  }, [activePath])

  const counts = useMemo(() => diagnosticCounts(diagnostics), [diagnostics])
  // Only the toggles that are on earn status-bar space; the bindings that turn
  // them on live in the F1 reference.
  const enabledToggles = [
    wordWrapEnabled ? 'Wrap' : null,
    velocityScrollEnabled ? 'Velocity' : null,
    zenMode ? 'Zen (Esc)' : null,
    syntaxSuspended ? 'Syntax off (long lines)' : null,
  ].filter(Boolean).join(' ')
  const indentSummary = useMemo(() => {
    if (!activeTab) return 'Spaces: 2'
    const unit = detectEditorIndentUnit(activeTab.content, activeTab.path)
    return unit === '\t' ? 'Tab' : `Spaces: ${unit.length}`
  }, [activeTab])
  const selectedCompletion = completions[completionCursor]
  const projectSearchWindowStart = Math.min(
    Math.max(0, projectSearchCursor - 9),
    Math.max(0, projectSearchResults.length - 12),
  )
  const visibleProjectSearchResults = projectSearchResults.slice(projectSearchWindowStart, projectSearchWindowStart + 12)
  const quickWindowStart = listWindowStart(quickCursor, quickResults.length, QUICK_VISIBLE_ROWS)
  const symbolWindowStart = listWindowStart(symbolNavigationCursor, symbolNavigationResults.length, SYMBOL_VISIBLE_ROWS)
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
  const completionListWidth = showCompletionDetailPane
    ? Math.min(34, completionPopupWidth - 24)
    : completionPopupWidth - 2
  // Outer border (2), detail border (2), and detail horizontal padding (2).
  const completionDetailTextWidth = Math.max(12, completionPopupWidth - completionListWidth - 6)
  const completionDetailRows = selectedCompletion
    ? 1 + (selectedCompletion.detail ? 1 : 0) + completionDocumentation.length
    : 0
  const completionPopupHeight = Math.min(
    11,
    Math.max(
      4,
      2 + (showCompletionDetailPane
        ? Math.max(visibleCompletions.length, completionDetailRows + 2)
        : visibleCompletions.length + completionDocumentation.length),
    ),
  )
  // Prefer the row below the caret, but flip above when the list would not fit
  // there — clamping it into view instead would paint it over the line being
  // typed, which is exactly what a suggestion must never do.
  const completionCaretRow = cursor.line - (editorRef.current?.scrollY ?? 0) + contentTop
  const completionFitsBelow = completionCaretRow + completionPopupHeight <= contentHeight
  const completionTop = completionFitsBelow
    ? Math.max(3, completionCaretRow)
    : Math.max(3, completionCaretRow - completionPopupHeight - 1)
  const completionLeft = explorerWidth + Math.max(5, Math.min(Math.max(5, editorWidth - completionPopupWidth - 2), cursor.visualColumn + 7))
  // Inline suggestion at the caret. The candidate is captured whenever a list
  // is open and re-checked against the live buffer on every keystroke, so it
  // survives the debounce and round trip that a new list costs.
  useEffect(() => {
    const session = completionSessionRef.current
    const selected = completions[completionCursor]
    if (!session || !selected) return
    const next = editorGhostCandidate(session.content, session.cursorOffset, selected)
    setGhostCandidate((current) => (
      current && next && current.replaceStart === next.replaceStart && current.newText === next.newText
        ? current
        : next
    ))
  }, [completionCursor, completions])

  const ghostSuffix = useMemo(() => {
    if (!activeTab || focusPane !== 'editor' || multiCursor || snippetSessionRef.current) return null
    const lineStarts = lineStartsFor(activeTab.content)
    if (cursor.line >= lineStarts.length) return null
    const cursorOffset = Math.min(
      cursor.line + 1 < lineStarts.length ? lineStarts[cursor.line + 1]! - 1 : activeTab.content.length,
      lineStarts[cursor.line]! + cursor.visualColumn,
    )
    return editorGhostSuffix(activeTab.content, cursorOffset, ghostCandidate)
  }, [activeTab, cursor.line, cursor.visualColumn, focusPane, ghostCandidate, multiCursor])
  // Absolute coordinates here are relative to the popover's frame, one row and
  // one column inside the terminal cell the caret occupies — the same offset
  // the completion popup absorbs into its own rough placement. The ghost has to
  // land on the caret exactly, so it subtracts it.
  const ghostRow = cursor.line - (editorRef.current?.scrollY ?? 0) + contentTop - 1
  const ghostLeft = explorerWidth + gutterMinWidth + cursor.visualColumn
  const ghostFits = ghostSuffix != null
    && ghostRow >= contentTop - 1
    && ghostRow < contentTop + contentHeight
    && cursor.visualColumn + ghostSuffix.length < editorWidth - gutterMinWidth - 2
  const ghostText = ghostFits ? ghostSuffix : null
  useLayoutEffect(() => {
    ghostTextRef.current = ghostText
  }, [ghostText])
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
      border={!zenMode}
      borderStyle="heavy"
      borderColor={theme.violet}
      title={zenMode ? undefined : "  EDITOR "}
      titleColor={theme.violet}
      zIndex={50}
      flexDirection="column"
    >
      {zenMode ? null : (
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
      )}

      <box height={contentHeight} flexDirection="row">
        {explorerShown ? (
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
              ref={explorerScrollRef}
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
                minWidth={gutterMinWidth}
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
        <text fg={theme.cyan}>{`   ${basename(root)}${zenMode && activePath ? ` › ${basename(activePath)}` : ''} `}</text>
        {dirty ? <text fg={theme.amber}>● modified  </text> : <text fg={theme.green}>✓ saved  </text>}
        {activePath && diskConflicts.has(activePath) ? <text fg={theme.red}>⚠ disk changed  </text> : null}
        {counts.errors > 0 ? <text fg={theme.red}>{`× ${counts.errors} `}</text> : null}
        {counts.warnings > 0 ? <text fg={theme.amber}>{`▲ ${counts.warnings} `}</text> : null}
        {counts.info > 0 ? <text fg={theme.cyan}>{`● ${counts.info} `}</text> : null}
        {multiCursor && multiCursor.ranges.length > 1 ? <text fg={theme.violet}>{` ${multiCursor.ranges.length} cursors`}</text> : null}
        <text fg={lspStatus?.state === 'ready' ? theme.green : theme.dim} wrapMode="none">
          {` ${fitText(lspStatusText(lspStatus), Math.max(18, Math.floor(editorWidth * 0.42)))}`}
        </text>
        <box flexGrow={1} />
        <text fg={theme.dim}>{`${detectTuiCodeFiletypeFromPath(activeTab?.path) ?? 'text'}  ${indentSummary}${enabledToggles ? `  ${enabledToggles}` : ''}  Ln ${cursor.line + 1}, Col ${cursor.visualColumn + 1}${selectionSummary ? ` (${selectionSummary.characters} sel${selectionSummary.lines > 1 ? `, ${selectionSummary.lines} lines` : ''})` : ''}  ${formatClock(clock)} `}</text>
      </box>
      {zenMode ? null : (
      <box height={footerHeight} paddingX={1} backgroundColor={theme.surface2} flexDirection="column">
        <text fg={message.startsWith('Unable') || message.startsWith('Refused') ? theme.red : theme.dim} wrapMode="none">
          {fitText(message, Math.max(10, width - 4))}
        </text>
        {footerShortcutRows.map((row) => <text key={row} fg={theme.dim} wrapMode="none">{row}</text>)}
      </box>
      )}

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
          <box flexGrow={1} flexDirection="row">
          <scrollbox flexGrow={1} scrollAcceleration={scrollAcceleration}>
            {quickResults.slice(quickWindowStart, quickWindowStart + QUICK_VISIBLE_ROWS).map((result, visibleIndex) => {
              const index = quickWindowStart + visibleIndex
              return (
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
              )
            })}
            {quickResults.length === 0 ? <text fg={theme.dim}>  No matching results</text> : null}
          </scrollbox>
          {renderListScrollbar(quickWindowStart, QUICK_VISIBLE_ROWS, quickResults.length)}
          </box>
        </box>
      ) : null}

      {projectSearchOpen ? (
        <box
          position="absolute"
          top={2}
          left={Math.max(2, Math.floor(width * 0.12))}
          width={Math.max(52, Math.floor(width * 0.76))}
          height={Math.min(19, height - 5)}
          zIndex={65}
          border
          borderStyle="heavy"
          borderColor={theme.cyan}
          backgroundColor={theme.surface}
          flexDirection="column"
          title=" Project search "
        >
          <box height={1} paddingX={1} backgroundColor={theme.surface2} flexDirection="row">
            <text fg={theme.text} wrapMode="none">{`⌕ ${projectSearchQuery || 'search files and unsaved buffers…'}`}</text>
            <box flexGrow={1} />
            <text fg={projectSearchRegex ? theme.amber : theme.dim}>.*</text>
            <text fg={projectSearchMatchCase ? theme.amber : theme.dim}> Aa</text>
            <text fg={projectSearchWholeWord ? theme.amber : theme.dim}> W</text>
          </box>
          <box height={1} paddingX={1} flexDirection="row">
            <text fg={theme.cyan}>{projectSearchStatus}</text>
            <box flexGrow={1} />
            <text fg={theme.dim}>Alt+R regex · Alt+C case · Alt+W word</text>
          </box>
          <box flexGrow={1} flexDirection="row">
          <scrollbox flexGrow={1} scrollAcceleration={scrollAcceleration}>
            {visibleProjectSearchResults.map((result, visibleIndex) => {
              const index = projectSearchWindowStart + visibleIndex
              return (
                <box
                  key={`${result.path}:${result.line}:${result.character}:${index}`}
                  height={2}
                  paddingX={1}
                  backgroundColor={index === projectSearchCursor ? theme.surface3 : theme.surface}
                  flexDirection="column"
                  onMouseUp={(event: MouseEvent) => {
                    if (event.button !== 0) return
                    event.stopPropagation()
                    void jumpToEditorLocation({
                      uri: pathToFileURL(join(root, result.path)).href,
                      range: {
                        start: { line: result.line, character: result.character },
                        end: { line: result.line, character: result.character },
                      },
                    })
                  }}
                >
                  <text fg={index === projectSearchCursor ? theme.amber : theme.cyan} wrapMode="none">
                    {fitText(`${result.path}:${result.line + 1}:${result.character + 1}`, Math.max(24, Math.floor(width * 0.68)))}
                  </text>
                  <text fg={theme.muted} wrapMode="none">{fitText(result.preview.trim(), Math.max(24, Math.floor(width * 0.68)))}</text>
                </box>
              )
            })}
            {projectSearchQuery && projectSearchResults.length === 0 && projectSearchStatus !== 'Searching…'
              ? <text fg={theme.dim}>  No project matches</text>
              : null}
          </scrollbox>
          {renderListScrollbar(projectSearchWindowStart, 12, projectSearchResults.length)}
          </box>
          <text fg={theme.dim}> Enter open · ↑↓ select · Ctrl+U clear · Esc close</text>
        </box>
      ) : null}

      {searchOpen && activeTab ? (
        <box
          position="absolute"
          top={2}
          right={2}
          width={Math.max(32, Math.min(56, Math.floor(width * 0.48)))}
          height={searchReplaceMode ? 6 : 4}
          zIndex={61}
          border
          borderStyle="rounded"
          borderColor={theme.amber}
          backgroundColor={theme.surface}
          flexDirection="column"
          title={searchReplaceMode ? ' Replace in file ' : ' Find in file '}
        >
          <box height={1} paddingX={1} backgroundColor={theme.surface2} flexDirection="row">
            <text fg={searchInput === 'find' ? theme.amber : theme.text} wrapMode="none">{`⌕ ${searchQuery || 'type to search…'}`}</text>
            <box flexGrow={1} />
            <text fg={searchMatchCase ? theme.amber : theme.dim}>Aa</text>
            <text fg={searchRegex ? theme.amber : theme.dim}> .*</text>
            <text fg={searchSelectionOnly ? theme.amber : theme.dim}> Sel</text>
            <text fg={theme.dim}>{`  ${searchMatches.length === 0 ? '0/0' : `${Math.max(0, searchCursor) + 1}/${searchMatches.length}`}`}</text>
          </box>
          {searchReplaceMode ? (
            <box height={1} paddingX={1} backgroundColor={theme.surface2}>
              <text fg={searchInput === 'replace' ? theme.amber : theme.text} wrapMode="none">{`↪ ${replaceQuery || 'replace with…'}`}</text>
            </box>
          ) : null}
          <text fg={searchResult.error ? theme.red : theme.dim}>{searchResult.error
            ? fitText(`Invalid regex: ${searchResult.error}`, Math.max(28, Math.min(52, Math.floor(width * 0.44))))
            : searchReplaceMode
              ? ' Tab field · Enter next/replace · Alt+Enter all · Alt+C case · Alt+R regex · Alt+S selection · Esc'
              : ' Enter next · Shift+Enter previous · Alt+C case · Alt+R regex · Alt+S selection · Esc'}</text>
        </box>
      ) : null}

      {symbolNavigationKind && symbolNavigationResults.length > 0 ? (
        <box
          position="absolute"
          top={2}
          left={Math.max(2, Math.floor(width * 0.18))}
          width={Math.max(42, Math.floor(width * 0.64))}
          height={Math.min(15, symbolNavigationResults.length + 4)}
          zIndex={62}
          border
          borderStyle="heavy"
          borderColor={theme.cyan}
          backgroundColor={theme.surface}
          flexDirection="column"
          title={` ${symbolNavigationKind} ${symbolNavigationCursor + 1}/${symbolNavigationResults.length} `}
        >
          <text fg={theme.dim}> Enter open · ↑↓ select · Esc close</text>
          <box flexGrow={1} flexDirection="row">
          <scrollbox flexGrow={1} scrollAcceleration={scrollAcceleration}>
            {symbolNavigationResults.slice(symbolWindowStart, symbolWindowStart + SYMBOL_VISIBLE_ROWS).map((result, visibleIndex) => {
              const index = symbolWindowStart + visibleIndex
              return (
              <box
                key={`${result.location.uri}:${result.location.range.start.line}:${result.location.range.start.character}`}
                height={1}
                paddingX={1}
                backgroundColor={index === symbolNavigationCursor ? theme.surface3 : theme.surface}
                flexDirection="row"
                onMouseUp={(event: MouseEvent) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  void jumpToEditorLocation(result.location)
                }}
              >
                <text fg={index === symbolNavigationCursor ? theme.amber : theme.text} wrapMode="none">{fitText(result.label, Math.max(14, Math.floor(width * 0.22)))}</text>
                <box flexGrow={1} />
                <text fg={theme.dim} wrapMode="none">{fitText(result.detail, Math.max(20, Math.floor(width * 0.34)))}</text>
              </box>
              )
            })}
          </scrollbox>
          {renderListScrollbar(symbolWindowStart, SYMBOL_VISIBLE_ROWS, symbolNavigationResults.length)}
          </box>
        </box>
      ) : null}

      {renameOpen ? (
        <box
          position="absolute"
          top={Math.max(3, Math.floor(height * 0.28))}
          left={Math.max(3, Math.floor(width * 0.24))}
          width={Math.max(38, Math.min(width - 6, Math.floor(width * 0.52)))}
          height={4}
          zIndex={64}
          border
          borderStyle="heavy"
          borderColor={theme.amber}
          backgroundColor={theme.surface}
          flexDirection="column"
          title=" Rename symbol "
        >
          <box height={1} paddingX={1} backgroundColor={theme.surface2}>
            <text fg={theme.text} wrapMode="none">{`› ${renameQuery || 'new symbol name…'}`}</text>
          </box>
          <text fg={theme.dim}> Enter rename across workspace · Esc cancel</text>
        </box>
      ) : null}

      {filePrompt ? (
        <box
          position="absolute"
          top={Math.max(3, Math.floor(height * 0.25))}
          left={Math.max(3, Math.floor(width * 0.2))}
          width={Math.max(44, Math.min(width - 6, Math.floor(width * 0.6)))}
          height={filePrompt.kind === 'delete' ? 7 : 6}
          zIndex={74}
          border
          borderStyle="heavy"
          borderColor={filePrompt.kind === 'delete' ? theme.red : theme.cyan}
          backgroundColor={theme.surface}
          paddingX={1}
          flexDirection="column"
          title={` ${filePrompt.kind === 'create' ? 'New file' : filePrompt.kind === 'rename' ? 'Rename file' : 'Delete file'} `}
        >
          {filePrompt.kind === 'delete' ? (
            <>
              <text fg={theme.red}>This permanently deletes the file from disk:</text>
              <text fg={theme.text} wrapMode="none">{fitText(filePrompt.source ?? '', Math.max(30, Math.floor(width * 0.52)))}</text>
              <box flexGrow={1} />
              <text fg={theme.dim}>Enter confirm delete · Esc cancel</text>
            </>
          ) : (
            <>
              <box height={1} paddingX={1} backgroundColor={theme.surface2}>
                <text fg={theme.text} wrapMode="none">{`› ${filePrompt.value || 'workspace/path…'}`}</text>
              </box>
              <box flexGrow={1} />
              <text fg={theme.dim}>Workspace-relative path · Enter confirm · Esc cancel</text>
            </>
          )}
        </box>
      ) : null}

      {recoveryConflictOpen && recoveryConflicts.length > 0 ? (
        <box
          position="absolute"
          top={Math.max(3, Math.floor(height * 0.2))}
          left={Math.max(3, Math.floor(width * 0.18))}
          width={Math.max(46, Math.min(width - 6, Math.floor(width * 0.64)))}
          height={Math.min(14, recoveryConflicts.length + 5)}
          zIndex={72}
          border
          borderStyle="heavy"
          borderColor={theme.red}
          backgroundColor={theme.surface}
          flexDirection="column"
          title={` Recovery conflicts ${recoveryConflictCursor + 1}/${recoveryConflicts.length} `}
        >
          <text fg={theme.amber}>Disk changed after these snapshots; recovery was not applied automatically.</text>
          <scrollbox flexGrow={1} scrollAcceleration={scrollAcceleration}>
            {recoveryConflicts.map((conflict, index) => (
              <box
                key={conflict.path}
                height={1}
                paddingX={1}
                backgroundColor={index === recoveryConflictCursor ? theme.surface3 : theme.surface}
                onMouseUp={(event: MouseEvent) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  void openRecoveryConflict(conflict)
                }}
              >
                <text fg={index === recoveryConflictCursor ? theme.amber : theme.text} wrapMode="none">{fitText(conflict.path, Math.max(28, Math.floor(width * 0.54)))}</text>
              </box>
            ))}
          </scrollbox>
          <text fg={theme.dim}> Enter load recovered copy · d discard selected · D discard all · Esc keep</text>
        </box>
      ) : null}

      {shortcutsOpen ? (
        <box
          position="absolute"
          top={2}
          left={Math.max(2, Math.floor(width * 0.12))}
          width={Math.max(46, Math.min(width - 4, Math.floor(width * 0.76)))}
          height={Math.max(10, contentHeight - 1)}
          zIndex={80}
          border
          borderStyle="heavy"
          borderColor={theme.cyan}
          backgroundColor={theme.surface}
          flexDirection="column"
          title=" Keyboard shortcuts "
        >
          <scrollbox ref={shortcutsScrollRef} flexGrow={1} scrollAcceleration={scrollAcceleration}>
            {EDITOR_SHORTCUT_GROUPS.map((group) => (
              <box key={group.title} flexDirection="column" paddingX={1}>
                <text fg={theme.cyan} wrapMode="none">{group.title}</text>
                {group.entries.map(([binding, label]) => (
                  <box key={`${group.title}:${binding}`} flexDirection="row">
                    <text fg={theme.amber} wrapMode="none">{`  ${binding.padEnd(20)}`}</text>
                    <text fg={theme.text} wrapMode="none">{fitText(label, Math.max(16, Math.floor(width * 0.5)))}</text>
                  </box>
                ))}
                <text fg={theme.dim}> </text>
              </box>
            ))}
          </scrollbox>
          <box height={1} paddingX={1} backgroundColor={theme.surface2}>
            <text fg={theme.dim} wrapMode="none">↑↓ scroll · Esc closes</text>
          </box>
        </box>
      ) : null}

      {codeActions.length > 0 ? (
        <box
          position="absolute"
          top={Math.max(3, Math.floor(height * 0.2))}
          left={Math.max(3, Math.floor(width * 0.2))}
          width={Math.max(44, Math.min(width - 6, Math.floor(width * 0.6)))}
          height={Math.min(14, codeActions.length + 4)}
          zIndex={63}
          border
          borderStyle="heavy"
          borderColor={theme.amber}
          backgroundColor={theme.surface}
          flexDirection="column"
          title={` Code actions ${codeActionCursor + 1}/${codeActions.length} `}
        >
          <text fg={theme.dim}> Enter apply · ↑↓ select · Esc close</text>
          <scrollbox flexGrow={1} scrollAcceleration={scrollAcceleration}>
            {codeActions.map((action, index) => (
              <box
                key={`${action.title}:${action.kind ?? ''}:${index}`}
                height={1}
                paddingX={1}
                backgroundColor={index === codeActionCursor ? theme.surface3 : theme.surface}
                flexDirection="row"
                onMouseUp={(event: MouseEvent) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  void applyCodeAction(action)
                }}
              >
                <text fg={action.preferred ? theme.green : index === codeActionCursor ? theme.amber : theme.text}>{action.preferred ? '● ' : '◇ '}</text>
                <text fg={index === codeActionCursor ? theme.text : theme.muted} wrapMode="none">{fitText(action.title, Math.max(20, Math.floor(width * 0.38)))}</text>
                <box flexGrow={1} />
                <text fg={theme.dim} wrapMode="none">{fitText(action.kind ?? (action.edit ? 'edit' : 'command'), 18)}</text>
              </box>
            ))}
          </scrollbox>
        </box>
      ) : null}

      {ghostText && activeTab ? (
        <box position="absolute" top={ghostRow} left={ghostLeft} height={1} zIndex={40}>
          <text fg={theme.dim} wrapMode="none">{ghostText}</text>
        </box>
      ) : null}

      {completions.length > 0 && activeTab && focusPane === 'editor' ? (
        <box position="absolute" top={completionTop} left={completionLeft} width={completionPopupWidth} height={completionPopupHeight} zIndex={55} border borderStyle="rounded" borderColor={theme.violet} backgroundColor={theme.surface} flexDirection="column" title={` completions ${completionCursor + 1}/${completions.length} · ${completionEngaged ? '⏎/Tab accept' : 'Tab accept'} `}>
          <box flexGrow={1} flexDirection="row">
            <box width={showCompletionDetailPane ? completionListWidth : undefined} flexGrow={showCompletionDetailPane ? 0 : 1} flexDirection="column">
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
                    <text fg={index === completionCursor ? theme.text : theme.muted} wrapMode="none">{fitText(item.label, showCompletionDetailPane ? Math.max(8, completionListWidth - 5) : Math.max(8, completionPopupWidth - 18))}</text>
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
                <text fg={theme.cyan} wrapMode="none">{fitText(selectedCompletion.label, completionDetailTextWidth)}</text>
                {selectedCompletion.detail ? <text fg={theme.amber} wrapMode="none">{fitText(selectedCompletion.detail, completionDetailTextWidth)}</text> : null}
                {completionDocumentation.map((line, index) => <text key={`completion-detail:${index}`} fg={theme.text} wrapMode="none">{fitText(line, completionDetailTextWidth)}</text>)}
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
