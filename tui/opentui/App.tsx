/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GitPopover } from './GitPopover'
import { RGBA, SyntaxStyle } from '@opentui/core'
import type { ScrollBoxRenderable, SelectOption, TabSelectOption, TabSelectRenderable } from '@opentui/core'
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
import {
  formatProviderLabel,
  formatSessionProject,
  formatSessionTitle,
  formatTranscriptCards,
  type TuiTranscriptCard,
  type TuiTranscriptCardLine,
} from '../format'
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
  readTuiDensity,
  readTuiFocusMode,
  readTuiProvider,
  readTuiRailVisible,
  readTuiSessionDetail,
  readTuiSessionMetadata,
  readTuiSessionReaderState,
  readTuiSessions,
  readTuiTabsEnabled,
  readTuiTheme,
  readTuiTranscriptView,
  writeTuiDensity,
  writeTuiFocusMode,
  writeTuiProvider,
  writeTuiRailVisible,
  writeTuiSessionReaderState,
  writeTuiTabsEnabled,
  writeTuiTheme,
  writeTuiTranscriptView,
  type TuiSessionDetail,
} from '../../lib/tui/service'
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
const THEMES: TuiThemeMode[] = ['light', 'dark', 'cyber']
const SEARCH_MAX_CHARS = 80
const SESSION_REFRESH_MS = 5000
const DETAIL_REFRESH_MS = 2000
const RUNNING_SESSION_REFRESH_MS = 1500

type PaneFocus = 'sessions' | 'messages'

type CardLandmark = {
  kind: 'resume' | 'unread' | 'day' | 'gap'
  text: string
}

