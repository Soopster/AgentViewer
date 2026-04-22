/** @jsxImportSource @opentui/react */
import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, startTransition, useState } from 'react'
import { spawn } from 'node:child_process'
import { GitPopover } from './GitPopover'
import { AnalyticsPopover } from './AnalyticsPopover'
import { RGBA, SyntaxStyle, MacOSScrollAccel } from '@opentui/core'
import type { ScrollBoxRenderable, SelectOption, TabSelectOption, TabSelectRenderable } from '@opentui/core'
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
import {
  formatProviderLabel,
  formatSessionProject,
  formatSessionTitle,
  formatTranscriptCard,
  type TuiTranscriptCard,
  type TuiTranscriptCardLine,
} from '../format'
import type { ThreadedMessage } from '../../lib/threading'
import {
  THEME,
  getProviderAccent,
  getThemePalette,
  setActiveTheme,
  type TuiDensity,
  type TuiThemeMode,
  type TuiThemePalette,
  type TuiTranscriptView,
} from '../theme'
import {
  patchTuiSession,
  readTuiDensity,
  readTuiFocusMode,
  readTuiProvider,
  readTuiRailVisible,
  readTuiSessionDetail,
  readTuiSessionReaderState,
  readTuiSessions,
  readTuiSidebarSort,
  readTuiSidebarWidth,
  readTuiShowToolCalls,
  readTuiTabsEnabled,
  readTuiTheme,
  readTuiTranscriptView,
  writeTuiDensity,
  writeTuiFocusMode,
  writeTuiProvider,
  writeTuiRailVisible,
  writeTuiSessionReaderState,
  writeTuiShowToolCalls,
  writeTuiSidebarSort,
  writeTuiSidebarWidth,
  writeTuiTabsEnabled,
  writeTuiTheme,
  writeTuiThemeSync,
  writeTuiTranscriptView,
  type TuiSessionDetail,
  type TuiSidebarSort,
} from '../../lib/tui/service'
import { readTuiSessionMetadataAsync } from './metadataWorkerClient'
import { readTuiSessionDetailAsync } from './sessionDetailWorkerClient'
import type { TuiSessionReaderState } from '../../lib/tuiState'
import type { ProviderSelection, RunningSessionRef, SendState, Session } from '../../lib/types'

const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']

function Spinner({ label, fg }: { label: string; fg: string }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80)
    return () => clearInterval(id)
  }, [])
  return <text fg={fg}>{`${SPINNER_FRAMES[frame]} ${label}`}</text>
}

const PROVIDERS: ProviderSelection[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'all']
const LIGHT_MODES: TuiThemeMode[] = [
  'light',
  'paper',
  'github-light',
  'solarized-light',
  'gruvbox-light',
  'catppuccin-latte',
  'rose-pine-dawn',
  'ayu-light',
  'one-light',
  'everforest-light',
  'tokyo-night-day',
  'quiet-light',
  'horizon-light',
  'imessage',
]
const DARK_MODES: TuiThemeMode[] = [
  'dark',
  'solarized-dark',
  'nord',
  'gruvbox-dark',
  'dracula',
  'tokyo-night',
  'catppuccin-mocha',
  'one-dark',
  'monokai',
  'kanagawa',
  'everforest-dark',
  'obsidian',
  'github-dark',
  'ayu-dark',
  'rose-pine',
  'palenight',
  'night-owl',
  'synthwave',
  'cyber',
]
const THEMES: TuiThemeMode[] = [...LIGHT_MODES, ...DARK_MODES]
const THEME_GROUPS: Array<{ label: string; themes: TuiThemeMode[] }> = [
  { label: 'LIGHT', themes: LIGHT_MODES },
  { label: 'DARK', themes: DARK_MODES },
]
const SEARCH_MAX_CHARS = 80
const SESSION_REFRESH_MS = 5000
const DETAIL_REFRESH_MS = 2000
const RUNNING_SESSION_REFRESH_MS = 1500
const DEFAULT_SIDEBAR_WIDTH = 32
const SIDEBAR_RESIZE_STEP = 2
const MIN_SIDEBAR_WIDTH = 28
const MIN_READER_WIDTH = 40
const SESSION_CACHE_LIMIT = 8
const MESSAGE_SCROLL_ACCEL = new MacOSScrollAccel()

type PaneFocus = 'sessions' | 'messages'

type CardLandmark = {
  kind: 'resume' | 'unread' | 'day' | 'gap'
  text: string
}

// Stable per-card data: expensive to compute, independent of landmark indices and search.
type StableCardData = {
  bodyLines: TuiTranscriptCardLine[]
  diffText: string | null
  diffLineCount: number
  codeBlockLineCounts: number[]
}

type CardDisplayData = {
  landmarks: CardLandmark[]
  bodyLines: TuiTranscriptCardLine[]
  diffText: string | null
  diffLineCount: number
  codeBlockLineCounts: number[]
  headerMeta: string
  isSearchHit: boolean
  accent: string
  isThinkingCard: boolean
  categoryEmoji: string
  isInsight: boolean
  markdownFallbackLines: string[] | null
}

type NoticeTone = 'info' | 'error'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

async function writeClipboard(text: string): Promise<void> {
  const tryCommand = (command: string, args: readonly string[] = []): Promise<void> => (
    new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        stdio: ['pipe', 'ignore', 'pipe'],
      })

      let stderr = ''
      child.on('error', reject)
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.on('close', (code) => {
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(stderr.trim() || `Clipboard command failed: ${command}`))
      })
      child.stdin.end(text)
    })
  )

  const platform = process.platform
  const candidates = platform === 'darwin'
    ? [['pbcopy', []] as const]
    : platform === 'win32'
    ? [['clip', []] as const, ['powershell', ['-Command', 'Set-Clipboard']] as const]
    : [
        ['wl-copy', []] as const,
        ['xclip', ['-selection', 'clipboard']] as const,
        ['xsel', ['--clipboard', '--input']] as const,
      ]

  let lastError: Error | null = null
  for (const [command, args] of candidates) {
    try {
      await tryCommand(command, args)
      return
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  throw lastError ?? new Error('No clipboard command available')
}

function cardClipboardText(card: TuiTranscriptCard): string {
  const sections: string[] = []
  const mainBody = card.markdownContent
    ?? card.expandedLines.map((line) => line.text).join('\n').trim()

  if (mainBody) sections.push(mainBody)

  if (card.codeBlocks?.length) {
    for (const block of card.codeBlocks) {
      sections.push(`\`\`\`${block.lang}\n${block.content}\n\`\`\``)
    }
  }

  if (card.editDiff) {
    sections.push(card.editDiff)
  }

  return sections.join('\n\n').trim()
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function renderContextBar(totalTokens: number, maxTokens: number, percentage: number, barWidth = 10): string {
  const filled = Math.round((percentage / 100) * barWidth)
  const bar = '▓'.repeat(filled) + '░'.repeat(barWidth - filled)
  return `${fmtTokens(totalTokens)} / ${fmtTokens(maxTokens)}  ${bar}  ${percentage}%`
}

function contextBarColor(percentage: number, theme: TuiThemePalette): string {
  if (percentage >= 80) return theme.red
  if (percentage >= 60) return theme.amber
  return theme.green
}

function joinMeta(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join('  ·  ')
}

function fitText(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length <= width) return value.padEnd(width, ' ')
  if (width === 1) return value.slice(0, 1)
  return `${value.slice(0, width - 1)}…`
}

function timeAgo(value?: string | number): string {
  if (value == null) return ''
  const ms = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(ms)) return ''
  const minutes = Math.max(Math.round(ms / 60_000), 0)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

const COMPOSER_HEIGHT = 3
const TRANSCRIPT_TOP_MARGIN = 2
const API_BASE_URL = process.env.AGENT_VIEWER_BASE_URL ?? 'http://localhost:3000'
// Metadata refresh is intentionally slow because Claude control queries are
// expensive and can still cause main-thread pressure when they complete.
const CLAUDE_METADATA_REFRESH_MS = 5 * 60_000
const DEFAULT_METADATA_REFRESH_MS = 60_000
const CLAUDE_BACKGROUND_METADATA_REFRESH_MS = 30 * 60_000
const DEFAULT_BACKGROUND_METADATA_REFRESH_MS = 5 * 60_000
const METADATA_REQUEST_TIMEOUT_MS = 4_000

function buildApiUrl(path: string): string {
  return new URL(path, API_BASE_URL).toString()
}

type SseFrame = {
  event: string
  data: string
}

function extractSseFrames(buffer: string): { frames: SseFrame[]; remaining: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const frames: SseFrame[] = []
  let cursor = 0

  while (true) {
    const boundary = normalized.indexOf('\n\n', cursor)
    if (boundary === -1) break

    const rawFrame = normalized.slice(cursor, boundary)
    cursor = boundary + 2

    let event = 'message'
    const dataLines: string[] = []

    for (const line of rawFrame.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }

    if (dataLines.length > 0) {
      frames.push({ event, data: dataLines.join('\n') })
    }
  }

  return {
    frames,
    remaining: normalized.slice(cursor),
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string'
        ? [record.text]
        : []
    })
    .join('\n\n')
    .trim()
}

function extractStreamingAssistantText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_agent_message_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  if ((record.type === 'codex_plan_delta' || record.type === 'codex_reasoning_delta' || record.type === 'codex_reasoning_summary_delta')
    && typeof record.delta === 'string') {
    return record.delta
  }

  if (record.type === 'codex_realtime_transcript') {
    return record.role === 'assistant' && typeof record.text === 'string'
      ? record.text
      : null
  }

  if (record.type === 'codex_realtime_item_added') {
    const item = record.item
    if (!item || typeof item !== 'object') return null
    const itemRecord = item as Record<string, unknown>
    if ((itemRecord.type === 'agentMessage' || itemRecord.type === 'plan') && typeof itemRecord.text === 'string') {
      return itemRecord.text
    }
    return null
  }

  if (record.type === 'codex_item_completed') {
    const item = record.item
    if (!item || typeof item !== 'object') return null
    const itemRecord = item as Record<string, unknown>
    return itemRecord.type === 'agentMessage' && typeof itemRecord.text === 'string'
      ? itemRecord.text
      : itemRecord.type === 'plan' && typeof itemRecord.text === 'string'
      ? itemRecord.text
      : null
  }

  if (record.type === 'stream_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'content_block_delta') return null

    const delta = eventRecord.delta
    if (!delta || typeof delta !== 'object') return null
    const deltaRecord = delta as Record<string, unknown>
    return deltaRecord.type === 'text_delta' && typeof deltaRecord.text === 'string'
      ? deltaRecord.text
      : null
  }

  if (record.type === 'opencode_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    const properties = eventRecord.properties
    if (!properties || typeof properties !== 'object') return null
    const propertiesRecord = properties as Record<string, unknown>
    if (eventRecord.type === 'message.part.delta') {
      const field = typeof propertiesRecord.field === 'string' ? propertiesRecord.field : ''
      return field === 'text' && typeof propertiesRecord.delta === 'string'
        ? propertiesRecord.delta
        : null
    }

    if (eventRecord.type !== 'message.part.updated') return null
    const part = propertiesRecord.part
    if (!part || typeof part !== 'object') return null
    const partRecord = part as Record<string, unknown>

    return partRecord.type === 'text' && typeof partRecord.text === 'string'
      ? partRecord.text
      : null
  }

  if (record.type === 'copilot_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>

    if (eventRecord.type === 'assistant.message_delta') {
      const data = eventRecord.data
      if (!data || typeof data !== 'object') return null
      const dataRecord = data as Record<string, unknown>
      return typeof dataRecord.deltaContent === 'string' ? dataRecord.deltaContent : null
    }

    if (eventRecord.type === 'assistant.message') {
      const data = eventRecord.data
      if (!data || typeof data !== 'object') return null
      const dataRecord = data as Record<string, unknown>
      return typeof dataRecord.content === 'string' ? dataRecord.content : null
    }

    return null
  }

  if (record.type === 'pi_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>

    if (eventRecord.type === 'message_update') {
      const assistantMessageEvent = eventRecord.assistantMessageEvent
      if (!assistantMessageEvent || typeof assistantMessageEvent !== 'object') return null
      const updateRecord = assistantMessageEvent as Record<string, unknown>

      if (updateRecord.type === 'text_delta' && typeof updateRecord.delta === 'string') {
        return updateRecord.delta
      }

      if ((updateRecord.type === 'done' || updateRecord.type === 'error')) {
        const finalMessage = updateRecord.type === 'done'
          ? updateRecord.message
          : updateRecord.error
        if (!finalMessage || typeof finalMessage !== 'object') return null
        const finalRecord = finalMessage as Record<string, unknown>
        return extractTextContent(finalRecord.content)
          || (typeof finalRecord.errorMessage === 'string' ? finalRecord.errorMessage : null)
      }
    }

    if (eventRecord.type === 'message_end') {
      const message = eventRecord.message
      if (!message || typeof message !== 'object') return null
      const messageRecord = message as Record<string, unknown>
      return messageRecord.role === 'assistant'
        ? extractTextContent(messageRecord.content)
          || (typeof messageRecord.errorMessage === 'string' ? messageRecord.errorMessage : null)
        : null
    }

    return null
  }

  if (record.type === 'assistant') {
    const message = record.message
    if (!message || typeof message !== 'object') return null
    const text = extractTextContent((message as Record<string, unknown>).content)
    return text || null
  }

  return null
}

function shouldReplaceLiveAssistantText(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  if (record.type === 'assistant') return true
  if (record.type === 'codex_realtime_transcript') return true
  if (record.type === 'codex_realtime_item_added') return true
  if (record.type === 'codex_item_completed') {
    const item = record.item
    if (!item || typeof item !== 'object') return false
    return !!((item as Record<string, unknown>).type === 'agentMessage' || (item as Record<string, unknown>).type === 'plan')
  }
  if (record.type === 'opencode_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return false
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'message.part.updated') return false
    const properties = eventRecord.properties
    if (!properties || typeof properties !== 'object') return false
    const part = (properties as Record<string, unknown>).part
    if (!part || typeof part !== 'object') return false
    return (part as Record<string, unknown>).type === 'text'
  }
  if (record.type === 'pi_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return false
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type === 'message_end') {
      const message = eventRecord.message
      return !!message && typeof message === 'object' && (message as Record<string, unknown>).role === 'assistant'
    }
    if (eventRecord.type !== 'message_update') return false
    const assistantMessageEvent = eventRecord.assistantMessageEvent
    if (!assistantMessageEvent || typeof assistantMessageEvent !== 'object') return false
    const updateRecord = assistantMessageEvent as Record<string, unknown>
    return updateRecord.type === 'done' || updateRecord.type === 'error'
  }
  if (record.type !== 'copilot_event') return false
  const event = record.event
  if (!event || typeof event !== 'object') return false
  return (event as Record<string, unknown>).type === 'assistant.message'
}

