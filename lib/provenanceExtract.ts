// Pure extraction of file-modifying tool calls from SessionMessages. Feeds the
// file_edits provenance index in sessionPersistence.ts: every Edit/Write/patch
// a provider reports is recorded with the lines it added, so current file
// contents can later be attributed back to the (session, turn) that wrote them.
//
// Provider shapes covered:
// - Claude SDK: Edit / MultiEdit / Write / NotebookEdit (file_path + strings)
// - Codex & OpenCode mappers: FileChange { changes: [{ path, kind, diff }] }
// - Codex apply_patch payloads (*** Add/Update File envelopes) and unified diffs
// - Copilot / Anthropic editor family: str_replace_editor (create/str_replace/insert)
// - Pi and other pass-through runtimes: edit/write with path + newText/content
//
// No DB or Node API imports — sessionPersistence consumes this at index time and
// lib/provenance.ts consumes the types at query time.

import type { ApiMessage, SessionMessage } from './types'

// Caps bound the index cost of pathological writes (generated bundles, lockfiles
// pasted through Write). Attribution degrades gracefully: only the head of a
// giant file is attributable, which is where humans actually read.
export const MAX_EDIT_LINES = 2000
const MAX_EDIT_CHARS = 200_000

export type FileEditKind = 'edit' | 'write' | 'patch' | 'touch'

export type ExtractedFileEdit = {
  /** tool_use id, used to drop edits whose tool_result reported an error. */
  toolUseId: string | null
  tool: string
  kind: FileEditKind
  filePath: string
  /** Lines this edit added, in order ('touch' = file known modified, lines unknown). */
  addedLines: string[]
}

const PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path', 'target_file', 'file']

function firstString(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function capLines(lines: string[]): string[] {
  const capped = lines.length > MAX_EDIT_LINES ? lines.slice(0, MAX_EDIT_LINES) : lines
  let total = 0
  for (let i = 0; i < capped.length; i++) {
    total += capped[i].length + 1
    if (total > MAX_EDIT_CHARS) return capped.slice(0, Math.max(i, 1))
  }
  return capped
}

function splitAdded(text: string): string[] {
  return capLines(text.split('\n'))
}

/** '+' lines of a single-file unified diff (or apply_patch file section). */
function addedLinesFromDiff(diff: string): string[] {
  const added: string[] = []
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1))
  }
  return capLines(added)
}

type PatchFileSegment = { path: string; addedLines: string[] }

/**
 * Split a multi-file patch into per-file added lines. Understands both plain
 * unified diffs ('+++ b/<path>' headers) and Codex apply_patch envelopes
 * ('*** Add File: <path>' / '*** Update File: <path>').
 */