type CardDisplayData = {
  landmarks: CardLandmark[]
  bodyLines: TuiTranscriptCardLine[]
  diffText: string | null
  diffLineCount: number
  codeBlockLineCounts: number[]
  headerMeta: string
  isSearchHit: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
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
const CLAUDE_METADATA_REFRESH_MS = 60_000
const DEFAULT_METADATA_REFRESH_MS = 15_000
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

function sessionMessageFingerprint(message: import('../../lib/types').SessionMessage | undefined): string | null {
  if (!message) return null
  let payload = ''
  try {
    payload = JSON.stringify(message.message)
  } catch {
    payload = String(message.message)
  }
  return [
    message.type,
    message.uuid,
    message.timestamp ?? '',
    message.turnId ?? '',
    message.origin?.kind ?? '',
    payload,
  ].join('|')
}

type SidebarEntry =
  | { type: 'project'; key: string; projectName: string; count: number }
  | { type: 'session'; key: string; session: Session; absoluteIndex: number }

function buildSidebarEntries(sessions: Session[]): SidebarEntry[] {
  // Group sessions by project, preserving time-sort order within each group.
  // Groups are ordered by the earliest (most recent) session they contain.
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

  const entries: SidebarEntry[] = []
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

function cycleTheme(current: TuiThemeMode): TuiThemeMode {
  return current === 'light' ? 'dark' : current === 'dark' ? 'cyber' : 'light'
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
  // Session
  { id: 'composer',   label: 'Open composer',          key: 'c',  category: 'Session'    },
  { id: 'rename',     label: 'Rename session',         key: '^R', category: 'Session'    },
  { id: 'git',        label: 'Git status',             key: '^G', category: 'Session'    },
  { id: 'provider',   label: 'Switch provider',        key: 'p',  category: 'Session'    },
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
  const [sessions, setSessions] = useState<Session[]>([])
  const [runningSessions, setRunningSessions] = useState<RunningSessionRef[]>([])
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null)
  const [sessionDetail, setSessionDetail] = useState<TuiSessionDetail | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [refreshingSessions, setRefreshingSessions] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusedPane, setFocusedPane] = useState<PaneFocus>('sessions')
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [providerMenuIndex, setProviderMenuIndex] = useState(0)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0)
  const [gitOpen, setGitOpen] = useState(false)
  const gitKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [searchMode, setSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)

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
  const tabSelectRef = useRef<TabSelectRenderable>(null)
  const sessionRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const metadataRequestRef = useRef(0)
  const providerSwitchRef = useRef(false)
  const readerStateWriteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousTranscriptRef = useRef<{ sessionKey: string | null; keys: string[] }>({
    sessionKey: null,
    keys: [],
  })
  const sessionDetailCacheRef = useRef(new Map<string, TuiSessionDetail>())
  const sessionContextUsageCacheRef = useRef(new Map<string, import('../../lib/types').ContextUsage | null>())
  const sessionMetadataFetchedAtRef = useRef(new Map<string, number>())
  const sessionMetadataInFlightRef = useRef(new Set<string>())
  const composerAbortRef = useRef<AbortController | null>(null)
  const loadingDetailRef = useRef(false)
  const selectedSessionKeyRef = useRef<string | null>(null)
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

  const theme = getThemePalette(themeMode)
  const syntaxStyle = useMemo(() => buildSyntaxStyle(theme), [themeMode])
  const densityState = densityConfig(density)
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

  const transcriptCards = useMemo(() => (
    sessionDetail ? formatTranscriptCards(sessionDetail.threadedMessages, density) : []
  ), [density, sessionDetail])
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
  const searchMatches = useMemo(() => {
    if (!normalizedSearchQuery) return []
    return transcriptCards.flatMap((card, index) => {
      const haystack = `${card.label}\n${card.searchText}`.toLowerCase()
      return haystack.includes(normalizedSearchQuery) ? [index] : []
    })
  }, [normalizedSearchQuery, transcriptCards])

  const cursorIndex = useMemo(() => {
    if (transcriptCards.length === 0) return -1
    const index = findCardIndex(transcriptCards, transcriptCursorKey)
    if (index >= 0) return index
    return followTail ? transcriptCards.length - 1 : 0
  }, [followTail, transcriptCards, transcriptCursorKey])

  const unreadBoundaryIndex = useMemo(
    () => findCardIndex(transcriptCards, unreadBoundaryKey),
    [transcriptCards, unreadBoundaryKey],
  )
  const resumeMarkerIndex = useMemo(
    () => findCardIndex(transcriptCards, resumeMarkerKey),
    [resumeMarkerKey, transcriptCards],
  )

  const readerTitle = useMemo(() => (
    sessionDetail?.info?.customTitle
    ?? sessionDetail?.info?.summary
    ?? selectedSession?.customTitle
    ?? selectedSession?.summary
    ?? '(untitled session)'
  ), [selectedSession, sessionDetail?.info])

  const readerModel = sessionDetail?.info?.currentModel ?? 'unknown'
  const projectCount = useMemo(
    () => new Set(sessions.map((session) => formatSessionProject(session))).size,
    [sessions],
  )
  const foldedTechnicalCount = useMemo(
    () => transcriptCards.filter((card) => card.autoFold && !resolvedExpandedKeys.has(card.key)).length,
    [resolvedExpandedKeys, transcriptCards],
  )
  const sidebarEntries = useMemo(
    () => buildSidebarEntries(sessions),
    [sessions],
  )
  const selectedSidebarEntryIndex = useMemo(() => {
    const idx = sidebarEntries.findIndex((e) => e.type === 'session' && e.absoluteIndex === selectedIndex)
    return idx >= 0 ? idx : 0
  }, [sidebarEntries, selectedIndex])
  const mainContentHeight = Math.max(height - 3 - (searchMode ? 3 : 1) - COMPOSER_HEIGHT, 8)
  const sidebarWidth = showRail ? clamp(Math.floor((width - 4) * 0.27), 28, 40) : 0
  const rightPaneWidth = Math.max(width - 4 - sidebarWidth - (showRail ? 1 : 0), 40)

  const showTabs = tabsEnabled && openTabSessions.length > 0
  const TAB_BAR_HEIGHT = 1
  const transcriptViewportRows = Math.max(mainContentHeight - (focusMode ? 4 : 7) - (showTabs ? TAB_BAR_HEIGHT : 0), 8)

  const activeTabIndex = useMemo(() => {
    if (!selectedSessionKey) return -1
    return openTabSessions.findIndex((s) => sessionKey(s) === selectedSessionKey)
  }, [selectedSessionKey, openTabSessions])

  const tabOptions = useMemo((): TabSelectOption[] => (
    openTabSessions.map((s) => ({
      name: formatSessionTitle(s),
      description: formatProviderLabel(s.provider ?? 'claude'),
      value: sessionKey(s),
    }))
  ), [openTabSessions])

  const tabWidth = useMemo(() => {
    if (openTabSessions.length === 0) return 16
    // Fill available width proportionally so tabs look natural at any count,
    // capped to avoid very wide tabs when only a few sessions are open.
    const available = Math.max(rightPaneWidth - 6, 20)
    const fill = Math.floor(available / openTabSessions.length)
    return Math.max(10, Math.min(fill, 24))
  }, [rightPaneWidth, openTabSessions.length])
  const sidebarRowBudget = Math.max(mainContentHeight - 7, 4)
  const sidebarInnerWidth = Math.max(sidebarWidth - 5, 17)

  const cardDisplayData = useMemo((): CardDisplayData[] => (
    transcriptCards.map((card, index) => {
      const isExpanded = resolvedExpandedKeys.has(card.key)
      const isLatest = index === transcriptCards.length - 1
      const isSearchHit = normalizedSearchQuery.length > 0
        && `${card.label}\n${card.searchText}`.toLowerCase().includes(normalizedSearchQuery)
      const isAutoFoldedTechnical = transcriptView === 'conversation' && card.autoFold && !isExpanded
      const landmarks = transcriptLandmarks(transcriptCards, index, resumeMarkerIndex, unreadBoundaryIndex, pendingNewCount)
      const bodyLines = renderedBodyLines(card, isExpanded, densityState.bodyLines, thinkingFullKeys.has(card.key))
      const diffText = cardDiffText(card, isExpanded)
      const diffLineCount = diffText ? diffText.split('\n').length : 0
      const codeBlockLineCounts = (isExpanded && card.codeBlocks)
        ? card.codeBlocks.map((cb) => cb.content.split('\n').length)
        : []
      const headerMeta = joinMeta([
        card.timestamp ?? null,
        isLatest ? 'latest' : null,
        isSearchHit ? 'match' : null,
        isAutoFoldedTechnical ? 'folded' : null,
        `e ${isExpanded ? 'collapse' : 'expand'}`,
      ])
      return { landmarks, bodyLines, diffText, diffLineCount, codeBlockLineCounts, headerMeta, isSearchHit }
    })
  ), [
    transcriptCards,
    resolvedExpandedKeys,
    normalizedSearchQuery,
    transcriptView,
    resumeMarkerIndex,
    unreadBoundaryIndex,
    pendingNewCount,
    densityState.bodyLines,
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
      setSessions(nextSessions)
      setSelectedSessionKey((current) => {
        if (nextSessions.length === 0) return null
        if (preserveSelection && current) {
          const matched = nextSessions.find((session) => sessionKey(session) === current)
          if (matched) return sessionKey(matched)
        }
        return sessionKey(nextSessions[0])
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
      setRunningSessions(nextRunning)
    } catch {
      // Ignore runtime discovery errors; composer falls back to selected session.
    }
  }, [])

  const refreshSelectedSessionDetail = useCallback(async (session: Session, foreground = true) => {
    if (!foreground && loadingDetailRef.current) return
    const requestId = ++detailRequestRef.current
    if (foreground) setLoadingDetail(true)
    setError((current) => current?.startsWith('Failed to load session detail') ? null : current)

    try {
      const detail = await readTuiSessionDetail(session)
      if (requestId !== detailRequestRef.current) return
      const cacheKey = sessionKey(session)
      const cachedDetail = sessionDetailCacheRef.current.get(cacheKey)
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
        sessionDetailCacheRef.current.set(cacheKey, detail)
        return detail
      })
      if (detail.contextUsage) {
        sessionContextUsageCacheRef.current.set(cacheKey, detail.contextUsage)
        if (cacheKey === selectedSessionKeyRef.current) {
          setContextUsage(detail.contextUsage)
          setContextUsageStatus('ready')
        }
      }

      const isRunningSession = runningSessions.some((running) =>
        running.sessionId === session.sessionId && running.provider === (session.provider ?? 'claude'),
      )
      if (session.provider === 'claude' && !isRunningSession) {
        if (cacheKey === selectedSessionKeyRef.current && !sessionContextUsageCacheRef.current.get(cacheKey)) {
          setContextUsageStatus('unavailable')
        }
        return
      }

      const metadataTtl = session.provider === 'claude'
        ? CLAUDE_METADATA_REFRESH_MS
        : DEFAULT_METADATA_REFRESH_MS
      const lastMetadataFetch = sessionMetadataFetchedAtRef.current.get(cacheKey) ?? 0
      const hasCachedMetadata = Boolean(
        sessionContextUsageCacheRef.current.get(cacheKey)
        || cachedDetail?.info?.currentModel
        || detail.info?.currentModel,
      )
      const shouldFetchMetadata = !sessionMetadataInFlightRef.current.has(cacheKey) && (
        !hasCachedMetadata || Date.now() - lastMetadataFetch >= metadataTtl
      )
      if (!shouldFetchMetadata) return

      const metadataRequestId = ++metadataRequestRef.current
      sessionMetadataInFlightRef.current.add(cacheKey)
      if (cacheKey === selectedSessionKeyRef.current) {
        setContextUsageStatus('loading')
      }
      void Promise.race([
        readTuiSessionMetadata(session),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), METADATA_REQUEST_TIMEOUT_MS)
        }),
      ])
        .then((metadata) => {
          if (metadataRequestId !== metadataRequestRef.current) return
          if (!metadata) {
            if (cacheKey === selectedSessionKeyRef.current) {
              setContextUsageStatus('unavailable')
            }
            return
          }
          sessionMetadataFetchedAtRef.current.set(cacheKey, Date.now())
          if (metadata.contextUsage) {
            sessionContextUsageCacheRef.current.set(cacheKey, metadata.contextUsage)
            if (cacheKey === selectedSessionKeyRef.current) {
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
              sessionDetailCacheRef.current.set(cacheKey, {
                ...cached,
                info: {
                  ...cached.info,
                  currentModel,
                },
              })
            }
          }
          if (!metadata.contextUsage && cacheKey === selectedSessionKeyRef.current) {
            setContextUsageStatus('unavailable')
          }
        })
        .catch(() => {
          if (cacheKey === selectedSessionKeyRef.current) {
            setContextUsageStatus('unavailable')
          }
        })
        .finally(() => {
          sessionMetadataInFlightRef.current.delete(cacheKey)
        })
    } catch (err) {
      if (requestId !== detailRequestRef.current) return
      setSessionDetail(null)
      setError(err instanceof Error ? `Failed to load session detail: ${err.message}` : 'Failed to load session detail')
    } finally {
      if (requestId === detailRequestRef.current && foreground) setLoadingDetail(false)
    }
  }, [runningSessions])

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
    const index = findCardIndex(transcriptCards, resumeMarkerKey)
    if (index >= 0) jumpToTranscriptIndex(index)
  }, [jumpToTranscriptIndex, resumeMarkerKey, transcriptCards])

  const moveSelection = useCallback((delta: number) => {
    if (sessions.length === 0) return
    const currentIndex = selectedIndex >= 0 ? selectedIndex : 0
    const nextIndex = clamp(currentIndex + delta, 0, sessions.length - 1)
    setSelectedSessionKey(sessionKey(sessions[nextIndex]))
    setError(null)
  }, [selectedIndex, sessions])

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

  const executeCommandPalette = useCallback((id: string) => {
    closeCommandPalette()
    switch (id) {
      case 'provider':
        setProviderMenuIndex(Math.max(PROVIDERS.indexOf(provider), 0))
        setProviderMenuOpen(true)
        break
      case 'theme': {
        const nextTheme = cycleTheme(themeMode)
        setThemeMode(nextTheme)
        setActiveTheme(nextTheme)
        void writeTuiTheme(nextTheme).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store theme'))
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
      case 'refresh':
        void refreshSessions(provider)
        if (selectedSessionTarget) void refreshSelectedSessionDetail(selectedSessionTarget, false)
        break
      case 'quit':
        renderer.destroy()
        process.exit(0)
    }
  }, [
    activeTabIndex, closeCommandPalette, density, focusMode, focusedPane, jumpToResumeMarker,
    tabsEnabled,
    jumpToTranscriptTail, jumpToUnreadBoundary, openTabSessions, provider, railVisible,
    refreshSessions, refreshSelectedSessionDetail, renderer, selectTabSession, selectedSessionKey,
    selectedSessionTarget, sessions, themeMode, toggleExpansion, transcriptView,
  ])

  const cancelComposerSend = useCallback(() => {
    if (composerAbortRef.current) {
      composerAbortRef.current.abort()
    }
    composerAbortRef.current = null
    setComposerSendState('idle')
    setComposerLiveText('')
  }, [])

  const commitRename = useCallback(async () => {
    if (!renameSessionKey || !selectedSession) return
    const trimmed = renameDraft.trim()
    setRenameSessionKey(null)
    setRenameDraft('')
    if (!trimmed) return
    try {
      await fetch(buildApiUrl(`/api/sessions/${selectedSession.sessionId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed, provider: selectedSession.provider }),
      })
      void refreshSessions(provider, true, false)
    } catch {
      // rename failed silently — session list will show original title on next poll
    }
  }, [renameSessionKey, renameDraft, selectedSession, provider, refreshSessions])

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
        ] = await Promise.all([
          readTuiTheme(),
          readTuiProvider(),
          readTuiRailVisible(),
          readTuiFocusMode(),
          readTuiDensity(),
          readTuiTranscriptView(),
          readTuiTabsEnabled(),
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
    setExpandedCardKeys((current) => {
      const allowed = new Set(transcriptCards.map((card) => card.key))
      let changed = false
      const next = new Set<string>()
      for (const key of current) {
        if (allowed.has(key)) next.add(key)
        else changed = true
      }
      return changed ? next : current
    })
    setCollapsedCardKeys((current) => {
      const allowed = new Set(transcriptCards.map((card) => card.key))
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
        const restoredIndex = findCardIndex(transcriptCards, restoredState.cursorKey)
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
  }, [
    cursorIndex,
    followTail,
    restoredReaderState,
    selectedSessionKey,
    transcriptCards,
  ])


  useEffect(() => {
    if (!selectedSessionKey || !restoredReaderState.loaded || restoredReaderState.sessionKey !== selectedSessionKey) {
      return
    }

    const validKeys = new Set(transcriptCards.map((card) => card.key))
    const persistState: TuiSessionReaderState = {
      followTail,
      cursorKey: followTail ? null : (transcriptCursorKey && validKeys.has(transcriptCursorKey) ? transcriptCursorKey : null),
      topKey: null,
      expandedKeys: [...expandedCardKeys].filter((key) => validKeys.has(key)),
      collapsedKeys: [...collapsedCardKeys].filter((key) => validKeys.has(key)),
    }

    if (readerStateWriteTimeoutRef.current) clearTimeout(readerStateWriteTimeoutRef.current)

    readerStateWriteTimeoutRef.current = setTimeout(() => {
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

  // Add newly selected session to open tabs (if not already present).
  // We use the full `selectedSession` object so tabs retain provider context
  // even when the user later switches to a different provider.
  useEffect(() => {
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
    const timer = setTimeout(() => {
      if (followTail) {
        transcriptScrollRef.current?.scrollTo(Number.MAX_SAFE_INTEGER)
      } else {
        transcriptScrollRef.current?.scrollChildIntoView(`card:${transcriptCursorKey}`)
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [followTail, transcriptCursorKey])

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

  const footerText = useMemo(
    () => fitText(
      `tab focus  j/k move  ctrl-u/d page  ←/→ tabs  w close tab  b ${tabsEnabled ? 'hide' : 'show'} tabs  () convo  {} tech  u unread  m mark  / search  n/N hits  f live  e fold  v ${transcriptView}  d ${density}  h rail  z focus  p provider  t theme  T thinking  r refresh  ? commands  q quit`,
      Math.max(width - 4, 20),
    ),
    [width, transcriptView, density, tabsEnabled],
  )

  const composerStatusMessage = composerError
    ? composerError
    : composerSendState === 'sending'
      ? composerLiveText || 'Waiting for saved response…'
      : null
  const composerTargetMessage = composerAutoTargetingRunning && composerTargetSession
    ? `Auto-targeting running ${String(composerTargetSession.provider ?? 'claude').toUpperCase()} session ${composerTargetSession.sessionId.slice(-8)}`
    : null

  useKeyboard((key) => {
    if (key.eventType === 'release') return
    const sequence = key.sequence || ''
    const isShifted = (char: string): boolean => key.name === char.toLowerCase() && key.shift
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

    if (gitOpen) {
      handled(() => { gitKeyHandlerRef.current?.(key) })
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
      if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
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

    if (key.name === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      handled(() => {
        renderer.destroy()
        process.exit(0)
      })
      return
    }

    if (key.name === 'tab' && showRail) {
      handled(() => {
        setFocusedPane((current) => current === 'sessions' ? 'messages' : 'sessions')
      })
      return
    }

    // Global git status popover
    if (key.ctrl && key.name === 'g') {
      handled(() => setGitOpen(true))
      return
    }

    if (effectiveFocus === 'sessions' && key.ctrl && key.name === 'r' && selectedSession) {
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
        if (sessions[0]) setSelectedSessionKey(sessionKey(sessions[0]))
      })
      return
    }

    if (effectiveFocus === 'sessions' && isShifted('G')) {
      handled(() => {
        const last = sessions.at(-1)
        if (last) setSelectedSessionKey(sessionKey(last))
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'left' && showTabs) {
      handled(() => {
        const prevIdx = Math.max(activeTabIndex - 1, 0)
        const prev = openTabSessions[prevIdx]
        if (prev) selectTabSession(prev)
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'right' && showTabs) {
      handled(() => {
        const nextIdx = Math.min(activeTabIndex + 1, openTabSessions.length - 1)
        const next = openTabSessions[nextIdx]
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

    if (effectiveFocus === 'messages' && key.ctrl && key.name === 'd') {
      handled(() => {
        moveViewport(1)
      })
      return
    }

    if (effectiveFocus === 'messages' && key.ctrl && key.name === 'u') {
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

    if (effectiveFocus === 'messages' && sequence === '[' && searchMatches.length > 0) {
      handled(() => {
        setSearchMatchIndex(0)
        jumpToTranscriptIndex(searchMatches[0] ?? 0)
      })
      return
    }

    if (effectiveFocus === 'messages' && sequence === ']' && searchMatches.length > 0) {
      handled(() => {
        const lastMatchIndex = searchMatches.length - 1
        setSearchMatchIndex(lastMatchIndex)
        jumpToTranscriptIndex(searchMatches[lastMatchIndex] ?? 0)
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
        const nextTheme = cycleTheme(themeMode)
        setThemeMode(nextTheme)
        setActiveTheme(nextTheme)
        void writeTuiTheme(nextTheme).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store theme')
        })
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
  const headerStatusRight = useMemo(
    () => fitText(
      joinMeta([
        statusLabel,
        `position ${transcriptCards.length === 0 ? '0' : `${Math.max(cursorIndex, 0) + 1}`}/${transcriptCards.length}`,
        readerMode,
        themeMode.toUpperCase(),
        provider.toUpperCase(),
        density.toUpperCase(),
        pendingNewCount > 0 ? `+${pendingNewCount} new` : null,
        !railVisible ? 'h show rail' : null,
      ]),
      Math.max(Math.floor(width * 0.55), 20),
    ),
    [statusLabel, transcriptCards.length, cursorIndex, readerMode, themeMode, provider, density, pendingNewCount, railVisible, width],
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
            title={`SESSIONS  ${Math.max(sessions.length, 0)}`}
          >
            <box paddingX={1} paddingTop={1}>
              <text fg={theme.cyan}>{fitText('tab focus  h hide rails  / search', sidebarInnerWidth)}</text>
            </box>
            <box flexGrow={1} paddingX={1} paddingBottom={1}>
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
                        {entry.key === renameSessionKey ? (
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
                  const tab = openTabSessions[index]
                  if (tab) selectTabSession(tab)
                }}
              />
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
                viewportCulling
                scrollbarOptions={{
                  trackOptions: {
                    foregroundColor: theme.muted,
                    backgroundColor: theme.surface2,
                  },
                }}
              >
                <box height={TRANSCRIPT_TOP_MARGIN} />
                {transcriptCards.map((card, index) => {
                  const display = cardDisplayData[index]
                  const isSelected = card.key === transcriptCursorKey
                  const hasCursor = isSelected && effectiveFocus === 'messages'
                  const isExpanded = resolvedExpandedKeys.has(card.key)
                  const accent = transcriptAccent(card.role, card.provider ?? provider)
                  const isThinkingCard = card.lines.some((line) => line.tone === 'thinking')
                  const { landmarks, bodyLines, diffText, diffLineCount, codeBlockLineCounts, headerMeta, isSearchHit } = display
                  const isActiveMatch = isSearchHit && searchMatches[searchMatchIndex] === index
                  const marker = hasCursor ? '>' : isSelected ? ':' : card.role === 'user' ? '▸' : '●'
                  const isInsight = card.category === 'insight'
                  const cardBg = hasCursor ? theme.surface3 : isSelected ? theme.surface2 : card.role === 'user' ? theme.userBg : isInsight ? theme.surface2 : theme.surface
                  const borderColor = hasCursor ? accent : isActiveMatch ? theme.amber : isSearchHit ? theme.cyan : isInsight ? theme.violet : isSelected ? theme.border2 : card.role === 'user' ? accent : theme.border
                  const maxTitleWidth = Math.max(rightPaneWidth - 6, 20)
                  const isTechnical = card.category === 'technical'
                  const isDiff = card.category === 'diff'
                  const isSystem = card.category === 'system'
                  const categoryEmoji = isInsight ? '✨ ' : isTechnical ? '🔧 ' : isDiff ? '✏️ ' : isSystem ? '⚙️ ' : ''
                  const titleMeta = joinMeta([
                    headerMeta,
                    isSelected ? card.usageSummary ?? null : null,
                  ])
                  const cardTitleFull = `${marker} ${categoryEmoji}${card.label}${titleMeta ? `  ${titleMeta}` : ''}`
                  const cardTitle = cardTitleFull.length > maxTitleWidth
                    ? cardTitleFull.slice(0, maxTitleWidth - 1) + '…'
                    : cardTitleFull

                  return (
                    <box key={card.key} flexDirection="column" marginBottom={densityState.cardGap}>
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
                            <text fg={color}>{fitText(landmark.text, rightPaneWidth - 4)}</text>
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
                          {(isExpanded && card.markdownContent) ? (
                            <box paddingX={1}>
                              <markdown
                                content={card.markdownContent}
                                syntaxStyle={syntaxStyle}
                                fg={theme.text}
                                streaming={false}
                                width={Math.max(rightPaneWidth - densityState.bodyIndent - 8, 20)}
                                tableOptions={{ widthMode: 'content', borders: true, borderColor: theme.border }}
                              />
                            </box>
                          ) : (
                            <>
                              {bodyLines.map((line, lineIndex) => (
                                <box
                                  key={`${card.key}:line:${lineIndex}`}
                                  paddingX={1}
                                  backgroundColor={transcriptBackground(line, theme) ?? cardBg}
                                >
                                  <text fg={transcriptColor(line, theme)} wrapMode="none">
                                    {fitText(line.text, Math.max(rightPaneWidth - densityState.bodyIndent - 8, 16))}
                                  </text>
                                </box>
                              ))}

                              {isExpanded && card.codeBlocks && card.codeBlocks.length > 0 ? (
                                card.codeBlocks.map((cb, cbIndex) => (
                                  <box key={cb.key} paddingX={1} marginTop={1}>
                                    <text fg={theme.dim}>{cb.lang}</text>
                                    <code
                                      content={cb.content}
                                      filetype={cb.lang}
                                      syntaxStyle={syntaxStyle}
                                      drawUnstyledText={true}
                                      style={{ height: Math.min((codeBlockLineCounts[cbIndex] ?? 0) + 1, 20) }}
                                      width={Math.max(rightPaneWidth - densityState.bodyIndent - 8, 20)}
                                    />
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
                })}

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
            height={3}
            border
            borderStyle="single"
            borderColor={theme.border2}
            backgroundColor={theme.surface}
            flexDirection="column"
          >
            <box paddingX={1}>
              <text fg={theme.dim}>
                {fitText(
                  `SEARCH  ${searchMatches.length === 0 ? 'no matches' : `${searchMatchIndex + 1}/${searchMatches.length} matches`}  enter jump  esc close`,
                  width - 6,
                )}
              </text>
            </box>
            <box paddingX={1}>
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
          theme={theme}
          width={width}
          height={height}
          onClose={() => setGitOpen(false)}
          onKeyHandlerReady={(handler) => { gitKeyHandlerRef.current = handler }}
        />
      ) : null}
    </box>
  )
}