function formatTimeGap(deltaMs: number): string | null {
  if (!Number.isFinite(deltaMs) || deltaMs < 30 * 60 * 1000) return null
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 90) return `${minutes}m later`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours}h later`
  return `${Math.round(hours / 24)}d later`
}

function sessionKey(session: Pick<Session, 'sessionId' | 'provider'>): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

// Stable content-equality check for the sessions list. The sidebar refresh
// fires every 5s and the running-session poll every 1.5s — returning the
// same array reference when nothing materially changed avoids invalidating
// the entire downstream memo chain (sidebarEntries, projectCount, tabs, …)
// and, more importantly, avoids rebuilding callbacks/intervals that list
// `sessions` or `runningSessions` in their deps.
function sessionsShallowEqual(a: Session[], b: Session[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const prev = a[i]
    const next = b[i]
    if (
      prev.sessionId !== next.sessionId
      || prev.provider !== next.provider
      || prev.lastModified !== next.lastModified
      || prev.customTitle !== next.customTitle
      || prev.summary !== next.summary
      || prev.cwd !== next.cwd
      || prev.tag !== next.tag
    ) return false
  }
  return true
}

function runningSessionsEqual(a: RunningSessionRef[], b: RunningSessionRef[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].sessionId !== b[i].sessionId || a[i].provider !== b[i].provider) return false
  }
  return true
}

const sessionMessageFingerprintCache = new WeakMap<object, string>()
function sessionMessageFingerprint(message: import('../../lib/types').SessionMessage | undefined): string | null {
  if (!message) return null
  const cached = sessionMessageFingerprintCache.get(message)
  if (cached !== undefined) return cached
  let payload = ''
  try {
    payload = JSON.stringify(message.message)
  } catch {
    payload = String(message.message)
  }
  const fingerprint = [
    message.type,
    message.uuid,
    message.timestamp ?? '',
    message.turnId ?? '',
    message.origin?.kind ?? '',
    payload,
  ].join('|')
  sessionMessageFingerprintCache.set(message, fingerprint)
  return fingerprint
}

type SidebarEntry =
  | { type: 'project'; key: string; projectName: string; count: number }
  | { type: 'session'; key: string; session: Session; absoluteIndex: number }

function buildSidebarEntries(sessions: Session[], sort: TuiSidebarSort): SidebarEntry[] {
  const entries: SidebarEntry[] = []

  if (sort === 'time') {
    // Sessions stay in global time-sort order. A project header is injected before
    // each run of consecutive sessions that share a project name.
    let prevProject = ''
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i]
      const projectName = formatSessionProject(session).toUpperCase()
      if (projectName !== prevProject) {
        // Measure the length of this consecutive run so the header can show a count.
        let run = 1
        while (
          i + run < sessions.length
          && formatSessionProject(sessions[i + run]).toUpperCase() === projectName
        ) run++
        // Key includes the absolute index so the same project appearing multiple
        // times in time-order gets distinct keys (required by the reconciler).
        entries.push({ type: 'project', key: `project:${projectName}:${i}`, projectName, count: run })
        prevProject = projectName
      }
      entries.push({
        type: 'session',
        key: `session:${session.provider ?? 'claude'}:${session.sessionId}`,
        session,
        absoluteIndex: i,
      })
    }
    return entries
  }

  // 'project' mode: group sessions by project, preserving time-sort order within each
  // group. Groups are ordered by the most-recently modified session they contain.
  const groupOrder: string[] = []
  const groups = new Map<string, Array<{ session: Session; absoluteIndex: number }>>()
  sessions.forEach((session, absoluteIndex) => {
    const projectName = formatSessionProject(session).toUpperCase()
    if (!groups.has(projectName)) {
      groups.set(projectName, [])
      groupOrder.push(projectName)
    }
    groups.get(projectName)!.push({ session, absoluteIndex })
  })

  for (const projectName of groupOrder) {
    const members = groups.get(projectName)!
    entries.push({ type: 'project', key: `project:${projectName}`, projectName, count: members.length })
    for (const { session, absoluteIndex } of members) {
      entries.push({
        type: 'session',
        key: `session:${session.provider ?? 'claude'}:${session.sessionId}`,
        session,
        absoluteIndex,
      })
    }
  }
  return entries
}


function findCardIndex(cards: TuiTranscriptCard[], key: string | null): number {
  if (!key) return -1
  return cards.findIndex((card) => card.key === key)
}

function densityConfig(density: TuiDensity): {
  cardGap: number
  bodyIndent: number
  bodyLines: number
  headerRows: number
} {
  switch (density) {
    case 'comfortable':
      return { cardGap: 1, bodyIndent: 3, bodyLines: 6, headerRows: 2 }
    case 'dense':
      return { cardGap: 0, bodyIndent: 1, bodyLines: 12, headerRows: 1 }
    default:
      return { cardGap: 1, bodyIndent: 2, bodyLines: 8, headerRows: 2 }
  }
}

function buildSyntaxStyle(theme: TuiThemePalette): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    keyword:     { fg: RGBA.fromHex(theme.violet), bold: true },
    string:      { fg: RGBA.fromHex(theme.green) },
    comment:     { fg: RGBA.fromHex(theme.dim), italic: true, dim: true },
    number:      { fg: RGBA.fromHex(theme.amber) },
    function:    { fg: RGBA.fromHex(theme.cyan) },
    type:        { fg: RGBA.fromHex(theme.pink) },
    operator:    { fg: RGBA.fromHex(theme.muted) },
    punctuation: { fg: RGBA.fromHex(theme.muted) },
    default:     { fg: RGBA.fromHex(theme.text) },
  })
}

function transcriptAccent(cardRole: 'user' | 'assistant' | 'system', provider: ProviderSelection | undefined): string {
  if (cardRole === 'user') return THEME.green
  if (cardRole === 'system') return THEME.dim
  return getProviderAccent(provider ?? 'claude')
}

function transcriptColor(line: TuiTranscriptCardLine, theme: TuiThemePalette): string {
  switch (line.tone) {
    case 'tool':
      return theme.cyan
    case 'agent':
      return theme.violet
    case 'result_ok':
      return theme.green
    case 'result_error':
      return theme.red
    case 'thinking':
      return theme.violet
    case 'system':
      return theme.amber
    case 'diff_add':
      return theme.green
    case 'diff_remove':
      return theme.red
    case 'diff_meta':
      return theme.cyan
    case 'muted':
      return theme.muted
    case 'dim':
      return theme.dim
    default:
      return theme.text
  }
}

function transcriptBackground(line: TuiTranscriptCardLine, theme: TuiThemePalette): string | undefined {
  switch (line.tone) {
    case 'result_ok':
      return theme.diffAddBg
    case 'result_error':
      return theme.diffRemoveBg
    case 'diff_add':
      return theme.diffAddBg
    case 'diff_remove':
      return theme.diffRemoveBg
    case 'diff_meta':
      return theme.diffMetaBg
    default:
      return undefined
  }
}

const EMPTY_LANDMARKS: CardLandmark[] = []

function landmarksEqual(a: CardLandmark[], b: CardLandmark[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].kind !== b[i].kind || a[i].text !== b[i].text) return false
  }
  return true
}

function computeAllLandmarks(
  cards: TuiTranscriptCard[],
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number,
  previous: CardLandmark[][] | null,
): CardLandmark[][] {
  const result: CardLandmark[][] = new Array(cards.length)
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const prev = i > 0 ? cards[i - 1] : null
    let landmarks: CardLandmark[] | null = null

    if (i === resumeMarkerIndex) {
      landmarks = landmarks ?? []
      landmarks.push({ kind: 'resume', text: 'LAST READ POSITION' })
    }

    if (i === unreadBoundaryIndex && pendingNewCount > 0) {
      landmarks = landmarks ?? []
      landmarks.push({
        kind: 'unread',
        text: `NEW SINCE LAST READ  ${pendingNewCount} message${pendingNewCount === 1 ? '' : 's'}`,
      })
    }

    if (!prev || prev.dayKey !== card.dayKey) {
      if (card.dayLabel) {
        landmarks = landmarks ?? []
        landmarks.push({ kind: 'day', text: card.dayLabel.toUpperCase() })
      }
    } else if (card.timestampMs != null && prev.timestampMs != null) {
      const gap = formatTimeGap(card.timestampMs - prev.timestampMs)
      if (gap) {
        landmarks = landmarks ?? []
        landmarks.push({ kind: 'gap', text: gap.toUpperCase() })
      }
    }

    const next = landmarks ?? EMPTY_LANDMARKS
    const prevEntry = previous?.[i]
    result[i] = prevEntry && landmarksEqual(prevEntry, next) ? prevEntry : next
  }
  return result
}

function transcriptLandmarks(
  cards: TuiTranscriptCard[],
  index: number,
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number,
): CardLandmark[] {
  const card = cards[index]
  if (!card) return []
  const previous = index > 0 ? cards[index - 1] : null
  const landmarks: CardLandmark[] = []

  if (index === resumeMarkerIndex) {
    landmarks.push({ kind: 'resume', text: 'LAST READ POSITION' })
  }

  if (index === unreadBoundaryIndex && pendingNewCount > 0) {
    landmarks.push({
      kind: 'unread',
      text: `NEW SINCE LAST READ  ${pendingNewCount} message${pendingNewCount === 1 ? '' : 's'}`,
    })
  }

  if (!previous || previous.dayKey !== card.dayKey) {
    if (card.dayLabel) landmarks.push({ kind: 'day', text: card.dayLabel.toUpperCase() })
  } else if (card.timestampMs != null && previous.timestampMs != null) {
    const gap = formatTimeGap(card.timestampMs - previous.timestampMs)
    if (gap) landmarks.push({ kind: 'gap', text: gap.toUpperCase() })
  }

  return landmarks
}

function renderedBodyLines(
  card: TuiTranscriptCard,
  isExpanded: boolean,
  previewLimit: number,
  thinkingFull: boolean = false,
): TuiTranscriptCardLine[] {
  const pretendExpanded = isExpanded || thinkingFull
  const source = pretendExpanded ? card.expandedLines : card.lines
  let base: TuiTranscriptCardLine[]
  if (pretendExpanded) {
    base = source.filter((line) => !['diff_add', 'diff_remove', 'diff_meta'].includes(line.tone))
  } else if (card.category === 'diff') {
    // Keep diff_meta (file path header) but strip raw diff lines — <diff> renders those
    base = source.filter((line) => line.tone !== 'diff_add' && line.tone !== 'diff_remove')
  } else {
    base = source.slice(0, previewLimit)
  }
  return base.length > 0 ? base : [{ text: 'No visible content', tone: 'dim' }]
}

function cardDiffText(card: TuiTranscriptCard, isExpanded: boolean): string | null {
  if (card.category !== 'diff' && !isExpanded) return null
  const raw = card.editDiff ?? extractDiffText(card.expandedLines)
  return raw ? rewriteHunkCounts(raw) : null
}

function cardDiffRows(card: TuiTranscriptCard, isExpanded: boolean, previewLimit: number): number {
  const diffText = cardDiffText(card, isExpanded)
  if (!diffText) return 0
  const lineCount = diffText.split('\n').length
  const maxHeight = isExpanded ? Math.max(lineCount + 2, 4) : previewLimit
  return Math.min(maxHeight, Math.max(lineCount + 2, 4)) + 1
}

function codeBlockRows(card: TuiTranscriptCard, isExpanded: boolean): number {
  if (!isExpanded || !card.codeBlocks?.length) return 0
  return card.codeBlocks.reduce((sum, cb) =>
    sum + 1 + Math.min(cb.content.split('\n').length + 1, 20) + 1, 0)
}

function cardHeight(
  cards: TuiTranscriptCard[],
  index: number,
  expandedKeys: Set<string>,
  previewLimit: number,
  cardGap: number,
  resumeMarkerIndex: number,
  unreadBoundaryIndex: number,
  pendingNewCount: number,
  thinkingFullKeys: Set<string>,
): number {
  const card = cards[index]
  const isExpanded = expandedKeys.has(card.key)
  const thinkingFull = thinkingFullKeys.has(card.key)
  const useMarkdown = isExpanded && !!card.markdownContent
  const landmarkRows = transcriptLandmarks(cards, index, resumeMarkerIndex, unreadBoundaryIndex, pendingNewCount).length
  const bodyRows = useMarkdown ? 0 : renderedBodyLines(card, isExpanded, previewLimit, thinkingFull).length
  const diffRows = cardDiffRows(card, isExpanded, previewLimit)
  const codeRows = useMarkdown ? 0 : codeBlockRows(card, isExpanded)
  const mdRows = useMarkdown ? card.markdownContent!.split('\n').length : 0
  const borderRows = 2
  const bodyPaddingBottom = 1
  return landmarkRows + borderRows + bodyPaddingBottom + bodyRows + diffRows + codeRows + mdRows + cardGap
}

function cycleDensityValue(current: TuiDensity): TuiDensity {
  return current === 'comfortable'
    ? 'balanced'
    : current === 'balanced'
    ? 'dense'
    : 'comfortable'
}

function cycleTranscriptViewValue(current: TuiTranscriptView): TuiTranscriptView {
  return current === 'conversation' ? 'full' : 'conversation'
}

const PROVIDER_SELECT_OPTIONS: SelectOption[] = PROVIDERS.map((provider) => ({
  name: provider.toUpperCase(),
  description: provider === 'all' ? 'All providers' : `${provider} sessions`,
  value: provider,
}))

const THEME_DESCRIPTIONS: Record<TuiThemeMode, string> = {
  light: 'Crisp white background',
  paper: 'Warm off-white',
  'github-light': 'GitHub neutral light',
  'solarized-light': 'Solarized cream',
  'gruvbox-light': 'Gruvbox retro cream',
  'catppuccin-latte': 'Catppuccin pastel latte',
  'rose-pine-dawn': 'Rosé Pine muted dawn',
  'ayu-light': 'Ayu warm light',
  'one-light': 'Atom One light',
  'everforest-light': 'Everforest warm light',
  'tokyo-night-day': 'Tokyo Night daylight',
  'quiet-light': 'Subdued VS Code quiet',
  'horizon-light': 'Horizon warm pastel',
  imessage: 'iOS Messages bubbles',
  dark: 'Deep navy background',
  'solarized-dark': 'Solarized teal',
  nord: 'Cool arctic greys',
  'gruvbox-dark': 'Gruvbox retro dark',
  dracula: 'Purple-heavy dracula',
  'tokyo-night': 'Tokyo Night indigo',
  'catppuccin-mocha': 'Catppuccin pastel mocha',
  'one-dark': 'Atom One dark',
  monokai: 'Monokai classic',
  kanagawa: 'Kanagawa muted waves',
  'everforest-dark': 'Everforest forest dark',
  obsidian: 'Pure black minimal',
  'github-dark': 'GitHub neutral dark',
  'ayu-dark': 'Ayu warm dark',
  'rose-pine': 'Rosé Pine moody',
  synthwave: 'Synthwave neon nights',
  palenight: 'Material Palenight',
  'night-owl': 'Night Owl deep teal',
  cyber: 'Neon accents',
}

const THEME_LABELS: Record<TuiThemeMode, string> = {
  light: 'LIGHT',
  paper: 'PAPER',
  'github-light': 'GITHUB LIGHT',
  'solarized-light': 'SOLARIZED LIGHT',
  'gruvbox-light': 'GRUVBOX LIGHT',
  'catppuccin-latte': 'CATPPUCCIN LATTE',
  'rose-pine-dawn': 'ROSÉ PINE DAWN',
  'ayu-light': 'AYU LIGHT',
  'one-light': 'ONE LIGHT',
  'everforest-light': 'EVERFOREST LIGHT',
  'tokyo-night-day': 'TOKYO NIGHT DAY',
  'quiet-light': 'QUIET LIGHT',
  'horizon-light': 'HORIZON LIGHT',
  imessage: 'iMESSAGE',
  dark: 'DARK',
  'solarized-dark': 'SOLARIZED DARK',
  nord: 'NORD',
  'gruvbox-dark': 'GRUVBOX DARK',
  dracula: 'DRACULA',
  'tokyo-night': 'TOKYO NIGHT',
  'catppuccin-mocha': 'CATPPUCCIN MOCHA',
  'one-dark': 'ONE DARK',
  monokai: 'MONOKAI',
  kanagawa: 'KANAGAWA',
  'everforest-dark': 'EVERFOREST DARK',
  obsidian: 'OBSIDIAN',
  'github-dark': 'GITHUB DARK',
  'ayu-dark': 'AYU DARK',
  'rose-pine': 'ROSÉ PINE',
  synthwave: 'SYNTHWAVE',
  palenight: 'PALENIGHT',
  'night-owl': 'NIGHT OWL',
  cyber: 'CYBER',
}

type PaletteCommand = { id: string; label: string; key: string; category: string }
type PaletteRow =
  | { kind: 'header'; label: string }
  | { kind: 'cmd'; cmd: PaletteCommand; cmdIndex: number }

const COMMANDS: PaletteCommand[] = [
  // Navigation
  { id: 'live',       label: 'Jump to live tail',      key: 'f',  category: 'Navigation' },
  { id: 'unread',     label: 'Jump to first unread',   key: 'u',  category: 'Navigation' },
  { id: 'mark',       label: 'Mark position',          key: 'm',  category: 'Navigation' },
  // Transcript
  { id: 'search',     label: 'Search messages',        key: '/',  category: 'Transcript' },
  { id: 'fold',       label: 'Fold/expand card',       key: 'e',  category: 'Transcript' },
  { id: 'copy',       label: 'Copy selected message',  key: 'y',  category: 'Transcript' },
  // Session
  { id: 'composer',   label: 'Open composer',          key: 'c',  category: 'Session'    },
  { id: 'rename',     label: 'Rename session',         key: '^R', category: 'Session'    },
  { id: 'git',        label: 'Git status',             key: '^G', category: 'Session'    },
  { id: 'analytics',  label: 'Session analytics',      key: '^A', category: 'Session'    },
  { id: 'provider',   label: 'Switch provider',        key: 'p',  category: 'Session'    },
  { id: 'sort',       label: 'Toggle sidebar sort',    key: 'S',  category: 'Session'    },
  // Tabs
  { id: 'tab-toggle', label: 'Toggle tab bar',         key: 'b',  category: 'Tabs'       },
  { id: 'tab-prev',   label: 'Previous tab',           key: '←',  category: 'Tabs'       },
  { id: 'tab-next',   label: 'Next tab',               key: '→',  category: 'Tabs'       },
  { id: 'tab-close',  label: 'Close current tab',      key: 'w',  category: 'Tabs'       },
  // View
  { id: 'theme',      label: 'Switch theme',           key: 't',  category: 'View'       },
  { id: 'thinking',   label: 'Toggle thinking mode',   key: 'T',  category: 'View'       },
  { id: 'density',    label: 'Toggle density',         key: 'd',  category: 'View'       },
  { id: 'view',       label: 'Toggle transcript view', key: 'v',  category: 'View'       },
  { id: 'rail',       label: 'Toggle session rail',    key: 'h',  category: 'View'       },
  { id: 'focus',      label: 'Toggle focus mode',      key: 'z',  category: 'View'       },
  { id: 'tools',      label: 'Toggle tool calls',      key: 'X',  category: 'View'       },
  // App
  { id: 'refresh',    label: 'Refresh sessions',       key: 'r',  category: 'App'        },
  { id: 'quit',       label: 'Quit',                   key: 'q',  category: 'App'        },
]

function extractDiffText(lines: TuiTranscriptCardLine[]): string | null {
  const diffLines = lines
    .filter((line) => {
      if (line.tone === 'diff_add' || line.tone === 'diff_remove') return true
      if (line.tone === 'diff_meta') {
        const t = line.text
        return t.startsWith('@@') || t.startsWith('--- ') || t.startsWith('+++ ')
          || t.startsWith('diff --git') || t.startsWith('index ')
      }
      return false
    })
    .map((line) => line.text)
  return diffLines.length > 0 ? diffLines.join('\n') : null
}

/**
 * Rewrite @@ hunk headers with counts that match the actual body content.
 * Necessary because previewDiff strips context lines, leaving the original
 * (context-aware) counts larger than the lines that remain.
 */
function rewriteHunkCounts(diff: string): string {
  const raw = diff.split('\n')
  const out: string[] = []
  let i = 0
  while (i < raw.length) {
    const l = raw[i]
    if (!l.startsWith('@@')) {
      out.push(l)
      i++
      continue
    }
    let j = i + 1
    while (j < raw.length && !raw[j].startsWith('@@')) j++
    const body = raw.slice(i + 1, j)
    let oldCount = 0
    let newCount = 0
    for (const bl of body) {
      if (!bl || bl === '\\ No newline at end of file') continue
      if (bl.startsWith('-')) oldCount++
      else if (bl.startsWith('+')) newCount++
      else { oldCount++; newCount++ }
    }
    const m = l.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
    out.push(m ? `@@ -${m[1]},${oldCount} +${m[2]},${newCount} @@${m[3] ?? ''}` : l)
    out.push(...body)
    i = j
  }
  return out.join('\n')
}

function currentProjectName(session: Session | null): string {
  return session ? formatSessionProject(session) : 'no-project'
}

function touchMapEntry<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.has(key)) map.delete(key)
  map.set(key, value)
}

function pruneSessionCaches(
  detailCache: Map<string, TuiSessionDetail>,
  usageCache: Map<string, import('../../lib/types').ContextUsage | null>,
  metadataFetchedAt: Map<string, number>,
  pinnedKeys: Set<string>,
  limit = SESSION_CACHE_LIMIT,
): void {
  const orderedKeys = [
    ...detailCache.keys(),
    ...usageCache.keys(),
    ...metadataFetchedAt.keys(),
  ].filter((key, index, keys) => keys.indexOf(key) === index)

  let evictableCount = orderedKeys.filter((key) => !pinnedKeys.has(key)).length
  if (evictableCount <= limit) return

  for (const key of orderedKeys) {
    if (pinnedKeys.has(key)) continue
    detailCache.delete(key)
    usageCache.delete(key)
    metadataFetchedAt.delete(key)
    evictableCount -= 1
    if (evictableCount <= limit) break
  }
}

type DensityState = { bodyLines: number; bodyIndent: number; cardGap: number }

type TranscriptCardProps = {
  card: TuiTranscriptCard
  display: CardDisplayData
  theme: TuiThemePalette
  densityState: DensityState
  syntaxStyle: SyntaxStyle | null
  rightPaneWidth: number
  isExpanded: boolean
  hasCursor: boolean
  isSelected: boolean
  isActiveMatch: boolean
  thinkingMode: boolean
  imessageStyle: boolean
}

function TranscriptCardInner({
  card,
  display,
  theme,
  densityState,
  syntaxStyle,
  rightPaneWidth,
  isExpanded,
  hasCursor,
  isSelected,
  isActiveMatch,
  thinkingMode,
  imessageStyle,
}: TranscriptCardProps) {
  const {
    landmarks,
    bodyLines,
    diffText,
    diffLineCount,
    codeBlockLineCounts,
    headerMeta,
    isSearchHit,
    accent,
    isThinkingCard,
    categoryEmoji,
    isInsight,
    markdownFallbackLines,
  } = display

  const marker = hasCursor ? '>' : isSelected ? ':' : card.role === 'user' ? '▸' : '●'
  const cardBg = hasCursor
    ? theme.surface3
    : isSelected
      ? theme.surface2
      : card.role === 'user'
        ? theme.userBg
        : isInsight
          ? theme.surface2
          : theme.surface
  const borderColor = hasCursor
    ? accent
    : isActiveMatch
      ? theme.amber
      : isSearchHit
        ? theme.cyan
        : isInsight
          ? theme.violet
          : isSelected
            ? theme.border2
            : card.role === 'user'
              ? accent
              : theme.border
  const maxTitleWidth = Math.max(rightPaneWidth - 6, 20)
  const titleMeta = joinMeta([
    headerMeta,
    isSelected ? card.usageSummary ?? null : null,
  ])
  const cardTitleFull = `${marker} ${categoryEmoji}${card.label}${titleMeta ? `  ${titleMeta}` : ''}`
  const cardTitle = cardTitleFull.length > maxTitleWidth
    ? cardTitleFull.slice(0, maxTitleWidth - 1) + '…'
    : cardTitleFull
  const imessageUserBubble = imessageStyle && card.role === 'user'
  const userBubbleWidth = imessageUserBubble
    ? Math.max(Math.min(Math.floor(rightPaneWidth * 0.7), rightPaneWidth - 4), 20)
    : undefined
  const bubbleTextColor = imessageUserBubble ? '#ffffff' : theme.text
  const bodyInnerWidth = Math.max((userBubbleWidth ?? rightPaneWidth) - densityState.bodyIndent - 8, 16)
  const markdownWidth = Math.max((userBubbleWidth ?? rightPaneWidth) - densityState.bodyIndent - 8, 20)
  const landmarkWidth = rightPaneWidth - 4

  return (
    <box
      flexDirection="column"
      marginBottom={densityState.cardGap}
      alignSelf={imessageUserBubble ? 'flex-end' : undefined}
      width={userBubbleWidth}
    >
      {landmarks.map((landmark, landmarkIndex) => {
        const color = landmark.kind === 'resume'
          ? theme.cyan
          : landmark.kind === 'unread'
            ? theme.amber
            : landmark.kind === 'day'
              ? theme.violet
              : theme.dim
        return (
          <box key={`${card.key}:landmark:${landmarkIndex}`} paddingX={1}>
            <text fg={color}>{fitText(landmark.text, landmarkWidth)}</text>
          </box>
        )
      })}

      <box
        id={`card:${card.key}`}
        border
        borderStyle="single"
        borderColor={borderColor}
        backgroundColor={cardBg}
        flexDirection="column"
        title={cardTitle}
      >
        <box flexDirection="column" paddingLeft={densityState.bodyIndent} paddingBottom={1}>
          {(isExpanded && card.markdownContent && syntaxStyle) ? (
            <box paddingX={1}>
              <markdown
                content={card.markdownContent}
                syntaxStyle={syntaxStyle}
                fg={bubbleTextColor}
                streaming={false}
                width={markdownWidth}
                tableOptions={{ widthMode: 'content', borders: true, borderColor: theme.border }}
              />
            </box>
          ) : markdownFallbackLines ? (
            <box paddingX={1}>
              {markdownFallbackLines.map((line, lineIndex) => (
                <text key={`${card.key}:markdown-fallback:${lineIndex}`} fg={bubbleTextColor}>
                  {fitText(line, markdownWidth)}
                </text>
              ))}
            </box>
          ) : (
            <>
              {bodyLines.map((line, lineIndex) => (
                <box
                  key={`${card.key}:line:${lineIndex}`}
                  paddingX={1}
                  backgroundColor={transcriptBackground(line, theme) ?? cardBg}
                >
                  <text fg={imessageUserBubble ? bubbleTextColor : transcriptColor(line, theme)} wrapMode="none">
                    {fitText(line.text, bodyInnerWidth)}
                  </text>
                </box>
              ))}

              {isExpanded && card.codeBlocks && card.codeBlocks.length > 0 ? (
                card.codeBlocks.map((cb, cbIndex) => (
                  <box key={cb.key} paddingX={1} marginTop={1}>
                    <text fg={theme.dim}>{cb.lang}</text>
                    {syntaxStyle ? (
                      <code
                        content={cb.content}
                        filetype={cb.lang}
                        syntaxStyle={syntaxStyle}
                        drawUnstyledText={true}
                        style={{ height: Math.min((codeBlockLineCounts[cbIndex] ?? 0) + 1, 20) }}
                        width={markdownWidth}
                      />
                    ) : (
                      cb.content.split('\n').slice(0, 20).map((line, lineIndex) => (
                        <text key={`${cb.key}:fallback:${lineIndex}`} fg={theme.text}>
                          {fitText(line, markdownWidth)}
                        </text>
                      ))
                    )}
                  </box>
                ))
              ) : null}
            </>
          )}

          {diffText ? (
            <box paddingX={1} marginTop={1}>
              <diff
                diff={diffText}
                view="unified"
                wrapMode="char"
                showLineNumbers={true}
                addedBg={theme.diffAddBg}
                removedBg={theme.diffRemoveBg}
                contextBg={theme.surface}
                lineNumberBg={theme.surface}
                lineNumberFg={theme.dim}
                fg={theme.text}
                style={{ height: isExpanded ? Math.max(diffLineCount + 2, 4) : Math.min(densityState.bodyLines, Math.max(diffLineCount + 2, 4)) }}
              />
            </box>
          ) : null}
          {isThinkingCard ? (
            <box paddingX={1} marginTop={1}>
              <text fg={thinkingMode ? theme.cyan : theme.dim}>
                {thinkingMode ? 'Thinking mode on (T to disable)' : 'T toggles thinking mode for all thinking cards'}
              </text>
            </box>
          ) : null}
        </box>
      </box>
    </box>
  )
}

const TranscriptCard = React.memo(TranscriptCardInner)

export default function OpenTuiApp() {
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()

  const [provider, setProvider] = useState<ProviderSelection>('claude')
  const [themeMode, setThemeMode] = useState<TuiThemeMode>('light')
  const [density, setDensity] = useState<TuiDensity>('balanced')
  const [transcriptView, setTranscriptView] = useState<TuiTranscriptView>('conversation')
  const [focusMode, setFocusMode] = useState(false)
  const [railVisible, setRailVisible] = useState(true)
  const [tabsEnabled, setTabsEnabled] = useState(true)
  const [showToolCalls, setShowToolCalls] = useState(true)
  const [sidebarSort, setSidebarSort] = useState<TuiSidebarSort>('project')
  const [sidebarWidthPreference, setSidebarWidthPreference] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [sessions, setSessions] = useState<Session[]>([])
  const [runningSessions, setRunningSessions] = useState<RunningSessionRef[]>([])
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null)
  const [sessionDetail, setSessionDetail] = useState<TuiSessionDetail | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [refreshingSessions, setRefreshingSessions] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null)
  const [focusedPane, setFocusedPane] = useState<PaneFocus>('sessions')
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [providerMenuIndex, setProviderMenuIndex] = useState(0)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [themeMenuIndex, setThemeMenuIndex] = useState(0)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0)
  const [gitOpen, setGitOpen] = useState(false)
  const gitKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const analyticsKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [searchMode, setSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)
  const [sessionSearchMode, setSessionSearchMode] = useState(false)
  const [sessionSearchQuery, setSessionSearchQuery] = useState('')

  const [transcriptCursorKey, setTranscriptCursorKey] = useState<string | null>(null)
  const [expandedCardKeys, setExpandedCardKeys] = useState<Set<string>>(() => new Set())
  const [collapsedCardKeys, setCollapsedCardKeys] = useState<Set<string>>(() => new Set())
  const [followTail, setFollowTail] = useState(true)
  const [pendingNewCount, setPendingNewCount] = useState(0)
  const [unreadBoundaryKey, setUnreadBoundaryKey] = useState<string | null>(null)
  const [resumeMarkerKey, setResumeMarkerKey] = useState<string | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [restoredReaderState, setRestoredReaderState] = useState<{
    sessionKey: string | null
    loaded: boolean
    state: TuiSessionReaderState | null
  }>({
    sessionKey: null,
    loaded: false,
    state: null,
  })
  const [contextUsage, setContextUsage] = useState<import('../../lib/types').ContextUsage | null>(null)
  const [contextUsageStatus, setContextUsageStatus] = useState<'idle' | 'loading' | 'unavailable' | 'ready'>('idle')
  const [renameSessionKey, setRenameSessionKey] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const renameDraftRef = useRef(renameDraft)
  const [composerActive, setComposerActive] = useState(false)
  const [composerDraft, setComposerDraft] = useState('')
  const [composerSendState, setComposerSendState] = useState<SendState>('idle')
  const [composerError, setComposerError] = useState<string | null>(null)
  const [composerLiveText, setComposerLiveText] = useState('')
  const [sentHistory, setSentHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [draftBeforeHistory, setDraftBeforeHistory] = useState('')
  const [thinkingMode, setThinkingMode] = useState(false)

  // Store full Session objects so tabs retain provider context across
  // provider switches (looking them up in `sessions` loses other-provider tabs).
  const [openTabSessions, setOpenTabSessions] = useState<Session[]>([])

  const transcriptScrollRef = useRef<ScrollBoxRenderable>(null)
  const sidebarScrollRef = useRef<ScrollBoxRenderable>(null)
  const pausedTranscriptScrollTopRef = useRef<number | null>(null)
  const prevFollowTailRef = useRef(true)
  const prevTranscriptLengthRef = useRef(0)
  const tabSelectRef = useRef<TabSelectRenderable>(null)
  const sessionRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const metadataRequestRef = useRef(0)
  const backgroundMetadataCursorRef = useRef(0)
  const providerSwitchRef = useRef(false)
  const readerStateWriteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readerStatePersistSignatureRef = useRef<string | null>(null)
  const expandedKeysRevisionRef = useRef(0)
  const collapsedKeysRevisionRef = useRef(0)
  const previousTranscriptRef = useRef<{ sessionKey: string | null; keys: string[] }>({
    sessionKey: null,
    keys: [],
  })
  const sessionDetailCacheRef = useRef(new Map<string, TuiSessionDetail>())
  const sessionContextUsageCacheRef = useRef(new Map<string, import('../../lib/types').ContextUsage | null>())
  const sessionMetadataFetchedAtRef = useRef(new Map<string, number>())
  const sessionMetadataInFlightRef = useRef(new Set<string>())
  const composerAbortRef = useRef<AbortController | null>(null)
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingDetailRef = useRef(false)
  const backgroundRefreshInFlightRef = useRef(new Set<string>())
  const sessionDetailMtimeRef = useRef(new Map<string, number>())
  const selectedSessionKeyRef = useRef<string | null>(null)
  const openTabSessionsRef = useRef<Session[]>([])
  const runningSessionsRef = useRef<RunningSessionRef[]>([])
  const tabsEnabledRef = useRef(true)
  const themeMenuOriginRef = useRef<TuiThemeMode | null>(null)
  const currentThemeRef = useRef<TuiThemeMode>('light')
  useEffect(() => {
    setActiveTheme(themeMode)
  }, [themeMode])

  useEffect(() => {
    loadingDetailRef.current = loadingDetail
  }, [loadingDetail])

  useEffect(() => {
    selectedSessionKeyRef.current = selectedSessionKey
  }, [selectedSessionKey])

  useEffect(() => {
    openTabSessionsRef.current = openTabSessions
  }, [openTabSessions])

  useEffect(() => {
    runningSessionsRef.current = runningSessions
  }, [runningSessions])

  useEffect(() => {
    tabsEnabledRef.current = tabsEnabled
  }, [tabsEnabled])

  useEffect(() => {
    expandedKeysRevisionRef.current += 1
  }, [expandedCardKeys])

  useEffect(() => {
    collapsedKeysRevisionRef.current += 1
  }, [collapsedCardKeys])

  useEffect(() => () => {
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current)
  }, [])

  useEffect(() => {
    if (composerActive) setFocusedPane('messages')
  }, [composerActive])

  useEffect(() => {
    if (!selectedSessionKey) {
      setContextUsage(null)
      setContextUsageStatus('idle')
    } else {
      const cachedUsage = sessionContextUsageCacheRef.current.get(selectedSessionKey) ?? null
      setContextUsage(cachedUsage)
      setContextUsageStatus(cachedUsage ? 'ready' : 'idle')
    }
    setRenameSessionKey(null)
    setRenameDraft('')
  }, [selectedSessionKey])

  useEffect(() => {
    const pinnedKeys = new Set([
      selectedSessionKey,
      ...openTabSessions.map((session) => sessionKey(session)),
    ].filter((key): key is string => Boolean(key)))
    pruneSessionCaches(
      sessionDetailCacheRef.current,
      sessionContextUsageCacheRef.current,
      sessionMetadataFetchedAtRef.current,
      pinnedKeys,
    )
  }, [openTabSessions, selectedSessionKey])

  const theme = useMemo(() => getThemePalette(themeMode), [themeMode])
  const densityState = useMemo(() => densityConfig(density), [density])
  const showRail = railVisible
  const effectiveFocus: PaneFocus = showRail ? focusedPane : 'messages'
  const selectedIndex = useMemo(() => {
    if (sessions.length === 0) return -1
    if (!selectedSessionKey) return 0
    return sessions.findIndex((session) => sessionKey(session) === selectedSessionKey)
  }, [selectedSessionKey, sessions])
  const selectedSession = selectedIndex >= 0 ? sessions[selectedIndex] ?? null : sessions[0] ?? null
  const selectedSessionIdentity = selectedSession ? sessionKey(selectedSession) : null
  const selectedSessionTarget = useMemo<Session | null>(() => (
    selectedSession
      ? {
          sessionId: selectedSession.sessionId,
          provider: selectedSession.provider,
        }
      : null
  ), [selectedSessionIdentity])
  const providerRunningSessions = useMemo(() => (
    runningSessions.filter((running) => provider === 'all' || running.provider === provider)
  ), [provider, runningSessions])
  const composerTargetSession = useMemo<Session | null>(() => {
    if (selectedSession) {
      const selectedIsRunning = providerRunningSessions.some((running) =>
        running.sessionId === selectedSession.sessionId && running.provider === selectedSession.provider,
      )
      if (selectedIsRunning) return selectedSession
    }

    if (providerRunningSessions.length === 1) {
      const onlyRunning = providerRunningSessions[0]
      const matchedSession = sessions.find((session) =>
        session.sessionId === onlyRunning.sessionId && session.provider === onlyRunning.provider,
      )
      return matchedSession ?? {
        sessionId: onlyRunning.sessionId,
        provider: onlyRunning.provider,
      }
    }

    return selectedSession
  }, [providerRunningSessions, selectedSession, sessions])
  const composerAutoTargetingRunning = Boolean(
    composerTargetSession
    && selectedSession
    && (
      composerTargetSession.sessionId !== selectedSession.sessionId
      || composerTargetSession.provider !== selectedSession.provider
    ),
  )

  // Preserve reference stability for partially-stripped messages so the
  // per-message card cache below keeps hitting when only the tail changes.
  const strippedCacheRef = useRef(new WeakMap<ThreadedMessage, ThreadedMessage>())
  const transcriptCardCacheRef = useRef(new Map<string, { threaded: ThreadedMessage; density: TuiDensity; card: TuiTranscriptCard }>())
  const transcriptCards = useMemo(() => {
    if (!sessionDetail) return []
    const source = sessionDetail.threadedMessages
    let messages: ThreadedMessage[]
    if (showToolCalls) {
      messages = source
    } else {
      const cache = strippedCacheRef.current
      messages = []
      for (const msg of source) {
        const cached = cache.get(msg)
        if (cached) {
          messages.push(cached)
          continue
        }
        const kept = msg.blocks.filter((b) => b.type !== 'tool_thread')
        if (kept.length === 0) continue
        const stripped = kept.length === msg.blocks.length ? msg : { ...msg, blocks: kept }
        cache.set(msg, stripped)
        messages.push(stripped)
      }
    }
    const prevCache = transcriptCardCacheRef.current
    const nextCache = new Map<string, { threaded: ThreadedMessage; density: TuiDensity; card: TuiTranscriptCard }>()
    const cards = messages.map((message) => {
      const cached = prevCache.get(message.uuid)
      if (cached && cached.threaded === message && cached.density === density) {
        nextCache.set(message.uuid, cached)
        return cached.card
      }
      const card = formatTranscriptCard(message, density)
      nextCache.set(message.uuid, { threaded: message, density, card })
      return card
    })
    transcriptCardCacheRef.current = nextCache
    return cards
  }, [density, sessionDetail, showToolCalls])
  const transcriptIndexByKey = useMemo(() => {
    const indexByKey = new Map<string, number>()
    transcriptCards.forEach((card, index) => {
      indexByKey.set(card.key, index)
    })
    return indexByKey
  }, [transcriptCards])
  const thinkingFullKeys = useMemo(() => {
    if (!thinkingMode) return new Set<string>()
    const next = new Set<string>()
    for (const card of transcriptCards) {
      if (card.lines.some((line) => line.tone === 'thinking')) {
        next.add(card.key)
      }
    }
    return next
  }, [thinkingMode, transcriptCards])

  const resolvedExpandedKeys = useMemo(() => {
    const next = new Set<string>()
    for (const card of transcriptCards) {
      const shouldAutoFold = transcriptView === 'conversation' && card.autoFold
      const isExpanded = shouldAutoFold
        ? expandedCardKeys.has(card.key)
        : !collapsedCardKeys.has(card.key)
      if (isExpanded) next.add(card.key)
    }
    return next
  }, [collapsedCardKeys, expandedCardKeys, transcriptCards, transcriptView])

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  // Deferred: search computation runs after user interactions, so typing stays instant.
  const deferredSearchQuery = useDeferredValue(normalizedSearchQuery)
  const searchMatches = useMemo(() => {
    if (!deferredSearchQuery) return []
    return transcriptCards.flatMap((card, index) => {
      const haystack = `${card.label}\n${card.searchText}`.toLowerCase()
      return haystack.includes(deferredSearchQuery) ? [index] : []
    })
  }, [deferredSearchQuery, transcriptCards])

  const cursorIndex = useMemo(() => {
    if (transcriptCards.length === 0) return -1
    const index = transcriptCursorKey ? transcriptIndexByKey.get(transcriptCursorKey) ?? -1 : -1
    if (index >= 0) return index
    return followTail ? transcriptCards.length - 1 : 0
  }, [followTail, transcriptCards.length, transcriptCursorKey, transcriptIndexByKey])

  const unreadBoundaryIndex = useMemo(
    () => unreadBoundaryKey ? (transcriptIndexByKey.get(unreadBoundaryKey) ?? -1) : -1,
    [transcriptIndexByKey, unreadBoundaryKey],
  )
  const resumeMarkerIndex = useMemo(
    () => resumeMarkerKey ? (transcriptIndexByKey.get(resumeMarkerKey) ?? -1) : -1,
    [resumeMarkerKey, transcriptIndexByKey],
  )

  const readerTitle = useMemo(() => (
    sessionDetail?.info?.customTitle
    ?? sessionDetail?.info?.summary
    ?? selectedSession?.customTitle
    ?? selectedSession?.summary
    ?? '(untitled session)'
  ), [selectedSession, sessionDetail?.info])

  const readerModel = sessionDetail?.info?.currentModel ?? 'unknown'
  const gitRepoCwd = sessionDetail?.info?.cwd ?? selectedSession?.cwd ?? null
  const projectCount = useMemo(
    () => new Set(sessions.map((session) => formatSessionProject(session))).size,
    [sessions],
  )
  const foldedTechnicalCount = useMemo(
    () => transcriptCards.filter((card) => card.autoFold && !resolvedExpandedKeys.has(card.key)).length,
    [resolvedExpandedKeys, transcriptCards],
  )
  const shouldEnableSyntaxHighlighting = useMemo(() => (
    transcriptCards.some((card) => {
      if (!resolvedExpandedKeys.has(card.key)) return false
      return Boolean(card.markdownContent || (card.codeBlocks && card.codeBlocks.length > 0))
    })
  ), [resolvedExpandedKeys, transcriptCards])
  const syntaxStyle = useMemo(
    () => shouldEnableSyntaxHighlighting ? buildSyntaxStyle(theme) : null,
    [shouldEnableSyntaxHighlighting, theme],
  )
  const normalizedSessionQuery = sessionSearchQuery.trim().toLowerCase()
  const filteredSessionsForSidebar = useMemo(() => {
    if (!normalizedSessionQuery) return sessions
    return sessions.filter((session) => {
      const title = formatSessionTitle(session).toLowerCase()
      const project = formatSessionProject(session).toLowerCase()
      const id = (session.sessionId ?? '').toLowerCase()
      return (
        title.includes(normalizedSessionQuery)
        || project.includes(normalizedSessionQuery)
        || id.includes(normalizedSessionQuery)
      )
    })
  }, [sessions, normalizedSessionQuery])
  const sidebarEntries = useMemo(() => {
    const entries = buildSidebarEntries(filteredSessionsForSidebar, sidebarSort)
    if (filteredSessionsForSidebar === sessions) return entries
    const originalIndex = new Map<string, number>()
    sessions.forEach((s, i) => { originalIndex.set(sessionKey(s), i) })
    return entries.map((entry) => {
      if (entry.type !== 'session') return entry
      const idx = originalIndex.get(sessionKey(entry.session))
      return idx === undefined ? entry : { ...entry, absoluteIndex: idx }
    })
  }, [filteredSessionsForSidebar, sessions, sidebarSort])
  const sidebarSortLabel = sidebarSort === 'project' ? 'PROJECT' : 'TIME'
  const selectedSidebarEntryIndex = useMemo(() => {
    const idx = sidebarEntries.findIndex((e) => e.type === 'session' && e.absoluteIndex === selectedIndex)
    return idx >= 0 ? idx : 0
  }, [sidebarEntries, selectedIndex])
  const mainContentHeight = Math.max(height - 3 - (searchMode || sessionSearchMode ? 4 : 1) - COMPOSER_HEIGHT, 8)
  const maxSidebarWidth = Math.max(MIN_SIDEBAR_WIDTH, width - 4 - 1 - MIN_READER_WIDTH)
  const sidebarWidth = showRail ? clamp(sidebarWidthPreference, MIN_SIDEBAR_WIDTH, maxSidebarWidth) : 0
  const rightPaneWidth = Math.max(width - 4 - sidebarWidth - (showRail ? 1 : 0), 40)

  const isPreviewMode = tabsEnabled && !!selectedSessionKey && !openTabSessions.some((s) => sessionKey(s) === selectedSessionKey)
  const visibleTabSessions = useMemo(() => (
    isPreviewMode && selectedSession
      ? [...openTabSessions, selectedSession]
      : openTabSessions
  ), [isPreviewMode, openTabSessions, selectedSession])
  const showTabs = tabsEnabled && visibleTabSessions.length > 0
  const showPreviewBar = false
  const TAB_BAR_HEIGHT = 1
  const transcriptViewportRows = Math.max(mainContentHeight - (focusMode ? 4 : 7) - (showTabs || showPreviewBar ? TAB_BAR_HEIGHT : 0), 8)

  const activeTabIndex = useMemo(() => {
    if (!selectedSessionKey) return -1
    return visibleTabSessions.findIndex((s) => sessionKey(s) === selectedSessionKey)
  }, [selectedSessionKey, visibleTabSessions])

  const tabOptions = useMemo((): TabSelectOption[] => (
    visibleTabSessions.map((s) => ({
      name: isPreviewMode && selectedSessionKey === sessionKey(s)
        ? `PREVIEW · ${formatSessionTitle(s)}`
        : formatSessionTitle(s),
      description: isPreviewMode && selectedSessionKey === sessionKey(s)
        ? 'Preview tab'
        : formatProviderLabel(s.provider ?? 'claude'),
      value: sessionKey(s),
    }))
  ), [isPreviewMode, selectedSessionKey, visibleTabSessions])

  const tabWidth = useMemo(() => {
    if (visibleTabSessions.length === 0) return 16
    // Fill available width proportionally so tabs look natural at any count,
    // capped to avoid very wide tabs when only a few sessions are open.
    const available = Math.max(rightPaneWidth - 6, 20)
    const fill = Math.floor(available / visibleTabSessions.length)
    return Math.max(10, Math.min(fill, 24))
  }, [rightPaneWidth, visibleTabSessions.length])
  const sidebarRowBudget = Math.max(mainContentHeight - 2, 4)
  const sidebarInnerWidth = Math.max(sidebarWidth - 5, 17)
  const sidebarSortHeader = useMemo(
    () => fitText(
      joinMeta([
        normalizedSessionQuery
          ? `SESSIONS ${filteredSessionsForSidebar.length}/${Math.max(sessions.length, 0)}`
          : `SESSIONS ${Math.max(sessions.length, 0)}`,
        `sort ${sidebarSortLabel}`,
        normalizedSessionQuery ? `/${sessionSearchQuery}` : '/ search',
      ]),
      Math.max(sidebarInnerWidth - 2, 12),
    ),
    [sidebarInnerWidth, sidebarSortLabel, sessions.length, filteredSessionsForSidebar.length, normalizedSessionQuery, sessionSearchQuery],
  )

  // Stable per-card data: body lines, diffs, code blocks. Cached by card reference so
  // when only one card's expansion toggles (transcriptCards ref unchanged), the other
  // cards reuse their prior StableCardData object — TranscriptCard memo then bails out.
  const stableCardCacheRef = useRef(new WeakMap<TuiTranscriptCard, {
    isExpanded: boolean
    bodyLineLimit: number
    thinkingFull: boolean
    value: StableCardData
  }>())
  const stableCardData = useMemo((): StableCardData[] => {
    const cache = stableCardCacheRef.current
    return transcriptCards.map((card) => {
      const isExpanded = resolvedExpandedKeys.has(card.key)
      const thinkingFull = thinkingFullKeys.has(card.key)
      const prev = cache.get(card)
      if (
        prev
        && prev.isExpanded === isExpanded
        && prev.bodyLineLimit === densityState.bodyLines
        && prev.thinkingFull === thinkingFull
      ) {
        return prev.value
      }
      const bodyLines = renderedBodyLines(card, isExpanded, densityState.bodyLines, thinkingFull)
      const diffText = cardDiffText(card, isExpanded)
      const diffLineCount = diffText ? diffText.split('\n').length : 0
      const codeBlockLineCounts = (isExpanded && card.codeBlocks)
        ? card.codeBlocks.map((cb) => cb.content.split('\n').length)
        : []
      const value: StableCardData = { bodyLines, diffText, diffLineCount, codeBlockLineCounts }
      cache.set(card, { isExpanded, bodyLineLimit: densityState.bodyLines, thinkingFull, value })
      return value
    })
  }, [transcriptCards, resolvedExpandedKeys, densityState.bodyLines, thinkingFullKeys])

  const allLandmarksRef = useRef<CardLandmark[][] | null>(null)
  const allLandmarks = useMemo(() => {
    const next = computeAllLandmarks(
      transcriptCards,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
      allLandmarksRef.current,
    )
    allLandmarksRef.current = next
    return next
  }, [transcriptCards, resumeMarkerIndex, unreadBoundaryIndex, pendingNewCount])

  const cardDisplayCacheRef = useRef(new WeakMap<TuiTranscriptCard, {
    inputs: {
      isExpanded: boolean
      isLatest: boolean
      isSearchHit: boolean
      isAutoFoldedTechnical: boolean
      landmarks: CardLandmark[]
      stable: StableCardData
      providerKey: ProviderSelection
      syntaxEnabled: boolean
    }
    value: CardDisplayData
  }>())

  const cardDisplayData = useMemo((): CardDisplayData[] => {
    const cache = cardDisplayCacheRef.current
    return transcriptCards.map((card, index) => {
      const isExpanded = resolvedExpandedKeys.has(card.key)
      const isLatest = index === transcriptCards.length - 1
      const isSearchHit = deferredSearchQuery.length > 0
        && `${card.label}\n${card.searchText}`.toLowerCase().includes(deferredSearchQuery)
      const isAutoFoldedTechnical = transcriptView === 'conversation' && card.autoFold && !isExpanded
      const landmarks = allLandmarks[index] ?? EMPTY_LANDMARKS
      const stable = stableCardData[index] ?? {
        bodyLines: [],
        diffText: null,
        diffLineCount: 0,
        codeBlockLineCounts: [],
      }
      const providerKey = card.provider ?? provider

      const prev = cache.get(card)
      if (
        prev
        && prev.inputs.isExpanded === isExpanded
        && prev.inputs.isLatest === isLatest
        && prev.inputs.isSearchHit === isSearchHit
        && prev.inputs.isAutoFoldedTechnical === isAutoFoldedTechnical
        && prev.inputs.landmarks === landmarks
        && prev.inputs.stable === stable
        && prev.inputs.providerKey === providerKey
        && prev.inputs.syntaxEnabled === shouldEnableSyntaxHighlighting
      ) {
        return prev.value
      }

      const headerMeta = joinMeta([
        card.timestamp ?? null,
        isLatest ? 'latest' : null,
        isSearchHit ? 'match' : null,
        isAutoFoldedTechnical ? 'folded' : null,
        `e ${isExpanded ? 'collapse' : 'expand'}`,
      ])
      const accent = transcriptAccent(card.role, providerKey)
      const isThinkingCard = card.lines.some((line) => line.tone === 'thinking')
      const isInsight = card.category === 'insight'
      const isTechnical = card.category === 'technical'
      const isDiff = card.category === 'diff'
      const isSystem = card.category === 'system'
      const categoryEmoji = isInsight ? '✨ ' : isTechnical ? '🔧 ' : isDiff ? '✏️ ' : isSystem ? '⚙️ ' : ''
      const markdownFallbackLines = (isExpanded && card.markdownContent && !shouldEnableSyntaxHighlighting)
        ? card.markdownContent.split('\n')
        : null
      const value: CardDisplayData = {
        landmarks,
        bodyLines: stable.bodyLines,
        diffText: stable.diffText,
        diffLineCount: stable.diffLineCount,
        codeBlockLineCounts: stable.codeBlockLineCounts,
        headerMeta,
        isSearchHit,
        accent,
        isThinkingCard,
        categoryEmoji,
        isInsight,
        markdownFallbackLines,
      }
      cache.set(card, {
        inputs: {
          isExpanded,
          isLatest,
          isSearchHit,
          isAutoFoldedTechnical,
          landmarks,
          stable,
          providerKey,
          syntaxEnabled: shouldEnableSyntaxHighlighting,
        },
        value,
      })
      return value
    })
  }, [
    allLandmarks,
    stableCardData,
    transcriptCards,
    resolvedExpandedKeys,
    deferredSearchQuery,
    transcriptView,
    provider,
    shouldEnableSyntaxHighlighting,
  ])
  const imessageStyle = themeMode === 'imessage'

  // Memoize the full list of <TranscriptCard /> elements so unrelated
  // re-renders (composer input, notice banner, theme menu, status tick, etc.)
  // don't rebuild N elements + run N React.memo comparisons. Only deps that
  // actually change what a card displays belong here.
  const transcriptChildren = useMemo(() => (
    transcriptCards.map((card, index) => {
      const display = cardDisplayData[index]
      if (!display) return null
      const isSelected = card.key === transcriptCursorKey
      const hasCursor = isSelected && effectiveFocus === 'messages'
      const isExpanded = resolvedExpandedKeys.has(card.key)
      const isActiveMatch = display.isSearchHit && searchMatches[searchMatchIndex] === index
      return (
        <TranscriptCard
          key={card.key}
          card={card}
          display={display}
          theme={theme}
          densityState={densityState}
          syntaxStyle={syntaxStyle}
          rightPaneWidth={rightPaneWidth}
          isExpanded={isExpanded}
          hasCursor={hasCursor}
          isSelected={isSelected}
          isActiveMatch={isActiveMatch}
          thinkingMode={thinkingMode}
          imessageStyle={imessageStyle}
        />
      )
    })
  ), [
    transcriptCards,
    cardDisplayData,
    transcriptCursorKey,
    effectiveFocus,
    resolvedExpandedKeys,
    searchMatches,
    searchMatchIndex,
    theme,
    densityState,
    syntaxStyle,
    rightPaneWidth,
    thinkingMode,
    imessageStyle,
  ])

  const refreshSessions = useCallback(async (
    nextProvider: ProviderSelection,
    preserveSelection = true,
    foreground = true,
  ) => {
    const requestId = ++sessionRequestRef.current
    if (foreground) {
      setLoadingSessions(true)
      setRefreshingSessions(false)
    } else {
      setRefreshingSessions(true)
    }
    if (!providerSwitchRef.current) setError(null)

    try {
      const nextSessions = await readTuiSessions(nextProvider)
      if (requestId !== sessionRequestRef.current) return
      startTransition(() => {
        setSessions((prev) => sessionsShallowEqual(prev, nextSessions) ? prev : nextSessions)
        setSelectedSessionKey((current) => {
          if (nextSessions.length === 0) return null
          if (preserveSelection && current) {
            const matched = nextSessions.find((session) => sessionKey(session) === current)
            if (matched) return sessionKey(matched)
          }
          return sessionKey(nextSessions[0])
        })
      })
    } catch (err) {
      if (requestId !== sessionRequestRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
      setSessions([])
      setSelectedSessionKey(null)
    } finally {
      if (requestId === sessionRequestRef.current) {
        setLoadingSessions(false)
        setRefreshingSessions(false)
      }
    }
  }, [])

  const refreshRunningSessions = useCallback(async () => {
    try {
      const res = await fetch(buildApiUrl('/api/runtime/running'))
      if (!res.ok) return
      const json = await res.json().catch(() => ({}))
      const nextRunning = Array.isArray(json.sessions)
        ? json.sessions
          .filter((session: unknown): session is RunningSessionRef => {
            if (!session || typeof session !== 'object') return false
            const record = session as Record<string, unknown>
            return typeof record.sessionId === 'string' && typeof record.provider === 'string'
          })
          .map((session: RunningSessionRef) => ({
            sessionId: session.sessionId,
            provider: session.provider,
          }))
        : []
      startTransition(() => setRunningSessions((prev) => runningSessionsEqual(prev, nextRunning) ? prev : nextRunning))
    } catch {
      // Ignore runtime discovery errors; composer falls back to selected session.
    }
  }, [])

  const refreshSessionMetadata = useCallback((
    session: Session,
    foreground = false,
    detailSnapshot?: TuiSessionDetail,
    cachedDetailSnapshot?: TuiSessionDetail | null,
  ) => {
    const cacheKey = sessionKey(session)
    const isSelectedTab = cacheKey === selectedSessionKeyRef.current
    const isRunningSession = runningSessionsRef.current.some((running) =>
      running.sessionId === session.sessionId && running.provider === (session.provider ?? 'claude'),
    )

    if (session.provider === 'claude') {
      const isPreviewingSession = tabsEnabledRef.current
        && !openTabSessionsRef.current.some((openSession) => sessionKey(openSession) === cacheKey)
      if (isPreviewingSession) return

      if (!isRunningSession && sessionContextUsageCacheRef.current.get(cacheKey)) return
    }

    const metadataTtl = isSelectedTab
      ? (session.provider === 'claude' ? CLAUDE_METADATA_REFRESH_MS : DEFAULT_METADATA_REFRESH_MS)
      : (session.provider === 'claude' ? CLAUDE_BACKGROUND_METADATA_REFRESH_MS : DEFAULT_BACKGROUND_METADATA_REFRESH_MS)
    const lastMetadataFetch = sessionMetadataFetchedAtRef.current.get(cacheKey) ?? 0
    const hasCachedMetadata = Boolean(
      sessionContextUsageCacheRef.current.get(cacheKey)
      || cachedDetailSnapshot?.info?.currentModel
      || detailSnapshot?.info?.currentModel
      || sessionDetailCacheRef.current.get(cacheKey)?.info?.currentModel,
    )
    const shouldFetchMetadata = !sessionMetadataInFlightRef.current.has(cacheKey) && (
      !hasCachedMetadata || Date.now() - lastMetadataFetch >= metadataTtl
    )
    if (!shouldFetchMetadata) return

    const metadataRequestId = ++metadataRequestRef.current
    sessionMetadataInFlightRef.current.add(cacheKey)
    if (foreground && isSelectedTab) {
      setContextUsageStatus('loading')
    }
    void Promise.race([
      readTuiSessionMetadataAsync(session),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), METADATA_REQUEST_TIMEOUT_MS)
      }),
    ])
      .then((metadata) => {
        if (metadataRequestId !== metadataRequestRef.current) return
        const pinnedKeys = new Set([
          ...openTabSessionsRef.current.map((openSession) => sessionKey(openSession)),
          selectedSessionKeyRef.current,
        ].filter((key): key is string => Boolean(key)))
        touchMapEntry(sessionMetadataFetchedAtRef.current, cacheKey, Date.now())
        if (!metadata) {
          pruneSessionCaches(
            sessionDetailCacheRef.current,
            sessionContextUsageCacheRef.current,
            sessionMetadataFetchedAtRef.current,
            pinnedKeys,
          )
          if (foreground && isSelectedTab) {
            startTransition(() => setContextUsageStatus('unavailable'))
          }
          return
        }
        startTransition(() => {
          if (metadata.contextUsage) {
            touchMapEntry(sessionContextUsageCacheRef.current, cacheKey, metadata.contextUsage)
            if (isSelectedTab) {
              setContextUsage(metadata.contextUsage)
              setContextUsageStatus('ready')
            }
          }
          const currentModel = metadata.currentModel
          if (currentModel) {
            setSessionDetail((prev) => {
              if (!prev) return prev
              if (
                prev.info?.sessionId
                && prev.info.sessionId !== session.sessionId
              ) {
                return prev
              }
              if (!prev.info) return prev
              if (prev.info.currentModel === currentModel) return prev
              return {
                ...prev,
                info: {
                  ...prev.info,
                  currentModel,
                },
              }
            })
            const cached = sessionDetailCacheRef.current.get(cacheKey)
            if (cached?.info) {
              touchMapEntry(sessionDetailCacheRef.current, cacheKey, {
                ...cached,
                info: {
                  ...cached.info,
                  currentModel,
                },
              })
            }
          }
          pruneSessionCaches(
            sessionDetailCacheRef.current,
            sessionContextUsageCacheRef.current,
            sessionMetadataFetchedAtRef.current,
            pinnedKeys,
          )
          if (!metadata.contextUsage && isSelectedTab) {
            setContextUsageStatus('unavailable')
          }
        })
      })
      .catch(() => {
        if (foreground && isSelectedTab) {
          startTransition(() => setContextUsageStatus('unavailable'))
        }
      })
      .finally(() => {
        sessionMetadataInFlightRef.current.delete(cacheKey)
      })
  }, [])

  const refreshSelectedSessionDetail = useCallback(async (session: Session, foreground = true) => {
    const cacheKeyForGuards = sessionKey(session)
    if (!foreground && (loadingDetailRef.current || backgroundRefreshInFlightRef.current.has(cacheKeyForGuards))) return

    // Skip background polls when the session file hasn't changed since the
    // cached detail was populated — avoids re-reading and re-threading the
    // full message file every interval for idle sessions. Worst case the
    // sidebar's lastModified is stale and we skip one poll; the next sidebar
    // refresh catches us up.
    if (!foreground && typeof session.lastModified === 'number') {
      const recordedMtime = sessionDetailMtimeRef.current.get(cacheKeyForGuards)
      if (recordedMtime != null && recordedMtime >= session.lastModified) return
    }
    const requestId = ++detailRequestRef.current

    // Cache-first for foreground loads — show the last-known detail immediately
    // rather than flashing a spinner while disk IO / JSON parsing runs. A
    // background refresh still fires below so the UI catches up.
    if (foreground) {
      const cached = sessionDetailCacheRef.current.get(cacheKeyForGuards)
      if (cached) {
        setSessionDetail(cached)
        setLoadingDetail(false)
      } else {
        setLoadingDetail(true)
      }
    }
    if (!foreground) backgroundRefreshInFlightRef.current.add(cacheKeyForGuards)
    setError((current) => current?.startsWith('Failed to load session detail') ? null : current)

    try {
      const detail = await readTuiSessionDetailAsync(session)
      if (requestId !== detailRequestRef.current) return
      if (typeof session.lastModified === 'number') {
        sessionDetailMtimeRef.current.set(cacheKeyForGuards, session.lastModified)
      }
      const cacheKey = sessionKey(session)
      const cachedDetail = sessionDetailCacheRef.current.get(cacheKey)
      const pinnedKeys = new Set([
        ...openTabSessionsRef.current.map((openSession) => sessionKey(openSession)),
        selectedSessionKeyRef.current,
      ].filter((key): key is string => Boolean(key)))
      startTransition(() => {
        setSessionDetail((prev) => {
          if (
            prev !== null &&
            prev.rawMessages.length === detail.rawMessages.length &&
            sessionMessageFingerprint(prev.rawMessages.at(-1)) === sessionMessageFingerprint(detail.rawMessages.at(-1)) &&
            prev.info?.currentModel === detail.info?.currentModel &&
            prev.info?.customTitle === detail.info?.customTitle
          ) {
            return prev
          }
          touchMapEntry(sessionDetailCacheRef.current, cacheKey, detail)
          pruneSessionCaches(
            sessionDetailCacheRef.current,
            sessionContextUsageCacheRef.current,
            sessionMetadataFetchedAtRef.current,
            pinnedKeys,
          )
          return detail
        })
        if (detail.contextUsage) {
          touchMapEntry(sessionContextUsageCacheRef.current, cacheKey, detail.contextUsage)
          pruneSessionCaches(
            sessionDetailCacheRef.current,
            sessionContextUsageCacheRef.current,
            sessionMetadataFetchedAtRef.current,
            pinnedKeys,
          )
          if (cacheKey === selectedSessionKeyRef.current) {
            setContextUsage(detail.contextUsage)
            setContextUsageStatus('ready')
          }
        }
      })

      // Context usage metadata is disabled for open tabs.
      // setTimeout(() => {
      //   refreshSessionMetadata(session, foreground, detail, cachedDetail)
      // }, 0)
    } catch (err) {
      if (requestId !== detailRequestRef.current) return
      // Only clear the view if we have nothing cached to fall back on — keeps
      // the last-known good detail visible during transient read failures.
      if (!sessionDetailCacheRef.current.has(cacheKeyForGuards)) setSessionDetail(null)
      setError(err instanceof Error ? `Failed to load session detail: ${err.message}` : 'Failed to load session detail')
    } finally {
      if (requestId === detailRequestRef.current && foreground) setLoadingDetail(false)
      if (!foreground) backgroundRefreshInFlightRef.current.delete(cacheKeyForGuards)
    }
  }, [])

  const jumpToTranscriptIndex = useCallback((index: number) => {
    if (transcriptCards.length === 0) return
    const nextIndex = clamp(index, 0, transcriptCards.length - 1)
    const nextCard = transcriptCards[nextIndex]
    if (!nextCard) return
    setTranscriptCursorKey(nextCard.key)
    const atTail = nextIndex === transcriptCards.length - 1
    setFollowTail(atTail)
    if (atTail) {
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
    }
  }, [transcriptCards])

  const jumpToTranscriptTail = useCallback(() => {
    if (transcriptCards.length === 0) return
    const lastIndex = transcriptCards.length - 1
    jumpToTranscriptIndex(lastIndex)
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
  }, [jumpToTranscriptIndex, transcriptCards])

  const jumpToUnreadBoundary = useCallback(() => {
    if (unreadBoundaryIndex >= 0) {
      jumpToTranscriptIndex(unreadBoundaryIndex)
      return
    }
    jumpToTranscriptTail()
  }, [jumpToTranscriptIndex, jumpToTranscriptTail, unreadBoundaryIndex])

  const jumpToResumeMarker = useCallback(() => {
    const index = resumeMarkerKey ? (transcriptIndexByKey.get(resumeMarkerKey) ?? -1) : -1
    if (index >= 0) jumpToTranscriptIndex(index)
  }, [jumpToTranscriptIndex, resumeMarkerKey, transcriptIndexByKey])

  const moveSelection = useCallback((delta: number) => {
    if (sessions.length === 0) return
    // Navigate in sidebar visual order (grouped by project), not raw time-sort order.
    const sessionEntries = sidebarEntries.filter((e): e is Extract<SidebarEntry, { type: 'session' }> => e.type === 'session')
    if (sessionEntries.length === 0) return
    const currentPos = sessionEntries.findIndex((e) => e.absoluteIndex === (selectedIndex >= 0 ? selectedIndex : 0))
    const nextPos = clamp((currentPos >= 0 ? currentPos : 0) + delta, 0, sessionEntries.length - 1)
    const nextEntry = sessionEntries[nextPos]
    if (nextEntry) {
      setSelectedSessionKey(sessionKey(nextEntry.session))
      setError(null)
    }
  }, [selectedIndex, sessions.length, sidebarEntries])

  const moveCursor = useCallback((delta: number) => {
    if (transcriptCards.length === 0) return
    const nextIndex = clamp((cursorIndex >= 0 ? cursorIndex : 0) + delta, 0, transcriptCards.length - 1)
    setTranscriptCursorKey(transcriptCards[nextIndex].key)
    const atTail = nextIndex === transcriptCards.length - 1
    setFollowTail(atTail)
    if (atTail) {
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
    }
  }, [cursorIndex, transcriptCards])

  const moveViewport = useCallback((direction: -1 | 1) => {
    const step = Math.max(Math.floor((height - (focusMode ? 5 : 7)) / 3), 1)
    moveCursor(direction * step)
  }, [focusMode, height, moveCursor])

  const jumpToMatchingCard = useCallback((direction: -1 | 1, predicate: (card: TuiTranscriptCard) => boolean) => {
    if (transcriptCards.length === 0) return
    let index = cursorIndex >= 0 ? cursorIndex + direction : direction > 0 ? 0 : transcriptCards.length - 1
    while (index >= 0 && index < transcriptCards.length) {
      if (predicate(transcriptCards[index])) {
        jumpToTranscriptIndex(index)
        return
      }
      index += direction
    }
  }, [cursorIndex, jumpToTranscriptIndex, transcriptCards])

  const jumpToSearchMatch = useCallback((matchOffset: number) => {
    if (searchMatches.length === 0) return
    const nextMatchIndex = (searchMatchIndex + matchOffset + searchMatches.length) % searchMatches.length
    setSearchMatchIndex(nextMatchIndex)
    jumpToTranscriptIndex(searchMatches[nextMatchIndex] ?? 0)
  }, [jumpToTranscriptIndex, searchMatchIndex, searchMatches])

  const toggleExpansion = useCallback(() => {
    const card = cursorIndex >= 0 ? transcriptCards[cursorIndex] : null
    if (!card) return
    const shouldAutoFold = transcriptView === 'conversation' && card.autoFold
    const isExpanded = resolvedExpandedKeys.has(card.key)

    if (shouldAutoFold) {
      setCollapsedCardKeys((current) => {
        if (!current.has(card.key)) return current
        const next = new Set(current)
        next.delete(card.key)
        return next
      })
      setExpandedCardKeys((current) => {
        const next = new Set(current)
        if (isExpanded) next.delete(card.key)
        else next.add(card.key)
        return next
      })
      return
    }

    setExpandedCardKeys((current) => {
      if (!current.has(card.key)) return current
      const next = new Set(current)
      next.delete(card.key)
      return next
    })
    setCollapsedCardKeys((current) => {
      const next = new Set(current)
      if (isExpanded) next.add(card.key)
      else next.delete(card.key)
      return next
    })
  }, [cursorIndex, resolvedExpandedKeys, transcriptCards, transcriptView])

  const closeProviderMenu = useCallback(() => {
    setProviderMenuOpen(false)
    setProviderMenuIndex(Math.max(PROVIDERS.indexOf(provider), 0))
  }, [provider])

  const openThemeMenu = useCallback(() => {
    themeMenuOriginRef.current = themeMode
    setThemeMenuIndex(Math.max(THEMES.indexOf(themeMode), 0))
    setThemeMenuOpen(true)
  }, [themeMode])

  const closeThemeMenu = useCallback(() => {
    const originTheme = themeMenuOriginRef.current
    setThemeMenuOpen(false)
    if (originTheme) {
      setThemeMode(originTheme)
      setThemeMenuIndex(Math.max(THEMES.indexOf(originTheme), 0))
    } else {
      setThemeMenuIndex(Math.max(THEMES.indexOf(themeMode), 0))
    }
    themeMenuOriginRef.current = null
  }, [themeMode])

  const chooseTheme = useCallback((nextTheme: TuiThemeMode) => {
    setThemeMode(nextTheme)
    setThemeMenuIndex(Math.max(THEMES.indexOf(nextTheme), 0))
    themeMenuOriginRef.current = null
    void writeTuiTheme(nextTheme).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store theme')
    })
    setThemeMenuOpen(false)
  }, [])

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false)
    setCommandPaletteQuery('')
    setCommandPaletteIndex(0)
  }, [])

  const filteredCommands = useMemo(() => {
    const q = commandPaletteQuery.toLowerCase()
    if (!q) return COMMANDS
    return COMMANDS.filter((cmd) => cmd.label.toLowerCase().includes(q))
  }, [commandPaletteQuery])

  useEffect(() => {
    if (!themeMenuOpen) return
    const previewTheme = THEMES[themeMenuIndex]
    if (previewTheme && previewTheme !== themeMode) setThemeMode(previewTheme)
  }, [themeMenuIndex, themeMenuOpen, themeMode])

  useEffect(() => {
    currentThemeRef.current = themeMode
  }, [themeMode])

  useEffect(() => {
    const persist = () => {
      try { writeTuiThemeSync(currentThemeRef.current) } catch { /* best-effort */ }
    }
    const onSignal = () => {
      persist()
      process.exit(0)
    }
    process.on('exit', persist)
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
    process.on('SIGHUP', onSignal)
    return () => {
      process.off('exit', persist)
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      process.off('SIGHUP', onSignal)
    }
  }, [])

  const paletteDisplayRows = useMemo((): PaletteRow[] => {
    if (commandPaletteQuery) {
      return filteredCommands.map((cmd, cmdIndex) => ({ kind: 'cmd', cmd, cmdIndex }))
    }
    const rows: PaletteRow[] = []
    let lastCategory = ''
    filteredCommands.forEach((cmd, cmdIndex) => {
      if (cmd.category !== lastCategory) {
        rows.push({ kind: 'header', label: cmd.category })
        lastCategory = cmd.category
      }
      rows.push({ kind: 'cmd', cmd, cmdIndex })
    })
    return rows
  }, [commandPaletteQuery, filteredCommands])

  const chooseProvider = useCallback(async (
    nextProvider: ProviderSelection,
    targetSession: Session | null = null,
  ) => {
    if (nextProvider === provider) {
      closeProviderMenu()
      if (targetSession) setSelectedSessionKey(sessionKey(targetSession))
      return
    }

    closeProviderMenu()
    providerSwitchRef.current = true
    setProvider(nextProvider)
    setSessionDetail(null)
    setSelectedSessionKey(targetSession ? sessionKey(targetSession) : null)
    setTranscriptCursorKey(null)
    setExpandedCardKeys(new Set())
    setCollapsedCardKeys(new Set())
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
    setResumeMarkerKey(null)
    setSearchMode(false)
    setSearchQuery('')
    setSearchMatchIndex(0)
    setRestoredReaderState({ sessionKey: null, loaded: false, state: null })
    setError(null)

    try {
      await writeTuiProvider(nextProvider)
      await refreshSessions(nextProvider, targetSession !== null, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch provider')
    } finally {
      providerSwitchRef.current = false
    }
  }, [closeProviderMenu, provider, refreshSessions])

  // Select a session that is already an open tab. If the tab belongs to a
  // different provider than the one currently active, transparently switch
  // providers first (carrying the target session through) so cross-provider
  // tab navigation works without losing the tab's context.
  const selectTabSession = useCallback((session: Session) => {
    const targetProvider: ProviderSelection = session.provider ?? 'claude'
    if (provider !== 'all' && targetProvider !== provider) {
      void chooseProvider(targetProvider, session)
      return
    }
    setSelectedSessionKey(sessionKey(session))
  }, [chooseProvider, provider])

  const cancelComposerSend = useCallback(() => {
    if (composerAbortRef.current) {
      composerAbortRef.current.abort()
    }
    composerAbortRef.current = null
    setComposerSendState('idle')
    setComposerLiveText('')
  }, [])

  // Keep the ref in sync on every render so commitRename always reads the latest draft,
  // regardless of which version of the callback is held by onSubmit or the keyboard handler.
  renameDraftRef.current = renameDraft

  const commitRename = useCallback(async () => {
    if (!renameSessionKey || !selectedSession) return
    const trimmed = renameDraftRef.current.trim()
    setRenameSessionKey(null)
    setRenameDraft('')
    renameDraftRef.current = ''
    if (!trimmed) return
    setSessions((prev) => prev.map((session) => (
      sessionKey(session) === renameSessionKey
        ? { ...session, customTitle: trimmed, summary: trimmed }
        : session
    )))
    setOpenTabSessions((prev) => prev.map((session) => (
      sessionKey(session) === renameSessionKey
        ? { ...session, customTitle: trimmed, summary: trimmed }
        : session
    )))
    setSessionDetail((prev) => (
      prev && selectedSession && sessionKey(selectedSession) === renameSessionKey && prev.info
        ? {
            ...prev,
            info: {
              ...prev.info,
              customTitle: trimmed,
              summary: trimmed,
            },
          }
        : prev
    ))
    const cachedDetail = sessionDetailCacheRef.current.get(renameSessionKey)
    if (cachedDetail?.info) {
      touchMapEntry(sessionDetailCacheRef.current, renameSessionKey, {
        ...cachedDetail,
        info: {
          ...cachedDetail.info,
          customTitle: trimmed,
          summary: trimmed,
        },
      })
    }
    try {
      await patchTuiSession(selectedSession, { title: trimmed })
      void refreshSessions(provider, true, false)
    } catch {
      // rename failed silently — session list will show original title on next poll
    }
  }, [renameSessionKey, selectedSession, provider, refreshSessions])

  const sendComposerMessage = useCallback(async () => {
    if (composerSendState === 'sending') return
    const trimmed = composerDraft.trim()
    if (!trimmed || !composerTargetSession) return

    const targetSession = composerTargetSession
    const controller = new AbortController()
    composerAbortRef.current = controller
    setComposerSendState('sending')
    setComposerError(null)
    // no longer track awaiting state separately
    setComposerLiveText('')

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

    try {
      const res = await fetch(buildApiUrl(`/api/sessions/${targetSession.sessionId}/messages`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          provider: targetSession.provider,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }

      reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')
      const decoder = new TextDecoder()
      let sseBuffer = ''

      const handleFrame = (frame: SseFrame) => {
        let parsed: unknown = null
        try {
          parsed = JSON.parse(frame.data)
        } catch {
          parsed = null
        }
        if (frame.event === 'error') {
          const message = (
            parsed && typeof parsed === 'object'
              ? (parsed as Record<string, unknown>).error
              : undefined
          )
          throw new Error(typeof message === 'string' ? message : 'Unknown agent error')
        }
        if (frame.event === 'context-usage' && parsed) {
          setContextUsage(parsed as import('../../lib/types').ContextUsage)
          return
        }
        if (!parsed) return
        const delta = extractStreamingAssistantText(parsed)
        if (!delta) return
        setComposerLiveText((prev) => shouldReplaceLiveAssistantText(parsed) ? delta : `${prev}${delta}`)
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        sseBuffer += decoder.decode(value, { stream: true })
        const { frames, remaining } = extractSseFrames(sseBuffer)
        sseBuffer = remaining
        for (const frame of frames) {
          handleFrame(frame)
        }
      }

      if (sseBuffer.trim()) {
        const { frames } = extractSseFrames(`${sseBuffer}\n\n`)
        for (const frame of frames) {
          handleFrame(frame)
        }
      }

      setSentHistory((prev) => [...prev, trimmed])
      setHistoryIndex(-1)
      setDraftBeforeHistory('')
      setComposerDraft('')
      setComposerSendState('idle')
      setComposerError(null)
      setFollowTail(true)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      setSelectedSessionKey(sessionKey(targetSession))
      void refreshSessions(provider, true, false)
      void refreshSelectedSessionDetail(targetSession, false)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      setComposerSendState('error')
      setComposerError(err instanceof Error ? err.message : 'Failed to send message')
      setComposerLiveText('')
    } finally {
      void reader?.cancel()
      composerAbortRef.current = null
      setComposerLiveText('')
    }
  }, [
    composerTargetSession,
    composerDraft,
    composerSendState,
    provider,
    refreshSessions,
    refreshSelectedSessionDetail,
  ])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [
          configuredTheme,
          configuredProvider,
          configuredRailVisible,
          configuredFocusMode,
          configuredDensity,
          configuredTranscriptView,
          configuredTabsEnabled,
          configuredSidebarSort,
          configuredSidebarWidth,
          configuredShowToolCalls,
        ] = await Promise.all([
          readTuiTheme(),
          readTuiProvider(),
          readTuiRailVisible(),
          readTuiFocusMode(),
          readTuiDensity(),
          readTuiTranscriptView(),
          readTuiTabsEnabled(),
          readTuiSidebarSort(),
          readTuiSidebarWidth(),
          readTuiShowToolCalls(),
        ])
        if (cancelled) return
        setThemeMode(configuredTheme)
        setActiveTheme(configuredTheme)
        setProvider(configuredProvider)
        setRailVisible(configuredRailVisible)
        setFocusMode(configuredFocusMode)
        setDensity(configuredDensity)
        setTranscriptView(configuredTranscriptView)
        setTabsEnabled(configuredTabsEnabled)
        setSidebarSort(configuredSidebarSort)
        setSidebarWidthPreference(configuredSidebarWidth)
        setShowToolCalls(configuredShowToolCalls)
        if (!configuredRailVisible || configuredFocusMode) setFocusedPane('messages')
        await Promise.all([
          refreshSessions(configuredProvider, false, true),
          refreshRunningSessions(),
        ])
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to initialize OpenTUI')
        setLoadingSessions(false)
      } finally {
        if (!cancelled) setBootstrapped(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [refreshRunningSessions, refreshSessions])

  useEffect(() => {
    if (!bootstrapped) return
    if (!selectedSessionTarget) {
      setSessionDetail(null)
      setLoadingDetail(false)
      return
    }

    const cachedDetail = sessionDetailCacheRef.current.get(sessionKey(selectedSessionTarget)) ?? null
    setSessionDetail(cachedDetail)
    void refreshSelectedSessionDetail(selectedSessionTarget, true)
  }, [bootstrapped, refreshSelectedSessionDetail, selectedSessionIdentity, selectedSessionTarget])

  useEffect(() => {
    if (selectedSession || sessions.length === 0) return
    setSelectedSessionKey(sessionKey(sessions[0]))
  }, [selectedSession, sessions])

  useEffect(() => {
    if (!bootstrapped) return undefined
    let active = true
    const interval = setInterval(() => {
      if (!active || loadingSessions || providerSwitchRef.current) return
      void refreshSessions(provider, true, false)
    }, SESSION_REFRESH_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [bootstrapped, loadingSessions, provider, refreshSessions])

  useEffect(() => {
    if (!bootstrapped || !selectedSessionTarget) return undefined
    let active = true
    const interval = setInterval(() => {
      if (!active || providerSwitchRef.current) return
      void refreshSelectedSessionDetail(selectedSessionTarget, false)
    }, DETAIL_REFRESH_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [bootstrapped, refreshSelectedSessionDetail, selectedSessionIdentity, selectedSessionTarget])

  useEffect(() => {
    if (!bootstrapped || !tabsEnabled || openTabSessions.length === 0) return undefined
    let active = true
    const interval = setInterval(() => {
      if (!active || providerSwitchRef.current) return
      const selectedKey = selectedSessionKeyRef.current
      const backgroundTabs = openTabSessionsRef.current.filter((tab) => sessionKey(tab) !== selectedKey)
      if (backgroundTabs.length === 0) return
      const cursor = backgroundMetadataCursorRef.current % backgroundTabs.length
      backgroundMetadataCursorRef.current = (backgroundMetadataCursorRef.current + 1) % backgroundTabs.length
      const target = backgroundTabs[cursor]
      if (!target) return
      // Context usage metadata is disabled for open tabs.
      // void refreshSessionMetadata(target, false)
    }, CLAUDE_BACKGROUND_METADATA_REFRESH_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [bootstrapped, openTabSessions.length, refreshSessionMetadata, tabsEnabled])

  useEffect(() => {
    if (!bootstrapped) return undefined
    let active = true
    const interval = setInterval(() => {
      if (!active) return
      void refreshRunningSessions()
    }, RUNNING_SESSION_REFRESH_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [bootstrapped, refreshRunningSessions])

  useEffect(() => {
    let cancelled = false

    setTranscriptCursorKey(null)
    setExpandedCardKeys(new Set())
    setCollapsedCardKeys(new Set())
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
    setResumeMarkerKey(null)
    setSearchMode(false)
    setSearchQuery('')
    setSearchMatchIndex(0)
    setRestoredReaderState({
      sessionKey: selectedSessionKey,
      loaded: selectedSessionKey == null,
      state: null,
    })

    if (!selectedSessionKey) {
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      try {
        const state = await readTuiSessionReaderState(selectedSessionKey)
        if (cancelled) return
        setRestoredReaderState({
          sessionKey: selectedSessionKey,
          loaded: true,
          state,
        })
        if (state) {
          setExpandedCardKeys(new Set(state.expandedKeys))
          setCollapsedCardKeys(new Set(state.collapsedKeys))
          if (state.followTail === false) {
            setTranscriptCursorKey(state.cursorKey)
            setFollowTail(false)
            setResumeMarkerKey(state.cursorKey)
          }
        }
      } catch {
        if (cancelled) return
        setRestoredReaderState({
          sessionKey: selectedSessionKey,
          loaded: true,
          state: null,
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedSessionKey])

  useEffect(() => {
    // Skip building the `allowed` Set when both sets are empty — the common
    // case on a freshly loaded session — otherwise every poll rebuilds an
    // O(n) Set from the transcript for nothing. We also build the allowed
    // Set at most once and share it between both state updates.
    let allowed: Set<string> | null = null
    setExpandedCardKeys((current) => {
      if (current.size === 0) return current
      if (!allowed) allowed = new Set(transcriptCards.map((card) => card.key))
      let changed = false
      const next = new Set<string>()
      for (const key of current) {
        if (allowed.has(key)) next.add(key)
        else changed = true
      }
      return changed ? next : current
    })
    setCollapsedCardKeys((current) => {
      if (current.size === 0) return current
      if (!allowed) allowed = new Set(transcriptCards.map((card) => card.key))
      let changed = false
      const next = new Set<string>()
      for (const key of current) {
        if (allowed.has(key)) next.add(key)
        else changed = true
      }
      return changed ? next : current
    })
  }, [transcriptCards])

  useEffect(() => {
    const currentKeys = transcriptCards.map((card) => card.key)
    const previous = previousTranscriptRef.current
    const sameSession = previous.sessionKey === selectedSessionKey

    if (currentKeys.length === 0) {
      setTranscriptCursorKey(null)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
      return
    }

    if (!sameSession) {
      if (restoredReaderState.sessionKey !== selectedSessionKey || !restoredReaderState.loaded) return
      const restoredState = restoredReaderState.state
      if (restoredState?.followTail === false) {
        const restoredIndex = restoredState.cursorKey ? (transcriptIndexByKey.get(restoredState.cursorKey) ?? -1) : -1
        const targetIndex = restoredIndex >= 0 ? restoredIndex : 0
        setTranscriptCursorKey(transcriptCards[targetIndex]?.key ?? transcriptCards[0].key)
        setFollowTail(false)
        setPendingNewCount(0)
        setUnreadBoundaryKey(null)
        setResumeMarkerKey(restoredState.cursorKey)
      } else {
        setTranscriptCursorKey(transcriptCards[transcriptCards.length - 1].key)
        setFollowTail(true)
        setPendingNewCount(0)
        setUnreadBoundaryKey(null)
        setResumeMarkerKey(null)
      }
      previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
      return
    }

    if (followTail) {
      setTranscriptCursorKey(transcriptCards[transcriptCards.length - 1].key)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
      return
    }

    const previousLastKey = previous.keys.at(-1) ?? null
    const previousLastIndex = previousLastKey ? currentKeys.indexOf(previousLastKey) : -1
    const appendedCount = previousLastIndex >= 0
      ? currentKeys.length - previousLastIndex - 1
      : 0

    if (appendedCount > 0) {
      setPendingNewCount(appendedCount)
      setUnreadBoundaryKey((current) => {
        if (current && currentKeys.includes(current)) return current
        return currentKeys[previousLastIndex + 1] ?? null
      })
    }

    setTranscriptCursorKey((current) => {
      if (current && currentKeys.includes(current)) return current
      return transcriptCards[Math.max(cursorIndex, 0)]?.key ?? transcriptCards[0].key
    })
    previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
    // cursorIndex is intentionally omitted from deps: the effect reconciles
    // cursor/pending state when transcriptCards changes, and the cursorIndex
    // fallback only fires when the current cursor key is missing from the new
    // card list. Re-running on every j/k keystroke would do O(n) indexOf +
    // includes work over the full transcript for a no-op setter result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    followTail,
    restoredReaderState,
    selectedSessionKey,
    transcriptCards,
    transcriptIndexByKey,
  ])


  useEffect(() => {
    if (!selectedSessionKey || !restoredReaderState.loaded || restoredReaderState.sessionKey !== selectedSessionKey) {
      return
    }

    if (readerStateWriteTimeoutRef.current) clearTimeout(readerStateWriteTimeoutRef.current)

    const persistSignature = [
      selectedSessionKey,
      followTail ? 'follow' : 'free',
      transcriptCursorKey ?? '',
      expandedKeysRevisionRef.current,
      collapsedKeysRevisionRef.current,
    ].join('|')
    if (readerStatePersistSignatureRef.current === persistSignature) return

    // Build the persist payload inside the debounce timer so the O(n) work
    // over transcriptCards + expanded/collapsed keys only runs once per pause
    // — not on every j/k keystroke. This was a visible hitch on large
    // sessions when rapidly navigating the cursor on Windows.
    readerStateWriteTimeoutRef.current = setTimeout(() => {
      const validKeys = new Set(transcriptCards.map((card) => card.key))
      const persistState: TuiSessionReaderState = {
        followTail,
        cursorKey: followTail ? null : (transcriptCursorKey && validKeys.has(transcriptCursorKey) ? transcriptCursorKey : null),
        topKey: null,
        expandedKeys: [...expandedCardKeys].filter((key) => validKeys.has(key)),
        collapsedKeys: [...collapsedCardKeys].filter((key) => validKeys.has(key)),
      }
      readerStatePersistSignatureRef.current = persistSignature
      void writeTuiSessionReaderState(selectedSessionKey, persistState).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to store reader position')
      })
    }, 150)

    return () => {
      if (readerStateWriteTimeoutRef.current) {
        clearTimeout(readerStateWriteTimeoutRef.current)
        readerStateWriteTimeoutRef.current = null
      }
    }
  }, [
    collapsedCardKeys,
    expandedCardKeys,
    followTail,
    restoredReaderState,
    selectedSessionKey,
    transcriptCards,
    transcriptCursorKey,
  ])

  useEffect(() => {
    if (searchMatches.length === 0) {
      setSearchMatchIndex(0)
      return
    }
    setSearchMatchIndex((current) => clamp(current, 0, searchMatches.length - 1))
  }, [searchMatches.length])

  // Promote the currently-previewed session to a real open tab.
  // We use the full `selectedSession` object so tabs retain provider context
  // even when the user later switches to a different provider.
  const promotePreviewToTab = useCallback(() => {
    if (!selectedSession) return
    const key = sessionKey(selectedSession)
    setOpenTabSessions((current) => {
      if (current.some((s) => sessionKey(s) === key)) return current
      return [...current, selectedSession]
    })
  }, [selectedSession])

  // Keep open-tab metadata in sync when the current provider's sessions list
  // refreshes (e.g. title updates from polling). Tabs for *other* providers
  // are left untouched — they retain whatever snapshot was captured when the
  // user last visited them.
  useEffect(() => {
    if (sessions.length === 0) return
    setOpenTabSessions((current) => {
      let changed = false
      const next = current.map((tab) => {
        const fresh = sessions.find((s) => sessionKey(s) === sessionKey(tab))
        if (fresh && fresh !== tab) {
          changed = true
          return fresh
        }
        return tab
      })
      return changed ? next : current
    })
  }, [sessions])

  // Sync tab-select visual position when active tab changes
  useEffect(() => {
    if (!tabSelectRef.current || activeTabIndex < 0) return
    tabSelectRef.current.setSelectedIndex(activeTabIndex)
  }, [activeTabIndex])

  useEffect(() => {
    if (!transcriptCursorKey) return
    if (followTail) return
    const timer = setTimeout(() => {
      transcriptScrollRef.current?.scrollChildIntoView(`card:${transcriptCursorKey}`)
    }, 0)
    return () => clearTimeout(timer)
  }, [followTail, transcriptCursorKey])

  useLayoutEffect(() => {
    if (!followTail) return
    if (transcriptCards.length === 0) return
    const lastKey = transcriptCards[transcriptCards.length - 1]?.key
    if (!lastKey) return
    transcriptScrollRef.current?.scrollChildIntoView(`card:${lastKey}`)
  }, [followTail, transcriptCards.length])

  useEffect(() => {
    const entry = sidebarEntries[selectedSidebarEntryIndex]
    if (!entry) return
    const prev = sidebarEntries[selectedSidebarEntryIndex - 1]
    const scrollKey = prev?.type === 'project' ? prev.key : entry.key
    const timer = setTimeout(() => {
      sidebarScrollRef.current?.scrollChildIntoView(`sidebar:${scrollKey}`)
    }, 0)
    return () => clearTimeout(timer)
  }, [selectedSidebarEntryIndex, sidebarEntries])

  useEffect(() => {
    if (followTail) {
      pausedTranscriptScrollTopRef.current = null
      return
    }
    const scrollTop = transcriptScrollRef.current?.scrollTop
    if (typeof scrollTop === 'number') {
      pausedTranscriptScrollTopRef.current = scrollTop
    }
  }, [followTail, transcriptCards.length])

  useLayoutEffect(() => {
    if (followTail) {
      if (transcriptCards.length > 0 && (prevTranscriptLengthRef.current !== transcriptCards.length || !prevFollowTailRef.current)) {
        transcriptScrollRef.current?.scrollTo(transcriptScrollRef.current?.scrollHeight ?? Number.MAX_SAFE_INTEGER)
      }
    } else {
      const scrollTop = pausedTranscriptScrollTopRef.current
      if (scrollTop != null) {
        transcriptScrollRef.current?.scrollTo(scrollTop)
      }
    }
    prevFollowTailRef.current = followTail
    prevTranscriptLengthRef.current = transcriptCards.length
  }, [followTail, transcriptCards.length])

  const footerText = useMemo(
    () => fitText(
      `tab focus  j/k move  ctrl-u/d page  ←/→ tabs  w close tab  b ${tabsEnabled ? 'hide' : 'show'} tabs  () convo  {} tech  u unread  m mark  / search  n/N hits  f live  e fold  v ${transcriptView}  d ${density}  h rail  z focus  p provider  t theme  T thinking  X ${showToolCalls ? 'hide tools' : 'show tools'}  r refresh  ? commands  q quit`,
      Math.max(width - 4, 20),
    ),
    [width, transcriptView, density, tabsEnabled, showToolCalls],
  )

  const composerStatusMessage = composerError
    ? composerError
    : composerSendState === 'sending'
      ? composerLiveText || 'Waiting for saved response…'
      : null
  const composerTargetMessage = composerAutoTargetingRunning && composerTargetSession
    ? `Auto-targeting running ${String(composerTargetSession.provider ?? 'claude').toUpperCase()} session ${composerTargetSession.sessionId.slice(-8)}`
    : null

  const resizeSidebar = useCallback((delta: number) => {
    const nextWidth = clamp(sidebarWidth + delta, MIN_SIDEBAR_WIDTH, maxSidebarWidth)
    if (nextWidth === sidebarWidth) return
    setSidebarWidthPreference(nextWidth)
    void writeTuiSidebarWidth(nextWidth).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store sidebar width')
    })
  }, [maxSidebarWidth, sidebarWidth])

  const showNotice = useCallback((tone: NoticeTone, text: string) => {
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current)
    setNotice({ tone, text })
    noticeTimeoutRef.current = setTimeout(() => {
      setNotice((current) => current?.text === text ? null : current)
      noticeTimeoutRef.current = null
    }, 2000)
  }, [])

  const copySelectedMessage = useCallback(async () => {
    const card = cursorIndex >= 0 ? transcriptCards[cursorIndex] : null
    if (!card) {
      showNotice('error', 'No message selected')
      return
    }
    const text = cardClipboardText(card)
    if (!text) {
      showNotice('error', 'Selected message has no copyable text')
      return
    }
    try {
      await writeClipboard(text)
      showNotice('info', 'Copied selected message to clipboard')
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to copy to clipboard')
    }
  }, [cursorIndex, showNotice, transcriptCards])

  const executeCommandPalette = useCallback((id: string) => {
    closeCommandPalette()
    switch (id) {
      case 'provider':
        setProviderMenuIndex(Math.max(PROVIDERS.indexOf(provider), 0))
        setProviderMenuOpen(true)
        break
      case 'theme': {
        openThemeMenu()
        break
      }
      case 'density': {
        const next = cycleDensityValue(density)
        setDensity(next)
        void writeTuiDensity(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store density'))
        break
      }
      case 'rail': {
        const nextVisible = !railVisible
        setRailVisible(nextVisible)
        if (!nextVisible && focusedPane === 'sessions') setFocusedPane('messages')
        void writeTuiRailVisible(nextVisible).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store rail'))
        break
      }
      case 'focus': {
        const next = !focusMode
        setFocusMode(next)
        if (next) setFocusedPane('messages')
        void writeTuiFocusMode(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store focus mode'))
        break
      }
      case 'tools': {
        setShowToolCalls((v) => {
          const next = !v
          void writeTuiShowToolCalls(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tool visibility'))
          return next
        })
        break
      }
      case 'view': {
        const next = cycleTranscriptViewValue(transcriptView)
        setTranscriptView(next)
        void writeTuiTranscriptView(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store transcript view'))
        break
      }
      case 'live':
        setFocusedPane('messages')
        jumpToTranscriptTail()
        break
      case 'unread':
        setFocusedPane('messages')
        jumpToUnreadBoundary()
        break
      case 'mark':
        setFocusedPane('messages')
        jumpToResumeMarker()
        break
      case 'search':
        setFocusedPane('messages')
        setSearchMode(true)
        break
      case 'fold':
        setFocusedPane('messages')
        toggleExpansion()
        break
      case 'copy':
        setFocusedPane('messages')
        void copySelectedMessage()
        break
      case 'tab-toggle': {
        const next = !tabsEnabled
        setTabsEnabled(next)
        void writeTuiTabsEnabled(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tab setting'))
        break
      }
      case 'tab-prev': {
        setFocusedPane('messages')
        const prevIdx = Math.max(activeTabIndex - 1, 0)
        const prev = openTabSessions[prevIdx]
        if (prev) selectTabSession(prev)
        break
      }
      case 'tab-next': {
        setFocusedPane('messages')
        const nextIdx = Math.min(activeTabIndex + 1, openTabSessions.length - 1)
        const next = openTabSessions[nextIdx]
        if (next) selectTabSession(next)
        break
      }
      case 'tab-close': {
        if (selectedSessionKey) {
          const idx = openTabSessions.findIndex((s) => sessionKey(s) === selectedSessionKey)
          const next = openTabSessions.filter((s) => sessionKey(s) !== selectedSessionKey)
          setOpenTabSessions(next)
          if (next.length > 0) {
            const newActive = next[Math.min(Math.max(idx, 0), next.length - 1)]
            if (newActive) selectTabSession(newActive)
          } else {
            const first = sessions[0]
            setSelectedSessionKey(first ? sessionKey(first) : null)
          }
        }
        break
      }
      case 'composer':
        setComposerActive(true)
        break
      case 'thinking':
        setThinkingMode((current) => !current)
        break
      case 'git':
        setGitOpen(true)
        break
      case 'analytics':
        setAnalyticsOpen(true)
        break
      case 'rename':
        if (selectedSession) {
          setRenameSessionKey(sessionKey(selectedSession))
          setRenameDraft(formatSessionTitle(selectedSession))
        }
        break
      case 'sort': {
        const next: TuiSidebarSort = sidebarSort === 'project' ? 'time' : 'project'
        setSidebarSort(next)
        void writeTuiSidebarSort(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store sidebar sort'))
        break
      }
      case 'refresh':
        void refreshSessions(provider)
        if (selectedSessionTarget) void refreshSelectedSessionDetail(selectedSessionTarget, false)
        break
      case 'quit':
        renderer.destroy()
        process.exit(0)
    }
  }, [
    activeTabIndex, closeCommandPalette, copySelectedMessage, density, focusMode, focusedPane, jumpToResumeMarker,
    tabsEnabled, sidebarSort,
    jumpToTranscriptTail, jumpToUnreadBoundary, openTabSessions, provider, railVisible,
    refreshSessions, refreshSelectedSessionDetail, renderer, selectTabSession, selectedSessionKey,
    selectedSession, selectedSessionTarget, sessions, themeMode, toggleExpansion, transcriptView,
  ])

  useKeyboard((key) => {
    if (key.eventType === 'release') return
    const sequence = key.sequence || ''
    const isShifted = (char: string): boolean => key.name === char.toLowerCase() && key.shift
    const isCtrl = (char: string): boolean => {
      const normalized = char.toLowerCase()
      const code = normalized.charCodeAt(0)
      const ctrlSequence = code >= 97 && code <= 122
        ? String.fromCharCode(code - 96)
        : ''
      return (key.ctrl && key.name === normalized) || sequence === ctrlSequence
    }
    const handled = (action: () => void): void => {
      key.preventDefault()
      key.stopPropagation()
      action()
    }

    if (searchMode) {
      if (key.name === 'escape') {
        handled(() => {
          setSearchMode(false)
        })
      }
      return
    }

    if (sessionSearchMode) {
      if (key.name === 'escape') {
        handled(() => {
          setSessionSearchMode(false)
          setSessionSearchQuery('')
        })
      }
      return
    }

    if (gitOpen) {
      handled(() => { gitKeyHandlerRef.current?.(key) })
      return
    }

    if (analyticsOpen) {
      handled(() => { analyticsKeyHandlerRef.current?.(key) })
      return
    }

    if (renameSessionKey) {
      if (key.name === 'escape') {
        handled(() => { setRenameSessionKey(null); setRenameDraft('') })
      } else if (key.name === 'return') {
        handled(commitRename)
      }
      return
    }

    if (providerMenuOpen) {
      if (key.name === 'escape' || key.name === 'p') {
        handled(() => {
          closeProviderMenu()
        })
        return
      }
      if (key.name === 'q' || isCtrl('c')) {
        handled(() => {
          renderer.destroy()
          process.exit(0)
        })
      }
      return
    }

    if (themeMenuOpen) {
      if (key.name === 'j' || key.name === 'down') {
        handled(() => setThemeMenuIndex((i) => Math.min(i + 1, THEMES.length - 1)))
        return
      }
      if (key.name === 'k' || key.name === 'up') {
        handled(() => setThemeMenuIndex((i) => Math.max(i - 1, 0)))
        return
      }
      if (key.name === 'return') {
        handled(() => {
          const nextTheme = THEMES[themeMenuIndex]
          if (nextTheme) chooseTheme(nextTheme)
        })
        return
      }
      if (key.name === 'escape' || key.name === 't') {
        handled(() => {
          closeThemeMenu()
        })
        return
      }
      if (key.name === 'q' || isCtrl('c')) {
        handled(() => {
          renderer.destroy()
          process.exit(0)
        })
      }
      return
    }

    if (commandPaletteOpen) {
      if (key.name === 'escape' || sequence === '?') {
        handled(closeCommandPalette)
        return
      }
      if (key.name === 'j' || key.name === 'down') {
        handled(() => setCommandPaletteIndex((i) => Math.min(i + 1, filteredCommands.length - 1)))
        return
      }
      if (key.name === 'k' || key.name === 'up') {
        handled(() => setCommandPaletteIndex((i) => Math.max(i - 1, 0)))
        return
      }
      if (key.name === 'return') {
        handled(() => {
          const cmd = filteredCommands[commandPaletteIndex]
          if (cmd) executeCommandPalette(cmd.id)
        })
        return
      }
      if (key.name === 'backspace' || key.name === 'delete') {
        handled(() => {
          setCommandPaletteQuery((q) => q.slice(0, -1))
          setCommandPaletteIndex(0)
        })
        return
      }
      if (!key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ') {
        handled(() => {
          setCommandPaletteQuery((q) => q + sequence)
          setCommandPaletteIndex(0)
        })
        return
      }
      return
    }

    if (composerActive) {
      if (key.name === 'escape') {
        handled(() => {
          if (composerSendState === 'sending') {
            cancelComposerSend()
          } else {
            setComposerActive(false)
          }
        })
        return
      }
      if (key.name === 'up') {
        handled(() => {
          if (sentHistory.length === 0) return
          const nextIndex = historyIndex === -1
            ? sentHistory.length - 1
            : Math.max(historyIndex - 1, 0)
          if (historyIndex === -1) setDraftBeforeHistory(composerDraft)
          setHistoryIndex(nextIndex)
          setComposerDraft(sentHistory[nextIndex] ?? '')
        })
        return
      }
      if (key.name === 'down' && historyIndex !== -1) {
        handled(() => {
          const nextIndex = historyIndex + 1
          if (nextIndex >= sentHistory.length) {
            setHistoryIndex(-1)
            setComposerDraft(draftBeforeHistory)
          } else {
            setHistoryIndex(nextIndex)
            setComposerDraft(sentHistory[nextIndex] ?? '')
          }
        })
        return
      }
      return
    }

    if (key.name === 'q' || key.name === 'escape' || isCtrl('c')) {
      handled(() => {
        renderer.destroy()
        process.exit(0)
      })
      return
    }

    if (key.name === 'tab' && showRail) {
      handled(() => {
        const next: PaneFocus = focusedPane === 'sessions' ? 'messages' : 'sessions'
        if (next === 'messages') promotePreviewToTab()
        setFocusedPane(next)
      })
      return
    }

    // Global git status popover
    if (isCtrl('g')) {
      handled(() => setGitOpen(true))
      return
    }

    // Global analytics popover
    if (isCtrl('a')) {
      handled(() => setAnalyticsOpen(true))
      return
    }

    if (showRail && isCtrl('r') && selectedSession) {
      handled(() => {
        setRenameSessionKey(sessionKey(selectedSession))
        setRenameDraft(formatSessionTitle(selectedSession))
      })
      return
    }

    if (effectiveFocus === 'sessions' && (key.name === 'j' || key.name === 'down')) {
      handled(() => {
        moveSelection(1)
      })
      return
    }

    if (effectiveFocus === 'sessions' && (key.name === 'k' || key.name === 'up')) {
      handled(() => {
        moveSelection(-1)
      })
      return
    }

    if (effectiveFocus === 'sessions' && key.name === 'g' && !key.shift) {
      handled(() => {
        const first = sidebarEntries.find((e): e is Extract<SidebarEntry, { type: 'session' }> => e.type === 'session')
        if (first) setSelectedSessionKey(sessionKey(first.session))
      })
      return
    }

    if (effectiveFocus === 'sessions' && isShifted('G')) {
      handled(() => {
        const last = [...sidebarEntries].reverse().find((e): e is Extract<SidebarEntry, { type: 'session' }> => e.type === 'session')
        if (last) setSelectedSessionKey(sessionKey(last.session))
      })
      return
    }

    if (effectiveFocus === 'sessions' && isShifted('S')) {
      handled(() => {
        const next: TuiSidebarSort = sidebarSort === 'project' ? 'time' : 'project'
        setSidebarSort(next)
        void writeTuiSidebarSort(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store sidebar sort'))
      })
      return
    }

    if (showRail && sequence === '[') {
      handled(() => {
        resizeSidebar(-SIDEBAR_RESIZE_STEP)
      })
      return
    }

    if (showRail && sequence === ']') {
      handled(() => {
        resizeSidebar(SIDEBAR_RESIZE_STEP)
      })
      return
    }

    if (effectiveFocus === 'sessions' && key.name === 'return') {
      handled(() => {
        promotePreviewToTab()
        setFocusedPane('messages')
      })
      return
    }

    if (key.name === 'left' && showTabs) {
      handled(() => {
        const prevIdx = Math.max(activeTabIndex - 1, 0)
        const prev = visibleTabSessions[prevIdx]
        if (prev) selectTabSession(prev)
      })
      return
    }

    if (key.name === 'right' && showTabs) {
      handled(() => {
        const nextIdx = Math.min(activeTabIndex + 1, visibleTabSessions.length - 1)
        const next = visibleTabSessions[nextIdx]
        if (next) selectTabSession(next)
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'w' && showTabs && selectedSessionKey) {
      handled(() => {
        const idx = openTabSessions.findIndex((s) => sessionKey(s) === selectedSessionKey)
        const next = openTabSessions.filter((s) => sessionKey(s) !== selectedSessionKey)
        setOpenTabSessions(next)
        if (next.length > 0) {
          const newActive = next[Math.min(Math.max(idx, 0), next.length - 1)]
          if (newActive) selectTabSession(newActive)
        } else {
          setSelectedSessionKey(sessions[0] ? sessionKey(sessions[0]) : null)
        }
      })
      return
    }

    if (effectiveFocus === 'messages' && (key.name === 'j' || key.name === 'down')) {
      handled(() => {
        moveCursor(1)
      })
      return
    }

    if (effectiveFocus === 'messages' && (key.name === 'k' || key.name === 'up')) {
      handled(() => {
        moveCursor(-1)
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'g' && !key.shift) {
      handled(() => {
        jumpToTranscriptIndex(0)
      })
      return
    }

    if (effectiveFocus === 'messages' && isShifted('G')) {
      handled(() => {
        jumpToTranscriptTail()
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'pagedown') {
      handled(() => {
        moveCursor(Math.max(Math.floor(transcriptViewportRows * 0.8), 1))
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'pageup') {
      handled(() => {
        moveCursor(-Math.max(Math.floor(transcriptViewportRows * 0.8), 1))
      })
      return
    }

    if (effectiveFocus === 'messages' && isCtrl('d')) {
      handled(() => {
        moveViewport(1)
      })
      return
    }

    if (effectiveFocus === 'messages' && isCtrl('u')) {
      handled(() => {
        moveViewport(-1)
      })
      return
    }

    if (effectiveFocus === 'messages' && (key.name === 'return' || key.name === 'e')) {
      handled(() => {
        toggleExpansion()
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'f') {
      handled(() => {
        jumpToTranscriptTail()
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'u') {
      handled(() => {
        jumpToUnreadBoundary()
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'm') {
      handled(() => {
        jumpToResumeMarker()
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === '/') {
      handled(() => {
        setSearchMode(true)
      })
      return
    }

    if (effectiveFocus === 'sessions' && sequence === '/') {
      handled(() => {
        setSessionSearchMode(true)
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === 'y') {
      handled(() => {
        void copySelectedMessage()
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'n' && !key.shift && searchMatches.length > 0) {
      handled(() => {
        jumpToSearchMatch(1)
      })
      return
    }

    if (effectiveFocus === 'messages' && isShifted('N') && searchMatches.length > 0) {
      handled(() => {
        jumpToSearchMatch(-1)
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === '(') {
      handled(() => {
        jumpToMatchingCard(-1, (card) => card.category === 'conversation')
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === ')') {
      handled(() => {
        jumpToMatchingCard(1, (card) => card.category === 'conversation')
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === '{') {
      handled(() => {
        jumpToMatchingCard(-1, (card) => card.category !== 'conversation')
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === '}') {
      handled(() => {
        jumpToMatchingCard(1, (card) => card.category !== 'conversation')
      })
      return
    }

    if (sequence === 'c' && !composerActive) {
      handled(() => {
        setComposerActive(true)
      })
      return
    }

    if (sequence === 'T') {
      handled(() => {
        setThinkingMode((current) => !current)
      })
      return
    }

    if (sequence === 'X') {
      handled(() => {
        setShowToolCalls((v) => {
          const next = !v
          void writeTuiShowToolCalls(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tool visibility'))
          return next
        })
      })
      return
    }

    if (sequence === '?') {
      handled(() => {
        setCommandPaletteIndex(0)
        setCommandPaletteQuery('')
        setCommandPaletteOpen(true)
      })
      return
    }

    if (key.name === 'p') {
      handled(() => {
        setProviderMenuIndex(Math.max(PROVIDERS.indexOf(provider), 0))
        setProviderMenuOpen(true)
      })
      return
    }

    if (key.name === 't') {
      handled(() => {
        openThemeMenu()
      })
      return
    }

    if (key.name === 'b') {
      handled(() => {
        const next = !tabsEnabled
        setTabsEnabled(next)
        void writeTuiTabsEnabled(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store tab setting')
        })
      })
      return
    }

    if (key.name === 'h' && !key.shift) {
      handled(() => {
        const nextVisible = !railVisible
        setRailVisible(nextVisible)
        if (!nextVisible && focusedPane === 'sessions') setFocusedPane('messages')
        void writeTuiRailVisible(nextVisible).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store reader layout')
        })
      })
      return
    }

    if (key.name === 'z') {
      handled(() => {
        const next = !focusMode
        setFocusMode(next)
        if (next) setFocusedPane('messages')
        void writeTuiFocusMode(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store focus mode')
        })
      })
      return
    }

    if (key.name === 'd') {
      handled(() => {
        const next = cycleDensityValue(density)
        setDensity(next)
        void writeTuiDensity(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store density')
        })
      })
      return
    }

    if (key.name === 'v') {
      handled(() => {
        const next = cycleTranscriptViewValue(transcriptView)
        setTranscriptView(next)
        void writeTuiTranscriptView(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store transcript view')
        })
      })
      return
    }

    if (key.name === 'r') {
      handled(() => {
        void refreshSessions(provider)
        if (selectedSessionTarget) void refreshSelectedSessionDetail(selectedSessionTarget, false)
      })
    }
  })

  const statusLabel = loadingSessions ? 'syncing' : refreshingSessions ? 'refreshing' : 'live'
  const readerMode = followTail ? 'live mode' : pendingNewCount > 0 ? 'new content waiting' : 'reading mode'
  const sessionIdLabel = selectedSession?.sessionId
    ? `id ${selectedSession.sessionId.slice(-8)}`
    : null
  const headerStatusRight = useMemo(
    () => fitText(
      joinMeta([
        statusLabel,
        `position ${transcriptCards.length === 0 ? '0' : `${Math.max(cursorIndex, 0) + 1}`}/${transcriptCards.length}`,
        readerMode,
        sessionIdLabel,
        themeMode.toUpperCase(),
        provider.toUpperCase(),
        density.toUpperCase(),
        pendingNewCount > 0 ? `+${pendingNewCount} new` : null,
        !railVisible ? 'h show rail' : null,
      ]),
      Math.max(Math.floor(width * 0.55), 20),
    ),
    [statusLabel, transcriptCards.length, cursorIndex, readerMode, sessionIdLabel, themeMode, provider, density, pendingNewCount, railVisible, width],
  )
  const headerContextLeft = useMemo(
    () => fitText(
      joinMeta([
        `project ${currentProjectName(selectedSession)}`,
        `model ${readerModel}`,
      ]),
      Math.max(Math.floor(width * 0.45) - 16, 12),
    ),
    [selectedSession, readerModel, width],
  )
  const previewBarText = useMemo(
    () => selectedSession
      ? fitText(
          `${formatSessionTitle(selectedSession)}  ·  preview  ·  ↵ open  ·  tab focus`,
          Math.max(rightPaneWidth - 2, 16),
        )
      : '',
    [rightPaneWidth, selectedSession],
  )

  const providerOptions = PROVIDER_SELECT_OPTIONS
  const providerAccent = getProviderAccent(provider)
  const providerSummary = provider.toUpperCase()

  return (
    <box width={width} height={height} flexDirection="column" backgroundColor={theme.bg}>
      <box flexGrow={1} padding={1} gap={1} height={mainContentHeight} flexDirection="row" backgroundColor={theme.bg}>
        {showRail ? (
          <box
            width={sidebarWidth}
            border
            borderStyle="single"
            borderColor={effectiveFocus === 'sessions' ? theme.border2 : theme.border}
            backgroundColor={theme.surface}
            flexDirection="column"
            title={sidebarSortHeader}
          >
            <box flexGrow={1} paddingX={1}>
              {loadingSessions && sessions.length === 0 ? (
                <Spinner label={fitText('Loading…', sidebarInnerWidth - 2)} fg={theme.dim} />
              ) : sidebarEntries.length === 0 ? (
                <text fg={theme.dim}>{fitText('No sessions available', sidebarInnerWidth)}</text>
              ) : (
                <scrollbox
                  ref={sidebarScrollRef}
                  style={{ height: sidebarRowBudget }}
                  backgroundColor={theme.surface}
                  scrollY
                  viewportCulling
                  scrollbarOptions={{
                    trackOptions: {
                      foregroundColor: theme.muted,
                      backgroundColor: theme.surface,
                    },
                  }}
                >
                  {sidebarEntries.map((entry) => {
                    if (entry.type === 'project') {
                      const countLabel = `${entry.count}`
                      const dashes = '─'.repeat(Math.max(sidebarInnerWidth - 2 - entry.projectName.length - countLabel.length - 3, 1))
                      return (
                        <box
                          key={entry.key}
                          id={`sidebar:${entry.key}`}
                          paddingX={1}
                          marginTop={1}
                          backgroundColor={theme.surface2}
                        >
                          <text fg={theme.cyan} wrapMode="none">
                            {fitText(`${entry.projectName} ${dashes} ${countLabel}`, sidebarInnerWidth - 2)}
                          </text>
                        </box>
                      )
                    }

                    const selected = entry.absoluteIndex === selectedIndex
                    const sessionAccent = getProviderAccent(entry.session.provider ?? 'claude')
                    const activityTime = entry.session.lastModified ?? entry.session.createdAt
                    const ago = timeAgo(activityTime)

                    const metaLine = joinMeta([formatProviderLabel(entry.session.provider), ago])

                    return (
                      <box
                        key={entry.key}
                        id={`sidebar:${entry.key}`}
                        flexDirection="column"
                        backgroundColor={selected ? theme.surface3 : theme.surface}
                        marginBottom={density === 'comfortable' ? 1 : 0}
                      >
                        {sessionKey(entry.session) === renameSessionKey ? (
                          <box paddingX={1} backgroundColor={theme.surface3}>
                            <input
                              focused
                              value={renameDraft}
                              maxLength={80}
                              onInput={(v: string) => setRenameDraft(v)}
                              onSubmit={commitRename}
                            />
                          </box>
                        ) : (
                          <box paddingX={1} backgroundColor={selected ? theme.surface3 : theme.surface}>
                            <text fg={selected ? theme.text : theme.muted} wrapMode="none">
                              {fitText(formatSessionTitle(entry.session), sidebarInnerWidth - 2)}
                            </text>
                          </box>
                        )}
                        <box paddingX={1} backgroundColor={selected ? theme.surface3 : theme.surface}>
                          <text fg={selected ? sessionAccent : theme.dim} wrapMode="none">
                            {fitText(metaLine, sidebarInnerWidth - 2)}
                          </text>
                        </box>
                      </box>
                    )
                  })}
                </scrollbox>
              )}
            </box>
          </box>
        ) : null}

        <box width={rightPaneWidth} flexDirection="column">
          {showTabs ? (
            <box
              paddingX={1}
              backgroundColor={theme.surface2}
            >
              <tab-select
                ref={tabSelectRef}
                options={tabOptions}
                width={rightPaneWidth - 2}
                tabWidth={tabWidth}
                backgroundColor={theme.surface2}
                focusedBackgroundColor={theme.surface3}
                textColor={theme.muted}
                focusedTextColor={theme.text}
                selectedBackgroundColor={theme.surface3}
                selectedTextColor={theme.cyan}
                selectedDescriptionColor={theme.dim}
                showDescription={false}
                showUnderline={false}
                showScrollArrows={true}
                wrapSelection={false}
                onChange={(index) => {
                  const tab = visibleTabSessions[index]
                  if (tab) selectTabSession(tab)
                }}
              />
            </box>
          ) : showPreviewBar && selectedSession ? (
            <box paddingX={1} backgroundColor={theme.surface2}>
              <text fg={theme.cyan} wrapMode="none">{previewBarText}</text>
            </box>
          ) : null}

          {notice ? (
            <box paddingX={1} backgroundColor={notice.tone === 'error' ? theme.diffRemoveBg : theme.surface3}>
              <text fg={notice.tone === 'error' ? theme.red : theme.cyan} wrapMode="none">
                {fitText(notice.text, Math.max(rightPaneWidth - 2, 16))}
              </text>
            </box>
          ) : null}

          <box
            flexGrow={1}
            border
            borderStyle="single"
            borderColor={effectiveFocus === 'messages' ? theme.border2 : theme.border}
            backgroundColor={theme.surface}
            flexDirection="column"
            title={headerStatusRight}
          >
          {!focusMode ? (
            <box paddingX={1} paddingTop={1}>
              <box width={Math.max(rightPaneWidth - 16, 16)} overflow="hidden">
                <text fg={theme.text}>{fitText(readerTitle, Math.max(rightPaneWidth - 16, 16))}</text>
              </box>
              <box width={12} overflow="hidden">
                <text fg={providerAccent}>{fitText(providerSummary, 12)}</text>
              </box>
            </box>
          ) : null}

          {!focusMode && contextUsage ? (
            <box paddingX={1}>
              <text fg={contextBarColor(contextUsage.percentage, theme)}>
                {fitText(renderContextBar(contextUsage.totalTokens, contextUsage.maxTokens, contextUsage.percentage), rightPaneWidth - 4)}
              </text>
            </box>
          ) : !focusMode && selectedSession?.provider === 'claude' && contextUsageStatus === 'loading' ? (
            <box paddingX={1}>
              <text fg={theme.dim}>{fitText('Loading context usage…', rightPaneWidth - 4)}</text>
            </box>
          ) : !focusMode && selectedSession?.provider === 'claude' && contextUsageStatus === 'unavailable' ? (
            <box paddingX={1}>
              <text fg={theme.dim}>{fitText('Context usage unavailable', rightPaneWidth - 4)}</text>
            </box>
          ) : null}

          {error ? (
            <box paddingX={1} marginTop={1}>
              <text fg={theme.red}>{fitText(error, rightPaneWidth - 4)}</text>
            </box>
          ) : null}

          {!followTail && pendingNewCount > 0 ? (
            <box paddingX={1} marginTop={1}>
              <text fg={theme.amber}>
                {fitText(`+${pendingNewCount} new messages waiting. Press u for first unread or f for live tail.`, rightPaneWidth - 4)}
              </text>
            </box>
          ) : null}

          {normalizedSearchQuery ? (
            <box paddingX={1} marginTop={1}>
              <text fg={theme.dim}>
                {fitText(
                  `/${searchQuery}  ${searchMatches.length === 0 ? 'no matches' : `${searchMatchIndex + 1}/${searchMatches.length} matches`}`,
                  rightPaneWidth - 4,
                )}
              </text>
            </box>
          ) : null}

          <box flexGrow={1} paddingX={1} paddingBottom={1} marginTop={1} overflow="hidden">
            {loadingDetail && transcriptCards.length === 0 ? (
              <Spinner label={fitText('Loading transcript…', rightPaneWidth - 6)} fg={theme.dim} />
            ) : transcriptCards.length === 0 ? (
              !selectedSession ? (
                <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1} paddingY={2}>
                  <ascii-font text="AGENT VIEWER" font="tiny" color={theme.dim} />
                  <box marginTop={1}>
                    <text fg={theme.dim}>Select a session to begin reading</text>
                  </box>
                </box>
              ) : (
                <text fg={theme.dim}>{fitText('No messages.', rightPaneWidth - 4)}</text>
              )
            ) : (
              <scrollbox
                ref={transcriptScrollRef}
                style={{ height: transcriptViewportRows }}
                focused={effectiveFocus === 'messages'}
                backgroundColor={theme.surface2}
                stickyScroll={followTail}
                stickyStart="bottom"
                scrollY
                scrollAcceleration={MESSAGE_SCROLL_ACCEL}
                viewportCulling
                scrollbarOptions={{
                  trackOptions: {
                    foregroundColor: theme.muted,
                    backgroundColor: theme.surface2,
                  },
                }}
                >
                <box height={TRANSCRIPT_TOP_MARGIN} />
                {transcriptChildren}

              </scrollbox>
            )}
          </box>

          {followTail && transcriptCards.length > 0 ? (
            <box paddingX={2} paddingBottom={1}>
              <Spinner label="waiting for new messages" fg={theme.dim} />
            </box>
          ) : null}
          </box>
        </box>

        {providerMenuOpen ? (
          <box
            position="absolute"
            top={focusMode ? 1 : 3}
            right={2}
            width={34}
            height={14}
            border
            borderStyle="single"
            borderColor={theme.border2}
            backgroundColor={theme.surface}
            zIndex={20}
            flexDirection="column"
          >
            <box paddingX={1} paddingTop={1}>
              <text fg={theme.text}>PROVIDERS</text>
            </box>
            <box flexGrow={1} paddingX={1} paddingBottom={1}>
              <select
                style={{ height: 10 }}
                focused
                options={providerOptions}
                selectedIndex={providerMenuIndex}
                selectedBackgroundColor={theme.surface3}
                selectedTextColor={theme.text}
                textColor={theme.muted}
                descriptionColor={theme.dim}
                selectedDescriptionColor={theme.cyan}
                backgroundColor={theme.surface}
                focusedBackgroundColor={theme.surface}
                showScrollIndicator={false}
                itemSpacing={0}
                onChange={(index) => setProviderMenuIndex(index)}
                onSelect={(_, option) => {
                  const nextProvider = option?.value as ProviderSelection | undefined
                  if (nextProvider) void chooseProvider(nextProvider)
                }}
              />
            </box>
          </box>
        ) : null}

        {themeMenuOpen ? (() => {
          type ThemeRow =
            | { kind: 'header'; label: string }
            | { kind: 'gap' }
            | { kind: 'theme'; mode: TuiThemeMode; globalIndex: number }
          const rows: ThemeRow[] = []
          THEME_GROUPS.forEach((group, groupIndex) => {
            if (groupIndex > 0) rows.push({ kind: 'gap' })
            rows.push({ kind: 'header', label: group.label })
            for (const mode of group.themes) {
              rows.push({ kind: 'theme', mode, globalIndex: THEMES.indexOf(mode) })
            }
          })
          const menuHeight = Math.max(12, Math.min(height - 4, 30))
          const visibleRows = Math.max(3, menuHeight - 5)
          const cursorRow = rows.findIndex((row) => row.kind === 'theme' && row.globalIndex === themeMenuIndex)
          let offset = 0
          if (cursorRow >= 0 && cursorRow >= visibleRows) {
            offset = Math.min(cursorRow - visibleRows + 1, rows.length - visibleRows)
          }
          offset = Math.max(0, offset)
          const sliced = rows.slice(offset, offset + visibleRows)
          return (
            <box
              position="absolute"
              top={focusMode ? 1 : 3}
              right={2}
              width={36}
              height={menuHeight}
              border
              borderStyle="single"
              borderColor={theme.border2}
              backgroundColor={theme.surface}
              zIndex={20}
              flexDirection="column"
            >
              <box paddingX={1} paddingTop={1}>
                <text fg={theme.text}>THEME</text>
              </box>
              <box flexGrow={1} paddingX={1} paddingBottom={1} flexDirection="column">
                {sliced.map((row, i) => {
                  if (row.kind === 'gap') {
                    return <box key={`gap-${i}`} height={1} />
                  }
                  if (row.kind === 'header') {
                    return (
                      <box key={`h-${row.label}-${i}`} paddingX={1}>
                        <text fg={theme.dim} wrapMode="none">{row.label}</text>
                      </box>
                    )
                  }
                  const selected = row.globalIndex === themeMenuIndex
                  const active = row.mode === themeMode
                  return (
                    <box
                      key={row.mode}
                      paddingX={1}
                      backgroundColor={selected ? theme.surface3 : theme.surface}
                      flexDirection="row"
                    >
                      <box flexGrow={1}>
                        <text fg={selected ? theme.text : active ? theme.cyan : theme.muted} wrapMode="none">
                          {fitText(THEME_LABELS[row.mode], 24)}
                        </text>
                      </box>
                      <text fg={active ? theme.cyan : theme.dim} wrapMode="none">
                        {active ? '✓' : ' '}
                      </text>
                    </box>
                  )
                })}
              </box>
            </box>
          )
        })() : null}

        {commandPaletteOpen ? (() => {
          const paletteW = Math.min(width - 8, 64)
          const labelW = paletteW - 10
          return (
            <box
              position="absolute"
              top={focusMode ? 2 : 4}
              left={Math.max(Math.floor((width - paletteW) / 2), 2)}
              width={paletteW}
              border
              borderStyle="single"
              borderColor={theme.border2}
              backgroundColor={theme.surface}
              zIndex={30}
              flexDirection="column"
            >
              <box paddingX={1} paddingTop={1} paddingBottom={1}>
                <text fg={theme.dim}>{fitText(`> ${commandPaletteQuery}█  j/k  enter  esc`, paletteW - 4)}</text>
              </box>
              {paletteDisplayRows.map((row, i) => {
                if (row.kind === 'header') {
                  return (
                    <box key={`h-${row.label}-${i}`} paddingX={1} backgroundColor={theme.surface2}>
                      <text fg={theme.dim}>{row.label.toUpperCase()}</text>
                    </box>
                  )
                }
                const isSelected = row.cmdIndex === commandPaletteIndex
                return (
                  <box key={row.cmd.id} paddingX={1} backgroundColor={isSelected ? theme.surface3 : theme.surface} flexDirection="row">
                    <box flexGrow={1}>
                      <text fg={isSelected ? theme.text : theme.muted} wrapMode="none">
                        {fitText(row.cmd.label, labelW)}
                      </text>
                    </box>
                    <text fg={isSelected ? theme.cyan : theme.dim}>{row.cmd.key}</text>
                  </box>
                )
              })}
              {filteredCommands.length === 0 ? (
                <box paddingX={1} paddingBottom={1}>
                  <text fg={theme.dim}>no matches</text>
                </box>
              ) : null}
            </box>
          )
        })() : null}

      </box>

      {searchMode ? (
        <box paddingX={1}>
          <box
            width={Math.max(width - 2, 20)}
            height={4}
            border
            borderStyle="single"
            borderColor={theme.border2}
            backgroundColor={theme.surface}
            flexDirection="column"
          >
            <box paddingX={1} height={1}>
              <text fg={theme.dim}>
                {fitText(
                  `SEARCH  ${searchMatches.length === 0 ? 'no matches' : `${searchMatchIndex + 1}/${searchMatches.length} matches`}  enter jump  esc close`,
                  width - 6,
                )}
              </text>
            </box>
            <box paddingX={1} height={1}>
              <input
                focused
                value={searchQuery}
                placeholder="Type to search transcript..."
                maxLength={SEARCH_MAX_CHARS}
                onInput={setSearchQuery}
                onSubmit={() => {
                  if (searchMatches.length > 0) jumpToTranscriptIndex(searchMatches[searchMatchIndex] ?? 0)
                  setSearchMode(false)
                }}
              />
            </box>
          </box>
        </box>
      ) : null}

      {sessionSearchMode ? (
        <box paddingX={1}>
          <box
            width={Math.max(width - 2, 20)}
            height={4}
            border
            borderStyle="single"
            borderColor={theme.border2}
            backgroundColor={theme.surface}
            flexDirection="column"
          >
            <box paddingX={1} height={1}>
              <text fg={theme.dim}>
                {fitText(
                  `SESSION SEARCH  ${filteredSessionsForSidebar.length}/${sessions.length} matches  enter select  esc clear`,
                  width - 6,
                )}
              </text>
            </box>
            <box paddingX={1} height={1}>
              <input
                focused
                value={sessionSearchQuery}
                placeholder="Type to filter sessions..."
                maxLength={SEARCH_MAX_CHARS}
                onInput={setSessionSearchQuery}
                onSubmit={() => {
                  const firstSession = sidebarEntries.find(
                    (e): e is Extract<SidebarEntry, { type: 'session' }> => e.type === 'session',
                  )
                  if (firstSession) {
                    setSelectedSessionKey(sessionKey(firstSession.session))
                  }
                  setSessionSearchMode(false)
                }}
              />
            </box>
          </box>
        </box>
      ) : null}

      {composerStatusMessage ? (
        <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
          <text fg={composerError ? theme.red : theme.dim} wrapMode="none">
            {fitText(
              composerStatusMessage,
              Math.max(width - 4, 20),
            )}
          </text>
        </box>
      ) : null}

      {composerTargetMessage ? (
        <box backgroundColor={theme.surface} paddingX={1}>
          <text fg={theme.cyan} wrapMode="none">
            {fitText(composerTargetMessage, Math.max(width - 4, 20))}
          </text>
        </box>
      ) : null}

      <box
        paddingX={1}
        backgroundColor={theme.surface}
        border
        borderStyle="single"
        borderColor={theme.border}
        height={COMPOSER_HEIGHT}
        flexDirection="column"
      >
        <box flexDirection="row" alignItems="center" gap={1}>
          <input
            focused={composerActive}
            value={composerDraft}
            placeholder={composerTargetSession ? 'Send a message… (enter to send)' : 'Select a session to send a message'}
            onInput={(value) => {
              setComposerDraft(value)
              if (historyIndex !== -1) setHistoryIndex(-1)
              if (composerError) setComposerError(null)
              if (composerSendState === 'error') setComposerSendState('idle')
            }}
            onSubmit={() => {
              void sendComposerMessage()
            }}
            style={{ flexGrow: 1 }}
          />
          <text fg={composerSendState === 'sending' ? theme.dim : theme.cyan}>
            {composerSendState === 'sending' ? 'Esc = cancel' : 'Enter = send'}
          </text>
        </box>
      </box>

      {!searchMode ? (
        <box backgroundColor={theme.surface} paddingX={1}>
          <text fg={theme.dim}>{footerText}</text>
        </box>
      ) : null}

      {gitOpen ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={49}
        />
      ) : null}

      {gitOpen ? (
        <GitPopover
          cwd={gitRepoCwd}
          theme={theme}
          width={width}
          height={height}
          onClose={() => setGitOpen(false)}
          onKeyHandlerReady={(handler) => { gitKeyHandlerRef.current = handler }}
        />
      ) : null}

      {analyticsOpen ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={49}
        />
      ) : null}

      {analyticsOpen ? (
        <AnalyticsPopover
          detail={sessionDetail}
          theme={theme}
          width={width}
          height={height}
          onClose={() => setAnalyticsOpen(false)}
          onKeyHandlerReady={(handler) => { analyticsKeyHandlerRef.current = handler }}
        />
      ) : null}
    </box>
  )
}