function splitPatchByFile(patch: string): PatchFileSegment[] {
  const segments: PatchFileSegment[] = []
  let currentPath: string | null = null
  let added: string[] = []
  const flush = () => {
    if (currentPath) segments.push({ path: currentPath, addedLines: capLines(added) })
    currentPath = null
    added = []
  }
  for (const line of patch.split('\n')) {
    const applyPatchHeader = /^\*\*\* (?:Add|Update) File: (.+)$/.exec(line)
    if (applyPatchHeader) {
      flush()
      currentPath = applyPatchHeader[1].trim()
      continue
    }
    if (line.startsWith('*** ')) {
      // Delete File / Begin Patch / End Patch — none contribute added lines.
      flush()
      continue
    }
    if (line.startsWith('+++ ')) {
      flush()
      const raw = line.slice(4).trim()
      currentPath = raw === '/dev/null' ? null : raw.replace(/^b\//, '')
      continue
    }
    if (line.startsWith('--- ') || line.startsWith('diff --git ') || line.startsWith('index ') || line.startsWith('@@')) continue
    if (currentPath && line.startsWith('+')) added.push(line.slice(1))
  }
  flush()
  return segments
}

function extractFromToolUse(
  tool: string,
  input: Record<string, unknown>,
  toolUseId: string | null,
): ExtractedFileEdit[] {
  const lower = tool.toLowerCase()
  const make = (filePath: string, kind: FileEditKind, addedLines: string[]): ExtractedFileEdit => ({
    toolUseId,
    tool,
    kind,
    filePath: filePath.trim(),
    addedLines,
  })

  if (lower === 'filechange') {
    const changes = input.changes
    if (!Array.isArray(changes)) return []
    return changes.flatMap((change): ExtractedFileEdit[] => {
      if (!change || typeof change !== 'object') return []
      const c = change as Record<string, unknown>
      const changePath = typeof c.path === 'string' && c.path.trim() ? c.path : null
      if (!changePath) return []
      const diff = typeof c.diff === 'string' && c.diff ? c.diff : null
      return [diff ? make(changePath, 'patch', addedLinesFromDiff(diff)) : make(changePath, 'touch', [])]
    })
  }

  if (lower === 'apply_patch' || lower === 'applypatch' || lower === 'patch') {
    const patch = firstString(input, ['patch', 'diff', 'input', 'content'])
    if (!patch) return []
    return splitPatchByFile(patch).map((segment) => make(segment.path, 'patch', segment.addedLines))
  }

  if (lower === 'str_replace_editor' || lower === 'str_replace_based_edit_tool' || lower === 'text_editor') {
    const editorPath = firstString(input, PATH_KEYS)
    if (!editorPath) return []
    const command = typeof input.command === 'string' ? input.command : ''
    if (command === 'create') {
      const text = firstString(input, ['file_text', 'content', 'text'])
      return [text ? make(editorPath, 'write', splitAdded(text)) : make(editorPath, 'touch', [])]
    }
    if (command === 'str_replace' || command === 'insert') {
      const text = firstString(input, ['new_str', 'insert_text', 'text'])
      return [text ? make(editorPath, 'edit', splitAdded(text)) : make(editorPath, 'touch', [])]
    }
    return []
  }

  const filePath = firstString(input, PATH_KEYS)
  if (!filePath) return []

  if (lower === 'multiedit' || lower === 'multi_edit') {
    const rawEdits = input.edits
    if (!Array.isArray(rawEdits)) return []
    const added: string[] = []
    for (const entry of rawEdits) {
      if (!entry || typeof entry !== 'object') continue
      const text = firstString(entry as Record<string, unknown>, ['new_string', 'newString', 'newText', 'new_str'])
      if (text) added.push(...text.split('\n'))
    }
    return [make(filePath, 'edit', capLines(added))]
  }

  if (lower === 'edit' || lower === 'str_replace' || lower === 'edit_file' || lower === 'replace' || lower === 'notebookedit') {
    const text = firstString(input, ['new_string', 'newString', 'newText', 'new_str', 'new_source', 'newSource', 'replacement'])
    return [text ? make(filePath, 'edit', splitAdded(text)) : make(filePath, 'touch', [])]
  }

  if (
    lower === 'write' || lower === 'create' || lower === 'write_file' || lower === 'create_file' ||
    lower === 'writefile' || lower === 'save_file' || lower === 'add_file'
  ) {
    const text = firstString(input, ['content', 'file_text', 'contents', 'text', 'source', 'code'])
    return [text ? make(filePath, 'write', splitAdded(text)) : make(filePath, 'touch', [])]
  }

  return []
}

/** All file-modifying tool calls issued by an assistant message. */
export function extractFileEditsFromMessage(message: SessionMessage): ExtractedFileEdit[] {
  if (message.type !== 'assistant') return []
  const payload = message.message as Partial<ApiMessage>
  const content = payload?.content
  if (!Array.isArray(content)) return []
  const edits: ExtractedFileEdit[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as { type?: unknown; name?: unknown; id?: unknown; input?: unknown }
    if (b.type !== 'tool_use' || typeof b.name !== 'string' || !b.name) continue
    if (!b.input || typeof b.input !== 'object') continue
    const toolUseId = typeof b.id === 'string' && b.id ? b.id : null
    edits.push(...extractFromToolUse(b.name, b.input as Record<string, unknown>, toolUseId))
  }
  return edits
}

/**
 * The plain text of a user message, or null when the message is only tool
 * results / attachments. Used to carry "what was the prompt" onto every file
 * edit recorded for the turn it started.
 */
export function plainUserPromptText(message: SessionMessage): string | null {
  if (message.type !== 'user') return null
  const payload = message.message as Partial<ApiMessage>
  const content = payload?.content
  if (typeof content === 'string') return content.trim() || null
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as { type?: unknown; text?: unknown }
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) parts.push(b.text)
  }
  const joined = parts.join('\n').trim()
  return joined || null
}
