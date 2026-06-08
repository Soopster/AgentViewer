/** @jsxImportSource @opentui/react */
import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, startTransition, useState } from 'react'
import { spawn } from 'node:child_process'
import { GitPopover } from './GitPopover'
import { AnalyticsPopover } from './AnalyticsPopover'
import { HandoffBriefPopover } from './HandoffBriefPopover'
import { PromptLibraryPopover } from './PromptLibraryPopover'
import { ChannelBridgePopover } from './ChannelBridgePopover'
import { TaskSidePanel } from './TaskSidePanel'
import { TaskPanelPopover } from './TaskPanelPopover'
import { scheduleWriteComposerDraft, readComposerDraft } from '../../lib/tuiComposerState'
import { registerExtraTreeSitterParsers } from './treeSitterParsers'
import { startTuiMetricsLogger, tuiMetricsEnabled, noteRenderFrame, registerTuiMetricsGauge, cardProfileEnabled, logCardRecompute } from './metricsLogger'
import {
  buildPierreDiffView,
  type TuiPierreDiffRow,
  type TuiPierreDiffView,
  type TuiPierreSplitRow,
  type TuiSplitRowSide,
} from './pierreDiffView'
import type { SelectedLineRange } from '@pierre/diffs'
import { RGBA, SyntaxStyle, MacOSScrollAccel } from '@opentui/core'
import type { BaseRenderable, MarkdownRenderable, MouseEvent, ScrollBoxRenderable, SelectOption, TabSelectOption, TabSelectRenderable, TextareaRenderable, TextareaAction } from '@opentui/core'
import { useKeyboard, usePaste, useRenderer, useSelectionHandler, useTerminalDimensions } from '@opentui/react'
import {
  formatProviderLabel,
  formatSessionProject,
  formatSessionTitle,
  buildTaskActiveForms,
  formatTranscriptCard,
  type TuiTranscriptCard,
  type TuiTranscriptCodeBlock,
  type TuiTranscriptCardLine,
} from '../format'
import { stripToolCallBlocks, type ThreadedMessage } from '../../lib/threading'
import { buildTaskRegistry } from '../../lib/taskRegistry'
import { buildDiffCommentComposerPrompt } from '../../lib/diffCommentComposer'
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
  readTuiDiffLayout,
  readTuiFocusMode,
  readTuiProvider,
  readTuiRailVisible,
  readTuiSessionDetail,
  readTuiSessionDiagnostics,
  readTuiSessionReaderState,
  readTuiSessions,
  readTuiSessionMetadata,
  readTuiSidebarSort,
  readTuiSidebarWidth,
  readTuiShowToolCalls,
  readTuiTabsEnabled,
  readTuiTheme,
  readTuiTranscriptView,
  readTuiVelocityScroll,
  readTuiSessionBookmarkIds,
  readTuiAllBookmarks,
  readTuiPrompts,
  readTuiPrompt,
  saveTuiPrompt,
  deleteTuiPrompt,
  toggleTuiSessionBookmark,
  runTuiSessionAction,
  streamTuiSessionTurn,
  interruptTuiSessionTurn,
  writeTuiDensity,
  writeTuiDiffLayout,
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
  writeTuiVelocityScroll,
  type TuiSessionDetail,
  type TuiDiffLayout,
  type TuiSidebarSort,
} from '../../lib/tui/service'
import type { MessageBookmark } from '../../lib/messageBookmarks'
import {
  extractClaudeStreamToolInputDelta,
  extractClaudeStreamToolUse,
  normalizeClaudeStreamThreadedMessage,
  parseClaudeStreamToolInput,
} from '../../lib/claudeMapper'
import { normalizeCodexStreamThreadedMessage } from '../../lib/codexMapper'
import { readTuiSessionMetadataAsync } from './metadataWorkerClient'
import {
  readTuiSessionDetailAsync,
  formatTranscriptCardsAsync,
  getTranscriptCardsSync,
} from './sessionDetailWorkerClient'
import type { TuiSessionReaderState } from '../../lib/tuiState'
import type { ContextUsage, ProviderSelection, ReasoningEffortLevel, RunningSessionRef, SendAttachment, SendState, Session, SessionComposerAgentOption, SessionModelInfo, ToolResultBlock } from '../../lib/types'
import { getContinueInCliCommand } from '../../lib/cliContinue'
import { isTransientSendError, MAX_TRANSIENT_SEND_RETRIES, transientRetryBackoffMs } from '../../lib/transientError'
import { listProjectFiles } from '../../lib/projectFiles'
import { runGitCommand } from '../../lib/gitNodeProvider'
import { getSlashCommandSuggestions, filterSlashCommands, normalizeSlashCommandSuggestions, type SlashCommandSuggestion } from '../../lib/slashCommands'
import { getProviderComposer, pickProviderExample } from '../../lib/providerComposer'
import { extractPendingPermission, extractPermissionReply, type PendingPermission, type PermissionResponse } from '../../lib/permissions'
import { readViewSessionSlashCommands, readViewSessionComposerOptions, createNewViewSession } from '../../lib/sessionBackend'
import { compactStableFingerprint } from '../../lib/compactFingerprint'
import { appendFileSync, mkdirSync } from 'node:fs'
import { readFile, rm, stat } from 'node:fs/promises'
import { release, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Stable-reference event handler — reads the latest closure on every call
// without appearing in any deps array. Mirrors React's upcoming useEffectEvent
// (RFC #220) and the implementation already used internally by @opentui/react.
function useEffectEvent<T extends (...args: never[]) => unknown>(handler: T): T {
  const handlerRef = React.useRef(handler)
  React.useLayoutEffect(() => { handlerRef.current = handler })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useCallback((...args: Parameters<T>) => (handlerRef.current as T)(...args), []) as T
}

const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']
const COMPOSER_WAITING_SPINNER_FRAMES = [
  ['|', '/', '-', '\\'],
  ['.', 'o', 'O', 'o'],
  ['◐', '◓', '◑', '◒'],
  ['▖', '▘', '▝', '▗'],
  ['◜', '◝', '◞', '◟'],
] as const
const IDLE_TICKER_PHRASES = [
  'waiting for new messages',
  'listening for activity',
  'standing by',
  'watching the wire',
  'all quiet on the western front',
  'ready when you are',
  'nothing new — yet',
  'on standby',
  'holding position',
  'idle — pinging occasionally',
  'no new messages',
  'the agent is thinking',
  'biding its time',
  'waiting patiently',
  'keeping watch',
] as const
const IDLE_TICKER_ROTATE_MS = 8000
const IDLE_TICKER_SPINNER_VARIANTS: ReadonlyArray<readonly string[]> = [
  ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],   // braille circle
  ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], // braille sweep
  ['◐', '◓', '◑', '◒'],                              // half-circle
  ['◜', '◝', '◞', '◟'],                              // arc
  ['▖', '▘', '▝', '▗'],                              // block quadrant
  ['|', '/', '-', '\\'],                              // ASCII classic
  ['.', 'o', 'O', 'o'],                               // dot pulse
  ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],        // arrow spin
]

const COMPOSER_WAITING_MESSAGES = [
  'Adding context',
  'Composing the reply',
  'Shaping the next move',
  'Reading the room',
  'Checking the map',
  'Threading the details',
  'Warming the context',
  'Letting the agent work',
  'Lining up the response',
  'Waiting on the model',
] as const

registerExtraTreeSitterParsers()
startTuiMetricsLogger()

// ── Optional render-frame timing (set AGENT_VIEWER_PERF=1) ───────────────────
// A fullscreen TUI can't log to stdout/stderr without corrupting the render, so
// frame timings are appended to a file. Each render stamps the start time in the
// component body; a post-commit effect measures the render→commit duration and,
// once per second, appends a summary line: commits observed, how many blew the
// 60fps (16.67ms) budget, and the slowest. Zero runtime cost unless enabled.
const PERF_LOG = process.env.AGENT_VIEWER_PERF === '1'
const PERF_LOG_PATH = process.env.AGENT_VIEWER_PERF_LOG
  ?? join(process.cwd(), '.agent-viewer-data', 'tui-perf.log')
const FRAME_BUDGET_MS = 1000 / 60
// Either sink wants a render-start stamp; check both so enabling just
// AGENT_VIEWER_TUI_METRICS (without AGENT_VIEWER_PERF) still times frames.
const FRAME_TIMING_NEEDED = PERF_LOG || tuiMetricsEnabled()
// Targeted live-streaming render profiling — see metricsLogger.ts. Read once
// at module scope (matches PERF_LOG) so the hot-path memos below pay nothing
// but a boolean check when disabled.
const CARD_PROFILE = cardProfileEnabled()

if (PERF_LOG) {
  try { mkdirSync(dirname(PERF_LOG_PATH), { recursive: true }) } catch { /* logging is best-effort */ }
}

const perfWindow = { frames: 0, slow: 0, maxDur: 0, startedAt: 0 }
function recordFramePerf(durationMs: number): void {
  const now = performance.now()
  if (perfWindow.startedAt === 0) perfWindow.startedAt = now
  perfWindow.frames++
  if (durationMs > FRAME_BUDGET_MS) perfWindow.slow++
  if (durationMs > perfWindow.maxDur) perfWindow.maxDur = durationMs
  if (now - perfWindow.startedAt >= 1000) {
    const line = `${new Date().toISOString()} commits=${perfWindow.frames} over-budget=${perfWindow.slow} max=${perfWindow.maxDur.toFixed(2)}ms\n`
    try { appendFileSync(PERF_LOG_PATH, line) } catch { /* never break the UI for logging */ }
    perfWindow.frames = 0
    perfWindow.slow = 0
    perfWindow.maxDur = 0
    perfWindow.startedAt = now
  }
}

class TuiErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    const { error } = this.state
    if (error) {
      return (
        <box flexDirection="column" paddingX={2} paddingY={1}>
          <text fg="#ff6b6b" wrapMode="word">Render error: {error.message}</text>
          <text fg="#888888" wrapMode="none">Malformed transcript — scroll past this card or reload.</text>
        </box>
      )
    }
    return this.props.children
  }
}

function Spinner({ label, fg, frames = SPINNER_FRAMES }: { label: string; fg: string; frames?: readonly string[] }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), 80)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <text fg={fg}>{`${frames[frame % frames.length]} ${label}`}</text>
}

function IdleTicker({ seed, fg }: { seed: string; fg: string }) {
  const hash = stableHash(seed)
  const spinnerFrames = IDLE_TICKER_SPINNER_VARIANTS[hash % IDLE_TICKER_SPINNER_VARIANTS.length]!
  const [phraseIndex, setPhraseIndex] = useState(() => (hash >>> 8) % IDLE_TICKER_PHRASES.length)
  useEffect(() => {
    const id = setInterval(
      () => setPhraseIndex((i) => (i + 1) % IDLE_TICKER_PHRASES.length),
      IDLE_TICKER_ROTATE_MS,
    )
    return () => clearInterval(id)
  }, [])
  return <Spinner label={IDLE_TICKER_PHRASES[phraseIndex]!} fg={fg} frames={spinnerFrames} />
}

function ComposerWaitingStatus({
  startedAt,
  seed,
  suffix,
  fg,
  width,
}: {
  startedAt: number | null
  seed: string
  suffix: string | null
  fg: string
  width: number
}) {
  const [frame, setFrame] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const hash = stableHash(seed)
  const frames = COMPOSER_WAITING_SPINNER_FRAMES[hash % COMPOSER_WAITING_SPINNER_FRAMES.length] ?? COMPOSER_WAITING_SPINNER_FRAMES[0]
  const message = COMPOSER_WAITING_MESSAGES[hash % COMPOSER_WAITING_MESSAGES.length] ?? COMPOSER_WAITING_MESSAGES[0]

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((current) => current + 1)
      setNow(Date.now())
    }, 120)
    return () => clearInterval(id)
  }, [])

  const elapsed = formatElapsedClock(startedAt == null ? 0 : Math.max(now - startedAt, 0))
  const status = suffix
    ? `${frames[frame % frames.length]} ${message}... (${elapsed} · ${suffix})`
    : `${frames[frame % frames.length]} ${message}... (${elapsed})`
  return <text fg={fg} wrapMode="none">{fitText(status, width)}</text>
}

const PROVIDERS: ProviderSelection[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'all']
const TUI_PROVIDER_TAG: Record<string, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  copilot: 'copilot',
  pi: 'pi',
}
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
  'flexoki-light',
  'nord-light',
  'vitesse-light',
  'white',
  'stripe',
  'claude-cream',
  'supabase',
  'posthog',
  'replicate',
  'notion',
  'figma',
  'miro',
  'apple',
  'nike',
  'pinterest',
  'playstation',
  'nvidia',
  'mongodb',
  'slack',
  'cohere',
  'mistral',
  'cursor',
  'airbnb',
  'intercom',
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
  'flexoki-dark',
  'cobalt',
  'vitesse-dark',
  'synthwave',
  'ethereal',
  'hackerman',
  'lumon',
  'matte-black',
  'miasma',
  'osaka-jade',
  'retro-82',
  'ristretto',
  'vantablack',
  'linear',
  'sentry',
  'raycast',
  'framer',
  'ferrari',
  'resend',
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
// Safety net: max time to wait for a completed turn's persisted rows before
// force-revealing the polled transcript, so the "Syncing…" state can't hang
// forever on a lost/delayed write. Generous vs the 2s detail poll.
const AWAITING_PERSISTED_TURN_TIMEOUT_MS = 12000
const DEFAULT_SIDEBAR_WIDTH = 32
const SIDEBAR_RESIZE_STEP = 2
const MIN_SIDEBAR_WIDTH = 28
const MIN_READER_WIDTH = 40
const TASK_PANEL_MIN_WIDTH = 24
const TASK_PANEL_DEFAULT_WIDTH = 32
const TASK_PANEL_MAX_WIDTH = 60
const TASK_PANEL_RESIZE_STEP = 4
// Cached TuiSessionDetail bundles include the full transcript, blocks, and
// derived landmarks. Cap at 2 — active + one neighbour — to halve the worst-
// case resident footprint on long-running TUI sessions. Switching further back
// re-fetches and re-threads, which the workers already do off the main thread.
const SESSION_CACHE_LIMIT = 2
const EXIT_CLEANUP_TIMEOUT_MS = 1500
const MESSAGE_SCROLL_ACCEL = new MacOSScrollAccel()
// Velocity scroll tuning — see velocityScrollStep(). A gap longer than the
// reset window between same-direction j/k/↑/↓ events means the key was
// released, so the streak (and thus the speed) starts over from base.
const VELOCITY_SCROLL_RESET_MS = 160
const VELOCITY_SCROLL_RAMP_MS = 700
const VELOCITY_SCROLL_MAX_STEP = 8
const TERMINAL_SELECTION_COPY_WINDOW_MS = 15_000

type PaneFocus = 'sessions' | 'messages'

type CardLandmark = {
  kind: 'resume' | 'unread' | 'day' | 'gap'
  text: string
}

// Stable per-card data: expensive to compute, independent of landmark indices and search.
type StableCardData = {
  bodyLines: TuiTranscriptCardLine[]
  diffView: TuiPierreDiffView | null
  codeBlockLineCounts: number[]
}

type CardDisplayData = {
  landmarks: CardLandmark[]
  bodyLines: TuiTranscriptCardLine[]
  diffView: TuiPierreDiffView | null
  codeBlockLineCounts: number[]
  // Query-independent header metadata. The match-tag is folded in at render
  // time inside TranscriptCard so search-query changes don't invalidate
  // this whole array (proposal 4).
  headerMeta: string
  accent: string
  isThinkingCard: boolean
  categoryEmoji: string
  isInsight: boolean
  markdownFallbackLines: string[] | null
}

type NoticeTone = 'info' | 'error'

const PIERRE_DIFF_CACHE = new WeakMap<TuiTranscriptCard, {
  isExpanded: boolean
  value: TuiPierreDiffView | null
}>()

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

type ClipboardImage = { data: string; mimeType: string; displayName: string }
type ComposerPromptPart =
  | { id: string; kind: 'text'; marker: string; text: string }
  | { id: string; kind: 'attachment'; marker: string; attachment: SendAttachment }
type ComposerDraftSnapshot = {
  text: string
  attachments: SendAttachment[]
  promptParts: ComposerPromptPart[]
  cursorOffset?: number
}
type ComposerPromptPartRange = ComposerPromptPart & { start: number; end: number }
type ComposerSubmission = {
  visibleText: string
  messageText: string
  attachments: SendAttachment[]
  promptParts: ComposerPromptPart[]
}

function parseFileUrlList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const url = new URL(line)
        return url.protocol === 'file:' ? [decodeURIComponent(url.pathname)] : []
      } catch {
        return []
      }
    })
}

function clipboardImageMimeTypeForPath(path: string): string | null {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return null
}

function pastedFileMimeTypeForPath(path: string): string {
  const imageMime = clipboardImageMimeTypeForPath(path)
  if (imageMime) return imageMime
  const lower = path.toLowerCase()
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown'
  return 'text/plain'
}

function normalizePastedFilePath(value: string, cwd: string | null | undefined): string | null {
  const raw = value.trim().replace(/^['"]+|['"]+$/g, '')
  if (!raw || raw.includes('\n')) return null
  let path = raw
  if (path.startsWith('file://')) {
    try {
      path = fileURLToPath(path)
    } catch {
      return null
    }
  } else if (process.platform !== 'win32') {
    path = path.replace(/\\(.)/g, '$1')
  }
  if (/^https?:\/\//i.test(path)) return null
  return isAbsolute(path) ? path : resolve(cwd || process.cwd(), path)
}

function appleScriptStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function isWslRuntime(): boolean {
  return process.platform === 'linux' && release().includes('WSL')
}

function runClipboardCommand(command: string, args: readonly string[] = [], timeoutMs = 2500): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: process.env.CLANG_MODULE_CACHE_PATH || '/tmp/agent-viewer-clang-module-cache',
      },
    })

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Clipboard command timed out: ${command}`))
    }, timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
    child.stdout.on('data', (chunk) => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.stderr.on('data', (chunk) => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve(Buffer.concat(stdout))
        return
      }
      reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `Clipboard command failed: ${command}`))
    })
  })
}

async function readClipboardText(): Promise<string> {
  const platform = process.platform
  const windowsClipboard = platform === 'win32' || isWslRuntime()
  const candidates = platform === 'darwin'
    ? [['pbpaste', []] as const]
    : windowsClipboard
    ? [['powershell.exe', ['-NonInteractive', '-NoProfile', '-Command', 'Get-Clipboard -Raw']] as const]
    : [
        ['wl-paste', ['--no-newline']] as const,
        ['xclip', ['-selection', 'clipboard', '-o']] as const,
        ['xsel', ['--clipboard', '--output']] as const,
      ]

  let lastError: Error | null = null
  for (const [command, args] of candidates) {
    try {
      return (await runClipboardCommand(command, args)).toString('utf8')
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError ?? new Error('No clipboard command available')
}

async function readMacClipboardImageWithAppleScript(): Promise<ClipboardImage | null> {
  const tmpfile = join(tmpdir(), `agent-viewer-clipboard-${process.pid}.png`)
  try {
    await runClipboardCommand('osascript', [
      '-e',
      'set imageData to the clipboard as "PNGf"',
      '-e',
      `set fileRef to open for access POSIX file ${appleScriptStringLiteral(tmpfile)} with write permission`,
      '-e',
      'set eof fileRef to 0',
      '-e',
      'write imageData to fileRef',
      '-e',
      'close access fileRef',
    ], 3500)
    const data = await readFile(tmpfile, 'base64')
    if (!data) return null
    return {
      data,
      mimeType: 'image/png',
      displayName: pastedImageDisplayName('image/png'),
    }
  } catch {
    return null
  } finally {
    await rm(tmpfile, { force: true }).catch(() => {})
  }
}

async function readMacClipboardImageWithSwift(): Promise<ClipboardImage | null> {
  const script = `
import AppKit
import Foundation

func emit(_ mimeType: String, _ data: Data) -> Never {
  print(mimeType)
  print(data.base64EncodedString())
  exit(0)
}

func emitImage(_ image: NSImage) -> Never? {
  guard let tiff = image.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff),
        let png = rep.representation(using: .png, properties: [:]) else {
    return nil
  }
  emit("image/png", png)
}

let pasteboard = NSPasteboard.general

if let png = pasteboard.data(forType: .png), !png.isEmpty {
  emit("image/png", png)
}

if let tiff = pasteboard.data(forType: .tiff),
   let rep = NSBitmapImageRep(data: tiff),
   let png = rep.representation(using: .png, properties: [:]) {
  emit("image/png", png)
}

if let image = NSImage(pasteboard: pasteboard) {
  _ = emitImage(image)
}

if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: nil) as? [URL] {
  for url in urls where url.isFileURL {
    let ext = url.pathExtension.lowercased()
    let mimeType: String?
    switch ext {
    case "png": mimeType = "image/png"
    case "jpg", "jpeg": mimeType = "image/jpeg"
    case "gif": mimeType = "image/gif"
    case "webp": mimeType = "image/webp"
    default: mimeType = nil
    }
    if let mimeType, let data = try? Data(contentsOf: url), !data.isEmpty {
      emit(mimeType, data)
    }
  }
}

exit(2)
`

  try {
    const output = await runClipboardCommand('swift', ['-e', script], 10_000)
    const lines = output.toString('utf8').trim().split(/\r?\n/)
    const mimeType = lines.shift()?.trim()
    const data = lines.join('').trim()
    if (!mimeType?.startsWith('image/') || !data) return null
    return {
      data,
      mimeType,
      displayName: pastedImageDisplayName(mimeType),
    }
  } catch {
    return null
  }
}

async function readClipboardImage(): Promise<ClipboardImage | null> {
  const platform = process.platform
  const windowsClipboard = platform === 'win32' || isWslRuntime()
  if (platform === 'darwin') {
    const appleScriptImage = await readMacClipboardImageWithAppleScript()
    if (appleScriptImage) return appleScriptImage

    const swiftImage = await readMacClipboardImageWithSwift()
    if (swiftImage) return swiftImage
  }
  const candidates: Array<{ command: string; args: string[]; mimeType: string; base64Output?: boolean }> = platform === 'darwin'
    ? [
        { command: 'pngpaste', args: ['-'], mimeType: 'image/png' },
        {
          command: 'osascript',
          args: [
            '-l',
            'JavaScript',
            '-e',
            "ObjC.import('AppKit'); const pb=$.NSPasteboard.generalPasteboard; let data=pb.dataForType($.NSPasteboardTypePNG) || pb.dataForType('public.png'); if (!data) { const tiff=pb.dataForType($.NSPasteboardTypeTIFF) || pb.dataForType('public.tiff'); if (tiff) { const rep=$.NSBitmapImageRep.imageRepWithData(tiff); if (rep) data=rep.representationUsingTypeProperties(4, $.NSDictionary.dictionary); } } if (!data) $.exit(2); console.log(ObjC.unwrap(data.base64EncodedStringWithOptions(0)));",
          ],
          mimeType: 'image/png',
          base64Output: true,
        },
      ]
    : windowsClipboard
    ? [{
        command: 'powershell.exe',
        args: [
          '-NonInteractive',
          '-NoProfile',
          '-command',
          "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $img=[Windows.Forms.Clipboard]::GetImage(); if ($null -eq $img) { exit 2 }; $ms=New-Object IO.MemoryStream; $img.Save($ms,[Drawing.Imaging.ImageFormat]::Png); [Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))",
        ],
        mimeType: 'image/png',
        base64Output: true,
      }]
    : [
        { command: 'wl-paste', args: ['-t', 'image/png'], mimeType: 'image/png' },
        { command: 'wl-paste', args: ['-t', 'image/jpeg'], mimeType: 'image/jpeg' },
        { command: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'], mimeType: 'image/png' },
        { command: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/jpeg', '-o'], mimeType: 'image/jpeg' },
      ]

  for (const candidate of candidates) {
    try {
      const output = await runClipboardCommand(candidate.command, candidate.args, 3500)
      const data = candidate.base64Output
        ? output.toString('utf8').trim()
        : output.toString('base64')
      if (!data) continue
      return {
        data,
        mimeType: candidate.mimeType,
        displayName: pastedImageDisplayName(candidate.mimeType),
      }
    } catch {
      // Try the next clipboard backend/format.
    }
  }

  if (platform === 'darwin') {
    try {
      const output = await runClipboardCommand('osascript', [
        '-l',
        'JavaScript',
        '-e',
        "ObjC.import('AppKit'); const pb=$.NSPasteboard.generalPasteboard; const urls=pb.readObjectsForClassesOptions($[$.NSURL.class], null); if (!urls || urls.count === 0) $.exit(2); for (let i=0; i<urls.count; i++) console.log(ObjC.unwrap(urls.objectAtIndex(i).absoluteString));",
      ], 3500)
      for (const path of parseFileUrlList(output.toString('utf8'))) {
        const mimeType = clipboardImageMimeTypeForPath(path)
        if (!mimeType) continue
        const data = await readFile(path, 'base64')
        return {
          data,
          mimeType,
          displayName: path.split('/').pop() || pastedImageDisplayName(mimeType),
        }
      }
    } catch {
      // Clipboard does not contain image file URLs.
    }
  }

  return null
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

function formatContextUsageChip(usage: Pick<ContextUsage, 'totalTokens' | 'maxTokens' | 'percentage'>): string {
  const total = fmtTokens(usage.totalTokens)
  if (usage.maxTokens <= 0) return total
  const percentage = Number.isFinite(usage.percentage) ? Math.round(usage.percentage) : 0
  return `${total}/${fmtTokens(usage.maxTokens)} ${percentage}%`
}

function formatLiveOutputTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatTuiComposerIdleHint(baseHint: string, historyCount: number): string {
  const cleaned = baseHint
    .replace(/\s*·\s*(?:↑↓|⌃P\/⌃N|\^P\/\^N|\^R|⌃R)\s+(?:search\s+)?history(?:\s*\(\d+\))?/g, '')
    .trim()
  const withSettings = cleaned.replace('⏎ send', '⏎ send · ⌥M model/effort')
  const historyHint = historyCount > 0
    ? `⌃P/⌃N history (${historyCount})`
    : '⌃P/⌃N history'
  return `${withSettings} · ${historyHint}`
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

type InlineTextSegment = {
  text: string
  fg: string
}

function clipText(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length <= width) return value
  if (width === 1) return value.slice(0, 1)
  return `${value.slice(0, width - 1)}…`
}

function renderInlineTextSegments(segments: InlineTextSegment[], width: number, padFg: string): React.ReactNode[] {
  if (width <= 0) return []
  const out: React.ReactNode[] = []
  let remaining = width
  for (let i = 0; i < segments.length; i += 1) {
    if (remaining <= 0) break
    const segment = segments[i]
    if (!segment?.text) continue
    const clipped = clipText(segment.text, remaining)
    if (!clipped) continue
    out.push(<span key={i} fg={segment.fg}>{clipped}</span>)
    remaining -= clipped.length
  }
  if (remaining > 0) {
    out.push(<span key="pad" fg={padFg}>{' '.repeat(remaining)}</span>)
  }
  return out
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function formatElapsedClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  if (totalMinutes > 0) return `${totalMinutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

function formatModelChipValue(value: string): string {
  try {
    const parsed = JSON.parse(value) as { modelID?: unknown; modelId?: unknown; id?: unknown }
    for (const candidate of [parsed.modelID, parsed.modelId, parsed.id]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate
    }
  } catch {
    // Plain provider model id.
  }
  return value.split('/').pop() || value
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

const COMPOSER_MIN_HEIGHT = 6
const COMPOSER_MAX_HEIGHT = 12
const COMPOSER_DOCK_CHROME_HEIGHT = 3
const COMPOSER_WINDOW_MAX_WIDTH = 96
const COMPOSER_WINDOW_MAX_HEIGHT = 36
const CODEX_LIVE_ASSISTANT_UUID = 'live-codex-assistant'
type ComposerKeyBinding = { name: string; action: TextareaAction; shift?: boolean; alt?: boolean; meta?: boolean; ctrl?: boolean }
const TUI_SLASH_HINTS: Record<string, string[]> = {
  claude: ['/clear', '/compact', '/help', '/model', '/cost', '/review'],
  codex: ['/clear', '/diff', '/status', '/compact'],
  opencode: ['/clear', '/summarize', '/help'],
  copilot: ['/help', '/clear'],
  pi: ['/help', '/clear'],
}

function detectMentionAtCursor(text: string, cursor: number): { start: number; query: string } | null {
  if (cursor <= 0) return null
  let i = cursor - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === '@') break
    if (!ch || /\s/.test(ch)) return null
    i -= 1
  }
  if (i < 0 || text[i] !== '@') return null
  if (i > 0 && !/\s/.test(text[i - 1] ?? '')) return null
  const query = text.slice(i + 1, cursor)
  if (query.length > 60) return null
  return { start: i, query }
}

function activeMentionAttachments(text: string, attachments: SendAttachment[]): SendAttachment[] {
  if (attachments.length === 0) return []
  return attachments.filter((attachment) => (
    attachment.type === 'blob' || attachment.type === 'image'
      ? attachment.text ? text.includes(attachment.text) : true
      : attachment.type === 'agent'
      ? Boolean(attachment.displayName && text.includes(`@${attachment.displayName}`))
      : Boolean(attachment.path && text.includes(`@${attachment.path}`))
  ))
}

function pasteImageMimeType(mimeType: string | undefined): string | null {
  if (!mimeType) return null
  const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase()
  return normalized?.startsWith('image/') ? normalized : null
}

function inferPastedImageMimeType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6))
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.subarray(0, 4))
    const webp = String.fromCharCode(...bytes.subarray(8, 12))
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp'
  }
  return null
}

function pastedImageDisplayName(mimeType: string): string {
  const extension = mimeType.split('/')[1]?.replace(/[^a-z0-9.+-]/gi, '') || 'png'
  return `pasted-image.${extension}`
}

function imageAttachmentCount(attachments: SendAttachment[]): number {
  return attachments.filter((attachment) => (
    (attachment.type === 'blob' && attachment.mimeType?.startsWith('image/')) || attachment.type === 'image'
  )).length
}

function attachmentCountLabel(attachments: SendAttachment[]): string | null {
  if (attachments.length === 0) return null
  const imageCount = imageAttachmentCount(attachments)
  const otherCount = attachments.length - imageCount
  const parts: string[] = []
  if (imageCount > 0) parts.push(`${imageCount} image${imageCount === 1 ? '' : 's'}`)
  if (otherCount > 0) parts.push(`${otherCount} attachment${otherCount === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

function composerSnapshotText(snapshot: ComposerDraftSnapshot): string {
  return snapshot.text
}

function compactComposerEntryText(text: string): string {
  return text.replace(/\s+/g, ' ').trim() || '(empty prompt)'
}

function composerEntryLineCount(text: string): number {
  return text.length === 0 ? 1 : text.split('\n').length
}
// NOTE: OpenTUI's mergeKeyBindings hashes by `name:ctrl:shift:meta:super` —
// `alt` is NOT part of the key. Listing `{ name: 'return', alt: true, ... }`
// collapses onto the same slot as plain `{ name: 'return', ... }` and silently
// overwrites the submit binding, so Enter ends up bound to newline.
// Option-Enter on macOS is delivered as `meta: true` (see binding below).
const composerKeyBindings: ComposerKeyBinding[] = [
  { name: 'return', action: 'submit' },
  { name: 'return', shift: true, action: 'newline' },
  { name: 'return', meta: true, action: 'newline' },
  { name: 'j', ctrl: true, action: 'newline' },
  { name: 'linefeed', action: 'newline' },
]
const TRANSCRIPT_TOP_MARGIN = 2
// Metadata refresh is intentionally slow because Claude control queries are
// expensive and can still cause main-thread pressure when they complete.
const CLAUDE_METADATA_REFRESH_MS = 5 * 60_000
const DEFAULT_METADATA_REFRESH_MS = 60_000
const CLAUDE_BACKGROUND_METADATA_REFRESH_MS = 30 * 60_000
const DEFAULT_BACKGROUND_METADATA_REFRESH_MS = 5 * 60_000
const METADATA_REQUEST_TIMEOUT_MS = 4_000
// Fire an OSC 9 / OSC 99 desktop notification when a composer send takes at
// least this long. Tuned high enough that quick replies don't bell the user.
const NOTIFY_AFTER_MS = 8_000
const NOTIFY_PREVIEW_CHARS = 140
const MAX_CODE_BLOCK_RENDER_LINES = 240
const MAX_MARKDOWN_SYNTAX_CHARS = 80_000

type SseFrame = {
  event: string
  data: string
}

type TuiLiveToolActivity = {
  key: string
  label: string
  status: 'running' | 'done'
}

type PermissionOption = { response: PermissionResponse; label: string }

// Ordered decisions for the approval overlay. 'always' is hidden when the
// provider can't offer a session-scoped grant for this request.
function permissionOptionsFor(permission: PendingPermission): PermissionOption[] {
  const options: PermissionOption[] = [{ response: 'once', label: 'Allow' }]
  if (permission.canApproveAlways !== false) options.push({ response: 'always', label: 'Always' })
  options.push({ response: 'reject', label: 'Reject' })
  return options
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

function extractCodexTurnPlanText(payload: Record<string, unknown>): string | null {
  const plan = Array.isArray(payload.plan) ? payload.plan : []
  const steps = plan
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const record = entry as Record<string, unknown>
      const step = typeof record.step === 'string' ? record.step.trim() : ''
      if (!step) return []
      const status = typeof record.status === 'string' ? record.status : ''
      const marker = status === 'completed'
        ? '[x]'
        : status === 'inProgress'
        ? '[~]'
        : '[ ]'
      return [`${marker} ${step}`]
    })
  const explanation = typeof payload.explanation === 'string' ? payload.explanation.trim() : ''
  if (steps.length === 0) return explanation || null
  return `${explanation ? `${explanation}\n\n` : ''}## Plan\n\n${steps.join('\n')}`
}

// Append-only reasoning/thinking deltas, kept separate from the answer so the
// composer can stream them as a distinct dim channel (matching the native CLIs).
function extractStreamingReasoningText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if ((record.type === 'codex_reasoning_delta' || record.type === 'codex_reasoning_summary_delta')
    && typeof record.delta === 'string') {
    return record.delta
  }

  if (record.type === 'stream_event') {
    if (typeof record.parent_tool_use_id === 'string' && record.parent_tool_use_id) return null
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'content_block_delta') return null
    const delta = eventRecord.delta
    if (!delta || typeof delta !== 'object') return null
    const deltaRecord = delta as Record<string, unknown>
    return deltaRecord.type === 'thinking_delta' && typeof deltaRecord.thinking === 'string'
      ? deltaRecord.thinking
      : null
  }

  if (record.type === 'pi_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'message_update') return null
    const assistantMessageEvent = eventRecord.assistantMessageEvent
    if (!assistantMessageEvent || typeof assistantMessageEvent !== 'object') return null
    const updateRecord = assistantMessageEvent as Record<string, unknown>
    return updateRecord.type === 'thinking_delta' && typeof updateRecord.delta === 'string'
      ? updateRecord.delta
      : null
  }

  if (record.type === 'opencode_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'message.part.delta') return null
    const properties = eventRecord.properties
    if (!properties || typeof properties !== 'object') return null
    const propertiesRecord = properties as Record<string, unknown>
    const field = typeof propertiesRecord.field === 'string' ? propertiesRecord.field : ''
    return field === 'reasoning' && typeof propertiesRecord.delta === 'string'
      ? propertiesRecord.delta
      : null
  }

  if (record.type === 'copilot_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'assistant.reasoning_delta') return null
    const data = eventRecord.data
    if (!data || typeof data !== 'object') return null
    const dataRecord = data as Record<string, unknown>
    return typeof dataRecord.deltaContent === 'string'
      ? dataRecord.deltaContent
      : typeof dataRecord.delta === 'string'
      ? dataRecord.delta
      : null
  }

  return null
}

function extractStreamingAssistantText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_agent_message_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  // Reasoning deltas are handled by extractStreamingReasoningText and rendered
  // on a separate dim channel; only the plan delta stays in the answer here.
  if (record.type === 'codex_plan_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  if (record.type === 'codex_turn_plan_updated') {
    return extractCodexTurnPlanText(record)
  }

  if (record.type === 'codex_error') {
    const error = record.error
    if (!error || typeof error !== 'object') return null
    const errorRecord = error as Record<string, unknown>
    const message = typeof errorRecord.message === 'string' ? errorRecord.message : ''
    const details = typeof errorRecord.additionalDetails === 'string' ? errorRecord.additionalDetails : ''
    return [message, details].filter(Boolean).join('\n\n') || null
  }

  if (record.type === 'codex_realtime_transcript_delta') {
    return record.role === 'assistant' && typeof record.delta === 'string'
      ? record.delta
      : null
  }

  if (record.type === 'codex_realtime_transcript_done') {
    return record.role === 'assistant' && typeof record.text === 'string'
      ? record.text
      : null
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
    if (typeof record.parent_tool_use_id === 'string' && record.parent_tool_use_id) return null
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

  if (record.type === 'pi_bash_delta' && typeof record.delta === 'string') {
    return record.delta
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
  if (record.type === 'codex_error') return true
  if (record.type === 'codex_turn_plan_updated') return true
  if (record.type === 'codex_realtime_transcript') return true
  if (record.type === 'codex_realtime_transcript_done') return true
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

function extractCodexVisibleAssistantText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_agent_message_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  if (record.type === 'codex_plan_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  if (record.type === 'codex_turn_plan_updated') {
    return extractCodexTurnPlanText(record)
  }

  if (record.type === 'codex_realtime_transcript_delta') {
    return record.role === 'assistant' && typeof record.delta === 'string'
      ? record.delta
      : null
  }

  if (record.type === 'codex_realtime_transcript_done') {
    return record.role === 'assistant' && typeof record.text === 'string'
      ? record.text
      : null
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
    if (itemRecord.type === 'agentMessage' && typeof itemRecord.text === 'string') return itemRecord.text
    if (itemRecord.type === 'plan' && typeof itemRecord.text === 'string') return `## Plan\n\n${itemRecord.text}`
    return null
  }

  if (record.type === 'codex_item_completed') {
    const item = record.item
    if (!item || typeof item !== 'object') return null
    const itemRecord = item as Record<string, unknown>
    if (itemRecord.type === 'agentMessage' && typeof itemRecord.text === 'string') return itemRecord.text
    if (itemRecord.type === 'plan' && typeof itemRecord.text === 'string') return `## Plan\n\n${itemRecord.text}`
  }

  return null
}

function shouldReplaceCodexVisibleAssistantText(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  if (record.type === 'codex_turn_plan_updated') return true
  if (record.type === 'codex_realtime_transcript') return true
  if (record.type === 'codex_realtime_transcript_done') return true
  if (record.type === 'codex_realtime_item_added') return true
  return record.type === 'codex_item_completed'
}

function stringifyLiveValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function upsertThreadedMessage(messages: ThreadedMessage[], nextMessage: ThreadedMessage): ThreadedMessage[] {
  const existingIndex = messages.findIndex((message) => message.uuid === nextMessage.uuid)
  if (existingIndex === -1) return [...messages, nextMessage]
  return messages.map((message, index) => index === existingIndex ? nextMessage : message)
}

function completeLiveToolThread(messages: ThreadedMessage[], key: string): ThreadedMessage[] {
  const targetUuid = `live-tool:${key}`
  return messages.map((message) => {
    if (message.uuid !== targetUuid) return message
    return {
      ...message,
      blocks: message.blocks.map((block) => {
        if (block.type !== 'tool_thread') return block
        if (block.result) return block
        return {
          ...block,
          result: {
            type: 'tool_result',
            tool_use_id: block.toolUse.id,
            content: 'Tool call emitted in live stream. Final output will appear when the transcript syncs.',
          },
        }
      }),
    }
  })
}

function updateLiveToolThreadInput(
  messages: ThreadedMessage[],
  key: string,
  input: Record<string, unknown>,
): ThreadedMessage[] {
  const targetUuid = `live-tool:${key}`
  return messages.map((message) => {
    if (message.uuid !== targetUuid) return message
    return {
      ...message,
      blocks: message.blocks.map((block) => block.type === 'tool_thread'
        ? { ...block, toolUse: { ...block.toolUse, input } }
        : block),
    }
  })
}

function codexLiveToolLabel(item: Record<string, unknown>): string | null {
  switch (item.type) {
    case 'commandExecution':
      return 'Bash'
    case 'fileChange':
      return 'FileChange'
    case 'mcpToolCall':
      return typeof item.tool === 'string' && item.tool.trim()
        ? item.tool
        : 'MCP'
    case 'dynamicToolCall':
      return typeof item.tool === 'string' && item.tool.trim()
        ? item.tool
        : 'DynamicTool'
    case 'collabAgentToolCall':
      return 'Agent'
    case 'webSearch':
      return 'WebSearch'
    case 'imageView':
      return 'ImageView'
    case 'imageGeneration':
      return 'ImageGeneration'
    case 'contextCompaction':
      return 'ContextCompaction'
    case 'hookPrompt':
      return 'Hook'
    default:
      return null
  }
}

function extractCodexLiveToolActivity(payload: Record<string, unknown>): TuiLiveToolActivity | null {
  if (payload.type !== 'codex_item_started' && payload.type !== 'codex_item_completed') return null
  const item = payload.item
  if (!item || typeof item !== 'object') return null
  const itemRecord = item as Record<string, unknown>
  const label = codexLiveToolLabel(itemRecord)
  if (!label) return null
  const itemId = typeof itemRecord.id === 'string' && itemRecord.id
    ? itemRecord.id
    : typeof payload.itemId === 'string' && payload.itemId
    ? payload.itemId
    : label
  return {
    key: itemId,
    label,
    status: payload.type === 'codex_item_completed' ? 'done' : 'running',
  }
}

function applyLiveToolActivity(prev: TuiLiveToolActivity[], activity: TuiLiveToolActivity): TuiLiveToolActivity[] {
  const existingIndex = prev.findIndex((entry) => entry.key === activity.key)
  if (existingIndex === -1) return [...prev, activity]
  return prev.map((entry, index) => index === existingIndex ? activity : entry)
}

function codexToolNameForDelta(type: unknown): string {
  if (type === 'codex_file_change_output_delta' || type === 'codex_file_change_patch_updated') return 'FileChange'
  if (type === 'codex_mcp_tool_progress') return 'MCP'
  return 'Bash'
}

function codexLiveDeltaText(record: Record<string, unknown>): string | null {
  if (record.type === 'codex_mcp_tool_progress') {
    return typeof record.message === 'string' && record.message ? `${record.message}\n` : null
  }
  if (record.type === 'codex_file_change_patch_updated') {
    const changes = Array.isArray(record.changes) ? record.changes.length : 0
    return `Patch updated (${changes} change${changes === 1 ? '' : 's'}).\n`
  }
  if (record.type === 'codex_command_output_delta' || record.type === 'codex_file_change_output_delta') {
    return typeof record.delta === 'string' ? record.delta : null
  }
  return null
}

function appendCodexLiveToolOutput(
  messages: ThreadedMessage[],
  payload: Record<string, unknown>,
  targetSession: Session,
): ThreadedMessage[] {
  const deltaText = codexLiveDeltaText(payload)
  if (!deltaText) return messages

  const turnId = typeof payload.turnId === 'string' && payload.turnId ? payload.turnId : null
  const itemId = typeof payload.itemId === 'string' && payload.itemId ? payload.itemId : null
  if (!turnId || !itemId) return messages

  const messageUuid = `${turnId}:${itemId}`
  const toolUseId = `${messageUuid}:tool`
  let matched = false
  const nextMessages = messages.map((message) => {
    if (message.uuid !== messageUuid) return message
    matched = true
    return {
      ...message,
      blocks: message.blocks.map((block) => {
        if (block.type !== 'tool_thread' || block.toolUse.id !== toolUseId) return block
        const existing = typeof block.result?.content === 'string' ? block.result.content : ''
        const result: ToolResultBlock = {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: `${existing}${deltaText}`,
          is_error: block.result?.is_error,
        }
        return { ...block, result }
      }),
    }
  })

  if (matched) return nextMessages

  const sessionId = typeof payload.threadId === 'string' && payload.threadId
    ? payload.threadId
    : targetSession.sessionId
  const toolName = codexToolNameForDelta(payload.type)
  return [
    ...nextMessages,
    {
      role: 'assistant',
      uuid: messageUuid,
      sessionId,
      provider: targetSession.provider ?? 'codex',
      blocks: [{
        type: 'tool_thread',
        toolUse: {
          type: 'tool_use',
          id: toolUseId,
          name: toolName,
          input: { status: 'running', itemId },
        },
        result: {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: deltaText,
        },
      }],
    },
  ]
}

function liveMessageSessionKey(message: ThreadedMessage): string | null {
  if (!message.sessionId) return null
  return `${message.provider ?? 'claude'}:${message.sessionId}`
}

function hasLiveAssistantMessage(messages: ThreadedMessage[], key: string): boolean {
  return messages.some((message) => liveMessageSessionKey(message) === key && message.role === 'assistant')
}

function hasPersistedAssistantAfterBaseline(rawMessages: import('../../lib/types').SessionMessage[], baselineCount: number): boolean {
  const durableMessages = rawMessages.filter(isDurableSessionMessage)
  const start = durableMessages.length > baselineCount
    ? baselineCount
    : Math.max(baselineCount - 1, 0)
  return durableMessages.slice(start).some((message) => message.type === 'assistant')
}

function makeLiveUserMessage(session: Session, text: string): ThreadedMessage {
  return {
    role: 'user',
    uuid: 'live-user',
    sessionId: session.sessionId,
    provider: session.provider ?? 'claude',
    blocks: [{ type: 'text', text }],
  }
}

function makeLiveAssistantTextMessage(session: Session, text: string, uuid: string, timestamp?: string): ThreadedMessage {
  return {
    role: 'assistant',
    uuid,
    sessionId: session.sessionId,
    provider: session.provider ?? 'claude',
    timestamp,
    blocks: [{ type: 'text', text }],
  }
}

function extractCopilotFinalAssistantMessage(payload: unknown, session: Session): ThreadedMessage | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.type !== 'copilot_event') return null
  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type !== 'assistant.message') return null
  const data = eventRecord.data
  if (!data || typeof data !== 'object') return null
  const dataRecord = data as Record<string, unknown>
  const content = typeof dataRecord.content === 'string' ? dataRecord.content : ''
  if (!content.trim()) return null
  const messageId = typeof dataRecord.messageId === 'string' && dataRecord.messageId
    ? dataRecord.messageId
    : typeof eventRecord.id === 'string' && eventRecord.id
    ? eventRecord.id
    : `fallback:${Date.now()}`
  const timestamp = typeof eventRecord.timestamp === 'string' ? eventRecord.timestamp : undefined
  return makeLiveAssistantTextMessage(session, content, `live-copilot:${messageId}`, timestamp)
}

type OpenCodeLiveSubagentInfo = {
  agentId: string
  name: string
  type: 'agent' | 'subtask'
}

type TuiMentionResult =
  | { kind: 'file'; path: string; basename: string }
  | { kind: 'agent'; name: string; description?: string; mode?: string }

function extractOpenCodeLiveSubagent(payload: unknown): OpenCodeLiveSubagentInfo | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.type !== 'opencode_event') return null
  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type !== 'message.part.updated') return null
  const properties = eventRecord.properties
  if (!properties || typeof properties !== 'object') return null
  const part = (properties as Record<string, unknown>).part
  if (!part || typeof part !== 'object') return null
  const partRecord = part as Record<string, unknown>
  const partType = partRecord.type
  if (partType !== 'agent' && partType !== 'subtask') return null
  const agentId = typeof partRecord.id === 'string' ? partRecord.id : null
  if (!agentId) return null
  if (partType === 'agent') {
    const name = typeof partRecord.name === 'string' ? partRecord.name : 'agent'
    return { agentId, name, type: 'agent' }
  }
  const description = typeof partRecord.description === 'string' ? partRecord.description : ''
  const agent = typeof partRecord.agent === 'string' ? partRecord.agent : ''
  return { agentId, name: description || agent || 'subtask', type: 'subtask' }
}

function extractOpenCodeLiveToolThread(payload: unknown, session: Session): ThreadedMessage | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.type !== 'opencode_event') return null

  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type !== 'message.part.updated') return null

  const properties = eventRecord.properties
  if (!properties || typeof properties !== 'object') return null
  const part = (properties as Record<string, unknown>).part
  if (!part || typeof part !== 'object') return null
  const partRecord = part as Record<string, unknown>
  if (partRecord.type !== 'tool' || typeof partRecord.tool !== 'string') return null

  const state = partRecord.state
  const stateRecord = state && typeof state === 'object' ? state as Record<string, unknown> : {}
  const status = typeof stateRecord.status === 'string' ? stateRecord.status : ''
  const toolUseId = typeof partRecord.callID === 'string'
    ? partRecord.callID
    : typeof partRecord.id === 'string'
    ? partRecord.id
    : `${partRecord.tool}:live`
  const input = stateRecord.input && typeof stateRecord.input === 'object'
    ? stateRecord.input as Record<string, unknown>
    : {}

  let result: ToolResultBlock | null = null
  if (status === 'completed' || status === 'error') {
    const raw = status === 'error'
      ? (stateRecord.error ?? stateRecord.output)
      : stateRecord.output
    result = {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: stringifyLiveValue(raw) || status,
      is_error: status === 'error' ? true : undefined,
    }
  }

  return {
    role: 'assistant',
    uuid: `live-tool:${toolUseId}`,
    sessionId: session.sessionId,
    provider: session.provider ?? 'opencode',
    blocks: [{
      type: 'tool_thread',
      toolUse: {
        type: 'tool_use',
        id: toolUseId,
        name: partRecord.tool,
        input,
      },
      result,
    }],
  }
}

function streamEventIndex(payload: unknown, eventType: string): number | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.type !== 'stream_event') return null
  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>
  return eventRecord.type === eventType && typeof eventRecord.index === 'number'
    ? eventRecord.index
    : null
}

function formatTimeGap(deltaMs: number): string | null {
  if (!Number.isFinite(deltaMs) || deltaMs < 30 * 60 * 1000) return null
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 90) return `${minutes}m later`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours}h later`
  return `${Math.round(hours / 24)}d later`
}

function sessionActivityMs(session: Session): number {
  const value = session.lastModified ?? session.createdAt
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const ms = new Date(value).getTime()
    return Number.isNaN(ms) ? 0 : ms
  }
  return 0
}

function compareSessionsByActivityDesc(a: Session, b: Session): number {
  const byActivity = sessionActivityMs(b) - sessionActivityMs(a)
  if (byActivity !== 0) return byActivity
  return sessionKey(a).localeCompare(sessionKey(b))
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

const sessionMessageFingerprintCache = new WeakMap<object, string>()
function sessionMessageFingerprint(message: import('../../lib/types').SessionMessage | undefined): string | null {
  if (!message) return null
  const cached = sessionMessageFingerprintCache.get(message)
  if (cached !== undefined) return cached
  const fingerprint = [
    message.type,
    message.uuid,
    message.timestamp ?? '',
    message.turnId ?? '',
    message.origin?.kind ?? '',
    compactStableFingerprint(message.message),
  ].join('|')
  sessionMessageFingerprintCache.set(message, fingerprint)
  return fingerprint
}

function sessionMessageSequenceFingerprint(messages: import('../../lib/types').SessionMessage[]): string {
  return `${messages.length}:${messages.map((message) => sessionMessageFingerprint(message) ?? '').join('\n')}`
}

function isDurableSessionMessage(message: import('../../lib/types').SessionMessage): boolean {
  return message.ephemeral !== true
}

type SidebarEntry =
  | { type: 'project'; key: string; projectName: string; count: number }
  | { type: 'session'; key: string; session: Session; absoluteIndex: number }

function buildSidebarEntries(sessions: Session[], sort: TuiSidebarSort): SidebarEntry[] {
  const entries: SidebarEntry[] = []
  const orderedSessions = sessions
    .map((session, absoluteIndex) => ({ session, absoluteIndex }))
    .sort((a, b) => compareSessionsByActivityDesc(a.session, b.session))

  if (sort === 'time') {
    // Sessions stay in global time-sort order. A project header is injected before
    // each run of consecutive sessions that share a project name.
    let prevProject = ''
    for (let i = 0; i < orderedSessions.length; i++) {
      const { session, absoluteIndex } = orderedSessions[i]
      const projectName = formatSessionProject(session).toUpperCase()
      if (projectName !== prevProject) {
        // Measure the length of this consecutive run so the header can show a count.
        let run = 1
        while (
          i + run < orderedSessions.length
          && formatSessionProject(orderedSessions[i + run].session).toUpperCase() === projectName
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
        absoluteIndex,
      })
    }
    return entries
  }

  // 'project' mode: group sessions by project, preserving time-sort order within each
  // group. Groups are ordered by the most-recently modified session they contain.
  const groupOrder: string[] = []
  const groups = new Map<string, Array<{ session: Session; absoluteIndex: number }>>()
  orderedSessions.forEach(({ session, absoluteIndex }) => {
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

function chooseSyntaxColor(theme: TuiThemePalette, preferred: string, fallbacks: string[]): string {
  const lowSignal = new Set([
    theme.text.toLowerCase(),
    theme.muted.toLowerCase(),
    theme.dim.toLowerCase(),
  ])
  if (!lowSignal.has(preferred.toLowerCase())) return preferred
  return fallbacks.find((color) => !lowSignal.has(color.toLowerCase())) ?? preferred
}

type SelectionColors = {
  selectionBg: string
  selectionFg: string
}

function parseHexRgb(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim().replace(/^#/, '')
  if (hex.length === 3) {
    const [r, g, b] = hex.split('').map((part) => Number.parseInt(`${part}${part}`, 16))
    return [r, g, b].every(Number.isFinite) ? { r, g, b } : null
  }
  if (hex.length !== 6) return null
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return [r, g, b].every(Number.isFinite) ? { r, g, b } : null
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function mixHexColor(accent: string, base: string, accentWeight: number): string | null {
  const accentRgb = parseHexRgb(accent)
  const baseRgb = parseHexRgb(base)
  if (!accentRgb || !baseRgb) return null
  const baseWeight = 1 - accentWeight
  return rgbToHex({
    r: accentRgb.r * accentWeight + baseRgb.r * baseWeight,
    g: accentRgb.g * accentWeight + baseRgb.g * baseWeight,
    b: accentRgb.b * accentWeight + baseRgb.b * baseWeight,
  })
}

function relativeLuminance(color: string): number | null {
  const rgb = parseHexRgb(color)
  if (!rgb) return null
  const channel = (value: number) => {
    const next = value / 255
    return next <= 0.03928 ? next / 12.92 : ((next + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

function terminalSelectionColors(theme: TuiThemePalette): SelectionColors {
  const lightTheme = (relativeLuminance(theme.bg) ?? relativeLuminance(theme.surface) ?? 0) > 0.5
  const selectionBg = mixHexColor(theme.cyan, theme.surface, lightTheme ? 0.22 : 0.42) ?? theme.surface3
  return {
    selectionBg,
    selectionFg: theme.text,
  }
}

type SelectionColorTarget = BaseRenderable & {
  selectionBg?: string
  selectionFg?: string
}

function applySelectionColorsToTree(root: BaseRenderable | null, colors: SelectionColors): void {
  if (!root) return
  const stack: BaseRenderable[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if ('selectionBg' in node) {
      const target = node as SelectionColorTarget
      target.selectionBg = colors.selectionBg
      target.selectionFg = colors.selectionFg
    }
    for (const child of node.getChildren()) {
      stack.push(child)
    }
  }
}

function buildSyntaxStyle(theme: TuiThemePalette): SyntaxStyle {
  const keywordColor = chooseSyntaxColor(theme, theme.violet, [theme.amber, theme.pink, theme.cyan])
  const functionColor = chooseSyntaxColor(theme, theme.cyan, [theme.green, theme.amber, theme.violet])
  const memberColor = chooseSyntaxColor(theme, theme.cyan, [theme.green, theme.amber, theme.violet])
  const typeColor = chooseSyntaxColor(theme, theme.pink, [theme.violet, theme.amber, theme.cyan])
  const builtinColor = chooseSyntaxColor(theme, theme.amber, [theme.pink, theme.violet, theme.green])

  return SyntaxStyle.fromStyles({
    keyword: { fg: RGBA.fromHex(keywordColor), bold: true },
    string: { fg: RGBA.fromHex(theme.green) },
    comment: { fg: RGBA.fromHex(theme.dim), italic: true, dim: true },
    number: { fg: RGBA.fromHex(builtinColor) },
    function: { fg: RGBA.fromHex(functionColor) },
    'function.call': { fg: RGBA.fromHex(functionColor) },
    'function.method': { fg: RGBA.fromHex(functionColor) },
    'function.method.call': { fg: RGBA.fromHex(functionColor) },
    'function.builtin': { fg: RGBA.fromHex(functionColor), bold: true },
    type: { fg: RGBA.fromHex(typeColor), bold: true },
    'type.builtin': { fg: RGBA.fromHex(builtinColor), bold: true },
    'type.definition': { fg: RGBA.fromHex(typeColor), bold: true },
    variable: { fg: RGBA.fromHex(theme.text) },
    'variable.builtin': { fg: RGBA.fromHex(builtinColor) },
    'variable.member': { fg: RGBA.fromHex(memberColor), bold: true },
    'variable.parameter': { fg: RGBA.fromHex(theme.text) },
    property: { fg: RGBA.fromHex(memberColor), bold: true },
    constructor: { fg: RGBA.fromHex(typeColor), bold: true },
    constant: { fg: RGBA.fromHex(theme.text) },
    'constant.builtin': { fg: RGBA.fromHex(builtinColor), bold: true },
    'constant.macro': { fg: RGBA.fromHex(builtinColor), bold: true },
    boolean: { fg: RGBA.fromHex(builtinColor) },
    character: { fg: RGBA.fromHex(theme.green) },
    'character.special': { fg: RGBA.fromHex(builtinColor) },
    tag: { fg: RGBA.fromHex(typeColor) },
    attribute: { fg: RGBA.fromHex(builtinColor) },
    module: { fg: RGBA.fromHex(functionColor) },
    namespace: { fg: RGBA.fromHex(functionColor) },
    label: { fg: RGBA.fromHex(typeColor) },
    embedded: { fg: RGBA.fromHex(theme.text) },
    escape: { fg: RGBA.fromHex(builtinColor), bold: true },
    operator: { fg: RGBA.fromHex(theme.muted) },
    'keyword.conditional': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.directive': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.function': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.import': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.modifier': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.operator': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.repeat': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.return': { fg: RGBA.fromHex(keywordColor), bold: true },
    'keyword.type': { fg: RGBA.fromHex(keywordColor), bold: true },
    punctuation: { fg: RGBA.fromHex(theme.muted) },
    'punctuation.bracket': { fg: RGBA.fromHex(theme.muted) },
    'punctuation.delimiter': { fg: RGBA.fromHex(theme.muted) },
    'punctuation.special': { fg: RGBA.fromHex(builtinColor) },
    'extmark.paste': { fg: RGBA.fromHex(theme.bg), bg: RGBA.fromHex(theme.amber), bold: true },
    default: { fg: RGBA.fromHex(theme.text) },
  })
}

function buildComposerSyntaxStyle(theme: TuiThemePalette): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    'extmark.paste': { fg: RGBA.fromHex(theme.bg), bg: RGBA.fromHex(theme.amber), bold: true },
    default: { fg: RGBA.fromHex(theme.text) },
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

function diffRowColor(row: TuiPierreDiffRow, theme: TuiThemePalette): string {
  switch (row.tone) {
    case 'addition':
      return theme.green
    case 'deletion':
      return theme.red
    case 'file':
    case 'hunk':
      return theme.cyan
    case 'tree':
    case 'meta':
      return theme.dim
    default:
      return theme.text
  }
}

function diffRowBackground(row: TuiPierreDiffRow, theme: TuiThemePalette): string | undefined {
  switch (row.tone) {
    case 'addition':
      return theme.diffAddBg
    case 'deletion':
      return theme.diffRemoveBg
    case 'file':
    case 'hunk':
      return theme.diffMetaBg
    default:
      return undefined
  }
}

function diffRowIndicator(row: TuiPierreDiffRow): string {
  switch (row.tone) {
    case 'addition':
      return '+'
    case 'deletion':
      return '-'
    case 'file':
      return '>'
    case 'hunk':
      return '@'
    case 'tree':
      return '|'
    default:
      return ' '
  }
}

function splitDiffSideColor(side: TuiSplitRowSide, theme: TuiThemePalette): string {
  if (side.kind === 'deletion') return theme.red
  if (side.kind === 'addition') return theme.green
  return theme.text
}

function splitDiffSideBackground(side: TuiSplitRowSide, theme: TuiThemePalette): string | undefined {
  if (side.kind === 'deletion') return theme.diffRemoveBg
  if (side.kind === 'addition') return theme.diffAddBg
  if (side.kind === 'empty') return theme.surface2
  return undefined
}

function splitDiffSideIndicator(side: TuiSplitRowSide): string {
  if (side.kind === 'deletion') return '-'
  if (side.kind === 'addition') return '+'
  return ' '
}

type SplitDiffSideProps = {
  side?: TuiSplitRowSide
  width: number
  gutterWidth: number
  showLineNumbers: boolean
  theme: TuiThemePalette
  selectionColors: SelectionColors
}

function SplitDiffSide({
  side,
  width,
  gutterWidth,
  showLineNumbers,
  theme,
  selectionColors,
}: SplitDiffSideProps) {
  const resolved = side ?? { kind: 'empty' as const, text: '' }
  const sideColor = splitDiffSideColor(resolved, theme)
  const textWidth = Math.max(width - gutterWidth - 1, 4)
  return (
    <box width={width} flexDirection="row" backgroundColor={splitDiffSideBackground(resolved, theme)}>
      {showLineNumbers ? (
        <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
          {formatDiffLineNumber(resolved.lineNum, gutterWidth)}{' '}
        </text>
      ) : null}
      <text fg={sideColor} wrapMode="none" selectable {...selectionColors}>
        {fitText(` ${splitDiffSideIndicator(resolved)} ${resolved.text}`, textWidth)}
      </text>
    </box>
  )
}

function formatDiffLineNumber(lineNumber: number | undefined, width: number): string {
  return lineNumber == null ? ''.padStart(width, ' ') : lineNumber.toString().padStart(width, ' ')
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
    // Keep diff_meta (file path header) but strip raw diff lines — Pierre renders those
    base = source.filter((line) => line.tone !== 'diff_add' && line.tone !== 'diff_remove')
  } else {
    base = source.slice(0, previewLimit)
  }
  return base.length > 0 ? base : [{ text: 'No visible content', tone: 'dim' }]
}

function cardDiffText(card: TuiTranscriptCard, isExpanded: boolean): string | null {
  if (card.category !== 'diff' && !isExpanded) return null
  return card.editDiff ?? extractDiffText(card.expandedLines)
}

function filePathFromDiffText(diffText: string | null, fallback: string): string {
  if (!diffText) return fallback
  const lines = diffText.split('\n')
  for (const line of lines) {
    if (line.startsWith('+++ b/')) return line.slice(6).trim()
    if (line.startsWith('--- a/')) return line.slice(6).trim()
  }
  const fileHeader = lines.find((line) => line.startsWith('diff --git '))
  if (fileHeader) {
    const match = fileHeader.match(/\sb\/(.+)$/)
    if (match?.[1]) return match[1].trim()
  }
  return fallback
}

function cardDiffView(card: TuiTranscriptCard, isExpanded: boolean): TuiPierreDiffView | null {
  const cached = PIERRE_DIFF_CACHE.get(card)
  if (cached && cached.isExpanded === isExpanded) return cached.value

  const diffText = cardDiffText(card, isExpanded)
  const value = diffText ? buildPierreDiffView(diffText, card.key) : null
  PIERRE_DIFF_CACHE.set(card, { isExpanded, value })
  return value
}

function cardDiffRows(card: TuiTranscriptCard, isExpanded: boolean, previewLimit: number): number {
  const diffView = cardDiffView(card, isExpanded)
  if (!diffView) return 0
  const visibleRows = isExpanded ? diffView.rows.length : Math.min(previewLimit, diffView.rows.length)
  const hiddenSummaryRows = visibleRows < diffView.rows.length ? 1 : 0
  return visibleRows + hiddenSummaryRows + 1
}

type TranscriptDiffNoteDraft = {
  anchor: string
  range: SelectedLineRange
  lineLabel: string
  text: string
}

type TranscriptDiffNote = {
  range: SelectedLineRange
  text: string
}

type TranscriptDiffSelectionPoint = {
  lineNumber: number
  side: SelectedLineRange['side']
}

type TranscriptDiffSelectionSpan = {
  startIndex: number
  endIndex: number
  selection: SelectedLineRange
  key: string
  label: string
}

function transcriptDiffStackRowAnchor(namespace: string, row: TuiPierreDiffRow): string | null {
  if (row.newLine !== undefined) return `${namespace}:new:${row.newLine}`
  if (row.oldLine !== undefined) return `${namespace}:old:${row.oldLine}`
  return null
}

function transcriptDiffSplitRowAnchor(namespace: string, row: TuiPierreSplitRow): string | null {
  if (row.right?.lineNum !== undefined) return `${namespace}:new:${row.right.lineNum}`
  if (row.left?.lineNum !== undefined) return `${namespace}:old:${row.left.lineNum}`
  return null
}

function transcriptDiffSelectionPointForStackRow(row: TuiPierreDiffRow): TranscriptDiffSelectionPoint | null {
  if (row.newLine !== undefined) return { lineNumber: row.newLine, side: 'additions' }
  if (row.oldLine !== undefined) return { lineNumber: row.oldLine, side: 'deletions' }
  return null
}

function transcriptDiffSelectionPointForSplitRow(row: TuiPierreSplitRow): TranscriptDiffSelectionPoint | null {
  if (row.right?.lineNum !== undefined) return { lineNumber: row.right.lineNum, side: 'additions' }
  if (row.left?.lineNum !== undefined) return { lineNumber: row.left.lineNum, side: 'deletions' }
  return null
}

function transcriptDiffSelectionKey(namespace: string, selection: SelectedLineRange): string {
  return [namespace, selection.start, selection.side ?? '', selection.end, selection.endSide ?? ''].join('\u0000')
}

function transcriptDiffSelectionLineLabel(selection: SelectedLineRange): string {
  const start = `L${selection.start}${selection.side === 'deletions' ? ' (old)' : ''}`
  const end = `L${selection.end}${selection.endSide === 'deletions' ? ' (old)' : ''}`
  return selection.start === selection.end && selection.side === selection.endSide ? start : `${start} → ${end}`
}

function transcriptDiffSelectionPointForRow(row: TuiPierreDiffRow | TuiPierreSplitRow): TranscriptDiffSelectionPoint | null {
  const splitRow = row as TuiPierreSplitRow
  if (splitRow.left !== undefined || splitRow.right !== undefined) {
    return transcriptDiffSelectionPointForSplitRow(splitRow)
  }
  return transcriptDiffSelectionPointForStackRow(row as TuiPierreDiffRow)
}

function transcriptDiffSelectionSpanFromRowRange(
  namespace: string,
  rows: Array<TuiPierreDiffRow | TuiPierreSplitRow>,
  startIndex: number,
  endIndex: number,
): TranscriptDiffSelectionSpan | null {
  if (rows.length === 0) return null
  const lo = Math.max(0, Math.min(startIndex, endIndex))
  const hi = Math.min(rows.length - 1, Math.max(startIndex, endIndex))
  let startPoint: TranscriptDiffSelectionPoint | null = null
  for (let index = lo; index <= hi; index += 1) {
    startPoint = transcriptDiffSelectionPointForRow(rows[index] as TuiPierreDiffRow | TuiPierreSplitRow)
    if (startPoint) break
  }
  let endPoint: TranscriptDiffSelectionPoint | null = null
  for (let index = hi; index >= lo; index -= 1) {
    endPoint = transcriptDiffSelectionPointForRow(rows[index] as TuiPierreDiffRow | TuiPierreSplitRow)
    if (endPoint) break
  }
  if (!startPoint || !endPoint) return null
  const selection: SelectedLineRange = {
    start: startPoint.lineNumber,
    side: startPoint.side,
    end: endPoint.lineNumber,
    endSide: endPoint.side,
  }
  return {
    startIndex: lo,
    endIndex: hi,
    selection,
    key: transcriptDiffSelectionKey(namespace, selection),
    label: transcriptDiffSelectionLineLabel(selection),
  }
}

function transcriptDiffSelectionSpanFromSelection(
  namespace: string,
  rows: Array<TuiPierreDiffRow | TuiPierreSplitRow>,
  selection: SelectedLineRange,
): TranscriptDiffSelectionSpan | null {
  if (rows.length === 0) return null
  let startIndex = -1
  let endIndex = -1
  for (let index = 0; index < rows.length; index += 1) {
    const point = transcriptDiffSelectionPointForRow(rows[index] as TuiPierreDiffRow | TuiPierreSplitRow)
    if (!point) continue
    if (startIndex === -1 && point.lineNumber === selection.start && point.side === selection.side) {
      startIndex = index
    }
    if (point.lineNumber === selection.end && point.side === selection.endSide) {
      endIndex = index
    }
  }
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return null
  return {
    startIndex,
    endIndex,
    selection,
    key: transcriptDiffSelectionKey(namespace, selection),
    label: transcriptDiffSelectionLineLabel(selection),
  }
}

function nextTranscriptDiffRowIndex(
  rows: Array<TuiPierreDiffRow | TuiPierreSplitRow>,
  currentIndex: number,
  direction: 1 | -1,
  showHunkHeaders: boolean,
): number | null {
  if (rows.length === 0) return null
  const hunkIndexes = rows
    .map((row, index) => row.tone === 'hunk' ? index : -1)
    .filter((index) => index >= 0)
  if (hunkIndexes.length === 0) return null

  const next = direction > 0
    ? hunkIndexes.find((index) => index > currentIndex) ?? hunkIndexes[0]
    : [...hunkIndexes].reverse().find((index) => index < currentIndex) ?? hunkIndexes[hunkIndexes.length - 1]
  if (showHunkHeaders) return next

  for (let index = next + 1; index < rows.length; index += 1) {
    if (rows[index]?.tone !== 'hunk') return index
  }
  return next
}

function renderTranscriptDiffNoteDraft(draft: TranscriptDiffNoteDraft, width: number, theme: TuiThemePalette) {
  const displayText = draft.text || 'Write a note…'
  return (
    <box width={width} flexDirection="column" border borderStyle="single" borderColor={theme.cyan} paddingX={1}>
      <box>
        <text fg={theme.cyan} wrapMode="none">
          {fitText(`Draft note — ${draft.lineLabel}`, Math.max(width - 4, 8))}
        </text>
      </box>
      <box height={2}>
        <text fg={draft.text ? theme.text : theme.dim} wrapMode="none">
          {`${displayText}${draft.text ? '▋' : ''}`}
        </text>
      </box>
      <box flexDirection="row" paddingY={0}>
        <box flexGrow={1} />
        <text fg={theme.green} wrapMode="none">Save (^S)</text>
        <text fg={theme.dim} wrapMode="none">{'  '}</text>
        <text fg={theme.muted} wrapMode="none">Cancel (Esc)</text>
      </box>
    </box>
  )
}

function renderTranscriptDiffNoteCard(
  note: TranscriptDiffNote,
  width: number,
  theme: TuiThemePalette,
  label: string,
  onSendToComposer?: () => void,
) {
  return (
    <box width={width} flexDirection="column" border borderStyle="single" borderColor={theme.violet} paddingX={1}>
      <box flexDirection="row">
        <text fg={theme.violet} wrapMode="none">
          {fitText(`Note — ${label}`, Math.max(width - 6, 8))}
        </text>
        <box flexGrow={1} />
        {onSendToComposer ? (
          <text fg={theme.green} wrapMode="none"> C:composer</text>
        ) : null}
        <text fg={theme.dim} wrapMode="none"> x:del</text>
      </box>
      <box>
        <text fg={theme.text} wrapMode="none">{note.text}</text>
      </box>
      {onSendToComposer ? (
        <box flexDirection="row">
          <box flexGrow={1} />
          <text fg={theme.green} wrapMode="none" onMouseUp={(event) => {
            event.stopPropagation()
            onSendToComposer()
          }}>Send to composer</text>
        </box>
      ) : null}
    </box>
  )
}

function codeBlockRows(card: TuiTranscriptCard, isExpanded: boolean): number {
  if (!isExpanded || !card.codeBlocks?.length) return 0
  return card.codeBlocks.reduce((sum, cb) => {
    const lineCount = countCodeBlockLines(cb.content)
    const renderHeight = codeBlockHeight(cb, lineCount)
    const footerRows = codeBlockHiddenLineCount(lineCount, renderHeight) > 0 ? 1 : 0
    return sum + 1 + renderHeight + footerRows + 1
  }, 0)
}

function countCodeBlockLines(content: string): number {
  if (!content) return 0
  let count = 1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) count++
  }
  return count
}

function codeBlockHeight(block: TuiTranscriptCodeBlock, lineCount: number): number {
  if (block.maxVisibleLines != null) return Math.min(lineCount, block.maxVisibleLines)
  if (block.lineNumbers) return Math.min(lineCount, MAX_CODE_BLOCK_RENDER_LINES)
  return Math.min(lineCount + 1, 20)
}

function codeBlockHiddenLineCount(lineCount: number, renderHeight: number): number {
  return Math.max(lineCount - Math.min(lineCount, renderHeight), 0)
}

function sliceCodeBlockLines(content: string, maxLines: number): string {
  if (maxLines <= 0 || !content) return ''
  let lines = 1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) !== 10) continue
    if (lines >= maxLines) return content.slice(0, i)
    lines++
  }
  return content
}

function canRenderMarkdownWithSyntax(content: string): boolean {
  return content.length <= MAX_MARKDOWN_SYNTAX_CHARS
}

function codeBlockLabel(block: TuiTranscriptCodeBlock): string {
  if (block.filePath) return `${block.lang} · ${block.filePath}`
  return block.lang
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
  const useMarkdown = isExpanded && !!card.markdownContent && !card.hasMermaidDiagrams
  const landmarkRows = transcriptLandmarks(cards, index, resumeMarkerIndex, unreadBoundaryIndex, pendingNewCount).length
  const bodyRows = useMarkdown ? 0 : renderedBodyLines(card, isExpanded, previewLimit, thinkingFull).length
  const diffRows = cardDiffRows(card, isExpanded, previewLimit)
  const codeRows = useMarkdown ? 0 : codeBlockRows(card, isExpanded)
  const mdRows = useMarkdown ? card.markdownContent!.split('\n').length : 0
  const diffFooterRows = card.category === 'diff' && cardDiffView(card, isExpanded) ? 1 : 0
  const borderRows = 2
  const bodyPaddingBottom = 1
  return landmarkRows + borderRows + bodyPaddingBottom + bodyRows + diffRows + diffFooterRows + codeRows + mdRows + cardGap
}

function cycleDensityValue(current: TuiDensity): TuiDensity {
  return current === 'comfortable'
    ? 'balanced'
    : current === 'balanced'
    ? 'dense'
    : 'comfortable'
}

function cycleTranscriptViewValue(current: TuiTranscriptView): TuiTranscriptView {
  return current === 'conversation' ? 'full' : current === 'full' ? 'continue' : current === 'continue' ? 'stream' : 'conversation'
}

const PROVIDER_SELECT_OPTIONS: SelectOption[] = PROVIDERS.map((provider) => ({
  name: provider.toUpperCase(),
  description: provider === 'all' ? 'All providers' : `${provider} sessions`,
  value: provider,
}))

type TuiEffort = 'auto' | ReasoningEffortLevel
type ModelPickerOption = SelectOption & Pick<SessionModelInfo, 'supportsEffort' | 'supportedEffortLevels'>

const EFFORT_DESCRIPTIONS: Record<TuiEffort, string> = {
  auto: 'Use the model or session default',
  off: 'Disable extended reasoning',
  minimal: 'Fastest reasoning pass',
  low: 'Light reasoning',
  medium: 'Balanced reasoning',
  high: 'Deep reasoning',
  xhigh: 'Extra-high reasoning',
  max: 'Maximum reasoning budget',
}

function effortLevelsForModel(
  provider: ProviderSelection | undefined,
  model: ModelPickerOption | undefined,
): ReasoningEffortLevel[] {
  if (!provider || provider === 'all' || provider === 'opencode' || model?.supportsEffort === false) return []
  const allowed: ReasoningEffortLevel[] = provider === 'codex'
    ? ['low', 'medium', 'high']
    : provider === 'copilot'
      ? ['low', 'medium', 'high', 'xhigh']
      : provider === 'pi'
        ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
        : ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const reported = model?.supportedEffortLevels
  if (!reported || reported.length === 0) return allowed
  return allowed.filter((level) => reported.includes(level))
}

function effortPickerOptions(
  provider: ProviderSelection | undefined,
  model: ModelPickerOption | undefined,
): Array<SelectOption & { value: TuiEffort }> {
  return [
    { name: 'AUTO', value: 'auto', description: EFFORT_DESCRIPTIONS.auto },
    ...effortLevelsForModel(provider, model).map((level) => ({
      name: level === 'xhigh' ? 'XHIGH' : level.toUpperCase(),
      value: level,
      description: EFFORT_DESCRIPTIONS[level],
    })),
  ]
}

const CLAUDE_PERMISSION_MODE_ORDER = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const
type TuiPermissionMode = typeof CLAUDE_PERMISSION_MODE_ORDER[number]

// Permission mode status row — matches Claude Code's shift+tab indicator style.
const PERMISSION_MODE_GLYPH: Partial<Record<string, string>> = {
  plan: '“',           // " left double quotation mark (read-only/pause)
  acceptEdits: '▶▶',    // ▶▶ (auto-accept edits)
  bypassPermissions: '▶▶', // ▶▶ (bypass all)
}
const PERMISSION_MODE_LABEL: Partial<Record<string, string>> = {
  plan: 'plan mode',
  acceptEdits: 'accept edits',
  bypassPermissions: 'bypass permissions',
}

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
  'flexoki-light': 'Flexoki warm paper',
  'nord-light': 'Nord frosted light',
  'vitesse-light': 'Vitesse low-contrast light',
  'iceberg-light': 'Iceberg cool cream',
  'material-lighter': 'Material Theme lighter',
  'min-light': 'Atom Min minimalist',
  white: 'Pure white monochrome',
  stripe: 'Stripe indigo finance',
  'claude-cream': 'Claude warm terracotta',
  supabase: 'Supabase brand green',
  posthog: 'PostHog hedgehog gold',
  replicate: 'Replicate bone + crimson',
  notion: 'Notion clean purple',
  figma: 'Figma color blocks',
  miro: 'Miro sunshine yellow',
  apple: 'Apple gallery white',
  nike: 'Nike sport contrast',
  pinterest: 'Pinterest brand red',
  playstation: 'PlayStation console blue',
  nvidia: 'NVIDIA brand green',
  mongodb: 'MongoDB leaf green',
  slack: 'Slack aubergine',
  cohere: 'Cohere coral warmth',
  mistral: 'Mistral sunshine orange',
  cursor: 'Cursor warm canvas',
  airbnb: 'Airbnb coral',
  intercom: 'Intercom warm cream',
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
  'flexoki-dark': 'Flexoki warm ink',
  cobalt: 'Cobalt blue console',
  'vitesse-dark': 'Vitesse low-contrast dark',
  iceberg: 'Iceberg cool blue-grey',
  zenburn: 'Zenburn earthy classic',
  'material-darker': 'Material Theme darker',
  ethereal: 'Ethereal indigo dusk',
  hackerman: 'Hackerman neon green',
  lumon: 'Lumon Severance blue',
  'matte-black': 'Matte black with amber',
  miasma: 'Miasma olive haze',
  'osaka-jade': 'Osaka jade temple',
  'retro-82': 'Retro 82 neon arcade',
  ristretto: 'Ristretto warm coffee',
  vantablack: 'Vantablack pure dark',
  linear: 'Linear lavender dusk',
  sentry: 'Sentry deep violet',
  raycast: 'Raycast near-black',
  framer: 'Framer gradient blue',
  ferrari: 'Ferrari racing red',
  resend: 'Resend neon glow',
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
  'flexoki-light': 'FLEXOKI LIGHT',
  'nord-light': 'NORD LIGHT',
  'vitesse-light': 'VITESSE LIGHT',
  'iceberg-light': 'ICEBERG LIGHT',
  'material-lighter': 'MATERIAL LIGHTER',
  'min-light': 'MIN LIGHT',
  white: 'WHITE',
  stripe: 'STRIPE',
  'claude-cream': 'CLAUDE CREAM',
  supabase: 'SUPABASE',
  posthog: 'POSTHOG',
  replicate: 'REPLICATE',
  notion: 'NOTION',
  figma: 'FIGMA',
  miro: 'MIRO',
  apple: 'APPLE',
  nike: 'NIKE',
  pinterest: 'PINTEREST',
  playstation: 'PLAYSTATION',
  nvidia: 'NVIDIA',
  mongodb: 'MONGODB',
  slack: 'SLACK',
  cohere: 'COHERE',
  mistral: 'MISTRAL',
  cursor: 'CURSOR',
  airbnb: 'AIRBNB',
  intercom: 'INTERCOM',
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
  'flexoki-dark': 'FLEXOKI DARK',
  cobalt: 'COBALT',
  'vitesse-dark': 'VITESSE DARK',
  iceberg: 'ICEBERG',
  zenburn: 'ZENBURN',
  'material-darker': 'MATERIAL DARKER',
  ethereal: 'ETHEREAL',
  hackerman: 'HACKERMAN',
  lumon: 'LUMON',
  'matte-black': 'MATTE BLACK',
  miasma: 'MIASMA',
  'osaka-jade': 'OSAKA JADE',
  'retro-82': 'RETRO 82',
  ristretto: 'RISTRETTO',
  vantablack: 'VANTABLACK',
  linear: 'LINEAR',
  sentry: 'SENTRY',
  raycast: 'RAYCAST',
  framer: 'FRAMER',
  ferrari: 'FERRARI',
  resend: 'RESEND',
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
  { id: 'reply',      label: 'Reply to selected message', key: '⇧Q', category: 'Transcript' },
  { id: 'bookmark-toggle', label: 'Bookmark message',  key: 'b',  category: 'Transcript' },
  { id: 'bookmark-jump',   label: 'Jump to next bookmark', key: '[ ]', category: 'Transcript' },
  { id: 'bookmark-all',    label: 'Browse all bookmarks', key: '⇧B', category: 'Transcript' },
  { id: 'tasks',      label: 'Open task panel',         key: '⇧T', category: 'Transcript' },
  { id: 'tasks-full', label: 'Task lineage popover',   key: '⇧L', category: 'Transcript' },
  // Session
  { id: 'composer',   label: 'Open composer',          key: 'c',  category: 'Session'    },
  { id: 'composer-window', label: 'Open composer window', key: '^O', category: 'Session'    },
  { id: 'composer-stash', label: 'Stash composer prompt', key: 'stash', category: 'Session' },
  { id: 'composer-stash-pop', label: 'Pop composer stash', key: 'pop', category: 'Session' },
  { id: 'composer-stash-list', label: 'List composer stash', key: 'list', category: 'Session' },
  { id: 'new',        label: 'New agent session',      key: 'N',  category: 'Session'    },
  { id: 'reuse',      label: 'Reuse last prompt',      key: 'R',  category: 'Session'    },
  { id: 'rename',     label: 'Rename session',         key: '^R', category: 'Session'    },
  { id: 'cli',        label: 'Copy CLI resume command', key: 'C',  category: 'Session'    },
  { id: 'git',        label: 'Git status',             key: '^G', category: 'Session'    },
  { id: 'analytics',  label: 'Session analytics',      key: '^A', category: 'Session'    },
  { id: 'handoff-brief', label: 'Handoff brief',       key: 'H',  category: 'Session'    },
  { id: 'prompt-library', label: 'Prompt library',     key: '⇧P', category: 'Session'    },
  { id: 'diagnostics', label: 'Session diagnostics',   key: 'D',  category: 'Session'    },
  { id: 'provider',   label: 'Switch provider',        key: 'p',  category: 'Session'    },
  { id: 'sort',       label: 'Toggle sidebar sort',    key: 'S',  category: 'Session'    },
  // Tabs
  { id: 'tab-toggle', label: 'Toggle tab bar',         key: 'b',  category: 'Tabs'       },
  { id: 'tab-prev',   label: 'Previous tab',           key: '←',  category: 'Tabs'       },
  { id: 'tab-next',   label: 'Next tab',               key: '→',  category: 'Tabs'       },
  { id: 'tab-close',  label: 'Close current tab',      key: 'w',  category: 'Tabs'       },
  // View
  { id: 'theme',      label: 'Switch theme',           key: 't',  category: 'View'       },
  { id: 'thinking',   label: 'Toggle thinking mode',   key: 'i',  category: 'View'       },
  { id: 'density',    label: 'Toggle density',         key: 'd',  category: 'View'       },
  { id: 'diff-layout', label: 'Toggle diff layout',    key: 's',  category: 'View'       },
  { id: 'view',       label: 'Toggle transcript view', key: 'v',  category: 'View'       },
  { id: 'rail',       label: 'Toggle session rail',    key: 'h',  category: 'View'       },
  { id: 'focus',      label: 'Toggle focus mode',      key: 'z',  category: 'View'       },
  { id: 'tools',      label: 'Toggle tool calls',      key: 'X',  category: 'View'       },
  { id: 'velocity-scroll', label: 'Toggle velocity scroll', key: '⇧V', category: 'View'  },
  { id: 'mode',       label: 'Cycle provider mode',    key: 'M',  category: 'Session'    },
  { id: 'model',      label: 'Pick model and effort',  key: '⌥M', category: 'Session'    },
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

function currentProjectName(session: Session | null): string {
  return session ? formatSessionProject(session) : 'no-project'
}

function touchMapEntry<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.has(key)) map.delete(key)
  map.set(key, value)
}

function pruneSessionCaches(
  detailCache: Map<string, TuiSessionDetail>,
  usageCache: Map<string, ContextUsage | null>,
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
  isSearchHit: boolean
  isActiveMatch: boolean
  bookmarked: boolean
  onSelectCard: (cardKey: string) => void
  thinkingMode: boolean
  diffLayout: TuiDiffLayout
  imessageStyle: boolean
  streamMode: boolean
  noteNamespace: string
  diffNotes: Map<string, TranscriptDiffNote>
  diffDraft: TranscriptDiffNoteDraft | null
  hoveredDiffAnchor: string | null
  activateDiffHover: (anchor: string) => void
  openDiffNote: (selection: SelectedLineRange) => void
  sendDiffNoteToComposer: (card: TuiTranscriptCard, note: TranscriptDiffNote, label: string, diffText: string | null) => void
  diffPlain: boolean
  diffShowLineNumbers: boolean
  diffShowHunkHeaders: boolean
  diffRowCursor: number
  diffSelectionAnchor: number | null
  setDiffRowCursor: (cardKey: string, rowIndex: number, preserveSelection?: boolean) => void
  setDiffSelectionAnchor: (cardKey: string, rowIndex: number) => void
}

type SelectableMarkdownProps = {
  content: string
  syntaxStyle: SyntaxStyle
  fg: string
  width: number
  selectionColors: SelectionColors
  borderColor: string
}

function SelectableMarkdown({
  content,
  syntaxStyle,
  fg,
  width,
  selectionColors,
  borderColor,
}: SelectableMarkdownProps) {
  const markdownRef = useRef<MarkdownRenderable | null>(null)

  useLayoutEffect(() => {
    applySelectionColorsToTree(markdownRef.current, selectionColors)
  }, [content, syntaxStyle, selectionColors.selectionBg, selectionColors.selectionFg])

  return (
    <markdown
      ref={markdownRef}
      content={content}
      syntaxStyle={syntaxStyle}
      fg={fg}
      streaming={false}
      width={width}
      tableOptions={{ widthMode: 'content', borders: true, borderColor, selectable: true }}
    />
  )
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
  isSearchHit,
  isActiveMatch,
  bookmarked,
  onSelectCard,
  thinkingMode,
  diffLayout,
  imessageStyle,
  streamMode,
  noteNamespace,
  diffNotes,
  diffDraft,
  hoveredDiffAnchor,
  activateDiffHover,
  openDiffNote,
  sendDiffNoteToComposer,
  diffPlain,
  diffShowLineNumbers,
  diffShowHunkHeaders,
  diffRowCursor,
  diffSelectionAnchor,
  setDiffRowCursor,
  setDiffSelectionAnchor,
}: TranscriptCardProps) {
  const {
    landmarks,
    bodyLines,
    diffView,
    codeBlockLineCounts,
    headerMeta,
    accent,
    isThinkingCard,
    categoryEmoji,
    isInsight,
    markdownFallbackLines,
  } = display

  const diffTextForComposer = card.category === 'diff' ? cardDiffText(card, isExpanded) : null
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
          : bookmarked
            ? theme.amber
            : isSelected
              ? theme.border2
              : card.role === 'user'
                ? accent
                : theme.border
  const maxTitleWidth = Math.max(rightPaneWidth - 6, 20)
  const titleMeta = joinMeta([
    headerMeta,
    card.category === 'diff' ? `s ${diffLayout}` : null,
    isSearchHit ? 'match' : null,
    isSelected ? card.usageSummary ?? null : null,
    hasCursor ? 'y copy  b bookmark  Q reply' : null,
  ])
  const bookmarkGlyph = bookmarked ? '★ ' : ''
  const cardTitleFull = `${marker} ${bookmarkGlyph}${categoryEmoji}${card.label}${titleMeta ? `  ${titleMeta}` : ''}`
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
  const effectiveDiffLayout = diffLayout === 'split' && (diffView?.splitRows.length ?? 0) > 0
    ? 'split'
    : 'stack'
  const rawDiffLines = diffPlain
    ? ((card.editDiff ?? extractDiffText(card.expandedLines) ?? '').split('\n').filter((line) => line.length > 0))
    : []
  const activeDiffRows = !diffPlain && diffView
    ? effectiveDiffLayout === 'split' ? diffView.splitRows : diffView.rows
    : []
  const renderedDiffRows = activeDiffRows.filter((row) => diffShowHunkHeaders || row.tone !== 'hunk')
  const diffRows = renderedDiffRows.slice(0, isExpanded ? renderedDiffRows.length : densityState.bodyLines)
  const hiddenDiffRows = renderedDiffRows.length - diffRows.length
  const stackedDiffRows = !diffPlain && effectiveDiffLayout === 'stack' ? diffRows as TuiPierreDiffRow[] : []
  const splitDiffRows = !diffPlain && effectiveDiffLayout === 'split' ? diffRows as TuiPierreSplitRow[] : []
  const diffLineNumbers = diffShowLineNumbers
    ? stackedDiffRows.flatMap((row) => [row.oldLine, row.newLine].filter((value): value is number => value != null))
    : []
  const diffGutterWidth = Math.max(
    diffLineNumbers.length > 0 ? Math.max(...diffLineNumbers).toString().length : 1,
    1,
  )
  const diffBadgeWidth = 3
  const diffTextWidth = Math.max(bodyInnerWidth - (diffShowLineNumbers ? (diffGutterWidth * 2 + 2) : 0) - 5 - diffBadgeWidth, 12)
  const splitLineNumbers = diffShowLineNumbers
    ? splitDiffRows.flatMap((row) => [
        row.left?.lineNum,
        row.right?.lineNum,
      ].filter((value): value is number => value != null))
    : []
  const splitGutterWidth = diffShowLineNumbers
    ? Math.max(
        splitLineNumbers.length > 0 ? Math.max(...splitLineNumbers).toString().length : 1,
        1,
      )
    : 0
  const splitDividerWidth = 1
  const splitBadgeWidth = 1
  const splitContentWidth = Math.max(bodyInnerWidth - splitBadgeWidth, 2)
  const splitLeftWidth = Math.floor((splitContentWidth - splitDividerWidth) / 2)
  const splitRightWidth = splitContentWidth - splitDividerWidth - splitLeftWidth
  const diffSelectionRows = !diffPlain && diffView
    ? effectiveDiffLayout === 'split' ? diffView.splitRows : diffView.rows
    : []
  const diffSelectionCurrentIndex = diffSelectionRows.length > 0
    ? clamp(diffRowCursor, 0, diffSelectionRows.length - 1)
    : 0
  const selectionAnchorIndex = diffSelectionAnchor != null
    ? clamp(diffSelectionAnchor, 0, Math.max(diffSelectionRows.length - 1, 0))
    : null
  const diffSelectionSpan = diffSelectionRows.length > 0
    ? (
        selectionAnchorIndex != null
          ? transcriptDiffSelectionSpanFromRowRange(
              noteNamespace,
              diffSelectionRows,
              selectionAnchorIndex,
              diffSelectionCurrentIndex,
            )
          : transcriptDiffSelectionSpanFromRowRange(
              noteNamespace,
              diffSelectionRows,
              diffSelectionCurrentIndex,
              diffSelectionCurrentIndex,
            )
      )
    : null
  const diffSelectionKey = diffSelectionSpan?.key ?? null
  const diffSelectionCurrentSelection = diffSelectionSpan?.selection ?? null
  const diffSelectionStartIndex = diffSelectionSpan?.startIndex ?? diffSelectionCurrentIndex
  const diffSelectionEndIndex = diffSelectionSpan?.endIndex ?? diffSelectionCurrentIndex
  const diffSelectionNotesByEndIndex = useMemo(() => {
    const notesByEndIndex = new Map<number, Array<{ key: string; note: TranscriptDiffNote; label: string; span: TranscriptDiffSelectionSpan }>>()
    if (diffPlain || !diffView) return notesByEndIndex
    const rows = effectiveDiffLayout === 'split' ? diffView.splitRows : diffView.rows
    for (const [key, note] of diffNotes) {
      const span = transcriptDiffSelectionSpanFromSelection(noteNamespace, rows, note.range)
      if (!span) continue
      const list = notesByEndIndex.get(span.endIndex) ?? []
      list.push({ key, note, label: span.label, span })
      notesByEndIndex.set(span.endIndex, list)
    }
    return notesByEndIndex
  }, [diffNotes, diffPlain, diffView, effectiveDiffLayout, noteNamespace])
  const diffDraftSpan = useMemo(() => {
    if (diffPlain || !diffView || !diffDraft) return null
    const rows = effectiveDiffLayout === 'split' ? diffView.splitRows : diffView.rows
    return transcriptDiffSelectionSpanFromSelection(noteNamespace, rows, diffDraft.range)
  }, [diffDraft, diffPlain, diffView, effectiveDiffLayout, noteNamespace])
  const shouldRenderSyntaxMarkdown = Boolean(
    isExpanded
    && card.markdownContent
    && !card.hasMermaidDiagrams
    && syntaxStyle
    && canRenderMarkdownWithSyntax(card.markdownContent),
  )
  const diffFooterSegments = card.category === 'diff'
    ? [
        { text: `v ${diffPlain ? 'parsed' : 'plain'}  `, fg: theme.cyan },
        { text: '● syntax  ', fg: theme.cyan },
        { text: `s ${diffLayout}  `, fg: theme.cyan },
        { text: `n ${diffShowLineNumbers ? '#' : 'no#'}  `, fg: theme.cyan },
        { text: `m ${diffShowHunkHeaders ? '@@' : 'no@@'}  `, fg: theme.cyan },
        { text: '{} hunk  ', fg: theme.cyan },
        { text: 'shift+j/k range  ', fg: theme.cyan },
        { text: 'a:note  ', fg: theme.cyan },
        { text: 'C:composer  ', fg: theme.cyan },
        { text: 'x:del', fg: theme.cyan },
      ]
    : null
  const beginDiffMouseSelection = (event: MouseEvent, rowIndex: number) => {
    if (event.button !== 0) return
    event.stopPropagation()
    if (event.modifiers.shift) {
      setDiffSelectionAnchor(card.key, diffSelectionAnchor ?? diffSelectionCurrentIndex)
    } else {
      setDiffSelectionAnchor(card.key, rowIndex)
    }
    setDiffRowCursor(card.key, rowIndex, true)
  }
  const updateDiffMouseSelection = (event: MouseEvent, rowIndex: number) => {
    if (event.button !== 0 || (!event.isDragging && event.type !== 'drag')) return
    event.stopPropagation()
    setDiffRowCursor(card.key, rowIndex, true)
  }
  const landmarkWidth = rightPaneWidth - 4
  const selectionColors = terminalSelectionColors(theme)

  if (streamMode) {
    const streamWidth = Math.max(rightPaneWidth - 2, 16)
    const streamTextWidth = Math.max(rightPaneWidth - 4, 12)
    const roleLine = fitText(
      `${marker} ${card.label}${card.timestamp ? `  ${card.timestamp}` : ''}`,
      streamWidth,
    )
    const streamBg = hasCursor ? theme.surface3 : isSelected ? theme.surface2 : undefined
    return (
      <box id={`card:${card.key}`} flexDirection="column" marginBottom={1} backgroundColor={streamBg}>
        {landmarks.map((landmark, landmarkIndex) => {
          const lmColor = landmark.kind === 'resume'
            ? theme.cyan
            : landmark.kind === 'unread'
              ? theme.amber
              : landmark.kind === 'day'
                ? theme.violet
                : theme.dim
          return (
            <text key={`${card.key}:lm:${landmarkIndex}`} fg={lmColor} selectable {...selectionColors}>
              {fitText(landmark.text, streamWidth)}
            </text>
          )
        })}
        <text fg={hasCursor ? accent : isSearchHit ? theme.cyan : theme.dim} selectable {...selectionColors}>
          {roleLine}
        </text>
        {bodyLines.map((line, lineIndex) => (
          <text
            key={`${card.key}:s:${lineIndex}`}
            fg={transcriptColor(line, theme)}
            wrapMode="none"
            selectable
            {...selectionColors}
          >
            {fitText(line.text, streamTextWidth)}
          </text>
        ))}
      </box>
    )
  }

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
            <text fg={color} selectable {...selectionColors}>{fitText(landmark.text, landmarkWidth)}</text>
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
        titleColor={accent}
        onMouseDown={(event) => {
          if (event.button !== 0) return
          onSelectCard(card.key)
        }}
      >
        <box flexDirection="column" paddingLeft={densityState.bodyIndent} paddingBottom={1}>
          {shouldRenderSyntaxMarkdown && card.markdownContent && syntaxStyle ? (
            <box paddingX={1}>
              <SelectableMarkdown
                content={card.markdownContent}
                syntaxStyle={syntaxStyle}
                fg={bubbleTextColor}
                width={markdownWidth}
                selectionColors={selectionColors}
                borderColor={theme.border}
              />
            </box>
          ) : markdownFallbackLines ? (
            <box paddingX={1}>
              {markdownFallbackLines.map((line, lineIndex) => (
                <text key={`${card.key}:markdown-fallback:${lineIndex}`} fg={bubbleTextColor} selectable {...selectionColors}>
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
                  <text fg={imessageUserBubble ? bubbleTextColor : transcriptColor(line, theme)} wrapMode="none" selectable {...selectionColors}>
                    {fitText(line.text, bodyInnerWidth)}
                  </text>
                </box>
              ))}

              {isExpanded && card.codeBlocks && card.codeBlocks.length > 0 ? (
                card.codeBlocks.map((cb, cbIndex) => {
                  const lineCount = codeBlockLineCounts[cbIndex] ?? countCodeBlockLines(cb.content)
                  const renderHeight = codeBlockHeight(cb, lineCount)
                  const visibleCode = sliceCodeBlockLines(cb.content, renderHeight)
                  const hiddenLineCount = codeBlockHiddenLineCount(lineCount, renderHeight)
                  const lineNumbers = cb.lineNumbers?.slice(0, renderHeight)
                  const gutterWidth = lineNumbers
                    ? Math.max(...lineNumbers.map((num) => num.length), 1) + 1
                    : 0
                  const codeWidth = Math.max(markdownWidth - gutterWidth - (lineNumbers ? 1 : 0), 12)
                  return (
                    <box key={cb.key} paddingX={1} marginTop={1}>
                      <text fg={theme.dim} selectable {...selectionColors}>{fitText(codeBlockLabel(cb), markdownWidth)}</text>
                      {syntaxStyle ? (
                        lineNumbers ? (
                          <box flexDirection="row">
                            <box width={gutterWidth} flexDirection="column">
                              {lineNumbers.map((num, lineIndex) => (
                                <text key={`${cb.key}:gutter:${lineIndex}`} fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
                                  {fitText(num, gutterWidth)}
                                </text>
                              ))}
                            </box>
                            <code
                              content={visibleCode}
                              filetype={cb.filetype}
                              syntaxStyle={syntaxStyle}
                              drawUnstyledText={true}
                              selectable
                              {...selectionColors}
                              style={{ height: renderHeight }}
                              width={codeWidth}
                            />
                          </box>
                        ) : (
                          <code
                            content={visibleCode}
                            filetype={cb.filetype}
                            syntaxStyle={syntaxStyle}
                            drawUnstyledText={true}
                            selectable
                            {...selectionColors}
                            style={{ height: renderHeight }}
                            width={markdownWidth}
                          />
                        )
                      ) : (
                        visibleCode.split('\n').map((line, lineIndex) => (
                          <box key={`${cb.key}:fallback:${lineIndex}`} flexDirection="row">
                            {lineNumbers ? (
                              <text fg={theme.dim} selectable {...selectionColors}>{fitText(lineNumbers[lineIndex] ?? '', gutterWidth)}</text>
                            ) : null}
                            <text fg={theme.text} selectable {...selectionColors}>
                              {fitText(line, lineNumbers ? codeWidth : markdownWidth)}
                            </text>
                          </box>
                        ))
                      )}
                      {hiddenLineCount > 0 ? (
                        <text fg={theme.dim} selectable {...selectionColors}>{fitText(`... ${hiddenLineCount} more lines`, markdownWidth)}</text>
                      ) : null}
                    </box>
                  )
                })
              ) : null}
            </>
          )}

          {card.category === 'diff' && diffPlain ? (
            <box paddingX={1} marginTop={1}>
              {rawDiffLines.map((line, index) => {
                const fg = line.startsWith('+') && !line.startsWith('+++')
                  ? theme.green
                  : line.startsWith('-') && !line.startsWith('---')
                    ? theme.red
                    : line.startsWith('@@')
                      ? theme.cyan
                      : line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')
                        ? theme.muted
                        : theme.text
                return (
                  <box key={`${card.key}:raw:${index}`}>
                    <text fg={fg} wrapMode="none" selectable {...selectionColors}>
                      {fitText(line, bodyInnerWidth)}
                    </text>
                  </box>
                )
              })}
              {diffFooterSegments ? (
                <box marginTop={1}>
                  <text fg={theme.cyan} selectable {...selectionColors}>
                    {renderInlineTextSegments(diffFooterSegments, bodyInnerWidth, theme.dim)}
                  </text>
                </box>
              ) : null}
            </box>
          ) : diffView && effectiveDiffLayout === 'stack' ? (
            <box paddingX={1} marginTop={1}>
              {stackedDiffRows.map((row, rowIndex) => (
                (() => {
                  const anchor = transcriptDiffStackRowAnchor(noteNamespace, row)
                  const point = transcriptDiffSelectionPointForStackRow(row)
                  const singleRowSelection = point
                    ? {
                        start: point.lineNumber,
                        side: point.side,
                        end: point.lineNumber,
                        endSide: point.side,
                      }
                    : null
                  const currentSelectionRange = diffSelectionCurrentSelection ?? singleRowSelection
                  const hasDraft = diffDraftSpan?.endIndex === rowIndex
                  const noteCards = (diffSelectionNotesByEndIndex.get(rowIndex) ?? []).filter(({ key }) => diffDraft?.anchor !== key)
                  const isHovered = anchor !== null && hoveredDiffAnchor === anchor
                  const isSelectedDiffRow = hasCursor && card.category === 'diff' && rowIndex >= diffSelectionStartIndex && rowIndex <= diffSelectionEndIndex
                  const rowBackground = isSelectedDiffRow ? theme.surface3 : diffRowBackground(row, theme)
                  const rowLabelSelection = currentSelectionRange ?? singleRowSelection
                  return (
                    <React.Fragment key={row.key}>
                      <box
                        width={bodyInnerWidth}
                        flexDirection="row"
                        backgroundColor={rowBackground}
                        onMouseDown={(event) => beginDiffMouseSelection(event, rowIndex)}
                        onMouseDrag={(event) => updateDiffMouseSelection(event, rowIndex)}
                        onMouseOver={(event) => {
                          anchor && activateDiffHover(anchor)
                          updateDiffMouseSelection(event, rowIndex)
                        }}
                        onMouseMove={(event) => {
                          anchor && activateDiffHover(anchor)
                          updateDiffMouseSelection(event, rowIndex)
                        }}
                        onMouseUp={(event) => {
                          if (event.button !== 0) return
                          event.stopPropagation()
                          setDiffRowCursor(card.key, rowIndex, true)
                        }}
                      >
                        {diffShowLineNumbers ? (
                          <>
                            <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
                              {fitText(formatDiffLineNumber(row.oldLine, diffGutterWidth), diffGutterWidth)}
                            </text>
                            <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}> </text>
                            <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
                              {fitText(formatDiffLineNumber(row.newLine, diffGutterWidth), diffGutterWidth)}
                            </text>
                          </>
                        ) : null}
                        <text fg={diffRowColor(row, theme)} wrapMode="none" selectable {...selectionColors}>
                          {fitText(`${isSelectedDiffRow ? '▶' : ' '} ${row.indicator ?? diffRowIndicator(row)} `, 3)}
                        </text>
                        <text fg={diffRowColor(row, theme)} wrapMode="none" selectable {...selectionColors}>
                          {fitText(row.text, Math.max(diffTextWidth, 12))}
                        </text>
                        {isHovered ? (
                          <box
                            width={3}
                            onMouseUp={(event) => {
                              event.stopPropagation()
                              rowLabelSelection && openDiffNote(rowLabelSelection)
                            }}
                          >
                            <text fg={theme.cyan} bg={theme.surface3} wrapMode="none">[+]</text>
                          </box>
                        ) : noteCards.length > 0 ? (
                          <text fg={theme.violet} wrapMode="none"> ● </text>
                        ) : (
                          <text fg={theme.dim} wrapMode="none">{'   '}</text>
                        )}
                      </box>
                      {hasDraft && diffDraft ? renderTranscriptDiffNoteDraft(diffDraft, bodyInnerWidth, theme) : null}
                      {noteCards.map(({ key, note, label }) => (
                        <React.Fragment key={key}>
                          {renderTranscriptDiffNoteCard(
                            note,
                            bodyInnerWidth,
                            theme,
                            label,
                            () => sendDiffNoteToComposer(card, note, label, diffTextForComposer),
                          )}
                        </React.Fragment>
                      ))}
                    </React.Fragment>
                  )
                })()
              ))}
              {hiddenDiffRows > 0 ? (
                <text fg={theme.dim} selectable {...selectionColors}>
                  {fitText(`... ${hiddenDiffRows} more diff lines`, bodyInnerWidth)}
                </text>
              ) : null}
              {diffFooterSegments ? (
                <box marginTop={1}>
                  <text fg={theme.cyan} selectable {...selectionColors}>
                    {renderInlineTextSegments(diffFooterSegments, bodyInnerWidth, theme.dim)}
                  </text>
                </box>
              ) : null}
            </box>
          ) : diffView ? (
            <box paddingX={1} marginTop={1}>
              {splitDiffRows.map((row, rowIndex) => {
                if (row.tone !== 'split-change' && row.tone !== 'split-context') {
                  const rowColor = row.tone === 'file' || row.tone === 'hunk' ? theme.cyan : theme.dim
                  const rowBackground = row.tone === 'hunk'
                    ? theme.diffMetaBg
                    : row.tone === 'file'
                      ? theme.surface2
                      : undefined
                  return (
                    <box key={row.key} backgroundColor={rowBackground}>
                      <text fg={rowColor} wrapMode="none" selectable {...selectionColors}>
                        {fitText(row.text ?? '', bodyInnerWidth)}
                      </text>
                    </box>
                  )
                }

                const anchor = transcriptDiffSplitRowAnchor(noteNamespace, row)
                const point = transcriptDiffSelectionPointForSplitRow(row)
                const singleRowSelection = point
                  ? {
                      start: point.lineNumber,
                      side: point.side,
                      end: point.lineNumber,
                      endSide: point.side,
                    }
                  : null
                const currentSelectionRange = diffSelectionCurrentSelection ?? singleRowSelection
                const hasDraft = diffDraftSpan?.endIndex === rowIndex
                const noteCards = (diffSelectionNotesByEndIndex.get(rowIndex) ?? []).filter(({ key }) => diffDraft?.anchor !== key)
                const isHovered = anchor !== null && hoveredDiffAnchor === anchor
                const isSelectedDiffRow = hasCursor && card.category === 'diff' && rowIndex >= diffSelectionStartIndex && rowIndex <= diffSelectionEndIndex
                return (
                  <React.Fragment key={row.key}>
                    <box
                      width={bodyInnerWidth}
                      flexDirection="row"
                      backgroundColor={isSelectedDiffRow ? theme.surface3 : undefined}
                      onMouseDown={(event) => beginDiffMouseSelection(event, rowIndex)}
                      onMouseDrag={(event) => updateDiffMouseSelection(event, rowIndex)}
                      onMouseOver={(event) => {
                        anchor && activateDiffHover(anchor)
                        updateDiffMouseSelection(event, rowIndex)
                      }}
                      onMouseMove={(event) => {
                        anchor && activateDiffHover(anchor)
                        updateDiffMouseSelection(event, rowIndex)
                      }}
                      onMouseUp={(event) => {
                        if (event.button !== 0) return
                        event.stopPropagation()
                        setDiffRowCursor(card.key, rowIndex, true)
                      }}
                    >
                      <SplitDiffSide
                        side={row.left}
                        width={splitLeftWidth}
                        gutterWidth={splitGutterWidth}
                        showLineNumbers={diffShowLineNumbers}
                        theme={theme}
                        selectionColors={selectionColors}
                      />
                      {isHovered ? (
                        <box
                          width={1}
                          onMouseUp={(event) => {
                            event.stopPropagation()
                            currentSelectionRange && openDiffNote(currentSelectionRange)
                          }}
                        >
                          <text fg={theme.cyan} bg={theme.surface3} wrapMode="none">+</text>
                        </box>
                      ) : noteCards.length > 0 ? (
                        <text fg={theme.violet} wrapMode="none">{'●'}</text>
                      ) : (
                        <text fg={isSelectedDiffRow ? theme.cyan : theme.border} wrapMode="none">{isSelectedDiffRow ? '▶' : '│'}</text>
                      )}
                      <SplitDiffSide
                        side={row.right}
                        width={splitRightWidth}
                        gutterWidth={splitGutterWidth}
                        showLineNumbers={diffShowLineNumbers}
                        theme={theme}
                        selectionColors={selectionColors}
                      />
                    </box>
                    {hasDraft && diffDraft ? renderTranscriptDiffNoteDraft(diffDraft, bodyInnerWidth, theme) : null}
                    {noteCards.map(({ key, note, label }) => (
                      <React.Fragment key={key}>
                        {renderTranscriptDiffNoteCard(
                          note,
                          bodyInnerWidth,
                          theme,
                          label,
                          () => sendDiffNoteToComposer(card, note, label, diffTextForComposer),
                        )}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                )
              })}
              {hiddenDiffRows > 0 ? (
                <text fg={theme.dim} selectable {...selectionColors}>
                  {fitText(`... ${hiddenDiffRows} more diff lines`, bodyInnerWidth)}
                </text>
              ) : null}
              {diffFooterSegments ? (
                <box marginTop={1}>
                  <text fg={theme.cyan} selectable {...selectionColors}>
                    {renderInlineTextSegments(diffFooterSegments, bodyInnerWidth, theme.dim)}
                  </text>
                </box>
              ) : null}
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

  // Frame-timing canary (no-op unless AGENT_VIEWER_PERF=1). Stamp at the top of
  // every render; the effect below reads it after commit.
  const renderStartRef = useRef(0)
  if (FRAME_TIMING_NEEDED) renderStartRef.current = performance.now()
  useEffect(() => {
    if (!FRAME_TIMING_NEEDED) return
    const durationMs = performance.now() - renderStartRef.current
    if (PERF_LOG) recordFramePerf(durationMs)
    noteRenderFrame(durationMs)
  })
  useEffect(() => {
    const clearTranscriptDiffHover = () => setHoveredTranscriptDiffAnchor(null)
    renderer.on('blur', clearTranscriptDiffHover)
    return () => {
      renderer.off('blur', clearTranscriptDiffHover)
    }
  }, [renderer])

  const [provider, setProvider] = useState<ProviderSelection>('claude')
  const [themeMode, setThemeMode] = useState<TuiThemeMode>('light')
  const [density, setDensity] = useState<TuiDensity>('balanced')
  const [diffLayout, setDiffLayout] = useState<TuiDiffLayout>('stack')
  const [transcriptDiffNotes, setTranscriptDiffNotes] = useState<Map<string, TranscriptDiffNote>>(() => new Map())
  const [transcriptDiffDraft, setTranscriptDiffDraft] = useState<TranscriptDiffNoteDraft | null>(null)
  const [hoveredTranscriptDiffAnchor, setHoveredTranscriptDiffAnchor] = useState<string | null>(null)
  const [transcriptDiffPlainCardKeys, setTranscriptDiffPlainCardKeys] = useState<Set<string>>(() => new Set())
  const [transcriptDiffHiddenLineNumberCardKeys, setTranscriptDiffHiddenLineNumberCardKeys] = useState<Set<string>>(() => new Set())
  const [transcriptDiffHiddenHunkHeaderCardKeys, setTranscriptDiffHiddenHunkHeaderCardKeys] = useState<Set<string>>(() => new Set())
  const [transcriptDiffRowCursorByCardKey, setTranscriptDiffRowCursorByCardKey] = useState<Record<string, number>>({})
  const [transcriptDiffSelectionAnchorByCardKey, setTranscriptDiffSelectionAnchorByCardKey] = useState<Record<string, number>>({})
  const [transcriptView, setTranscriptView] = useState<TuiTranscriptView>('conversation')
  const [focusMode, setFocusMode] = useState(false)
  const [railVisible, setRailVisible] = useState(true)
  const [tabsEnabled, setTabsEnabled] = useState(true)
  const [showToolCalls, setShowToolCalls] = useState(true)
  const [velocityScrollEnabled, setVelocityScrollEnabled] = useState(false)
  const [sidebarSort, setSidebarSort] = useState<TuiSidebarSort>('project')
  const [sidebarWidthPreference, setSidebarWidthPreference] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [taskPanelWidth, setTaskPanelWidth] = useState(TASK_PANEL_DEFAULT_WIDTH)
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
  const [themeMenuGroup, setThemeMenuGroup] = useState<'light' | 'dark'>('dark')
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0)
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)
  const [exitCleanupInProgress, setExitCleanupInProgress] = useState(false)
  const [gitOpen, setGitOpen] = useState(false)
  const gitKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const analyticsKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [handoffBriefOpen, setHandoffBriefOpen] = useState(false)
  const handoffBriefKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false)
  const promptLibraryKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }) => void) | null>(null)
  const [channelBridgeOpen, setChannelBridgeOpen] = useState(false)
  const channelBridgeKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }) => void) | null>(null)
  const [taskPanelOpen, setTaskPanelOpen] = useState(false)
  const [taskPanelTab, setTaskPanelTab] = useState<'tasks' | 'agents'>('tasks')
  const [taskPopoverOpen, setTaskPopoverOpen] = useState(false)
  const taskPopoverKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [awaitingPersistedTurn, setAwaitingPersistedTurn] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnosticsSections, setDiagnosticsSections] = useState<import('../../lib/types').SessionDiagnosticSection[]>([])
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null)
  const [diagnosticsBusy, setDiagnosticsBusy] = useState<string | null>(null)
  const [diagnosticsMcpIndex, setDiagnosticsMcpIndex] = useState(0)
  const [searchMode, setSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)
  const [sessionSearchMode, setSessionSearchMode] = useState(false)
  const [sessionSearchQuery, setSessionSearchQuery] = useState('')

  const [transcriptCursorKey, setTranscriptCursorKey] = useState<string | null>(null)
  const [expandedCardKeys, setExpandedCardKeys] = useState<Set<string>>(() => new Set())
  const [collapsedCardKeys, setCollapsedCardKeys] = useState<Set<string>>(() => new Set())
  // Bookmarked message uuids (== card keys) for the active session. The ref
  // keeps the toggle handler stable across renders.
  const [bookmarkKeys, setBookmarkKeys] = useState<Set<string>>(() => new Set())
  const bookmarkKeysRef = useRef<Set<string>>(bookmarkKeys)
  bookmarkKeysRef.current = bookmarkKeys
  // Global bookmarks overlay (cross-session/provider browser).
  const [bookmarksOverlayOpen, setBookmarksOverlayOpen] = useState(false)
  const [bookmarksOverlay, setBookmarksOverlay] = useState<MessageBookmark[]>([])
  const [bookmarksOverlayIndex, setBookmarksOverlayIndex] = useState(0)
  // When jumping to a bookmark in another session, remember where to land once
  // that session's transcript has loaded.
  const pendingBookmarkCursorRef = useRef<{ sessionKey: string; uuid: string } | null>(null)
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
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [contextUsageStatus, setContextUsageStatus] = useState<'idle' | 'loading' | 'unavailable' | 'ready'>('idle')
  const [renameSessionKey, setRenameSessionKey] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const renameDraftRef = useRef(renameDraft)
  const [composerActive, setComposerActive] = useState(false)
  const [composerWindowOpen, setComposerWindowOpen] = useState(false)
  const [composerDraft, setComposerDraft] = useState('')
  const composerDraftStorageKeyRef = useRef<string | null>(null)
  const [composerLiveTodos, setComposerLiveTodos] = useState<import('../../lib/taskRegistry').OpenCodeTodo[]>([])
  const [composerMention, setComposerMention] = useState<{ start: number; query: string } | null>(null)
  const [composerMentionResults, setComposerMentionResults] = useState<TuiMentionResult[]>([])
  const [composerAgentOptions, setComposerAgentOptions] = useState<SessionComposerAgentOption[]>([])
  const [composerMentionAgents, setComposerMentionAgents] = useState<SessionComposerAgentOption[]>([])
  const [composerMentionIndex, setComposerMentionIndex] = useState(0)
  const [composerMentionDismissedStart, setComposerMentionDismissedStart] = useState<number | null>(null)
  const [composerMentionAttachments, setComposerMentionAttachments] = useState<SendAttachment[]>([])
  const [composerPromptParts, setComposerPromptParts] = useState<ComposerPromptPart[]>([])
  const [composerStash, setComposerStash] = useState<ComposerDraftSnapshot[]>([])
  const [composerStashOpen, setComposerStashOpen] = useState(false)
  const [composerStashIndex, setComposerStashIndex] = useState(0)
  const [composerSlashIndex, setComposerSlashIndex] = useState(0)
  const [composerSlashDismissed, setComposerSlashDismissed] = useState(false)
  const [composerHistoryOpen, setComposerHistoryOpen] = useState(false)
  const [composerHistoryIndex, setComposerHistoryIndex] = useState(0)
  const [composerLiveSlashCommands, setComposerLiveSlashCommands] = useState<SlashCommandSuggestion[]>([])
  const [composerSendState, setComposerSendState] = useState<SendState>('idle')
  const [composerSendStartedAt, setComposerSendStartedAt] = useState<number | null>(null)
  const [interruptPressActive, setInterruptPressActive] = useState(false)
  const [backgroundingTasks, setBackgroundingTasks] = useState(false)
  const interruptPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Pending tool-approval requests surfaced from the live SSE stream (Claude
  // canUseTool, Copilot/OpenCode permission events, Codex approvals). The
  // overlay below the composer lets the user allow/reject them, matching native.
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([])
  const [permissionActionLoading, setPermissionActionLoading] = useState<string | null>(null)
  const [permissionOptionIndex, setPermissionOptionIndex] = useState(0)
  const [composerWaitingSeed, setComposerWaitingSeed] = useState('')
  const [composerError, setComposerError] = useState<string | null>(null)
  const [composerLiveText, setComposerLiveText] = useState('')
  // Reasoning streams on its own dim channel (see liveReasoning render below).
  const [composerLiveReasoning, setComposerLiveReasoning] = useState('')
  const [liveTranscriptMessages, setLiveTranscriptMessages] = useState<ThreadedMessage[]>([])
  // Queued prompt waiting for the active turn to finish (CLI-style queue).
  const [queuedComposerSend, setQueuedComposerSend] = useState<{ text: string; attachments: SendAttachment[] } | null>(null)
  const [livePromptSuggestion, setLivePromptSuggestion] = useState<string | null>(null)
  const [liveStatus, setLiveStatus] = useState<'requesting' | 'compacting' | 'retrying' | null>(null)
  const [liveSubagentText, setLiveSubagentText] = useState<Record<string, string>>({})
  const [liveOutputTokens, setLiveOutputTokens] = useState(0)
  const [liveToolActivities, setLiveToolActivities] = useState<TuiLiveToolActivity[]>([])
  const [taskBudgetTokens, setTaskBudgetTokens] = useState<number | null>(null)
  // Provider-agnostic send knobs. Forwarded into the streamTuiSessionTurn
  // body so the TUI composer matches the web composer's send-time controls
  // (model / reasoning effort / Claude permission mode). Defaults of `auto`
  // / `default` mean "let the SDK keep whatever the session was using".
  const [tuiEffort, setTuiEffort] = useState<TuiEffort>('auto')
  const [tuiPermissionModeByKey, setTuiPermissionModeByKey] = useState<Record<string, TuiPermissionMode>>({})
  const tuiPermissionModeByKeyRef = useRef<Record<string, TuiPermissionMode>>({})
  const [tuiCopilotMode, setTuiCopilotMode] = useState<'interactive' | 'plan' | 'autopilot' | 'shell'>('interactive')
  const [tuiOpenCodeAgent, setTuiOpenCodeAgent] = useState('')
  const [tuiModelOverride, setTuiModelOverride] = useState<Record<string, string>>({})
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelPickerTarget, setModelPickerTarget] = useState<Session | null>(null)
  const [modelPickerFocus, setModelPickerFocus] = useState<'model' | 'effort'>('model')
  const [modelPickerOptions, setModelPickerOptions] = useState<ModelPickerOption[]>([])
  const [modelPickerIndex, setModelPickerIndex] = useState(0)
  const [modelPickerEffortIndex, setModelPickerEffortIndex] = useState(0)
  const [modelPickerLoading, setModelPickerLoading] = useState(false)
  const [modelPickerError, setModelPickerError] = useState<string | null>(null)
  const [sentHistory, setSentHistory] = useState<ComposerDraftSnapshot[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [draftBeforeHistory, setDraftBeforeHistory] = useState<ComposerDraftSnapshot>({
    text: '',
    attachments: [],
    promptParts: [],
  })
  const [thinkingMode, setThinkingMode] = useState(false)

  // Store full Session objects so tabs retain provider context across
  // provider switches (looking them up in `sessions` loses other-provider tabs).
  const [openTabSessions, setOpenTabSessions] = useState<Session[]>([])

  const transcriptScrollRef = useRef<ScrollBoxRenderable>(null)
  const sidebarScrollRef = useRef<ScrollBoxRenderable>(null)
  const pausedTranscriptScrollTopRef = useRef<number | null>(null)
  const prevFollowTailRef = useRef(true)
  // Velocity scroll: ramps the per-tick cursor step up smoothly the longer j/k/↑/↓
  // is held, by tracking how recently the same-direction key keeps repeating.
  // A gap longer than VELOCITY_SCROLL_RESET_MS means the key was released (or
  // re-pressed deliberately), so the streak — and the speed — resets to base.
  const velocityScrollStateRef = useRef<{ direction: -1 | 1; streakStart: number; lastEventTime: number } | null>(null)
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
  const sessionContextUsageCacheRef = useRef(new Map<string, ContextUsage | null>())
  const sessionMetadataFetchedAtRef = useRef(new Map<string, number>())
  const sessionMetadataInFlightRef = useRef(new Set<string>())
  const composerAbortRef = useRef<AbortController | null>(null)
  const activeComposerSendCleanupRef = useRef<Promise<void> | null>(null)
  // Transient auto-retry bookkeeping (mirrors the web composer): only retry a
  // turn that streamed no output yet, bounded attempts, timer cleared on cancel.
  const composerTurnProducedOutputRef = useRef(false)
  const composerRetryCountRef = useRef(0)
  const composerRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Set by cancelComposerSend so the send's AbortError handler transitions into
  // the awaitingPersistedTurn 'Syncing…' reconcile (confirmed interrupt) rather
  // than discarding the interrupted turn's partial output outright.
  const composerInterruptPendingRef = useRef(false)
  const composerTextareaRef = useRef<TextareaRenderable | null>(null)
  const composerPastePartTypeIdRef = useRef<number | null>(null)
  const composerCursorOffsetRef = useRef<number | null>(null)
  const terminalSelectionRef = useRef<{ text: string; capturedAt: number } | null>(null)
  const liveToolIndexesRef = useRef<Map<number, string>>(new Map())
  const liveToolInputJsonRef = useRef<Map<number, string>>(new Map())
  const liveTranscriptBaselineRef = useRef(new Map<string, { count: number; lastFingerprint: string | null; sequenceFingerprint: string }>())
  const liveTranscriptMessagesRef = useRef<ThreadedMessage[]>([])
  const awaitingPersistedTurnRef = useRef(false)
  const liveTextFlushFrameRef = useRef<number | null>(null)
  const pendingLiveTextRef = useRef('')
  const pendingLiveReasoningRef = useRef('')
  const liveTextTargetSessionRef = useRef<Session | null>(null)
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
  const exitConfirmOpenRef = useRef(false)
  const exitInProgressRef = useRef(false)
  const densityRef = useRef<TuiDensity>('balanced')
  const showToolCallsRef = useRef(true)
  const transcriptDiffHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracked for the detail-poll skip path (proposal 6): the 2s background
  // refresh fires startTransition work that can interleave with keystroke
  // handling during active typing or searching, causing visible stutter.
  const composerActiveRef = useRef(false)
  const composerDraftRef = useRef('')
  const searchModeRef = useRef(false)
  const sessionSearchModeRef = useRef(false)
  useEffect(() => { densityRef.current = density }, [density])
  useEffect(() => { showToolCallsRef.current = showToolCalls }, [showToolCalls])
  useEffect(() => { composerActiveRef.current = composerActive }, [composerActive])
  useEffect(() => { composerDraftRef.current = composerDraft }, [composerDraft])
  useEffect(() => { tuiPermissionModeByKeyRef.current = tuiPermissionModeByKey }, [tuiPermissionModeByKey])
  useEffect(() => { liveTranscriptMessagesRef.current = liveTranscriptMessages }, [liveTranscriptMessages])
  useEffect(() => { searchModeRef.current = searchMode }, [searchMode])
  useEffect(() => { sessionSearchModeRef.current = sessionSearchMode }, [sessionSearchMode])
  useEffect(() => { exitConfirmOpenRef.current = exitConfirmOpen }, [exitConfirmOpen])
  // No-op unless AGENT_VIEWER_TUI_METRICS=1: reports the sizes of the
  // session-keyed maps/sets most likely to grow unbounded, alongside the
  // process-level memory/GC/loop-delay samples in metricsLogger.ts.
  useEffect(() => registerTuiMetricsGauge(() => ({
    sessions: sessions.length,
    runningSessions: runningSessionsRef.current.length,
    transcriptMessages: sessionDetail?.rawMessages.length ?? 0,
    threadedMessages: sessionDetail?.threadedMessages.length ?? 0,
    sessionDetailCache: sessionDetailCacheRef.current.size,
    sessionContextUsageCache: sessionContextUsageCacheRef.current.size,
    sessionMetadataFetchedAt: sessionMetadataFetchedAtRef.current.size,
    sessionMetadataInFlight: sessionMetadataInFlightRef.current.size,
    liveToolIndexes: liveToolIndexesRef.current.size,
    liveToolInputJson: liveToolInputJsonRef.current.size,
    liveTranscriptBaseline: liveTranscriptBaselineRef.current.size,
    backgroundRefreshInFlight: backgroundRefreshInFlightRef.current.size,
    sessionDetailMtime: sessionDetailMtimeRef.current.size,
  })), [sessions.length, sessionDetail])
  useEffect(() => {
    if (!composerActive && composerWindowOpen) setComposerWindowOpen(false)
  }, [composerActive, composerWindowOpen])
  useLayoutEffect(() => {
    if (!composerActive) return
    const offset = composerCursorOffsetRef.current
    if (offset == null) return
    const renderable = composerTextareaRef.current
    if (!renderable) return
    renderable.cursorOffset = Math.min(offset, renderable.plainText.length)
    composerCursorOffsetRef.current = null
  }, [composerActive, composerWindowOpen])
  useEffect(() => { awaitingPersistedTurnRef.current = awaitingPersistedTurn }, [awaitingPersistedTurn])
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
  const composerSyntaxStyle = useMemo(() => buildComposerSyntaxStyle(theme), [theme])
  const densityState = useMemo(() => densityConfig(density), [density])
  const showRail = railVisible
  const effectiveFocus: PaneFocus = showRail ? focusedPane : 'messages'
  const selectedIndex = useMemo(() => {
    if (sessions.length === 0) return -1
    if (!selectedSessionKey) return 0
    return sessions.findIndex((session) => sessionKey(session) === selectedSessionKey)
  }, [selectedSessionKey, sessions])
  // Fall back to openTabSessions when the key doesn't match anything in
  // `sessions` — that's the case for freshly created pending provider sessions
  // (added to openTabSessions immediately, but only appears in `sessions` once
  // the SDK materialises it on first send).
  const selectedSession = useMemo<Session | null>(() => {
    if (selectedSessionKey) {
      const fromTab = openTabSessions.find((session) => sessionKey(session) === selectedSessionKey)
      if (fromTab?.isPending) return fromTab
    }
    if (selectedIndex >= 0) return sessions[selectedIndex] ?? null
    if (selectedSessionKey) {
      const fromTab = openTabSessions.find((session) => sessionKey(session) === selectedSessionKey)
      if (fromTab) return fromTab
    }
    return sessions[0] ?? null
  }, [openTabSessions, selectedIndex, selectedSessionKey, sessions])
  const selectedSessionIdentity = selectedSession ? sessionKey(selectedSession) : null
  useEffect(() => {
    setTranscriptDiffDraft(null)
    setHoveredTranscriptDiffAnchor(null)
    setTranscriptDiffSelectionAnchorByCardKey({})
  }, [selectedSessionIdentity])
  useEffect(() => () => {
    if (transcriptDiffHoverTimeoutRef.current) clearTimeout(transcriptDiffHoverTimeoutRef.current)
  }, [])
  const activateTranscriptDiffHover = useCallback((anchor: string) => {
    if (transcriptDiffHoverTimeoutRef.current) clearTimeout(transcriptDiffHoverTimeoutRef.current)
    setHoveredTranscriptDiffAnchor(anchor)
    transcriptDiffHoverTimeoutRef.current = setTimeout(() => {
      setHoveredTranscriptDiffAnchor(null)
      transcriptDiffHoverTimeoutRef.current = null
    }, 2000)
  }, [])
  const openTranscriptDiffNote = useCallback((selection: SelectedLineRange) => {
    const key = transcriptDiffSelectionKey(selectedSessionIdentity ?? 'no-session', selection)
    setTranscriptDiffDraft({
      anchor: key,
      range: selection,
      lineLabel: transcriptDiffSelectionLineLabel(selection),
      text: transcriptDiffNotes.get(key)?.text ?? '',
    })
  }, [selectedSessionIdentity, transcriptDiffNotes])
  const deleteTranscriptDiffNote = useCallback((selectionKey: string) => {
    setTranscriptDiffNotes((prev) => {
      const next = new Map(prev)
      next.delete(selectionKey)
      return next
    })
    setTranscriptDiffDraft((draft) => (draft?.anchor === selectionKey ? null : draft))
  }, [])
  const toggleTranscriptDiffCardSet = useCallback((setter: React.Dispatch<React.SetStateAction<Set<string>>>, cardKey: string) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(cardKey)) next.delete(cardKey)
      else next.add(cardKey)
      return next
    })
  }, [])
  const clearTranscriptDiffSelectionForCard = useCallback((cardKey: string) => {
    setTranscriptDiffSelectionAnchorByCardKey((prev) => {
      if (!(cardKey in prev)) return prev
      const next = { ...prev }
      delete next[cardKey]
      return next
    })
  }, [])
  const setTranscriptDiffSelectionAnchorForCard = useCallback((cardKey: string, rowIndex: number) => {
    setTranscriptDiffSelectionAnchorByCardKey((prev) => ({ ...prev, [cardKey]: Math.max(0, rowIndex) }))
  }, [])
  const setTranscriptDiffRowCursorForCard = useCallback((cardKey: string, rowIndex: number, preserveSelection = false) => {
    setTranscriptDiffRowCursorByCardKey((prev) => ({ ...prev, [cardKey]: Math.max(0, rowIndex) }))
    if (!preserveSelection) clearTranscriptDiffSelectionForCard(cardKey)
  }, [clearTranscriptDiffSelectionForCard])
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
  const composerProvider = composerTargetSession?.provider ?? selectedSession?.provider ?? null
  const composerPermissionMode = useMemo<TuiPermissionMode>(() => {
    if (composerTargetSession?.provider !== 'claude') return 'default'
    return tuiPermissionModeByKey[sessionKey(composerTargetSession)] ?? 'default'
  }, [composerTargetSession, tuiPermissionModeByKey])
  const composerConfig = useMemo(() => getProviderComposer(composerProvider), [composerProvider])
  const composerExampleSeed = useMemo(() => {
    const source = composerTargetSession?.sessionId ?? composerProvider ?? ''
    let hash = 0
    for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0
    return hash
  }, [composerTargetSession?.sessionId, composerProvider])
  const composerExample = useMemo(
    () => pickProviderExample(composerProvider, composerExampleSeed),
    [composerProvider, composerExampleSeed],
  )
  const composerAccentColor = useMemo(() => {
    const key = composerConfig.tuiAccentKey
    const value = (theme as unknown as Record<string, string>)[key]
    return value ?? theme.cyan
  }, [composerConfig.tuiAccentKey, theme])
  const liveTranscriptMessagesCacheRef = useRef<ThreadedMessage[] | null>(null)
  const liveTranscriptMessagesForSession = useMemo(() => {
    if (!selectedSessionTarget) return []
    const key = sessionKey(selectedSessionTarget)
    const filtered = liveTranscriptMessages.filter((message) => liveMessageSessionKey(message) === key)
    const prev = liveTranscriptMessagesCacheRef.current
    if (prev && prev.length === filtered.length && prev.every((m, i) => m === filtered[i])) {
      return prev
    }
    liveTranscriptMessagesCacheRef.current = filtered
    return filtered
  }, [liveTranscriptMessages, selectedSessionTarget])

  const taskPanelMessages = useMemo(() => {
    const persisted = sessionDetail?.threadedMessages ?? []
    const live = liveTranscriptMessagesForSession
    if (live.length === 0) return persisted
    const seen = new Set(live.map((m) => m.uuid))
    return [...live, ...persisted.filter((m) => !seen.has(m.uuid))]
  }, [sessionDetail?.threadedMessages, liveTranscriptMessagesForSession])
  const codexLiveAssistantTextVisible = useMemo(
    () => liveTranscriptMessagesForSession.some((message) => message.uuid === CODEX_LIVE_ASSISTANT_UUID),
    [liveTranscriptMessagesForSession],
  )

  // Card formatting runs in the threading worker. The worker client keeps only
  // the most recent card variant; if it has been evicted, this render path can
  // still format synchronously from the already-threaded messages.
  // ── Base card computation — NOT dependent on live messages ────────────────
  // Separating base from the live overlay is the key perf fix: streaming deltas
  // change only liveTranscriptMessagesForSession, so this memo is stable for
  // the entire duration of a streaming turn. Before the split, every delta
  // triggered a full O(N_base) rebuild: buildTaskActiveForms/buildTaskRegistry
  // over all base messages + formatTranscriptCard × N_base on the main thread
  // (60–800ms per delta for a 63–136 card session). Now that work runs only
  // when sessionDetail/density/showToolCalls actually change.
  const baseTranscriptCards = useMemo<TuiTranscriptCard[]>(() => {
    const profileStart = CARD_PROFILE ? performance.now() : 0
    if (!selectedSessionTarget || !sessionDetail) return []
    let cards: TuiTranscriptCard[]
    let recomputed = 0
    const cachedSync = getTranscriptCardsSync(
      selectedSessionTarget,
      sessionDetail.threadedMessages,
      density,
      showToolCalls,
    )
    if (cachedSync) {
      cards = cachedSync
    } else {
      const filtered = showToolCalls
        ? sessionDetail.threadedMessages
        : stripToolCallBlocks(sessionDetail.threadedMessages)
      const activeForms = buildTaskActiveForms(filtered)
      const taskRegistry = buildTaskRegistry(filtered)
      cards = filtered.map((msg) => formatTranscriptCard(msg, density, activeForms, taskRegistry))
      recomputed = cards.length
    }
    if (CARD_PROFILE) {
      logCardRecompute({
        scope: 'transcriptCards',
        totalCards: cards.length,
        recomputed,
        liveCards: 0,
        durationMs: performance.now() - profileStart,
      })
    }
    return cards
  }, [density, sessionDetail, selectedSessionTarget, showToolCalls])

  // ── Task context for live cards — stable across streaming deltas ───────────
  // buildTaskActiveForms and buildTaskRegistry scan the full base transcript.
  // Memoizing them separately ensures the O(N_base) scan runs at most once per
  // sessionDetail update (2s poll cadence), never per streamed token.
  // Live messages occasionally contain TaskCreate/TaskUpdate calls; their task
  // events appear in the persisted transcript (and therefore here) on the next
  // poll, which is the correct behaviour — the live overlay is ephemeral.
  const baseTaskContext = useMemo(() => {
    if (!sessionDetail) return { activeForms: new Map() as ReturnType<typeof buildTaskActiveForms>, taskRegistry: new Map() as ReturnType<typeof buildTaskRegistry> }
    const filtered = showToolCalls
      ? sessionDetail.threadedMessages
      : stripToolCallBlocks(sessionDetail.threadedMessages)
    return {
      activeForms: buildTaskActiveForms(filtered),
      taskRegistry: buildTaskRegistry(filtered),
    }
  }, [sessionDetail, showToolCalls])

  // ── Live overlay — O(N_live) per delta, base cards always cache-hit ────────
  const transcriptCards = useMemo<TuiTranscriptCard[]>(() => {
    if (liveTranscriptMessagesForSession.length === 0) return baseTranscriptCards
    const profileStart = CARD_PROFILE ? performance.now() : 0
    const liveMessages = showToolCalls
      ? liveTranscriptMessagesForSession
      : stripToolCallBlocks(liveTranscriptMessagesForSession)
    const liveCards = liveMessages.map((message) => ({
      ...formatTranscriptCard(message, density, baseTaskContext.activeForms, baseTaskContext.taskRegistry),
      key: `live:${message.uuid}`,
    }))
    if (CARD_PROFILE) {
      logCardRecompute({
        scope: 'transcriptCards',
        totalCards: baseTranscriptCards.length + liveCards.length,
        recomputed: liveCards.length,
        liveCards: liveCards.length,
        durationMs: performance.now() - profileStart,
      })
    }
    return [...baseTranscriptCards, ...liveCards]
  }, [baseTranscriptCards, baseTaskContext, density, liveTranscriptMessagesForSession, showToolCalls])

  // In 'continue' and 'stream' modes, hide technical/diff/system cards entirely
  // so only the conversation layer (user + assistant text) is visible.
  const visibleTranscriptCards = useMemo(
    () => (transcriptView === 'continue' || transcriptView === 'stream')
      ? transcriptCards.filter((card) => !card.autoFold)
      : transcriptCards,
    [transcriptCards, transcriptView],
  )

  useLayoutEffect(() => {
    if (!selectedSessionTarget || !sessionDetail) return
    const key = sessionKey(selectedSessionTarget)
    const baseline = liveTranscriptBaselineRef.current.get(key)
    if (!baseline) return
    const durableMessages = sessionDetail.rawMessages.filter(isDurableSessionMessage)
    const lastFingerprint = sessionMessageFingerprint(durableMessages.at(-1))
    const sequenceFingerprint = sessionMessageSequenceFingerprint(durableMessages)
    const persistedTurnArrived =
      durableMessages.length > baseline.count
      || lastFingerprint !== baseline.lastFingerprint
      || sequenceFingerprint !== baseline.sequenceFingerprint
    if (!persistedTurnArrived) return
    const liveAssistantVisible = Boolean(composerLiveText.trim())
      || hasLiveAssistantMessage(liveTranscriptMessagesForSession, key)
    if (liveAssistantVisible && !hasPersistedAssistantAfterBaseline(sessionDetail.rawMessages, baseline.count)) {
      setLiveTranscriptMessages((prev) => {
        const next = prev.filter((message) => !(liveMessageSessionKey(message) === key && message.role === 'user'))
        return next.length === prev.length ? prev : next
      })
      return
    }

    liveTranscriptBaselineRef.current.delete(key)
    setLiveTranscriptMessages((prev) => prev.filter((message) => liveMessageSessionKey(message) !== key))
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
    setComposerLiveText('')
    setAwaitingPersistedTurn(false)
  }, [composerLiveText, liveTranscriptMessagesForSession, selectedSessionIdentity, selectedSessionTarget, sessionDetail])

  // Escape hatch mirroring the web composer: if the persisted rows for a
  // completed turn never arrive, force-reveal the polled transcript after a
  // bounded wait so the live overlay / "Syncing…" state can't stick forever.
  useEffect(() => {
    if (!awaitingPersistedTurn) return
    const timer = setTimeout(() => {
      const key = selectedSessionTarget ? sessionKey(selectedSessionTarget) : null
      if (key) {
        liveTranscriptBaselineRef.current.delete(key)
        setLiveTranscriptMessages((prev) => prev.filter((message) => liveMessageSessionKey(message) !== key))
      }
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
      setComposerLiveText('')
      setAwaitingPersistedTurn(false)
    }, AWAITING_PERSISTED_TURN_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [awaitingPersistedTurn, selectedSessionTarget])

  // (Auto-open of the composer on a pending session was removed: with
  // composerActive=true, the global key handler's `N` / `c` / `q` shortcuts
  // were intercepted by the composer-active branch. The welcome banner +
  // explicit `c` keypress is the native model here.)

  // Warm the worker + client caches when the user toggles density/showToolCalls
  // to a variant that isn't yet cached. The synchronous fallback above keeps the
  // UI responsive in the meantime; this effect just ensures subsequent toggles
  // hit the cache instead of running a main-thread format every time.
  useEffect(() => {
    if (!sessionDetail || !selectedSessionTarget) return
    const cachedSync = getTranscriptCardsSync(
      selectedSessionTarget,
      sessionDetail.threadedMessages,
      density,
      showToolCalls,
    )
    if (cachedSync) return
    void formatTranscriptCardsAsync(
      selectedSessionTarget,
      sessionDetail.threadedMessages,
      density,
      showToolCalls,
    ).catch(() => { /* worker errors surface elsewhere */ })
  }, [density, sessionDetail, selectedSessionTarget, showToolCalls])
  const transcriptIndexByKey = useMemo(() => {
    const indexByKey = new Map<string, number>()
    visibleTranscriptCards.forEach((card, index) => {
      indexByKey.set(card.key, index)
    })
    return indexByKey
  }, [visibleTranscriptCards])

  const jumpToTranscriptIndex = useCallback((index: number) => {
    if (visibleTranscriptCards.length === 0) return
    const nextIndex = clamp(index, 0, visibleTranscriptCards.length - 1)
    const nextCard = visibleTranscriptCards[nextIndex]
    if (!nextCard) return
    setTranscriptCursorKey(nextCard.key)
    const atTail = nextIndex === visibleTranscriptCards.length - 1
    setFollowTail(atTail)
    if (atTail) {
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
    }
  }, [visibleTranscriptCards])

  const selectTranscriptCard = useCallback((cardKey: string) => {
    const index = transcriptIndexByKey.get(cardKey)
    if (index == null) return
    jumpToTranscriptIndex(index)
    setFocusedPane('messages')
  }, [transcriptIndexByKey, jumpToTranscriptIndex])
  const thinkingFullKeys = useMemo(() => {
    if (!thinkingMode) return new Set<string>()
    const next = new Set<string>()
    for (const card of visibleTranscriptCards) {
      if (card.lines.some((line) => line.tone === 'thinking')) {
        next.add(card.key)
      }
    }
    return next
  }, [thinkingMode, visibleTranscriptCards])

  const resolvedExpandedKeys = useMemo(() => {
    const next = new Set<string>()
    for (const card of visibleTranscriptCards) {
      const shouldAutoFold = transcriptView === 'conversation' && card.autoFold
      const isExpanded = shouldAutoFold
        ? expandedCardKeys.has(card.key)
        : !collapsedCardKeys.has(card.key)
      if (isExpanded) next.add(card.key)
    }
    return next
  }, [collapsedCardKeys, expandedCardKeys, visibleTranscriptCards, transcriptView])

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  // Deferred: search computation runs after user interactions, so typing stays instant.
  const deferredSearchQuery = useDeferredValue(normalizedSearchQuery)
  const searchMatches = useMemo(() => {
    if (!deferredSearchQuery) return []
    return visibleTranscriptCards.flatMap((card, index) => (
      card.searchHaystackLower.includes(deferredSearchQuery) ? [index] : []
    ))
  }, [deferredSearchQuery, visibleTranscriptCards])

  const cursorIndex = useMemo(() => {
    if (visibleTranscriptCards.length === 0) return -1
    const index = transcriptCursorKey ? transcriptIndexByKey.get(transcriptCursorKey) ?? -1 : -1
    if (index >= 0) return index
    return followTail ? visibleTranscriptCards.length - 1 : 0
  }, [followTail, visibleTranscriptCards.length, transcriptCursorKey, transcriptIndexByKey])

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
    () => visibleTranscriptCards.filter((card) => card.autoFold && !resolvedExpandedKeys.has(card.key)).length,
    [resolvedExpandedKeys, visibleTranscriptCards],
  )
  // Split the live-stream fast path out of the O(transcript) scan so the
  // expensive `.some()` only recomputes when expanded keys or cards change —
  // not on every RAF flush that mutates composerLiveText while a turn streams.
  const liveSyntaxActive = composerSendState === 'sending' && Boolean(composerLiveText)
  const expandedSyntaxActive = useMemo(
    () => visibleTranscriptCards.some((card) => {
      if (!resolvedExpandedKeys.has(card.key)) return false
      return Boolean(card.markdownContent || (card.codeBlocks && card.codeBlocks.length > 0))
    }),
    [resolvedExpandedKeys, visibleTranscriptCards],
  )
  const shouldEnableSyntaxHighlighting = liveSyntaxActive || expandedSyntaxActive
  const syntaxStyle = useMemo(
    () => shouldEnableSyntaxHighlighting ? buildSyntaxStyle(theme) : null,
    [shouldEnableSyntaxHighlighting, theme],
  )
  const handoffBriefSyntaxStyle = useMemo(
    () => syntaxStyle ?? buildSyntaxStyle(theme),
    [syntaxStyle, theme],
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
  const composerHeight = Math.max(COMPOSER_MIN_HEIGHT, Math.min(COMPOSER_MAX_HEIGHT, (composerDraft.length === 0 ? 1 : composerDraft.split('\n').length) + COMPOSER_DOCK_CHROME_HEIGHT))
  const composerDockHeight = composerWindowOpen ? 0 : composerHeight
  const composerDockTextareaHeight = Math.max(2, composerDockHeight - COMPOSER_DOCK_CHROME_HEIGHT)
  const composerTargetSessionInfo = useMemo(() => {
    if (!composerTargetSession) return null
    const targetKey = sessionKey(composerTargetSession)
    const activeDetail = sessionDetail?.info
    if (
      selectedSessionKey === targetKey
      && activeDetail
      && activeDetail.sessionId === composerTargetSession.sessionId
      && activeDetail.provider === composerTargetSession.provider
    ) {
      return activeDetail
    }
    return sessionDetailCacheRef.current.get(targetKey)?.info ?? null
  }, [composerTargetSession, selectedSessionKey, sessionDetail])
  const composerCurrentModel = useMemo(() => {
    if (!composerTargetSession) return null
    const targetKey = sessionKey(composerTargetSession)
    const modelOverride = tuiModelOverride[targetKey]
    const selectedDetailModel = composerTargetSessionInfo?.currentModel
    const contextModel = selectedSessionKey === targetKey ? contextUsage?.model : undefined
    const rawModel = modelOverride ?? selectedDetailModel ?? contextModel
    if (!rawModel) return null
    const model = formatModelChipValue(rawModel)
    return model && model.toLowerCase() !== 'unknown' ? model : null
  }, [composerTargetSession, composerTargetSessionInfo, contextUsage, selectedSessionKey, tuiModelOverride])
  const highlightedModelPickerOption = modelPickerOptions[modelPickerIndex]
  const modelPickerEffortOptions = useMemo(
    () => effortPickerOptions(modelPickerTarget?.provider, highlightedModelPickerOption),
    [highlightedModelPickerOption, modelPickerTarget?.provider],
  )
  const composerContextUsage = useMemo(() => {
    if (!composerTargetSession) return null
    const targetKey = sessionKey(composerTargetSession)
    const usage = selectedSessionKey === targetKey
      ? contextUsage
      : sessionContextUsageCacheRef.current.get(targetKey) ?? null
    return usage ? formatContextUsageChip(usage) : null
  }, [composerTargetSession, contextUsage, selectedSessionKey])
  // One-line chip summarising the active model, explicit effort, and any
  // provider-specific send knobs.
  const composerKnobSegments = useMemo<InlineTextSegment[]>(() => {
    const parts: InlineTextSegment[] = []
    if (composerCurrentModel) parts.push({ text: `model:${composerCurrentModel}`, fg: composerAccentColor })
    if (composerContextUsage) parts.push({ text: `ctx:${composerContextUsage}`, fg: theme.green })
    parts.push({ text: `effort:${tuiEffort}`, fg: theme.amber })
    if (composerTargetSession?.provider === 'opencode' && tuiOpenCodeAgent) {
      parts.push({ text: `agent:${tuiOpenCodeAgent}`, fg: theme.cyan })
    }
    if (composerTargetSession?.provider === 'claude' && composerPermissionMode !== 'default') {
      parts.push({ text: `mode:${composerPermissionMode}`, fg: theme.violet })
    }
    if (composerTargetSession?.provider === 'copilot' && tuiCopilotMode !== 'interactive') {
      parts.push({ text: `mode:${tuiCopilotMode}`, fg: theme.cyan })
    }
    return parts
  }, [composerAccentColor, composerContextUsage, composerCurrentModel, composerPermissionMode, composerTargetSession?.provider, theme.amber, theme.cyan, theme.green, theme.violet, tuiCopilotMode, tuiEffort, tuiOpenCodeAgent])
  const composerKnobsChip = useMemo(
    () => composerKnobSegments.length > 0
      ? `· ${composerKnobSegments.map((part) => part.text).join(' · ')}`
      : '',
    [composerKnobSegments],
  )
  const composerWorkingDirectory = composerTargetSessionInfo?.cwd ?? composerTargetSession?.cwd ?? null
  const composerGitBranch = composerTargetSessionInfo?.gitBranch ?? null
  const composerLocationSegments = useMemo<InlineTextSegment[]>(() => {
    const parts: InlineTextSegment[] = []
    if (composerWorkingDirectory) parts.push({ text: `cwd ${composerWorkingDirectory}`, fg: theme.dim })
    if (composerGitBranch) parts.push({ text: `⎇ ${composerGitBranch}`, fg: theme.violet })
    return parts
  }, [composerGitBranch, composerWorkingDirectory, theme.dim, theme.violet])
  const buildComposerStatsSegments = (lineCount: number): InlineTextSegment[] => {
    const segments: InlineTextSegment[] = []
    if (composerDraft.length === 0) {
      segments.push({ text: composerConfig.glyph, fg: composerAccentColor })
      segments.push({ text: ` ${composerConfig.label}`, fg: composerAccentColor })
    } else {
      segments.push({ text: `${lineCount} line${lineCount === 1 ? '' : 's'}`, fg: composerAccentColor })
      segments.push({ text: ` · ${composerDraft.length} chars`, fg: theme.text })
    }
    if (composerAttachmentLabel) {
      segments.push({ text: ' · ', fg: theme.dim })
      segments.push({ text: composerAttachmentLabel, fg: theme.cyan })
    }
    if (composerKnobSegments.length > 0) {
      segments.push({ text: ' · ', fg: theme.dim })
      composerKnobSegments.forEach((segment, index) => {
        if (index > 0) segments.push({ text: ' · ', fg: theme.dim })
        segments.push(segment)
      })
    }
    if (composerLocationSegments.length > 0) {
      segments.push({ text: ' · ', fg: theme.dim })
      composerLocationSegments.forEach((segment, index) => {
        if (index > 0) segments.push({ text: ' · ', fg: theme.dim })
        segments.push(segment)
      })
    }
    return segments
  }
  const composerWaitingSuffix = useMemo(() => {
    const parts: string[] = []
    if (composerKnobsChip) parts.push(composerKnobsChip.replace(/^·\s*/, ''))
    if (composerSendState === 'sending' && liveOutputTokens > 0) {
      parts.push(`↓ ${formatLiveOutputTokens(liveOutputTokens)} tokens`)
    }
    return parts.length > 0 ? parts.join(' · ') : null
  }, [composerKnobsChip, composerSendState, liveOutputTokens])

  useEffect(() => {
    if (!modelPickerOpen) return
    const index = modelPickerEffortOptions.findIndex((option) => option.value === tuiEffort)
    setModelPickerEffortIndex(index >= 0 ? index : 0)
  }, [modelPickerEffortOptions, modelPickerOpen, tuiEffort])
  const composerWaitingStatusSeed = composerWaitingSeed
    || `${composerTargetSession?.provider ?? 'unknown'}:${composerTargetSession?.sessionId ?? 'pending'}:${composerDraft}`
  const composerFirstLine = composerDraft.split('\n')[0] ?? ''
  const composerSlashOpen = composerFirstLine.startsWith('/') && !composerSlashDismissed
  const composerSlashCommands: SlashCommandSuggestion[] = useMemo(() => {
    if (!composerSlashOpen) return []
    const baseline = getSlashCommandSuggestions(selectedSession?.provider ?? 'claude')
    const merged: SlashCommandSuggestion[] = [...composerLiveSlashCommands]
    const seen = new Set(merged.map((entry) => entry.command))
    for (const entry of baseline) {
      if (!seen.has(entry.command)) {
        merged.push(entry)
        seen.add(entry.command)
      }
    }
    return filterSlashCommands(merged, composerFirstLine.slice(1))
  }, [composerSlashOpen, composerFirstLine, selectedSession?.provider, composerLiveSlashCommands])

  useEffect(() => {
    if (!selectedSession) {
      setComposerLiveSlashCommands([])
      setComposerAgentOptions([])
      setComposerMentionAgents([])
      setTuiOpenCodeAgent('')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [live, composerOptions] = await Promise.all([
          readViewSessionSlashCommands(selectedSession.sessionId, selectedSession.provider),
          readViewSessionComposerOptions(selectedSession.sessionId, selectedSession.provider),
        ])
        if (cancelled) return
        setComposerLiveSlashCommands(live.map((entry) => ({
          command: entry.command,
          description: entry.description,
          argumentHint: entry.argumentHint && entry.argumentHint.trim() ? entry.argumentHint.trim() : undefined,
        })))
        const agentOptions = composerOptions.agents ?? []
        setComposerAgentOptions(agentOptions)
        setComposerMentionAgents(composerOptions.mentionAgents ?? [])
        if (selectedSession.provider === 'opencode') {
          const currentAgent = composerOptions.currentAgent
          setTuiOpenCodeAgent(
            currentAgent && agentOptions.some((agent) => agent.value === currentAgent)
              ? currentAgent
              : agentOptions[0]?.value ?? '',
          )
        } else {
          setTuiOpenCodeAgent('')
        }
      } catch {
        if (!cancelled) {
          setComposerLiveSlashCommands([])
          setComposerAgentOptions([])
          setComposerMentionAgents([])
          setTuiOpenCodeAgent('')
        }
      }
    })()
    return () => { cancelled = true }
  }, [selectedSession?.sessionId, selectedSession?.provider, selectedSession])
  const composerSlashHint = useMemo(() => {
    if (!composerSlashOpen) return ''
    const provider = selectedSession?.provider ?? 'claude'
    const suggestions = TUI_SLASH_HINTS[provider] ?? TUI_SLASH_HINTS.claude
    return `slash · ${suggestions.join(' · ')}`
  }, [composerSlashOpen, selectedSession?.provider])

  const composerMentionSourceSession = composerTargetSession ?? selectedSession
  const composerMentionSearchSession = useMemo(() => {
    if (!composerMentionSourceSession) return null
    const parentSessionId = composerMentionSourceSession.parentSessionId
    if (!parentSessionId) return composerMentionSourceSession
    const parentSession = sessions.find((session) =>
      session.sessionId === parentSessionId
      && session.provider === composerMentionSourceSession.provider,
    ) ?? openTabSessions.find((session) => session.sessionId === parentSessionId)
      ?? sessions.find((session) => session.sessionId === parentSessionId)
    return parentSession ?? composerMentionSourceSession
  }, [composerMentionSourceSession, openTabSessions, sessions])
  const composerMentionProvider = composerMentionSourceSession?.provider ?? 'claude'
  const composerMentionCwd = composerMentionSearchSession?.cwd ?? composerMentionSourceSession?.cwd ?? null

  useEffect(() => {
    if (!composerMention) {
      setComposerMentionResults([])
      return
    }
    const agentMatches: TuiMentionResult[] = composerMentionProvider === 'opencode'
      ? composerMentionAgents
          .filter((agent) => {
            const query = composerMention.query.toLowerCase()
            if (!query) return true
            return agent.value.toLowerCase().includes(query)
              || agent.label.toLowerCase().includes(query)
              || (agent.description?.toLowerCase().includes(query) ?? false)
          })
          .slice(0, 8)
          .map((agent) => ({
            kind: 'agent' as const,
            name: agent.value,
            description: agent.description,
            mode: agent.mode,
          }))
      : []
    const cwd = composerMentionCwd
    if (!cwd) {
      setComposerMentionResults(agentMatches)
      setComposerMentionIndex(0)
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const all = await listProjectFiles(cwd, runGitCommand)
          if (cancelled) return
          const query = composerMention.query.toLowerCase()
          const fileMatches: Array<{ path: string; basename: string }> = []
          for (const entry of all) {
            if (fileMatches.length >= 12) break
            if (!query) { fileMatches.push(entry); continue }
            const lower = entry.path.toLowerCase()
            const base = entry.basename.toLowerCase()
            if (base === query || base.startsWith(query) || base.includes(query) || lower.includes(query)) {
              fileMatches.push(entry)
            }
          }
          if (fileMatches.length < 12 && query) {
            for (const entry of all) {
              if (fileMatches.length >= 12) break
              if (fileMatches.includes(entry)) continue
              let qi = 0
              for (let i = 0; i < entry.path.length && qi < query.length; i += 1) {
                if (entry.path[i] === query[qi]) qi += 1
              }
              if (qi === query.length) fileMatches.push(entry)
            }
          }
          const matches: TuiMentionResult[] = [
            ...agentMatches,
            ...fileMatches.map((entry) => ({ kind: 'file' as const, ...entry })),
          ]
          setComposerMentionResults(matches)
          setComposerMentionIndex(0)
        } catch {
          if (!cancelled) setComposerMentionResults(agentMatches)
        }
      })()
    }, 60)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [composerMention, composerMentionAgents, composerMentionCwd, composerMentionProvider])

  const ensureComposerPastePartTypeId = useEffectEvent((renderable: TextareaRenderable): number => {
    let typeId = composerPastePartTypeIdRef.current
    if (typeId == null) {
      typeId = renderable.extmarks.registerType('composer-paste')
      composerPastePartTypeIdRef.current = typeId
    }
    return typeId
  })

  const restoreComposerPromptPartExtmarks = useEffectEvent((parts: ComposerPromptPart[], text: string) => {
    const renderable = composerTextareaRef.current
    if (!renderable) return
    renderable.extmarks.clear()
    if (parts.length === 0) return
    const typeId = ensureComposerPastePartTypeId(renderable)
    const styleId = renderable.syntaxStyle?.getStyleId('extmark.paste') ?? undefined
    let cursor = 0
    for (const part of parts) {
      const start = text.indexOf(part.marker, cursor)
      if (start === -1) continue
      const end = start + part.marker.length
      renderable.extmarks.create({
        start,
        end,
        virtual: true,
        styleId,
        typeId,
        data: { partId: part.id },
      })
      cursor = end
    }
  })

  const makeComposerSnapshot = useEffectEvent((): ComposerDraftSnapshot => ({
    text: composerTextareaRef.current?.plainText ?? composerDraft,
    attachments: [...composerMentionAttachments],
    promptParts: [...composerPromptParts],
    cursorOffset: composerTextareaRef.current?.cursorOffset,
  }))

  const applyComposerSnapshot = useEffectEvent((snapshot: ComposerDraftSnapshot) => {
    const text = snapshot.text
    composerTextareaRef.current?.setText(text)
    if (composerTextareaRef.current) composerTextareaRef.current.cursorOffset = snapshot.cursorOffset ?? text.length
    setComposerDraft(text)
    setComposerMentionAttachments(snapshot.attachments)
    setComposerPromptParts(snapshot.promptParts)
    restoreComposerPromptPartExtmarks(snapshot.promptParts, text)
  })

  const appendDiffCommentPromptToComposer = useEffectEvent((prompt: string) => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    const existing = composerTextareaRef.current?.plainText ?? composerDraft
    const separator = existing.length > 0 ? (existing.endsWith('\n') ? '\n' : '\n\n') : ''
    const next = `${existing}${separator}${trimmed}\n\n`
    applyComposerSnapshot({
      text: next,
      attachments: [...composerMentionAttachments],
      promptParts: [...composerPromptParts],
      cursorOffset: next.length,
    })
    setComposerActive(true)
  })

  const sendTranscriptDiffNoteToComposer = useEffectEvent((
    card: TuiTranscriptCard,
    note: TranscriptDiffNote,
    label: string,
    diffText: string | null,
  ) => {
    const context = diffText ?? cardClipboardText(card)
    appendDiffCommentPromptToComposer(buildDiffCommentComposerPrompt({
      filePath: filePathFromDiffText(diffText, card.label),
      range: note.range,
      comment: note.text,
      context,
      source: `Transcript diff card ${label}`,
    }))
  })

  const activeComposerPromptPartRanges = useEffectEvent((text: string, parts: ComposerPromptPart[]): ComposerPromptPartRange[] => {
    const renderable = composerTextareaRef.current
    const typeId = composerPastePartTypeIdRef.current
    const byId = new Map(parts.map((part) => [part.id, part]))
    if (renderable && typeId != null) {
      return renderable.extmarks
        .getAllForTypeId(typeId)
        .flatMap((extmark: { start: number; end: number; data?: { partId?: unknown } }) => {
          const partId = typeof extmark.data?.partId === 'string' ? extmark.data.partId : ''
          const part = byId.get(partId)
          if (!part) return []
          const marker = text.slice(extmark.start, extmark.end) || part.marker
          return [{ ...part, marker, start: extmark.start, end: extmark.end }]
        })
        .sort((a, b) => a.start - b.start)
    }

    let cursor = 0
    const ranges: ComposerPromptPartRange[] = []
    for (const part of parts) {
      const start = text.indexOf(part.marker, cursor)
      if (start === -1) continue
      const end = start + part.marker.length
      ranges.push({ ...part, start, end })
      cursor = end
    }
    return ranges
  })

  const prepareComposerSubmission = useEffectEvent((visibleText: string, attachments: SendAttachment[], parts: ComposerPromptPart[]): ComposerSubmission => {
    const promptPartRanges = activeComposerPromptPartRanges(visibleText, parts)
    let messageText = visibleText
    for (const part of [...promptPartRanges].sort((a, b) => b.start - a.start)) {
      if (part.kind !== 'text') continue
      messageText = `${messageText.slice(0, part.start)}${part.text}${messageText.slice(part.end)}`
    }
    const promptPartAttachments = promptPartRanges
      .filter((part): part is ComposerPromptPartRange & { kind: 'attachment' } => part.kind === 'attachment')
      .map((part) => ({ ...part.attachment, text: part.marker }))
    const promptAttachmentIds = new Set(promptPartAttachments.map((attachment) => attachment.id).filter(Boolean))
    const mentionAttachments = activeMentionAttachments(visibleText, attachments)
      .filter((attachment) => !attachment.id || !promptAttachmentIds.has(attachment.id))
    return {
      visibleText,
      messageText: messageText.trim(),
      attachments: [...mentionAttachments, ...promptPartAttachments],
      promptParts: promptPartRanges.map(({ start: _start, end: _end, ...part }) => part),
    }
  })

  const insertMentionAtCursor = useEffectEvent((entry: TuiMentionResult) => {
    const renderable = composerTextareaRef.current
    if (!renderable || !composerMention) return
    const text = renderable.plainText
    const cursor = renderable.cursorOffset
    const before = text.slice(0, composerMention.start)
    const after = text.slice(cursor)
    const insertion = entry.kind === 'agent'
      ? `@${entry.name} `
      : `@${entry.path} `
    const next = `${before}${insertion}${after}`
    renderable.setText(next)
    renderable.cursorOffset = before.length + insertion.length
    setComposerDraft(next)
    setComposerMentionAttachments((prev) => {
      if (entry.kind === 'agent') {
        if (prev.some((attachment) => attachment.type === 'agent' && attachment.displayName === entry.name)) return prev
        return [
          ...prev,
          {
            id: `agent-${entry.name}`,
            type: 'agent',
            displayName: entry.name,
            text: `@${entry.name}`,
          },
        ]
      }
      if (prev.some((attachment) => attachment.path === entry.path)) return prev
      return [
        ...prev,
        {
          id: `mention-${entry.path}`,
          type: 'mention',
          path: entry.path,
          displayName: entry.basename,
        },
      ]
    })
    setComposerMention(null)
    setComposerMentionResults([])
  })

  const insertSlashAtCursor = useCallback((command: string) => {
    const renderable = composerTextareaRef.current
    if (!renderable) return
    const text = renderable.plainText
    const newlineIdx = text.indexOf('\n')
    const after = newlineIdx === -1 ? '' : text.slice(newlineIdx)
    const insertion = `${command} `
    const next = `${insertion}${after}`
    renderable.setText(next)
    renderable.cursorOffset = insertion.length
    setComposerDraft(next)
    setComposerSlashIndex(0)
  }, [])

  const selectComposerHistoryEntry = useEffectEvent((displayIndex: number) => {
    if (sentHistory.length === 0) return
    const nextDisplayIndex = clamp(displayIndex, 0, sentHistory.length - 1)
    const sourceIndex = sentHistory.length - 1 - nextDisplayIndex
    const replacement = sentHistory[sourceIndex] ?? { text: '', attachments: [], promptParts: [] }
    setComposerHistoryIndex(nextDisplayIndex)
    setHistoryIndex(sourceIndex)
    applyComposerSnapshot(replacement)
  })

  const openComposerHistory = useEffectEvent((displayIndex = 0) => {
    if (sentHistory.length === 0) return
    if (!composerHistoryOpen && historyIndex === -1) {
      setDraftBeforeHistory(makeComposerSnapshot())
    }
    setComposerMention(null)
    setComposerMentionResults([])
    setComposerStashOpen(false)
    setComposerHistoryOpen(true)
    selectComposerHistoryEntry(displayIndex)
  })

  const commitComposerHistory = useCallback(() => {
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
  }, [])

  const cancelComposerHistory = useEffectEvent(() => {
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
    applyComposerSnapshot(draftBeforeHistory)
    setHistoryIndex(-1)
  })

  const moveComposerHistory = useEffectEvent((delta: number) => {
    if (sentHistory.length === 0) return
    if (!composerHistoryOpen) {
      if (delta > 0) {
        const currentDisplayIndex = historyIndex === -1
          ? -1
          : sentHistory.length - 1 - historyIndex
        openComposerHistory(Math.max(currentDisplayIndex + 1, 0))
      } else if (historyIndex !== -1) {
        const currentDisplayIndex = sentHistory.length - 1 - historyIndex
        if (currentDisplayIndex <= 0) {
          cancelComposerHistory()
        } else {
          openComposerHistory(currentDisplayIndex - 1)
        }
      }
      return
    }

    const nextDisplayIndex = composerHistoryIndex + delta
    if (nextDisplayIndex < 0) {
      cancelComposerHistory()
      return
    }
    selectComposerHistoryEntry(nextDisplayIndex)
  })

  const handleComposerContentChange = useEffectEvent(() => {
    const renderable = composerTextareaRef.current
    const text = renderable?.plainText ?? ''
    const cursor = renderable?.cursorOffset ?? text.length
    setComposerDraft(text)
    if (composerDraftStorageKeyRef.current) scheduleWriteComposerDraft(composerDraftStorageKeyRef.current, text)
    if (historyIndex !== -1 && text !== (sentHistory[historyIndex]?.text ?? '')) setHistoryIndex(-1)
    if (composerError) setComposerError(null)
    if (composerSendState === 'error') setComposerSendState('idle')
    const mention = detectMentionAtCursor(text, cursor)
    const dismissedStart = composerMentionDismissedStart
    if (!mention || (dismissedStart !== null && mention.start !== dismissedStart)) {
      if (dismissedStart !== null) setComposerMentionDismissedStart(null)
    }
    setComposerMention((prev) => {
      if (!mention) return prev ? null : prev
      if (dismissedStart !== null && mention.start === dismissedStart) return prev ? null : prev
      if (prev && prev.start === mention.start && prev.query === mention.query) return prev
      setComposerMentionIndex(0)
      return mention
    })
    const firstLine = text.split('\n')[0] ?? ''
    if (!firstLine.startsWith('/')) {
      setComposerSlashIndex(0)
      if (composerSlashDismissed) setComposerSlashDismissed(false)
    }
  })

  const composerMentionVisibleCount = Math.min(composerMentionResults.length, 5)
  const composerSlashVisibleCount = Math.min(composerSlashCommands.length, 5)
  const composerHistoryVisibleCount = Math.min(sentHistory.length, 6)
  const composerStashVisibleCount = Math.min(composerStash.length, 6)
  const composerPopoverHeight = (!composerWindowOpen && composerActive && composerMention && composerMentionVisibleCount > 0)
    ? composerMentionVisibleCount + 3
    : (!composerWindowOpen && composerActive && composerSlashOpen && composerSlashVisibleCount > 0 && !composerMention && !composerHistoryOpen && !composerStashOpen)
    ? composerSlashVisibleCount + 3
    : (!composerWindowOpen && composerActive && composerHistoryOpen && composerHistoryVisibleCount > 0 && !composerMention)
    ? composerHistoryVisibleCount + 3
    : (!composerWindowOpen && composerActive && composerStashOpen && composerStashVisibleCount > 0 && !composerMention)
    ? composerStashVisibleCount + 3
    : 0
  // Status indicators (requesting spinner, subagent tail, live-prompt
  // suggestion, composer status, auto-targeting note) render as siblings
  // *between* the scrollbox and the composer. They each take fixed rows when
  // visible — we must subtract them from mainContentHeight so the transcript
  // shrinks instead of pushing the composer off-screen.
  const hasSubagentTail = useMemo(
    () => Object.values(liveSubagentText).some((t) => t.trim().length > 0),
    [liveSubagentText],
  )
  const activeRunningToolCount = useMemo(
    () => liveToolActivities.reduce((n, a) => (a.status === 'running' ? n + 1 : n), 0),
    [liveToolActivities],
  )
  const hasComposerStatusMessage = Boolean(
    composerError
    || awaitingPersistedTurn
    || queuedComposerSend
    || (composerSendState === 'sending' && (composerLiveText || activeRunningToolCount > 0))
  )
  const composerStatusBlockHeight = (() => {
    let rows = 0
    if (composerSendState === 'sending' && !composerLiveText && activeRunningToolCount === 0) rows += 2
    if (hasSubagentTail) rows += 2
    if (liveToolActivities.length > 0 && activeRunningToolCount > 0) rows += 2
    if (livePromptSuggestion && composerSendState !== 'sending') rows += 2
    if (composerTargetSession?.provider === 'claude' && composerPermissionMode !== 'default') rows += 2
    if (hasComposerStatusMessage) {
      const streamingMarkdown = composerSendState === 'sending' && composerLiveText && syntaxStyle && !composerError
      rows += streamingMarkdown ? 6 : 2
    }
    if (awaitingPersistedTurn) rows += 2
    if (composerAutoTargetingRunning && composerTargetSession) rows += 1
    if ((liveStatus === 'retrying' || liveStatus === 'compacting') && composerSendState === 'sending') rows += 2
    if (composerSendState === 'sending' && composerLiveReasoning.trim()) rows += 2
    if (pendingPermissions.length > 0) {
      const permission = pendingPermissions[0]!
      // border(2) + outer padding(1) + title(1) + options(1) + hint(1)
      let permRows = 6
      if (permission.reason) permRows += 1
      if (permission.command) permRows += 1
      if (permission.url) permRows += 1
      if (permission.paths && permission.paths.length > 0) permRows += 1
      if (permission.diff) permRows += Math.min(permission.diff.split('\n').length, 12)
      rows += permRows
    }
    return rows
  })()
  const mainContentHeight = Math.max(
    height
    - 3
    - (searchMode || sessionSearchMode ? 4 : 1)
    - composerDockHeight
    - composerPopoverHeight
    - composerStatusBlockHeight,
    8,
  )
  const effectiveTaskPanelWidth = taskPanelOpen ? taskPanelWidth : 0
  const maxSidebarWidth = Math.max(MIN_SIDEBAR_WIDTH, width - 4 - 1 - MIN_READER_WIDTH - effectiveTaskPanelWidth - (taskPanelOpen ? 1 : 0))
  const sidebarWidth = showRail ? clamp(sidebarWidthPreference, MIN_SIDEBAR_WIDTH, maxSidebarWidth) : 0
  const rightPaneWidth = Math.max(width - 4 - sidebarWidth - (showRail ? 1 : 0) - effectiveTaskPanelWidth - (taskPanelOpen ? 1 : 0), 40)
  const textareaInnerWidth = Math.max(rightPaneWidth - 4, 10)
  const composerDockTextareaWidth = Math.max(width - 4, 20)
  const composerVisualLineCount = composerDraft.length === 0
    ? 1
    : composerDraft.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / textareaInnerWidth)), 0)
  const composerWindowWidth = Math.max(
    20,
    Math.min(
      Math.max(width - 4, 20),
      Math.max(72, Math.min(COMPOSER_WINDOW_MAX_WIDTH, Math.floor(width * 0.84))),
    ),
  )
  const composerWindowHeight = Math.max(
    10,
    Math.min(
      Math.max(height - 4, 10),
      Math.max(16, Math.min(COMPOSER_WINDOW_MAX_HEIGHT, Math.floor(height * 0.72))),
    ),
  )
  const composerWindowLeft = Math.max(1, Math.floor((width - composerWindowWidth) / 2))
  const composerWindowTop = Math.max(1, Math.floor((height - composerWindowHeight) / 2))
  const composerWindowContentWidth = Math.max(composerWindowWidth - 4, 16)
  const composerWindowTextareaWidth = Math.max(composerWindowContentWidth - 2, 12)
  const composerWindowVisualLineCount = composerDraft.length === 0
    ? 1
    : composerDraft.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / composerWindowTextareaWidth)), 0)
  const composerWindowSuggestionHeight = (composerActive && composerMention && composerMentionVisibleCount > 0)
    ? composerMentionVisibleCount + 3
    : (composerActive && composerSlashOpen && composerSlashVisibleCount > 0 && !composerMention && !composerHistoryOpen && !composerStashOpen)
    ? composerSlashVisibleCount + 3
    : (composerActive && composerHistoryOpen && composerHistoryVisibleCount > 0 && !composerMention)
    ? composerHistoryVisibleCount + 3
    : (composerActive && composerStashOpen && composerStashVisibleCount > 0 && !composerMention)
    ? composerStashVisibleCount + 3
    : 0
  const composerWindowHeaderHeight = 2
  const composerWindowFooterHeight = 2
  const composerWindowEditorHeight = Math.max(
    4,
    composerWindowHeight - composerWindowHeaderHeight - composerWindowFooterHeight - composerWindowSuggestionHeight - 2,
  )

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
    const profileStart = CARD_PROFILE ? performance.now() : 0
    let recomputed = 0
    const result = visibleTranscriptCards.map((card) => {
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
      recomputed += 1
      const bodyLines = renderedBodyLines(card, isExpanded, densityState.bodyLines, thinkingFull)
      const diffView = cardDiffView(card, isExpanded)
      const codeBlockLineCounts = (isExpanded && card.codeBlocks)
        ? card.codeBlocks.map((cb) => countCodeBlockLines(cb.content))
        : []
      const value: StableCardData = { bodyLines, diffView, codeBlockLineCounts }
      cache.set(card, { isExpanded, bodyLineLimit: densityState.bodyLines, thinkingFull, value })
      return value
    })
    if (CARD_PROFILE) {
      logCardRecompute({
        scope: 'stableCardData',
        totalCards: visibleTranscriptCards.length,
        recomputed,
        liveCards: liveTranscriptMessagesForSession.length,
        durationMs: performance.now() - profileStart,
      })
    }
    return result
  }, [visibleTranscriptCards, resolvedExpandedKeys, densityState.bodyLines, thinkingFullKeys])

  const allLandmarksRef = useRef<CardLandmark[][] | null>(null)
  const allLandmarks = useMemo(() => {
    const next = computeAllLandmarks(
      visibleTranscriptCards,
      resumeMarkerIndex,
      unreadBoundaryIndex,
      pendingNewCount,
      allLandmarksRef.current,
    )
    allLandmarksRef.current = next
    return next
  }, [visibleTranscriptCards, resumeMarkerIndex, unreadBoundaryIndex, pendingNewCount])

  const cardDisplayCacheRef = useRef(new WeakMap<TuiTranscriptCard, {
    inputs: {
      isExpanded: boolean
      isLatest: boolean
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
    const profileStart = CARD_PROFILE ? performance.now() : 0
    let recomputed = 0
    const result = visibleTranscriptCards.map((card, index) => {
      const isExpanded = resolvedExpandedKeys.has(card.key)
      const isLatest = index === visibleTranscriptCards.length - 1
      const isAutoFoldedTechnical = transcriptView === 'conversation' && card.autoFold && !isExpanded
      const landmarks = allLandmarks[index] ?? EMPTY_LANDMARKS
      const stable = stableCardData[index] ?? {
        bodyLines: [],
        diffView: null,
        codeBlockLineCounts: [],
      }
      const providerKey = card.provider ?? provider

      const prev = cache.get(card)
      if (
        prev
        && prev.inputs.isExpanded === isExpanded
        && prev.inputs.isLatest === isLatest
        && prev.inputs.isAutoFoldedTechnical === isAutoFoldedTechnical
        && prev.inputs.landmarks === landmarks
        && prev.inputs.stable === stable
        && prev.inputs.providerKey === providerKey
        && prev.inputs.syntaxEnabled === shouldEnableSyntaxHighlighting
      ) {
        return prev.value
      }
      recomputed += 1

      const headerMeta = joinMeta([
        card.timestamp ?? null,
        isLatest ? 'latest' : null,
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
      const markdownFallbackLines = (isExpanded && card.markdownContent && !card.hasMermaidDiagrams && !shouldEnableSyntaxHighlighting)
        ? card.markdownContent.split('\n')
        : null
      const value: CardDisplayData = {
        landmarks,
        bodyLines: stable.bodyLines,
        diffView: stable.diffView,
        codeBlockLineCounts: stable.codeBlockLineCounts,
        headerMeta,
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
    if (CARD_PROFILE) {
      logCardRecompute({
        scope: 'cardDisplayData',
        totalCards: visibleTranscriptCards.length,
        recomputed,
        liveCards: liveTranscriptMessagesForSession.length,
        durationMs: performance.now() - profileStart,
      })
    }
    return result
  }, [
    allLandmarks,
    stableCardData,
    visibleTranscriptCards,
    resolvedExpandedKeys,
    transcriptView,
    provider,
    shouldEnableSyntaxHighlighting,
  ])
  const imessageStyle = themeMode === 'imessage'

  // Memoize the full list of <TranscriptCard /> elements so unrelated
  // re-renders (composer input, notice banner, theme menu, status tick, etc.)
  // don't rebuild N elements + run N React.memo comparisons. Only deps that
  // actually change what a card displays belong here.
  //
  // isSearchHit is derived here from searchMatches (instead of living on
  // CardDisplayData) so search-query changes don't invalidate cardDisplayData
  // — they only re-run this memo, whose per-card work is cheap (Set lookup).
  const searchMatchSet = useMemo(() => new Set(searchMatches), [searchMatches])
  const activeMatchTargetIndex = searchMatches[searchMatchIndex] ?? -1
  const transcriptChildren = useMemo(() => (
    visibleTranscriptCards.map((card, index) => {
      const display = cardDisplayData[index]
      if (!display) return null
      const isSelected = card.key === transcriptCursorKey
      const hasCursor = isSelected && effectiveFocus === 'messages'
      const isExpanded = resolvedExpandedKeys.has(card.key)
      const isSearchHit = searchMatchSet.has(index)
      const isActiveMatch = isSearchHit && activeMatchTargetIndex === index
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
          isSearchHit={isSearchHit}
          isActiveMatch={isActiveMatch}
          bookmarked={bookmarkKeys.has(card.key)}
          onSelectCard={selectTranscriptCard}
          thinkingMode={thinkingMode}
          diffLayout={diffLayout}
          imessageStyle={imessageStyle}
          streamMode={transcriptView === 'stream'}
          noteNamespace={selectedSessionIdentity ?? 'no-session'}
          diffNotes={transcriptDiffNotes}
          diffDraft={transcriptDiffDraft}
          hoveredDiffAnchor={hoveredTranscriptDiffAnchor}
          activateDiffHover={activateTranscriptDiffHover}
          openDiffNote={openTranscriptDiffNote}
          sendDiffNoteToComposer={sendTranscriptDiffNoteToComposer}
          diffPlain={transcriptDiffPlainCardKeys.has(card.key)}
          diffShowLineNumbers={!transcriptDiffHiddenLineNumberCardKeys.has(card.key)}
          diffShowHunkHeaders={!transcriptDiffHiddenHunkHeaderCardKeys.has(card.key)}
          diffRowCursor={transcriptDiffRowCursorByCardKey[card.key] ?? 0}
          diffSelectionAnchor={transcriptDiffSelectionAnchorByCardKey[card.key] ?? null}
          setDiffRowCursor={setTranscriptDiffRowCursorForCard}
          setDiffSelectionAnchor={setTranscriptDiffSelectionAnchorForCard}
        />
      )
    })
  ), [
    visibleTranscriptCards,
    cardDisplayData,
    transcriptCursorKey,
    effectiveFocus,
    resolvedExpandedKeys,
    searchMatchSet,
    activeMatchTargetIndex,
    bookmarkKeys,
    selectTranscriptCard,
    theme,
    densityState,
    syntaxStyle,
    rightPaneWidth,
    thinkingMode,
    diffLayout,
    imessageStyle,
    transcriptView,
    selectedSessionIdentity,
    transcriptDiffNotes,
    transcriptDiffDraft,
    hoveredTranscriptDiffAnchor,
    activateTranscriptDiffHover,
    openTranscriptDiffNote,
    sendTranscriptDiffNoteToComposer,
    transcriptDiffPlainCardKeys,
    transcriptDiffHiddenLineNumberCardKeys,
    transcriptDiffHiddenHunkHeaderCardKeys,
    transcriptDiffRowCursorByCardKey,
    setTranscriptDiffSelectionAnchorForCard,
    setTranscriptDiffRowCursorForCard,
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
          // Draft sessions (pending provider sessions after N, or any session that's
          // been opened as a tab but not yet materialised server-side) live
          // in openTabSessions, not `sessions`. If we clobber a draft
          // selection here, pressing N silently lands the user on the first
          // server session instead of the new welcome tab.
          const isDraftTab = (key: string | null) => Boolean(
            key && openTabSessionsRef.current.some((tab) => sessionKey(tab) === key)
          )
          if (nextSessions.length === 0) {
            return isDraftTab(current) ? current : null
          }
          if (preserveSelection && current) {
            const matched = nextSessions.find((session) => sessionKey(session) === current)
            if (matched) return sessionKey(matched)
            if (isDraftTab(current)) return current
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

  const markSessionRunning = useCallback((ref: RunningSessionRef) => {
    setRunningSessions((prev) => {
      if (prev.some((entry) => entry.sessionId === ref.sessionId && entry.provider === ref.provider)) return prev
      return [...prev, ref]
    })
  }, [])

  const clearSessionRunning = useCallback((ref: RunningSessionRef) => {
    setRunningSessions((prev) => {
      const next = prev.filter((entry) => !(entry.sessionId === ref.sessionId && entry.provider === ref.provider))
      return next.length === prev.length ? prev : next
    })
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
    if (!foreground && liveTranscriptBaselineRef.current.has(cacheKeyForGuards) && !awaitingPersistedTurnRef.current) return

    // Skip background polls when the session file hasn't changed since the
    // cached detail was populated — avoids re-reading and re-threading the
    // full message file every interval for idle sessions. Worst case the
    // sidebar's lastModified is stale and we skip one poll; the next sidebar
    // refresh catches us up.
    if (!foreground && !awaitingPersistedTurnRef.current && typeof session.lastModified === 'number') {
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
      const detail = await readTuiSessionDetailAsync(session, densityRef.current, showToolCallsRef.current)
      if (requestId !== detailRequestRef.current) return
      const liveBaseline = liveTranscriptBaselineRef.current.get(cacheKeyForGuards)
      if (liveBaseline) {
        const durableMessages = detail.rawMessages.filter(isDurableSessionMessage)
        const lastFingerprint = sessionMessageFingerprint(durableMessages.at(-1))
        const sequenceFingerprint = sessionMessageSequenceFingerprint(durableMessages)
        const persistedTurnArrived =
          durableMessages.length > liveBaseline.count
          || lastFingerprint !== liveBaseline.lastFingerprint
          || sequenceFingerprint !== liveBaseline.sequenceFingerprint
        if (persistedTurnArrived) {
          const liveAssistantVisible = Boolean(pendingLiveTextRef.current.trim())
            || hasLiveAssistantMessage(liveTranscriptMessagesRef.current, cacheKeyForGuards)
          if (liveAssistantVisible && !hasPersistedAssistantAfterBaseline(detail.rawMessages, liveBaseline.count)) {
            setLiveTranscriptMessages((prev) => {
              const next = prev.filter((message) => !(liveMessageSessionKey(message) === cacheKeyForGuards && message.role === 'user'))
              return next.length === prev.length ? prev : next
            })
          } else {
            liveTranscriptBaselineRef.current.delete(cacheKeyForGuards)
            setLiveTranscriptMessages((prev) => prev.filter((message) => liveMessageSessionKey(message) !== cacheKeyForGuards))
            liveToolIndexesRef.current.clear()
            liveToolInputJsonRef.current.clear()
            setComposerLiveText('')
            setAwaitingPersistedTurn(false)
          }
        }
      }
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
            sessionMessageSequenceFingerprint(prev.rawMessages) === sessionMessageSequenceFingerprint(detail.rawMessages) &&
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

  const jumpToTranscriptTail = useCallback(() => {
    if (visibleTranscriptCards.length === 0) return
    const lastIndex = visibleTranscriptCards.length - 1
    jumpToTranscriptIndex(lastIndex)
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
  }, [jumpToTranscriptIndex, visibleTranscriptCards])

  const jumpToUnreadBoundary = useEffectEvent(() => {
    if (unreadBoundaryIndex >= 0) {
      jumpToTranscriptIndex(unreadBoundaryIndex)
      return
    }
    jumpToTranscriptTail()
  })

  const jumpToResumeMarker = useEffectEvent(() => {
    const index = resumeMarkerKey ? (transcriptIndexByKey.get(resumeMarkerKey) ?? -1) : -1
    if (index >= 0) jumpToTranscriptIndex(index)
  })

  const moveSelection = useEffectEvent((delta: number) => {
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
  })

  const moveCursor = useEffectEvent((delta: number) => {
    if (visibleTranscriptCards.length === 0) return
    const nextIndex = clamp((cursorIndex >= 0 ? cursorIndex : 0) + delta, 0, visibleTranscriptCards.length - 1)
    setTranscriptCursorKey(visibleTranscriptCards[nextIndex].key)
    const atTail = nextIndex === visibleTranscriptCards.length - 1
    setFollowTail(atTail)
    if (atTail) {
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
    }
  })

  // Returns the number of cards to move for one j/k/↑/↓ tick. With velocity
  // scroll off (or on a fresh tap) this is just 1; while the same direction
  // keeps repeating, the step eases from 1 up to VELOCITY_SCROLL_MAX_STEP over
  // VELOCITY_SCROLL_RAMP_MS — a quadratic ease-in so the ramp feels gradual
  // rather than snapping straight to top speed.
  const velocityScrollStep = useEffectEvent((direction: -1 | 1): number => {
    if (!velocityScrollEnabled) return 1
    const now = performance.now()
    const state = velocityScrollStateRef.current
    if (!state || state.direction !== direction || now - state.lastEventTime > VELOCITY_SCROLL_RESET_MS) {
      velocityScrollStateRef.current = { direction, streakStart: now, lastEventTime: now }
      return 1
    }
    state.lastEventTime = now
    const t = clamp((now - state.streakStart) / VELOCITY_SCROLL_RAMP_MS, 0, 1)
    const eased = t * t
    return Math.max(1, Math.round(1 + (VELOCITY_SCROLL_MAX_STEP - 1) * eased))
  })

  const moveViewport = useEffectEvent((direction: -1 | 1) => {
    const step = Math.max(Math.floor((height - (focusMode ? 5 : 7)) / 3), 1)
    moveCursor(direction * step)
  })

  const jumpToMatchingCard = useEffectEvent((direction: -1 | 1, predicate: (card: TuiTranscriptCard) => boolean) => {
    if (visibleTranscriptCards.length === 0) return
    let index = cursorIndex >= 0 ? cursorIndex + direction : direction > 0 ? 0 : visibleTranscriptCards.length - 1
    while (index >= 0 && index < visibleTranscriptCards.length) {
      if (predicate(visibleTranscriptCards[index])) {
        jumpToTranscriptIndex(index)
        return
      }
      index += direction
    }
  })

  const jumpToSearchMatch = useEffectEvent((matchOffset: number) => {
    if (searchMatches.length === 0) return
    const nextMatchIndex = (searchMatchIndex + matchOffset + searchMatches.length) % searchMatches.length
    setSearchMatchIndex(nextMatchIndex)
    jumpToTranscriptIndex(searchMatches[nextMatchIndex] ?? 0)
  })

  const toggleExpansion = useEffectEvent(() => {
    const card = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
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
  })

  const closeProviderMenu = useCallback(() => {
    setProviderMenuOpen(false)
    setProviderMenuIndex(Math.max(PROVIDERS.indexOf(provider), 0))
  }, [provider])

  const openThemeMenu = useEffectEvent(() => {
    themeMenuOriginRef.current = themeMode
    setThemeMenuIndex(Math.max(THEMES.indexOf(themeMode), 0))
    setThemeMenuGroup(LIGHT_MODES.includes(themeMode) ? 'light' : 'dark')
    setThemeMenuOpen(true)
  })

  const closeThemeMenu = useEffectEvent(() => {
    const originTheme = themeMenuOriginRef.current
    setThemeMenuOpen(false)
    if (originTheme) {
      setThemeMode(originTheme)
      setThemeMenuIndex(Math.max(THEMES.indexOf(originTheme), 0))
    } else {
      setThemeMenuIndex(Math.max(THEMES.indexOf(themeMode), 0))
    }
    themeMenuOriginRef.current = null
  })

  const chooseTheme = useCallback((nextTheme: TuiThemeMode) => {
    setThemeMode(nextTheme)
    setThemeMenuIndex(Math.max(THEMES.indexOf(nextTheme), 0))
    themeMenuOriginRef.current = null
    void writeTuiTheme(nextTheme).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store theme')
    })
    setThemeMenuOpen(false)
  }, [])

  const persistTheme = useCallback(() => {
    try { writeTuiThemeSync(currentThemeRef.current) } catch { /* best-effort */ }
  }, [])

  const confirmExit = useCallback(() => {
    if (exitInProgressRef.current) return
    exitInProgressRef.current = true
    setExitCleanupInProgress(true)
    setQueuedComposerSend(null)

    const cleanupPromise = activeComposerSendCleanupRef.current
    const controller = composerAbortRef.current
    const runningRefs = [...runningSessionsRef.current]
    if (controller && !controller.signal.aborted) controller.abort()

    void (async () => {
      const cleanupTasks: Promise<unknown>[] = []
      if (runningRefs.length > 0) {
        cleanupTasks.push(Promise.allSettled(runningRefs.map((running) => interruptTuiSessionTurn(running))))
      }
      if (cleanupPromise) {
        cleanupTasks.push(cleanupPromise.catch(() => undefined))
      }
      if (cleanupTasks.length > 0) {
        await Promise.race([
          Promise.all(cleanupTasks).then(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, EXIT_CLEANUP_TIMEOUT_MS)),
        ])
      }
      persistTheme()
      renderer.destroy()
      process.exit(0)
    })()
  }, [persistTheme, renderer])

  const requestExit = useCallback(() => {
    setExitConfirmOpen(true)
  }, [])

  const cancelExit = useCallback(() => {
    if (exitInProgressRef.current) return
    setExitConfirmOpen(false)
  }, [])

  // Open the composer settings overlay. Model metadata stays provider-owned;
  // the TUI only filters the reported effort levels to values each backend
  // accepts, then applies both settings to the next send.
  const openModelPicker = useEffectEvent(async () => {
    const target = composerTargetSession ?? selectedSession
    if (!target) {
      setNotice({ tone: 'info', text: 'Pick a session first' })
      return
    }
    setModelPickerTarget(target)
    setModelPickerFocus('model')
    setModelPickerError(null)
    setModelPickerOptions([])
    setModelPickerIndex(0)
    setModelPickerLoading(true)
    setModelPickerOpen(true)
    try {
      const meta = await readTuiSessionMetadata(target)
      const options = meta.models
        .filter((m): m is { value: string; displayName?: string; description?: string } & typeof m =>
          typeof m.value === 'string' && m.value.length > 0)
        .map((m): ModelPickerOption => ({
          name: m.displayName || m.value,
          value: m.value,
          description: m.description ?? '',
          supportsEffort: m.supportsEffort,
          supportedEffortLevels: m.supportedEffortLevels,
        }))
      if (options.length === 0) {
        setModelPickerError('No models reported by provider')
        setModelPickerOptions([])
        setModelPickerIndex(0)
        return
      }
      const currentValue = tuiModelOverride[sessionKey(target)] ?? meta.currentModel ?? options[0]!.value
      const idx = Math.max(0, options.findIndex((o) => o.value === currentValue))
      setModelPickerOptions(options)
      setModelPickerIndex(idx >= 0 ? idx : 0)
    } catch (err) {
      setModelPickerError(err instanceof Error ? err.message : 'Failed to load models')
    } finally {
      setModelPickerLoading(false)
    }
  })

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
    currentThemeRef.current = themeMode
  }, [themeMode])

  useEffect(() => {
    const onInterrupt = () => {
      if (exitConfirmOpenRef.current) {
        confirmExit()
        return
      }
      setExitConfirmOpen(true)
    }
    const onTerminate = () => {
      confirmExit()
    }
    process.on('exit', persistTheme)
    process.on('SIGINT', onInterrupt)
    process.on('SIGTERM', onTerminate)
    process.on('SIGHUP', onTerminate)
    return () => {
      process.off('exit', persistTheme)
      process.off('SIGINT', onInterrupt)
      process.off('SIGTERM', onTerminate)
      process.off('SIGHUP', onTerminate)
    }
  }, [confirmExit, persistTheme])

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
  const commandPaletteTopOffset = focusMode ? 2 : 4
  const commandPaletteBodyRows = Math.max(1, Math.min(
    paletteDisplayRows.length || 1,
    mainContentHeight - commandPaletteTopOffset - 8,
  ))

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
  const selectTabSession = useEffectEvent((session: Session) => {
    const targetProvider: ProviderSelection = session.provider ?? 'claude'
    if (provider !== 'all' && targetProvider !== provider) {
      void chooseProvider(targetProvider, session)
      return
    }
    setSelectedSessionKey(sessionKey(session))
  })

  const refreshDiagnostics = useEffectEvent(async () => {
    if (!selectedSession) return
    setDiagnosticsLoading(true)
    setDiagnosticsError(null)
    try {
      const data = await readTuiSessionDiagnostics(selectedSession)
      setDiagnosticsSections(data.sections ?? [])
    } catch (err) {
      setDiagnosticsError(err instanceof Error ? err.message : 'Failed to load diagnostics')
    } finally {
      setDiagnosticsLoading(false)
    }
  })

  const openDiagnostics = useEffectEvent(() => {
    setDiagnosticsOpen(true)
    setDiagnosticsMcpIndex(0)
    void refreshDiagnostics()
  })

  const closeDiagnostics = useCallback(() => {
    setDiagnosticsOpen(false)
    setDiagnosticsError(null)
    setDiagnosticsBusy(null)
  }, [])

  const runDiagnosticsAction = useEffectEvent(async (action: string, extra: Record<string, unknown>, busyKey: string) => {
    if (!selectedSession || selectedSession.provider !== 'claude') return
    setDiagnosticsBusy(busyKey)
    setDiagnosticsError(null)
    try {
      await runTuiSessionAction(selectedSession, { action, ...extra })
      await refreshDiagnostics()
    } catch (err) {
      setDiagnosticsError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setDiagnosticsBusy(null)
    }
  })

  // Fire-and-forget push of model/permission changes through the actions
  // route, mirroring MessageView.tsx. For warm Claude sessions the server's
  // claudePool applies these live via setModel/setPermissionMode on the
  // persistent Query; otherwise the change still rides on the next send's
  // body. Skips when no Claude target, or when the target is still pending.
  const pushClaudeControl = useCallback((
    target: Session | null | undefined,
    body: Record<string, unknown>,
  ): void => {
    if (!target || target.provider !== 'claude' || target.isPending) return
    void runTuiSessionAction(target, body).catch(() => { /* swallow */ })
  }, [])

  const setClaudeComposerPermissionMode = useEffectEvent((target: Session | null | undefined, nextMode: TuiPermissionMode) => {
    if (!target || target.provider !== 'claude') return
    const targetKey = sessionKey(target)
    setTuiPermissionModeByKey((prev) => {
      const next = prev[targetKey] === nextMode ? prev : { ...prev, [targetKey]: nextMode }
      tuiPermissionModeByKeyRef.current = next
      return next
    })
    pushClaudeControl(target, { action: 'setPermissionMode', permissionMode: nextMode })
  })

  const cycleClaudeComposerPermissionMode = useEffectEvent((target: Session | null | undefined) => {
    if (!target || target.provider !== 'claude') return
    const current = tuiPermissionModeByKeyRef.current[sessionKey(target)] ?? 'default'
    const currentIndex = CLAUDE_PERMISSION_MODE_ORDER.indexOf(current)
    const next = CLAUDE_PERMISSION_MODE_ORDER[(currentIndex + 1) % CLAUDE_PERMISSION_MODE_ORDER.length]!
    setClaudeComposerPermissionMode(target, next)
  })

  const cancelComposerSend = useEffectEvent(() => {
    const target = composerTargetSession
    // Turns are decoupled from the client connection (they survive disconnect),
    // so aborting the local fetch alone leaves the agent running on the server —
    // it would finish in the background and reappear on the next poll. Interrupt
    // the server-side turn too, matching the native CLI's Esc/Ctrl+C behavior.
    if (target && !target.isPending) {
      void interruptTuiSessionTurn({ sessionId: target.sessionId }).catch(() => { /* best effort */ })
    }
    // Cancel any pending transient auto-retry so it can't fire after an explicit stop.
    if (composerRetryTimerRef.current) {
      clearTimeout(composerRetryTimerRef.current)
      composerRetryTimerRef.current = null
    }
    composerRetryCountRef.current = 0
    const targetKey = target ? sessionKey(target) : null
    // Confirmed interrupt: if the turn had started (a live baseline exists),
    // keep what the agent produced visible and hand off to the awaitingPersistedTurn
    // 'Syncing…' reconcile so the partial output settles smoothly instead of
    // vanishing and reappearing on the next poll. The send's AbortError handler
    // checks composerInterruptPendingRef to avoid undoing this. The awaiting
    // timeout (AWAITING_PERSISTED_TURN_TIMEOUT_MS) is the escape hatch.
    const reconcileInterrupt = Boolean(targetKey && liveTranscriptBaselineRef.current.has(targetKey))
    composerInterruptPendingRef.current = reconcileInterrupt
    if (composerAbortRef.current) {
      composerAbortRef.current.abort()
    }
    composerAbortRef.current = null
    setInterruptPressActive(false)
    if (interruptPressTimeoutRef.current) {
      clearTimeout(interruptPressTimeoutRef.current)
      interruptPressTimeoutRef.current = null
    }
    setPendingPermissions([])
    setPermissionOptionIndex(0)
    if (reconcileInterrupt) {
      // Keep committed partial cards (liveTranscriptMessages) + baseline for the
      // reconcile, but drop the transient streaming previews right away.
      setComposerSendState('idle')
      setAwaitingPersistedTurn(true)
      setLiveStatus(null)
      setComposerLiveText('')
      setComposerLiveReasoning('')
      pendingLiveReasoningRef.current = ''
      return
    }
    // Nothing started yet — clear cleanly.
    if (targetKey) {
      liveTranscriptBaselineRef.current.delete(targetKey)
      setLiveTranscriptMessages((prev) => prev.filter((message) => liveMessageSessionKey(message) !== targetKey))
    }
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
    if (liveTextFlushFrameRef.current != null) {
      cancelAnimationFrame(liveTextFlushFrameRef.current)
      liveTextFlushFrameRef.current = null
    }
    pendingLiveTextRef.current = ''
    pendingLiveReasoningRef.current = ''
    liveTextTargetSessionRef.current = null
    setComposerSendState('idle')
    setComposerLiveText('')
    setComposerLiveReasoning('')
    setLiveStatus(null)
    setLiveSubagentText({})
    setLiveToolActivities([])
  })

  const backgroundComposerTasks = useEffectEvent(async () => {
    const target = composerTargetSession
    if (!target || target.provider !== 'claude' || target.isPending || backgroundingTasks) return
    setBackgroundingTasks(true)
    try {
      const result = await runTuiSessionAction(target, { action: 'backgroundTasks', provider: 'claude' })
      const backgrounded = result.backgrounded === true
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current)
      setNotice({
        tone: 'info',
        text: backgrounded ? 'Claude task moved to background' : 'No foreground Claude task to background',
      })
      noticeTimeoutRef.current = setTimeout(() => {
        setNotice((current) => current?.text.includes('background') ? null : current)
        noticeTimeoutRef.current = null
      }, 3500)
    } catch (err) {
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current)
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Failed to background Claude task' })
    } finally {
      setBackgroundingTasks(false)
    }
  })

  const respondToTuiPermission = useEffectEvent(async (permission: PendingPermission, response: PermissionResponse) => {
    const target = composerTargetSession
    if (!target || permissionActionLoading) return
    setPermissionActionLoading(permission.id)
    try {
      await runTuiSessionAction(
        { ...target, sessionId: permission.sessionId ?? target.sessionId },
        { action: 'respondPermission', permissionId: permission.id, response, provider: target.provider },
      )
      setPendingPermissions((prev) => prev.filter((entry) => entry.id !== permission.id))
      setPermissionOptionIndex(0)
    } catch (err) {
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current)
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Failed to respond to permission' })
    } finally {
      setPermissionActionLoading(null)
    }
  })

  // Keep the ref in sync on every render so commitRename always reads the latest draft,
  // regardless of which version of the callback is held by onSubmit or the keyboard handler.
  renameDraftRef.current = renameDraft

  const commitRename = useEffectEvent(async () => {
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
  })

  // Build the sidebar row elements once per relevant-state change instead of
  // on every App render. The per-row formatting (fitText/timeAgo/joinMeta/
  // formatSessionTitle/getProviderAccent) is O(sessions) and previously re-ran
  // on every 2s poll, keystroke, and live-stream RAF flush; a stable element
  // array also lets OpenTUI's reconciler bail on the whole subtree when nothing
  // here changed. `timeAgo` output refreshes whenever sidebarEntries does (the
  // 5s sessions poll produces a new array), which is frequent enough.
  const sidebarRowElements = useMemo(() => sidebarEntries.map((entry) => {
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
  }), [sidebarEntries, selectedIndex, theme, density, sidebarInnerWidth, renameSessionKey, renameDraft, commitRename])

  // Stable scrollbar config objects so the two long-lived <scrollbox>
  // renderables don't see a fresh prop reference on every render.
  const sidebarScrollbarOptions = useMemo(
    () => ({ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface } }),
    [theme.muted, theme.surface],
  )
  const transcriptScrollbarOptions = useMemo(
    () => ({ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }),
    [theme.muted, theme.surface2],
  )
  const flushLiveText = useCallback(() => {
    liveTextFlushFrameRef.current = null
    const text = pendingLiveTextRef.current
    const session = liveTextTargetSessionRef.current
    if (!session) return
    setComposerLiveText(text)
    setComposerLiveReasoning(pendingLiveReasoningRef.current)
  }, [])

  const sendComposerMessage = useCallback(async (draftOverride?: string, attachmentsOverride?: SendAttachment[], isRetry?: boolean) => {
    const visibleText = draftOverride ?? composerDraft
    const submission = attachmentsOverride
      ? {
          visibleText,
          messageText: visibleText.trim(),
          attachments: attachmentsOverride,
          promptParts: [],
        }
      : prepareComposerSubmission(visibleText, composerMentionAttachments, composerPromptParts)
    const trimmed = submission.messageText
    if ((!trimmed && submission.attachments.length === 0) || !composerTargetSession) return
    const sendAttachments = submission.attachments
    // Native CLIs queue a follow-up prompt while the active turn streams.
    // Mirror that here: when sending, stash this draft and flush it after. A
    // transient auto-retry bypasses the queue — the prior (failed) turn already
    // settled, composerSendState just hasn't been cleared yet across the backoff.
    if (!isRetry && composerSendState === 'sending') {
      setQueuedComposerSend({ text: trimmed, attachments: sendAttachments })
      composerTextareaRef.current?.setText('')
      setComposerDraft('')
      setComposerMentionAttachments([])
      setComposerPromptParts([])
      composerTextareaRef.current?.extmarks.clear()
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      return
    }

    if (!isRetry) composerRetryCountRef.current = 0
    composerTurnProducedOutputRef.current = false

    const targetSession = composerTargetSession
    const controller = new AbortController()
    const sendStartedAt = Date.now()
    let resolveTurnCleanup: () => void = () => {}
    const turnCleanupPromise = new Promise<void>((resolve) => {
      resolveTurnCleanup = resolve
    })
    activeComposerSendCleanupRef.current = turnCleanupPromise
    composerAbortRef.current = controller
    setComposerSendState('sending')
    setComposerSendStartedAt(sendStartedAt)
    setComposerWaitingSeed(`${targetSession.provider ?? 'claude'}:${targetSession.sessionId}:${sendStartedAt}:${trimmed}`)
    setComposerError(null)
    flushLiveText() // flush any stale pending text
    pendingLiveTextRef.current = ''
    pendingLiveReasoningRef.current = ''
    liveTextTargetSessionRef.current = targetSession
    if (liveTextFlushFrameRef.current != null) {
      cancelAnimationFrame(liveTextFlushFrameRef.current)
      liveTextFlushFrameRef.current = null
    }
    setComposerLiveText('')
    setComposerLiveReasoning('')
    setLivePromptSuggestion(null)
    setLiveStatus(null)
    setLiveSubagentText({})
    setLiveOutputTokens(0)
    setLiveToolActivities([])
    setPendingPermissions([])
    setPermissionOptionIndex(0)
    const runningRef: RunningSessionRef = {
      sessionId: targetSession.sessionId,
      provider: targetSession.provider ?? 'claude',
    }
    markSessionRunning(runningRef)
    const targetKey = sessionKey(targetSession)
    const baselineDetail = sessionDetailCacheRef.current.get(targetKey)
      ?? (selectedSessionKeyRef.current === targetKey ? sessionDetail : null)
    const baselineMessages = baselineDetail?.rawMessages.filter(isDurableSessionMessage) ?? []
    liveTranscriptBaselineRef.current.set(targetKey, {
      count: baselineMessages.length,
      lastFingerprint: sessionMessageFingerprint(baselineMessages.at(-1)),
      sequenceFingerprint: sessionMessageSequenceFingerprint(baselineMessages),
    })
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
    setLiveTranscriptMessages((prev) => [
      ...prev.filter((message) => liveMessageSessionKey(message) !== targetKey),
      makeLiveUserMessage(targetSession, trimmed),
    ])
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let replyAccumulator = ''
    let codexLiveMessageAccumulator = ''
    let copilotFinalMessageSeen = false

    try {
      const overrideModel = tuiModelOverride[sessionKey(targetSession)]
      const res = await streamTuiSessionTurn(
        targetSession,
        {
          message: trimmed,
          provider: targetSession.provider,
          taskBudgetTokens: taskBudgetTokens ?? undefined,
          isPendingSession: targetSession.isPending === true ? true : undefined,
          cwd: targetSession.cwd ?? undefined,
          attachments: sendAttachments.length > 0 ? sendAttachments : undefined,
          model: overrideModel || undefined,
          agent: targetSession.provider === 'opencode' && tuiOpenCodeAgent
            ? tuiOpenCodeAgent
            : undefined,
          effort: tuiEffort === 'auto' ? undefined : tuiEffort,
          mode: targetSession.provider === 'copilot'
            ? tuiCopilotMode
            : undefined,
          permissionMode: targetSession.provider === 'claude' && composerPermissionMode !== 'default'
            ? composerPermissionMode
            : undefined,
          // Claude/Copilot only emit interactive tool-approval prompts when the
          // client opts in. OpenCode/Codex surface them automatically.
          // bypass/plan handle all tool decisions via permissionMode — no bridge.
          manualPermissions: targetSession.provider === 'copilot'
            || (targetSession.provider === 'claude' && composerPermissionMode !== 'bypassPermissions' && composerPermissionMode !== 'plan')
            ? true : undefined,
        },
        controller.signal,
      )

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }

      reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')
      const decoder = new TextDecoder()
      let sseBuffer = ''

      const activeSubagentIdRef = { current: '' }

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
          const usage = parsed as ContextUsage
          touchMapEntry(sessionContextUsageCacheRef.current, sessionKey(targetSession), usage)
          setContextUsage(usage)
          return
        }
        if (frame.event === 'turn-usage' && parsed && typeof parsed === 'object') {
          const outputTokens = (parsed as { outputTokens?: unknown }).outputTokens
          if (typeof outputTokens === 'number' && Number.isFinite(outputTokens)) {
            setLiveOutputTokens(Math.max(0, outputTokens))
          }
          return
        }
        // Non-fatal turn notice (e.g. an MCP elicitation prompt). Surface it as a
        // transient banner without disturbing the live turn state.
        if (frame.event === 'turn-notice' && parsed) {
          const message = (parsed as { message?: unknown }).message
          if (typeof message === 'string' && message.trim()) setNotice({ tone: 'info', text: message.trim() })
          return
        }
        if (frame.event === 'session' && parsed) {
          const evt = parsed as { sessionId?: unknown }
          if (typeof evt.sessionId === 'string' && evt.sessionId && targetSession.isPending) {
            const realId = evt.sessionId
            const oldKey = sessionKey(targetSession)
            const updated: Session = { ...targetSession, sessionId: realId, isPending: false }
            const newKey = sessionKey(updated)
            const baseline = liveTranscriptBaselineRef.current.get(oldKey)
            if (baseline) {
              liveTranscriptBaselineRef.current.delete(oldKey)
              liveTranscriptBaselineRef.current.set(newKey, baseline)
            }
            setLiveTranscriptMessages((prev) => prev.map((message) =>
              liveMessageSessionKey(message) === oldKey
                ? { ...message, sessionId: realId }
                : message
            ))
            setTuiPermissionModeByKey((prev) => {
              const pendingMode = prev[oldKey]
              if (!pendingMode) return prev
              const next = { ...prev }
              delete next[oldKey]
              next[newKey] = pendingMode
              tuiPermissionModeByKeyRef.current = next
              return next
            })
            setOpenTabSessions((prev) => prev.map((s) => sessionKey(s) === oldKey ? updated : s))
            setSessions((prev) => prev.map((s) => sessionKey(s) === oldKey ? { ...s, sessionId: realId, isPending: false } : s))
            if (selectedSessionKeyRef.current === oldKey) setSelectedSessionKey(newKey)
          }
          return
        }
        if (frame.event === 'opencode-todos' && Array.isArray(parsed)) {
          setComposerLiveTodos(parsed as import('../../lib/taskRegistry').OpenCodeTodo[])
          return
        }
        if (frame.event === 'command-result' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const result = parsed as { message?: unknown; mode?: unknown }
          if (
            result.mode === 'interactive'
            || result.mode === 'plan'
            || result.mode === 'autopilot'
            || result.mode === 'shell'
          ) {
            setTuiCopilotMode(result.mode)
          }
          if (typeof result.message === 'string' && result.message.trim()) {
            const text = result.message.trim()
            if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current)
            setNotice({ tone: 'info', text })
            noticeTimeoutRef.current = setTimeout(() => {
              setNotice((current) => current?.text === text ? null : current)
              noticeTimeoutRef.current = null
            }, 2000)
          }
          return
        }
        if (!parsed) return
        const parsedRecord = parsed as Record<string, unknown>

        const pendingPermission = extractPendingPermission(parsed)
        if (pendingPermission) {
          setPendingPermissions((prev) => {
            const next = [...prev.filter((entry) => entry.id !== pendingPermission.id), pendingPermission]
            setPermissionOptionIndex(0)
            return next
          })
        }
        const repliedPermissionId = extractPermissionReply(parsed)
        if (repliedPermissionId) {
          setPendingPermissions((prev) => prev.filter((entry) => entry.id !== repliedPermissionId))
        }

        if (parsedRecord.type === 'prompt_suggestion' && typeof parsedRecord.suggestion === 'string') {
          setLivePromptSuggestion(parsedRecord.suggestion)
        }
        if (parsedRecord.type === 'system' && parsedRecord.subtype === 'commands_changed') {
          const commands = normalizeSlashCommandSuggestions(parsedRecord.commands)
          if (commands) setComposerLiveSlashCommands(commands)
        }
        if (parsedRecord.type === 'system' && parsedRecord.subtype === 'status') {
          const status = parsedRecord.status === 'requesting' || parsedRecord.status === 'compacting' ? parsedRecord.status : null
          setLiveStatus(status)
        }
        // The Claude SDK auto-retries transient API errors and emits an api_retry
        // system message per attempt. Surface it as the live "Retrying…" status
        // (same as Pi's native retry); it clears on the next delta/result.
        if (parsedRecord.type === 'system' && parsedRecord.subtype === 'api_retry') {
          setLiveStatus('retrying')
        }
        // Pi surfaces auto-retry / auto-compaction as non-fatal progress so the
        // turn doesn't look hung while it recovers (mirrors native Pi).
        if (parsedRecord.type === 'pi_status') {
          if (parsedRecord.status === 'retry_start') setLiveStatus('retrying')
          else if (parsedRecord.status === 'compaction_start') setLiveStatus('compacting')
          else if (parsedRecord.status === 'retry_end' || parsedRecord.status === 'compaction_end') setLiveStatus(null)
        }
        if (parsedRecord.type === 'stream_event' && typeof parsedRecord.parent_tool_use_id === 'string' && parsedRecord.parent_tool_use_id) {
          const event = parsedRecord.event as Record<string, unknown> | undefined
          if (event?.type === 'content_block_delta') {
            const eventDelta = event.delta as Record<string, unknown> | undefined
            if (eventDelta?.type === 'text_delta' && typeof eventDelta.text === 'string') {
              const parentId = parsedRecord.parent_tool_use_id
              const deltaText = eventDelta.text
              setLiveSubagentText((prev) => ({ ...prev, [parentId]: (prev[parentId] ?? '') + deltaText }))
            }
          }
        }
        if (parsedRecord.type === 'user' && typeof parsedRecord.parent_tool_use_id === 'string' && parsedRecord.parent_tool_use_id) {
          const parentId = parsedRecord.parent_tool_use_id
          setLiveSubagentText((prev) => {
            if (!(parentId in prev)) return prev
            const { [parentId]: _, ...rest } = prev
            return rest
          })
        }

        // Accumulate output tokens from message_delta events (top-level only, not subagents).
        if (parsedRecord.type === 'stream_event' && !parsedRecord.parent_tool_use_id) {
          const sseEvent = parsedRecord.event as Record<string, unknown> | undefined
          if (sseEvent?.type === 'message_delta') {
            const usage = sseEvent.usage as Record<string, unknown> | undefined
            const toks = typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0
            if (toks > 0) setLiveOutputTokens((prev) => prev + toks)
          }
        }

        const claudeToolUse = extractClaudeStreamToolUse(parsed)
        if (claudeToolUse) {
          // A tool call is a side effect — never blind-retry past this point.
          composerTurnProducedOutputRef.current = true
          const startIndex = streamEventIndex(parsed, 'content_block_start')
          if (startIndex != null) {
            liveToolIndexesRef.current.set(startIndex, claudeToolUse.id)
            liveToolInputJsonRef.current.set(startIndex, '')
          }
          setLiveToolActivities((prev) => [...prev, { key: claudeToolUse.id, label: claudeToolUse.name, status: 'running' }])
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, {
            role: 'assistant',
            uuid: `live-tool:${claudeToolUse.id}`,
            sessionId: targetSession.sessionId,
            provider: targetSession.provider ?? 'claude',
            blocks: [{
              type: 'tool_thread',
              toolUse: claudeToolUse,
              result: null,
            }],
          }))
        }

        const toolInputDelta = extractClaudeStreamToolInputDelta(parsed)
        if (toolInputDelta) {
          const toolKey = liveToolIndexesRef.current.get(toolInputDelta.index)
          if (toolKey) {
            const accumulated = `${liveToolInputJsonRef.current.get(toolInputDelta.index) ?? ''}${toolInputDelta.partialJson}`
            liveToolInputJsonRef.current.set(toolInputDelta.index, accumulated)
            const input = parseClaudeStreamToolInput(accumulated)
            if (input) {
              setLiveTranscriptMessages((prev) => updateLiveToolThreadInput(prev, toolKey, input))
            }
          }
        }

        const stopIndex = streamEventIndex(parsed, 'content_block_stop')
        if (stopIndex != null) {
          const toolKey = liveToolIndexesRef.current.get(stopIndex)
          if (toolKey) {
            const accumulated = liveToolInputJsonRef.current.get(stopIndex)
            const finalInput = accumulated ? parseClaudeStreamToolInput(accumulated) : null
            if (finalInput) {
              setLiveTranscriptMessages((prev) => updateLiveToolThreadInput(prev, toolKey, finalInput))
            }
            setLiveToolActivities((prev) => prev.map((a) =>
              a.key === toolKey ? { ...a, status: 'done' } : a
            ))
            setLiveTranscriptMessages((prev) => completeLiveToolThread(prev, toolKey))
          }
          liveToolInputJsonRef.current.delete(stopIndex)
          liveToolIndexesRef.current.delete(stopIndex)
        }

        const openCodeToolThread = extractOpenCodeLiveToolThread(parsed, targetSession)
        if (openCodeToolThread) {
          composerTurnProducedOutputRef.current = true
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, openCodeToolThread))
        }

        const openCodeSubagent = extractOpenCodeLiveSubagent(parsed)
        if (openCodeSubagent) {
          activeSubagentIdRef.current = openCodeSubagent.agentId
          setLiveSubagentText((prev) => ({
            ...prev,
            [openCodeSubagent.agentId]: `Agent: ${openCodeSubagent.name}`,
          }))
          const label = openCodeSubagent.type === 'agent'
            ? `Running agent: ${openCodeSubagent.name}`
            : `Running subtask: ${openCodeSubagent.name}`
          const agentCard: ThreadedMessage = {
            role: 'assistant',
            uuid: `live-subagent:${openCodeSubagent.agentId}`,
            sessionId: targetSession.sessionId,
            provider: targetSession.provider ?? 'opencode',
            blocks: [{ type: 'text', text: label }],
          }
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, agentCard))
        }

        if (targetSession.provider === 'codex') {
          const codexToolActivity = extractCodexLiveToolActivity(parsedRecord)
          if (codexToolActivity) {
            composerTurnProducedOutputRef.current = true
            setLiveToolActivities((prev) => applyLiveToolActivity(prev, codexToolActivity))
          }
          setLiveTranscriptMessages((prev) => appendCodexLiveToolOutput(prev, parsedRecord, targetSession))
        }

        const codexCompletionItem = parsedRecord.type === 'codex_item_completed' && parsedRecord.item && typeof parsedRecord.item === 'object'
          ? parsedRecord.item as Record<string, unknown>
          : null
        const codexCompletionIsText = codexCompletionItem?.type === 'agentMessage' || codexCompletionItem?.type === 'plan'

        if (targetSession.provider === 'claude') {
          const threaded = normalizeClaudeStreamThreadedMessage(parsed)
          if (threaded) {
            setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, threaded))
          }
        } else if (targetSession.provider === 'codex') {
          const threaded = normalizeCodexStreamThreadedMessage(parsed, targetSession.sessionId)
          if (threaded || codexCompletionIsText) {
            setLiveTranscriptMessages((prev) => {
              const withoutStreamingText = codexCompletionIsText
                ? prev.filter((message) => message.uuid !== CODEX_LIVE_ASSISTANT_UUID)
                : prev
              return threaded
                ? upsertThreadedMessage(withoutStreamingText, threaded)
                : withoutStreamingText
            })
          }
          if (codexCompletionIsText) {
            pendingLiveTextRef.current = ''
            setComposerLiveText('')
          }
        } else if (targetSession.provider === 'copilot') {
          const threaded = extractCopilotFinalAssistantMessage(parsed, targetSession)
          if (threaded) {
            copilotFinalMessageSeen = true
            const finalText = extractStreamingAssistantText(parsed)
            if (finalText) replyAccumulator = finalText
            pendingLiveTextRef.current = ''
            setComposerLiveText('')
            setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, threaded))
            return
          }
        }

        if (targetSession.provider === 'codex' && codexCompletionIsText) {
          const finalText = extractStreamingAssistantText(parsed)
          if (finalText) replyAccumulator = finalText
          return
        }

        // Reasoning streams on its own channel; capture it before the answer
        // bail-out so a thinking-only frame still updates the dim preview.
        const reasoningDelta = extractStreamingReasoningText(parsed)
        if (reasoningDelta) {
          setLiveStatus(null)
          pendingLiveReasoningRef.current = `${pendingLiveReasoningRef.current}${reasoningDelta}`
          liveTextTargetSessionRef.current = targetSession
          if (liveTextFlushFrameRef.current == null) {
            liveTextFlushFrameRef.current = requestAnimationFrame(flushLiveText)
          }
        }

        const delta = extractStreamingAssistantText(parsed)
        if (!delta) return
        // Committed assistant output — this turn must not be blind-retried.
        composerTurnProducedOutputRef.current = true
        setLiveStatus(null)

        // Route agent/subtask text to liveSubagentText so it appears as ↪ subagent: <text>
        // in the status footer, visually distinct from the main model's text.
        const agentId = activeSubagentIdRef.current
        if (targetSession.provider === 'opencode' && agentId) {
          const replace = shouldReplaceLiveAssistantText(parsed)
          setLiveSubagentText((prev) => ({
            ...prev,
            [agentId]: replace ? delta : (prev[agentId] ?? '') + delta,
          }))
          return
        }

        const replace = shouldReplaceLiveAssistantText(parsed)
        replyAccumulator = replace ? delta : `${replyAccumulator}${delta}`
        if (targetSession.provider === 'codex') {
          const visibleText = extractCodexVisibleAssistantText(parsed)
          if (visibleText) {
            codexLiveMessageAccumulator = shouldReplaceCodexVisibleAssistantText(parsed)
              ? visibleText
              : `${codexLiveMessageAccumulator}${visibleText}`
            setLiveTranscriptMessages((prev) => upsertThreadedMessage(
              prev,
              makeLiveAssistantTextMessage(
                targetSession,
                codexLiveMessageAccumulator,
                CODEX_LIVE_ASSISTANT_UUID,
              ),
            ))
          }
        }
        pendingLiveTextRef.current = replace ? delta : `${pendingLiveTextRef.current}${delta}`
        liveTextTargetSessionRef.current = targetSession
        if (liveTextFlushFrameRef.current == null) {
          if (targetSession.provider === 'opencode') {
            flushLiveText()
          } else {
            liveTextFlushFrameRef.current = requestAnimationFrame(flushLiveText)
          }
        }
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

      if (targetSession.provider === 'copilot' && !copilotFinalMessageSeen && replyAccumulator.trim()) {
        setLiveTranscriptMessages((prev) => upsertThreadedMessage(
          prev,
          makeLiveAssistantTextMessage(
            targetSession,
            replyAccumulator,
            `live-copilot:fallback:${sendStartedAt}`,
          ),
        ))
      }

      setSentHistory((prev) => [...prev, {
        text: submission.visibleText.trim(),
        attachments: sendAttachments,
        promptParts: submission.promptParts,
      }])
      setHistoryIndex(-1)
      setDraftBeforeHistory({ text: '', attachments: [], promptParts: [] })
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      composerTextareaRef.current?.setText('')
      composerTextareaRef.current?.extmarks.clear()
      setComposerDraft('')
      if (composerDraftStorageKeyRef.current) scheduleWriteComposerDraft(composerDraftStorageKeyRef.current, '')
      setComposerMention(null)
      setComposerMentionResults([])
      setComposerMentionDismissedStart(null)
      setComposerMentionAttachments([])
      setComposerPromptParts([])
      setComposerSlashIndex(0)
      setComposerSlashDismissed(false)
      setComposerSendState('idle')
      setInterruptPressActive(false)
      if (interruptPressTimeoutRef.current) {
        clearTimeout(interruptPressTimeoutRef.current)
        interruptPressTimeoutRef.current = null
      }
      setComposerError(null)
      setAwaitingPersistedTurn(true)
      setFollowTail(true)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      setSelectedSessionKey(sessionKey(targetSession))
      void refreshSessions(provider, true, false)
      void refreshSelectedSessionDetail(targetSession, true)

      if (liveTextFlushFrameRef.current != null) {
        cancelAnimationFrame(liveTextFlushFrameRef.current)
        liveTextFlushFrameRef.current = null
      }
      pendingLiveTextRef.current = ''
      liveTextTargetSessionRef.current = null

      const elapsedMs = Date.now() - sendStartedAt
      if (elapsedMs >= NOTIFY_AFTER_MS) {
        const firstLine = replyAccumulator.split('\n').find((line) => line.trim().length > 0) ?? ''
        const preview = firstLine.length > NOTIFY_PREVIEW_CHARS
          ? `${firstLine.slice(0, NOTIFY_PREVIEW_CHARS - 1)}…`
          : firstLine || 'Reply ready'
        try {
          renderer.triggerNotification(preview, `agent-viewer · ${formatSessionTitle(targetSession)}`)
        } catch {
          // terminal doesn't support OSC notifications — silently ignore
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Confirmed interrupt: cancelComposerSend already moved us into the
        // awaitingPersistedTurn reconcile and wants the partial output kept.
        // Don't tear it down here — just clean up the live-text frame plumbing.
        if (composerInterruptPendingRef.current) {
          composerInterruptPendingRef.current = false
          liveToolIndexesRef.current.clear()
          liveToolInputJsonRef.current.clear()
          if (liveTextFlushFrameRef.current != null) {
            cancelAnimationFrame(liveTextFlushFrameRef.current)
            liveTextFlushFrameRef.current = null
          }
          pendingLiveTextRef.current = ''
          liveTextTargetSessionRef.current = null
          return
        }
        liveTranscriptBaselineRef.current.delete(targetKey)
        setLiveTranscriptMessages((prev) => prev.filter((message) => liveMessageSessionKey(message) !== targetKey))
        setAwaitingPersistedTurn(false)
        liveToolIndexesRef.current.clear()
        liveToolInputJsonRef.current.clear()
        if (liveTextFlushFrameRef.current != null) {
          cancelAnimationFrame(liveTextFlushFrameRef.current)
          liveTextFlushFrameRef.current = null
        }
        pendingLiveTextRef.current = ''
        liveTextTargetSessionRef.current = null
        return
      }
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
      // Visible auto-retry: ride out a transient API/network blip when the turn
      // produced no output yet (mirrors the web composer + Pi's native retry).
      // Keep the turn 'sending' with a 'retrying' status across the backoff,
      // then re-fire the same draft. The finally below preserves liveStatus
      // while a retry timer is armed (see the guarded setLiveStatus there).
      if (isTransientSendError(errorMessage)
        && !composerTurnProducedOutputRef.current
        && composerRetryCountRef.current < MAX_TRANSIENT_SEND_RETRIES) {
        composerRetryCountRef.current += 1
        const attempt = composerRetryCountRef.current
        const retryDraft = draftOverride ?? composerDraft
        const retryAttachments = attachmentsOverride
        setLiveStatus('retrying')
        setComposerLiveText('')
        setLiveToolActivities([])
        liveTranscriptBaselineRef.current.delete(targetKey)
        setLiveTranscriptMessages((prev) => prev.filter((message) => liveMessageSessionKey(message) !== targetKey))
        liveToolIndexesRef.current.clear()
        liveToolInputJsonRef.current.clear()
        if (composerRetryTimerRef.current) clearTimeout(composerRetryTimerRef.current)
        composerRetryTimerRef.current = setTimeout(() => {
          composerRetryTimerRef.current = null
          void sendComposerMessage(retryDraft, retryAttachments, true)
        }, transientRetryBackoffMs(attempt))
        return
      }
      const failedDraft = draftOverride ?? composerDraft
      setComposerSendState('error')
      setComposerError(err instanceof Error ? err.message : 'Failed to send message')
      setComposerLiveText('')
      setLiveStatus(null)
      setLiveToolActivities([])
      setAwaitingPersistedTurn(false)
      // Drop any queued follow-up: auto-sending it blind after a failed turn is
      // a surprise-send, and keeping it would clobber the restored failedDraft
      // the moment a keystroke flips error->idle (handleComposerContentChange).
      setQueuedComposerSend(null)
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
      composerTextareaRef.current?.setText(failedDraft)
      setComposerDraft(failedDraft)
    } finally {
      void reader?.cancel()
      composerAbortRef.current = null
      if (liveTextFlushFrameRef.current != null) {
        cancelAnimationFrame(liveTextFlushFrameRef.current)
        liveTextFlushFrameRef.current = null
      }
      pendingLiveTextRef.current = ''
      liveTextTargetSessionRef.current = null
      setComposerLiveText('')
      // Preserve the 'retrying' status while a transient-retry backoff is armed;
      // the catch above left composerSendState 'sending' so the badge shows.
      if (composerRetryTimerRef.current == null) setLiveStatus(null)
      setLiveSubagentText({})
      setLiveOutputTokens(0)
      setLiveToolActivities([])
      setComposerSendStartedAt(null)
      clearSessionRunning(runningRef)
      if (activeComposerSendCleanupRef.current === turnCleanupPromise) {
        activeComposerSendCleanupRef.current = null
      }
      resolveTurnCleanup()
    }
  }, [
    composerTargetSession,
    composerDraft,
    composerSendState,
    provider,
    refreshSessions,
    refreshSelectedSessionDetail,
    markSessionRunning,
    clearSessionRunning,
    renderer,
    taskBudgetTokens,
    tuiEffort,
    tuiCopilotMode,
    tuiOpenCodeAgent,
    composerPermissionMode,
    tuiModelOverride,
    composerMentionAttachments,
    composerPromptParts,
    prepareComposerSubmission,
    sessionDetail,
  ])

  // Flush queued prompt once the active turn lands (CLI-style queueing).
  // Gate on === 'idle' (not !== 'sending'): the prior turn can settle into
  // 'error', and auto-firing a queued follow-up after a failed turn is a
  // surprise-send. On error we clear the queue (see the error branch above),
  // so the only state that reaches here with a queued send is a clean idle.
  useEffect(() => {
    if (!queuedComposerSend) return
    if (composerSendState !== 'idle') return
    const next = queuedComposerSend
    setQueuedComposerSend(null)
    composerTextareaRef.current?.setText(next.text)
    setComposerDraft(next.text)
    setComposerMentionAttachments(next.attachments)
    void sendComposerMessage(next.text, next.attachments)
  }, [composerSendState, queuedComposerSend, sendComposerMessage])

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
          configuredDiffLayout,
          configuredTranscriptView,
          configuredTabsEnabled,
          configuredSidebarSort,
          configuredSidebarWidth,
          configuredShowToolCalls,
          configuredVelocityScroll,
        ] = await Promise.all([
          readTuiTheme(),
          readTuiProvider(),
          readTuiRailVisible(),
          readTuiFocusMode(),
          readTuiDensity(),
          readTuiDiffLayout(),
          readTuiTranscriptView(),
          readTuiTabsEnabled(),
          readTuiSidebarSort(),
          readTuiSidebarWidth(),
          readTuiShowToolCalls(),
          readTuiVelocityScroll(),
        ])
        if (cancelled) return
        setThemeMode(configuredTheme)
        setActiveTheme(configuredTheme)
        setProvider(configuredProvider)
        setRailVisible(configuredRailVisible)
        setFocusMode(configuredFocusMode)
        setDensity(configuredDensity)
        setDiffLayout(configuredDiffLayout)
        setTranscriptView(configuredTranscriptView)
        setTabsEnabled(configuredTabsEnabled)
        setSidebarSort(configuredSidebarSort)
        setSidebarWidthPreference(configuredSidebarWidth)
        setShowToolCalls(configuredShowToolCalls)
        setVelocityScrollEnabled(configuredVelocityScroll)
        if (!configuredRailVisible || configuredFocusMode) setFocusedPane('messages')
        await refreshSessions(configuredProvider, false, true)
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
  }, [refreshSessions])

  useEffect(() => {
    if (!bootstrapped) return
    if (!selectedSessionTarget || selectedSession?.isPending) {
      setSessionDetail(null)
      setLoadingDetail(false)
      setError((current) => current?.startsWith('Failed to load session detail') ? null : current)
      return
    }

    const cachedDetail = sessionDetailCacheRef.current.get(sessionKey(selectedSessionTarget)) ?? null
    setSessionDetail(cachedDetail)
    void refreshSelectedSessionDetail(selectedSessionTarget, true)
  }, [bootstrapped, refreshSelectedSessionDetail, selectedSession?.isPending, selectedSessionIdentity, selectedSessionTarget])

  // Clear stale live todos on session switch
  useEffect(() => {
    setComposerLiveTodos([])
  }, [selectedSessionIdentity])

  // Restore persisted composer draft on session switch
  useEffect(() => {
    if (!selectedSession) return
    const key = `${selectedSession.provider ?? 'claude'}:${selectedSession.sessionId}`
    composerDraftStorageKeyRef.current = key
    const saved = readComposerDraft(key)
    if (saved && saved !== composerDraft) {
      setComposerDraft(saved)
      composerTextareaRef.current?.setText(saved)
    }
  }, [selectedSessionIdentity])

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
    if (!bootstrapped || !selectedSessionTarget || selectedSession?.isPending) return undefined
    let active = true
    const interval = setInterval(() => {
      if (!active || providerSwitchRef.current) return
      // Skip background polls during active typing/searching — the poll's
      // startTransition can interleave with input handling and cause stutter.
      // The next tick after the user stops typing picks up any new content
      // (and a focused refresh on entering search-mode already fires).
      if (composerActiveRef.current && composerDraftRef.current.length > 0) return
      if (searchModeRef.current || sessionSearchModeRef.current) return
      void refreshSelectedSessionDetail(selectedSessionTarget, false)
    }, DETAIL_REFRESH_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [bootstrapped, refreshSelectedSessionDetail, selectedSession?.isPending, selectedSessionIdentity, selectedSessionTarget])

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
        setTranscriptCursorKey(visibleTranscriptCards[targetIndex]?.key ?? visibleTranscriptCards[0].key)
        setFollowTail(false)
        setPendingNewCount(0)
        setUnreadBoundaryKey(null)
        setResumeMarkerKey(restoredState.cursorKey)
      } else {
        setTranscriptCursorKey(visibleTranscriptCards[visibleTranscriptCards.length - 1].key)
    setComposerLiveTodos([])
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
        setResumeMarkerKey(null)
      }
      previousTranscriptRef.current = { sessionKey: selectedSessionKey, keys: currentKeys }
      return
    }

    if (followTail) {
      setTranscriptCursorKey(visibleTranscriptCards[visibleTranscriptCards.length - 1].key)
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
      return visibleTranscriptCards[Math.max(cursorIndex, 0)]?.key ?? visibleTranscriptCards[0].key
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
    visibleTranscriptCards,
    transcriptIndexByKey,
  ])

  // Load the active session's bookmarks whenever the selection changes.
  useEffect(() => {
    const target = selectedSessionTarget
    if (!target) { setBookmarkKeys(new Set()); return }
    let cancelled = false
    void readTuiSessionBookmarkIds({ sessionId: target.sessionId, provider: target.provider } as Session)
      .then((ids) => { if (!cancelled) setBookmarkKeys(new Set(ids)) })
      .catch(() => { if (!cancelled) setBookmarkKeys(new Set()) })
    return () => { cancelled = true }
  }, [selectedSessionIdentity])

  // Land on a bookmark target once its session transcript has loaded. Runs
  // after the cursor-reconcile effect above, so it wins the final cursor state.
  useEffect(() => {
    const pending = pendingBookmarkCursorRef.current
    if (!pending || pending.sessionKey !== selectedSessionKey) return
    const idx = transcriptIndexByKey.get(pending.uuid)
    if (idx === undefined || idx < 0) return
    pendingBookmarkCursorRef.current = null
    setTranscriptCursorKey(visibleTranscriptCards[idx].key)
    setFollowTail(false)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
  }, [selectedSessionKey, visibleTranscriptCards, transcriptIndexByKey])


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
  const promotePreviewToTab = useEffectEvent(() => {
    if (!selectedSession) return
    const key = sessionKey(selectedSession)
    setOpenTabSessions((current) => {
      if (current.some((s) => sessionKey(s) === key)) return current
      return [...current, selectedSession]
    })
  })

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
      const scrollbox = transcriptScrollRef.current
      scrollbox?.scrollChildIntoView(`card:${transcriptCursorKey}`)
      const scrollTop = scrollbox?.scrollTop
      if (typeof scrollTop === 'number') {
        pausedTranscriptScrollTopRef.current = scrollTop
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [followTail, transcriptCursorKey])

  useLayoutEffect(() => {
    if (!followTail) return
    if (visibleTranscriptCards.length === 0) return
    const lastKey = visibleTranscriptCards[visibleTranscriptCards.length - 1]?.key
    if (!lastKey) return
    transcriptScrollRef.current?.scrollChildIntoView(`card:${lastKey}`)
  }, [followTail, visibleTranscriptCards.length])

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
  }, [followTail, pendingNewCount, visibleTranscriptCards.length, unreadBoundaryKey])

  useLayoutEffect(() => {
    if (followTail) {
      if (visibleTranscriptCards.length > 0 && (prevTranscriptLengthRef.current !== visibleTranscriptCards.length || !prevFollowTailRef.current)) {
        transcriptScrollRef.current?.scrollTo(transcriptScrollRef.current?.scrollHeight ?? Number.MAX_SAFE_INTEGER)
      }
    } else {
      const scrollTop = pausedTranscriptScrollTopRef.current
      if (scrollTop != null) {
        transcriptScrollRef.current?.scrollTo(scrollTop)
      }
    }
    prevFollowTailRef.current = followTail
    prevTranscriptLengthRef.current = visibleTranscriptCards.length
  }, [followTail, pendingNewCount, visibleTranscriptCards.length, unreadBoundaryKey])

  useLayoutEffect(() => {
    if (!followTail) return
    if (composerSendState === 'sending' && composerLiveText) {
      transcriptScrollRef.current?.scrollTo(transcriptScrollRef.current?.scrollHeight ?? Number.MAX_SAFE_INTEGER)
    }
  }, [composerLiveText, composerSendState, followTail])

  // When switching to 'continue' or 'stream' mode the cursor may be on a hidden
  // technical card. Snap it to the last visible card so navigation stays coherent.
  useEffect(() => {
    if (transcriptView !== 'continue' && transcriptView !== 'stream') return
    if (visibleTranscriptCards.length === 0) return
    const isVisible = transcriptCursorKey
      ? visibleTranscriptCards.some((c) => c.key === transcriptCursorKey)
      : false
    if (!isVisible) {
      setTranscriptCursorKey(visibleTranscriptCards[visibleTranscriptCards.length - 1].key)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptView])

  const footerText = useMemo(
    () => fitText(
      `tab focus  j/k move  ctrl-u/d page  ←/→ tabs  w close tab  b bookmark  [ ] jump marks  S-B all marks  () convo  {} tech  u unread  m mark  / search  n/N hits  f live  e fold  s diff:${diffLayout}  v ${transcriptView}  d ${density}  h rail  S-T tasks  z focus  ^O composer  p provider  i thinking  X ${showToolCalls ? 'hide tools' : 'show tools'}  V ${velocityScrollEnabled ? 'velocity off' : 'velocity on'}  y copy  Q reply  r refresh  ? commands  q quit`,
      Math.max(width - 4, 20),
    ),
    [width, diffLayout, transcriptView, density, showToolCalls, velocityScrollEnabled],
  )

  const composerStatusMessage = composerError
    ? composerError
    : awaitingPersistedTurn
      ? 'Syncing transcript…'
      : queuedComposerSend && composerSendState === 'sending'
        ? `Queued · sends after current turn: "${queuedComposerSend.text.slice(0, 60)}${queuedComposerSend.text.length > 60 ? '…' : ''}"`
        : composerSendState === 'sending'
          ? activeRunningToolCount > 0
            ? `Using ${activeRunningToolCount} tool${activeRunningToolCount === 1 ? '' : 's'}.`
            : composerLiveText
              ? 'Streaming assistant response.'
              : null
          : null
  const composerTargetMessage = composerAutoTargetingRunning && composerTargetSession
    ? `Auto-targeting running ${String(composerTargetSession.provider ?? 'claude').toUpperCase()} session ${composerTargetSession.sessionId.slice(-8)}`
    : null
  const composerIdleFooterHint = useMemo(
    () => formatTuiComposerIdleHint(composerConfig.footerHintIdle, sentHistory.length),
    [composerConfig.footerHintIdle, sentHistory.length],
  )

  const resizeSidebar = useEffectEvent((delta: number) => {
    const nextWidth = clamp(sidebarWidth + delta, MIN_SIDEBAR_WIDTH, maxSidebarWidth)
    if (nextWidth === sidebarWidth) return
    setSidebarWidthPreference(nextWidth)
    void writeTuiSidebarWidth(nextWidth).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store sidebar width')
    })
  })

  const maxTaskPanelWidth = taskPanelOpen
    ? Math.max(TASK_PANEL_MIN_WIDTH, width - 4 - sidebarWidth - (showRail ? 1 : 0) - MIN_READER_WIDTH - (taskPanelOpen ? 1 : 0))
    : TASK_PANEL_DEFAULT_WIDTH
  const resizeTaskPanel = useEffectEvent((delta: number) => {
    const nextWidth = taskPanelOpen
      ? clamp(taskPanelWidth + delta, TASK_PANEL_MIN_WIDTH, maxTaskPanelWidth)
      : TASK_PANEL_DEFAULT_WIDTH + delta
    setTaskPanelWidth(Math.round(nextWidth / TASK_PANEL_RESIZE_STEP) * TASK_PANEL_RESIZE_STEP)
  })

  const showNotice = useCallback((tone: NoticeTone, text: string) => {
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current)
    setNotice({ tone, text })
    noticeTimeoutRef.current = setTimeout(() => {
      setNotice((current) => current?.text === text ? null : current)
      noticeTimeoutRef.current = null
    }, 2000)
  }, [])

  const rememberComposerCursor = useCallback(() => {
    composerCursorOffsetRef.current = composerTextareaRef.current?.cursorOffset ?? null
  }, [])

  const openComposerWindow = useEffectEvent(() => {
    rememberComposerCursor()
    setComposerActive(true)
    setComposerWindowOpen(true)
  })

  const toggleComposerWindow = useEffectEvent(() => {
    rememberComposerCursor()
    setComposerActive(true)
    setComposerWindowOpen((open) => !open)
  })

  const insertComposerPasteMarker = useEffectEvent((marker: string, partId: string) => {
    const renderable = composerTextareaRef.current
    if (!renderable || !marker || !partId) return
    const textToInsert = `${marker} `
    const start = renderable.cursorOffset
    renderable.insertText(textToInsert)
    const end = start + marker.length
    const typeId = ensureComposerPastePartTypeId(renderable)
    const styleId = renderable.syntaxStyle?.getStyleId('extmark.paste') ?? undefined
    renderable.extmarks.create({
      start,
      end,
      virtual: true,
      styleId,
      typeId,
      data: { partId },
    })
    const next = renderable.plainText
    setComposerDraft(next)
    if (composerDraftStorageKeyRef.current) scheduleWriteComposerDraft(composerDraftStorageKeyRef.current, next)
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
  })

  const attachComposerAttachment = useEffectEvent((attachment: SendAttachment, marker: string, noticeText: string) => {
    const id = attachment.id || `paste-${Date.now()}-${composerPromptParts.length}`
    const nextAttachment = { ...attachment, id, text: marker }
    insertComposerPasteMarker(marker, id)
    setComposerMentionAttachments((prev) => [...prev, nextAttachment])
    setComposerPromptParts((prev) => [...prev, {
      id,
      kind: 'attachment',
      marker,
      attachment: nextAttachment,
    }])
    showNotice('info', noticeText)
  })

  const attachComposerImage = useEffectEvent((image: ClipboardImage) => {
    const visibleDraft = composerTextareaRef.current?.plainText ?? composerDraft
    const activeAttachments = prepareComposerSubmission(visibleDraft, composerMentionAttachments, composerPromptParts).attachments
    const marker = `[Image ${imageAttachmentCount(activeAttachments) + 1}]`
    attachComposerAttachment({
      id: `paste-${Date.now()}-${composerPromptParts.length}`,
      type: 'blob',
      mimeType: image.mimeType,
      data: image.data,
      displayName: image.displayName,
    }, marker, `Attached ${image.displayName}`)
  })

  const insertCompactPastedText = useEffectEvent((text: string, marker: string) => {
    const id = `paste-text-${Date.now()}-${composerPromptParts.length}`
    insertComposerPasteMarker(marker, id)
    setComposerPromptParts((prev) => [...prev, {
      id,
      kind: 'text',
      marker,
      text,
    }])
  })

  const pasteFilePathToComposer = useEffectEvent(async (text: string): Promise<boolean> => {
    const cwd = composerTargetSession?.cwd ?? selectedSession?.cwd ?? null
    const filePath = normalizePastedFilePath(text, cwd)
    if (!filePath) return false
    try {
      const info = await stat(filePath)
      if (!info.isFile()) return false
    } catch {
      return false
    }
    const mimeType = pastedFileMimeTypeForPath(filePath)
    const filename = basename(filePath)
    if (mimeType === 'image/svg+xml') {
      const content = await readFile(filePath, 'utf8').catch(() => null)
      if (!content) return false
      insertCompactPastedText(content, `[SVG: ${filename || 'image'}]`)
      return true
    }
    if (mimeType.startsWith('image/')) {
      const visibleDraft = composerTextareaRef.current?.plainText ?? composerDraft
      const activeAttachments = prepareComposerSubmission(visibleDraft, composerMentionAttachments, composerPromptParts).attachments
      const marker = `[Image ${imageAttachmentCount(activeAttachments) + 1}]`
      attachComposerAttachment({
        id: `paste-file-${Date.now()}-${composerPromptParts.length}`,
        type: 'image',
        path: filePath,
        displayName: filename,
        mimeType,
      }, marker, `Attached ${filename}`)
      return true
    }
    if (mimeType === 'application/pdf') {
      const visibleDraft = composerTextareaRef.current?.plainText ?? composerDraft
      const activeAttachments = prepareComposerSubmission(visibleDraft, composerMentionAttachments, composerPromptParts).attachments
      const pdfCount = activeAttachments.filter((attachment) => attachment.mimeType === 'application/pdf').length
      const marker = `[PDF ${pdfCount + 1}]`
      attachComposerAttachment({
        id: `paste-file-${Date.now()}-${composerPromptParts.length}`,
        type: 'file',
        path: filePath,
        displayName: filename,
        mimeType,
      }, marker, `Attached ${filename}`)
      return true
    }
    return false
  })

  const insertComposerTextAtCursor = useEffectEvent((textToInsert: string) => {
    const renderable = composerTextareaRef.current
    if (!renderable || !textToInsert) return
    const text = renderable.plainText
    const cursor = renderable.cursorOffset
    const next = `${text.slice(0, cursor)}${textToInsert}${text.slice(cursor)}`
    renderable.setText(next)
    renderable.cursorOffset = cursor + textToInsert.length
    setComposerDraft(next)
    if (composerDraftStorageKeyRef.current) scheduleWriteComposerDraft(composerDraftStorageKeyRef.current, next)
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
  })

  const pasteTextToComposer = useEffectEvent(async (textToInsert: string) => {
    const normalizedText = textToInsert.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (!normalizedText) return
    if (await pasteFilePathToComposer(normalizedText)) return
    const pastedContent = normalizedText.trim()
    const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
    if (pastedContent && (lineCount >= 3 || pastedContent.length > 150)) {
      insertCompactPastedText(pastedContent, `[Pasted ~${lineCount} lines]`)
      return
    }
    insertComposerTextAtCursor(normalizedText)
  })

  const pasteSystemClipboardToComposer = useEffectEvent(async () => {
    try {
      const image = await readClipboardImage()
      if (image) {
        attachComposerImage(image)
        return
      }
      const text = await readClipboardText()
      if (!text) {
        showNotice('error', 'Clipboard has no supported image or text')
        return
      }
      await pasteTextToComposer(text)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to paste from clipboard')
    }
  })

  const clearComposerDraft = useEffectEvent(() => {
    composerTextareaRef.current?.setText('')
    composerTextareaRef.current?.extmarks.clear()
    setComposerDraft('')
    setComposerMentionAttachments([])
    setComposerPromptParts([])
    setComposerMention(null)
    setComposerMentionResults([])
    setComposerMentionDismissedStart(null)
    setComposerSlashIndex(0)
    setComposerSlashDismissed(false)
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
    setComposerStashOpen(false)
    setComposerStashIndex(0)
    if (composerDraftStorageKeyRef.current) scheduleWriteComposerDraft(composerDraftStorageKeyRef.current, '')
  })

  const stashComposerPrompt = useEffectEvent(() => {
    const snapshot = makeComposerSnapshot()
    if (!snapshot.text.trim() && snapshot.attachments.length === 0 && snapshot.promptParts.length === 0) {
      showNotice('info', 'Composer is empty')
      return
    }
    setComposerStash((prev) => [...prev, snapshot])
    clearComposerDraft()
    showNotice('info', 'Stashed composer prompt')
  })

  const popComposerStash = useEffectEvent(() => {
    const popped = composerStash[composerStash.length - 1] ?? null
    if (!popped) {
      showNotice('info', 'Composer stash is empty')
      return
    }
    setComposerStash((prev) => prev.slice(0, -1))
    setComposerActive(true)
    applyComposerSnapshot(popped)
    showNotice('info', 'Restored composer stash')
  })

  const openComposerStashList = useEffectEvent(() => {
    if (composerStash.length === 0) {
      showNotice('info', 'Composer stash is empty')
      return
    }
    setComposerActive(true)
    setComposerMention(null)
    setComposerMentionResults([])
    setComposerHistoryOpen(false)
    setComposerStashOpen(true)
    setComposerStashIndex(0)
  })

  const selectComposerStashEntry = useEffectEvent((displayIndex: number) => {
    if (composerStash.length === 0) return
    setComposerStashIndex(clamp(displayIndex, 0, composerStash.length - 1))
  })

  const commitComposerStashEntry = useEffectEvent(() => {
    const sourceIndex = composerStash.length - 1 - composerStashIndex
    const entry = composerStash[sourceIndex]
    if (!entry) return
    setComposerStash((prev) => prev.filter((_, index) => index !== sourceIndex))
    setComposerStashOpen(false)
    setComposerStashIndex(0)
    applyComposerSnapshot(entry)
    showNotice('info', 'Restored composer stash')
  })

  useSelectionHandler((selection) => {
    const text = selection.getSelectedText()
    if (!text.trim()) return
    terminalSelectionRef.current = { text, capturedAt: Date.now() }
    // Auto-copy via OSC 52 so Cmd+C / Ctrl+Shift+C work immediately after
    // dragging to select, without needing to press y.
    renderer.copyToClipboardOSC52(text)
  })

  usePaste((event) => {
    if (!composerActiveRef.current) return
    if (!composerTextareaRef.current) return
    const imageMimeType = pasteImageMimeType(event.metadata?.mimeType) ?? inferPastedImageMimeType(event.bytes)
    if (imageMimeType) {
      event.preventDefault()
      event.stopPropagation()
      attachComposerImage({
        data: Buffer.from(event.bytes).toString('base64'),
        mimeType: imageMimeType,
        displayName: pastedImageDisplayName(imageMimeType),
      })
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const text = Buffer.from(event.bytes).toString('utf8')
    void pasteTextToComposer(text)
  })

  const copySelectedMessage = useEffectEvent(async () => {
    const terminalSelection = terminalSelectionRef.current
    if (
      terminalSelection
      && Date.now() - terminalSelection.capturedAt <= TERMINAL_SELECTION_COPY_WINDOW_MS
      && terminalSelection.text.trim()
    ) {
      try {
        await writeClipboard(terminalSelection.text)
        terminalSelectionRef.current = null
        showNotice('info', 'Copied terminal selection to clipboard')
      } catch (err) {
        showNotice('error', err instanceof Error ? err.message : 'Failed to copy selection')
      }
      return
    }

    const card = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
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
  })

  const replySelectedMessage = useEffectEvent(() => {
    const card = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
    if (!card) {
      showNotice('error', 'No message selected')
      return
    }
    const text = cardClipboardText(card).trim()
    if (!text) {
      showNotice('error', 'Selected message has no reply text')
      return
    }

    const quoted = text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    const existing = composerTextareaRef.current?.plainText ?? composerDraft
    const separator = existing.length > 0 ? (existing.endsWith('\n') ? '' : '\n\n') : ''
    const next = `${existing}${separator}${quoted}\n\n`

    applyComposerSnapshot({
      text: next,
      attachments: [...composerMentionAttachments],
      promptParts: [...composerPromptParts],
      cursorOffset: next.length,
    })
    setComposerActive(true)
  })

  // Toggle a bookmark on the card under the transcript cursor.
  const toggleBookmarkForCursor = useEffectEvent(async () => {
    const target = selectedSessionTarget
    if (!target) { showNotice('error', 'No session selected'); return }
    const card = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
    if (!card) { showNotice('error', 'No message selected'); return }
    if (card.key.startsWith('live-')) { showNotice('error', 'Cannot bookmark a streaming message'); return }
    const uuid = card.key
    const next = !bookmarkKeysRef.current.has(uuid)
    setBookmarkKeys((prev) => {
      const updated = new Set(prev)
      if (next) updated.add(uuid)
      else updated.delete(uuid)
      return updated
    })
    try {
      const meta = next
        ? {
            role: card.role,
            label: card.role === 'user' ? 'user' : 'assistant',
            preview: (card.compactSummary || card.searchText || '').replace(/\s+/g, ' ').trim().slice(0, 200) || undefined,
            sessionTitle: readerTitle || undefined,
            messageTimestamp: card.timestamp,
          }
        : undefined
      const ids = await toggleTuiSessionBookmark(
        { sessionId: target.sessionId, provider: target.provider } as Session,
        uuid,
        next,
        meta,
      )
      setBookmarkKeys(new Set(ids))
      showNotice('info', next ? 'Bookmarked message' : 'Removed bookmark')
    } catch (err) {
      setBookmarkKeys((prev) => {
        const updated = new Set(prev)
        if (next) updated.delete(uuid)
        else updated.add(uuid)
        return updated
      })
      showNotice('error', err instanceof Error ? err.message : 'Failed to update bookmark')
    }
  })

  // Jump to the next/previous bookmarked card in the active session.
  const jumpToBookmark = useEffectEvent((direction: 1 | -1) => {
    if (visibleTranscriptCards.length === 0) return
    const marks = bookmarkKeysRef.current
    if (marks.size === 0) { showNotice('info', 'No bookmarks in this session'); return }
    const start = cursorIndex >= 0 ? cursorIndex : 0
    const count = visibleTranscriptCards.length
    for (let step = 1; step <= count; step += 1) {
      const idx = (((start + direction * step) % count) + count) % count
      const card = visibleTranscriptCards[idx]
      if (card && marks.has(card.key)) {
        jumpToTranscriptIndex(idx)
        return
      }
    }
  })

  const openBookmarksOverlay = useEffectEvent(async () => {
    setBookmarksOverlayOpen(true)
    setBookmarksOverlayIndex(0)
    try {
      const all = await readTuiAllBookmarks()
      setBookmarksOverlay(all)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to load bookmarks')
    }
  })

  const openHandoffBrief = useEffectEvent(() => {
    if (!selectedSessionTarget) {
      showNotice('error', 'No session selected')
      return
    }
    setHandoffBriefOpen(true)
  })

  const openPromptLibrary = useEffectEvent(() => {
    if (!selectedSessionTarget) {
      showNotice('error', 'No session selected')
      return
    }
    rememberComposerCursor()
    setComposerActive(true)
    setPromptLibraryOpen(true)
  })

  const openChannelBridge = useEffectEvent(() => {
    setChannelBridgeOpen(true)
  })

  const insertComposerPromptText = useEffectEvent((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const renderable = composerTextareaRef.current
    const current = renderable?.plainText ?? composerDraft
    const cursor = renderable?.cursorOffset ?? current.length
    const before = current.slice(0, cursor)
    const insertion = before.length > 0 && !before.endsWith('\n') ? `\n${trimmed}` : trimmed
    insertComposerTextAtCursor(insertion)
    setComposerActive(true)
  })

  // Navigate to a bookmark from the global overlay — switching session (and
  // provider) when needed, then landing on the message once it has loaded.
  const openBookmarkRecord = useEffectEvent((record: MessageBookmark) => {
    setBookmarksOverlayOpen(false)
    const targetSession = { sessionId: record.sessionId, provider: record.provider } as Session
    const targetKey = sessionKey(targetSession)
    if (targetKey === selectedSessionKeyRef.current) {
      const idx = transcriptIndexByKey.get(record.uuid)
      if (idx !== undefined && idx >= 0) jumpToTranscriptIndex(idx)
      else pendingBookmarkCursorRef.current = { sessionKey: targetKey, uuid: record.uuid }
      setFocusedPane('messages')
      return
    }
    pendingBookmarkCursorRef.current = { sessionKey: targetKey, uuid: record.uuid }
    selectTabSession(targetSession)
    setFocusedPane('messages')
  })

  const copyCliCommand = useEffectEvent(async () => {
    const session = selectedSession
    if (!session) { showNotice('error', 'No session selected'); return }
    const cwd = sessionDetail?.info?.cwd ?? session.cwd
    const cmd = getContinueInCliCommand(session.provider ?? 'claude', session.sessionId, cwd)
    if (!cmd) { showNotice('error', `No CLI resume command for ${session.provider}`); return }
    try {
      await writeClipboard(cmd)
      showNotice('info', `Copied: ${cmd}`)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to copy')
    }
  })

  const executeCommandPalette = useEffectEvent((id: string) => {
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
      case 'diff-layout': {
        const next: TuiDiffLayout = diffLayout === 'stack' ? 'split' : 'stack'
        setDiffLayout(next)
        void writeTuiDiffLayout(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store diff layout'))
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
      case 'velocity-scroll': {
        setVelocityScrollEnabled((v) => {
          const next = !v
          void writeTuiVelocityScroll(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store velocity scroll'))
          return next
        })
        break
      }
      case 'mode': {
        const target = composerTargetSession ?? selectedSession
        if (target?.provider === 'opencode') {
          if (composerAgentOptions.length === 0) break
          setTuiOpenCodeAgent((current) => {
            const index = Math.max(0, composerAgentOptions.findIndex((agent) => agent.value === current))
            return composerAgentOptions[(index + 1) % composerAgentOptions.length]?.value ?? current
          })
          break
        }
        if (target?.provider === 'copilot') {
          const order = ['interactive', 'plan', 'autopilot', 'shell'] as const
          setTuiCopilotMode((current) => {
            const next = order[(order.indexOf(current) + 1) % order.length]!
            void runTuiSessionAction(target, {
              action: 'setMode',
              mode: next,
            }).catch(() => { /* swallow; next send carries body.mode */ })
            return next
          })
          break
        }
        if (target?.provider === 'claude') {
          cycleClaudeComposerPermissionMode(target)
        }
        break
      }
      case 'model': {
        void openModelPicker()
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
      case 'reply':
        setFocusedPane('messages')
        replySelectedMessage()
        break
      case 'bookmark-toggle':
        setFocusedPane('messages')
        void toggleBookmarkForCursor()
        break
      case 'bookmark-jump':
        setFocusedPane('messages')
        jumpToBookmark(1)
        break
      case 'bookmark-all':
        void openBookmarksOverlay()
        break
      case 'tasks':
        setTaskPanelOpen(true)
        setTaskPanelTab('tasks')
        break
      case 'tasks-full':
        setTaskPopoverOpen(true)
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
      case 'composer-window':
        openComposerWindow()
        break
      case 'composer-stash':
        stashComposerPrompt()
        break
      case 'composer-stash-pop':
        popComposerStash()
        break
      case 'composer-stash-list':
        openComposerStashList()
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
      case 'handoff-brief':
        openHandoffBrief()
        break
      case 'prompt-library':
        openPromptLibrary()
        break
      case 'diagnostics':
        openDiagnostics()
        break
      case 'rename':
        if (selectedSession) {
          setRenameSessionKey(sessionKey(selectedSession))
          setRenameDraft(formatSessionTitle(selectedSession))
        }
        break
      case 'cli':
        void copyCliCommand()
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
        requestExit()
        break
    }
  })

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
    const isKeyRepeat = key.eventType === 'repeat' || key.repeated === true
    const isModelEffortShortcut = (key.name === 'm' && (key.option || key.meta)) || sequence === 'µ'
    const handled = (action: () => void): void => {
      key.preventDefault()
      key.stopPropagation()
      action()
    }
    const selectedTranscriptCard = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
    const selectedTranscriptCardDisplay = cursorIndex >= 0 ? cardDisplayData[cursorIndex] : null

    if (exitConfirmOpen) {
      if (key.name === 'return' || key.name === 'y') {
        handled(confirmExit)
        return
      }
      if (key.name === 'escape' || key.name === 'n') {
        handled(cancelExit)
        return
      }
      handled(() => {})
      return
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

    if (handoffBriefOpen) {
      handled(() => { handoffBriefKeyHandlerRef.current?.(key) })
      return
    }

    if (promptLibraryOpen) {
      handled(() => { promptLibraryKeyHandlerRef.current?.(key) })
      return
    }

    if (channelBridgeOpen) {
      handled(() => { channelBridgeKeyHandlerRef.current?.(key) })
      return
    }

    if (bookmarksOverlayOpen) {
      handled(() => {
        if (key.name === 'escape' || key.name === 'q' || isShifted('B') || isCtrl('c')) {
          setBookmarksOverlayOpen(false)
          return
        }
        if (bookmarksOverlay.length === 0) return
        if (key.name === 'j' || key.name === 'down') {
          setBookmarksOverlayIndex((i) => Math.min(i + 1, bookmarksOverlay.length - 1))
          return
        }
        if (key.name === 'k' || key.name === 'up') {
          setBookmarksOverlayIndex((i) => Math.max(i - 1, 0))
          return
        }
        if (key.name === 'return') {
          const record = bookmarksOverlay[bookmarksOverlayIndex]
          if (record) openBookmarkRecord(record)
        }
      })
      return
    }

    if (taskPopoverOpen) {
      handled(() => { taskPopoverKeyHandlerRef.current?.(key) })
      return
    }

    if (diagnosticsOpen) {
      handled(() => {
        if (key.name === 'escape' || isShifted('D') || isCtrl('c')) {
          closeDiagnostics()
          return
        }
        if (selectedSession?.provider !== 'claude') return
        const mcpSection = diagnosticsSections.find((s) => s.id === 'mcp')
        const mcpRows = mcpSection?.items.filter((i) => i !== 'None') ?? []
        if (mcpRows.length === 0 && key.name !== 'p') return
        if (key.name === 'up' || key.name === 'k') {
          setDiagnosticsMcpIndex((i) => Math.max(0, i - 1))
          return
        }
        if (key.name === 'down' || key.name === 'j') {
          setDiagnosticsMcpIndex((i) => Math.min(mcpRows.length - 1, i + 1))
          return
        }
        if (key.name === 'r' && mcpRows[diagnosticsMcpIndex]) {
          const item = mcpRows[diagnosticsMcpIndex]
          const name = item.split(' · ')[0]?.trim() ?? ''
          if (name) void runDiagnosticsAction('reconnectMcpServer', { serverName: name }, `mcp:${name}`)
          return
        }
        if (key.name === 't' && mcpRows[diagnosticsMcpIndex]) {
          const item = mcpRows[diagnosticsMcpIndex]
          const [rawName, rawStatus] = item.split(' · ')
          const name = rawName?.trim() ?? ''
          const status = rawStatus?.trim() ?? ''
          if (name) void runDiagnosticsAction('toggleMcpServer', { serverName: name, enabled: status === 'disabled' }, `mcp:toggle:${name}`)
          return
        }
        if (key.name === 'p') {
          void runDiagnosticsAction('reloadPlugins', {}, 'reload-plugins')
          return
        }
      })
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
        handled(requestExit)
      }
      return
    }

    if (modelPickerOpen) {
      if (key.name === 'escape' || isModelEffortShortcut) {
        handled(() => setModelPickerOpen(false))
        return
      }
      if (key.name === 'tab' || key.name === 'left' || key.name === 'right') {
        handled(() => setModelPickerFocus((current) => current === 'model' ? 'effort' : 'model'))
        return
      }
      if (key.name === 'q' || isCtrl('c')) {
        handled(requestExit)
      }
      return
    }

    if (themeMenuOpen) {
      if (key.name === 'left' || key.name === 'right') {
        handled(() => {
          const newGroup = key.name === 'left' ? 'light' : 'dark'
          setThemeMenuGroup(newGroup)
          const groupThemes = newGroup === 'light' ? LIGHT_MODES : DARK_MODES
          const origin = themeMenuOriginRef.current
          const target = (origin && groupThemes.includes(origin)) ? origin : groupThemes[0]
          if (target) {
            setThemeMenuIndex(THEMES.indexOf(target))
            setThemeMode(target)
          }
        })
        return
      }
      if (key.name === 'escape' || key.name === 't') {
        handled(closeThemeMenu)
        return
      }
      if (key.name === 'q' || isCtrl('c')) {
        handled(requestExit)
      }
      return
    }

    if (commandPaletteOpen) {
      if (key.name === 'escape' || sequence === '?') {
        handled(closeCommandPalette)
        return
      }
      if (key.name === 'j' || key.name === 'down') {
        handled(() => setCommandPaletteIndex((i) => Math.min(i + 1, Math.max(0, filteredCommands.length - 1))))
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

    if (transcriptDiffDraft !== null) {
      if (key.name === 'escape') {
        handled(() => setTranscriptDiffDraft(null))
        return
      }
      if ((key.ctrl && key.name === 's') || key.name === 'return') {
        handled(() => {
          const trimmed = transcriptDiffDraft.text.trim()
          setTranscriptDiffNotes((prev) => {
            const next = new Map(prev)
            if (trimmed) next.set(transcriptDiffDraft.anchor, { range: transcriptDiffDraft.range, text: trimmed })
            else next.delete(transcriptDiffDraft.anchor)
            return next
          })
          setTranscriptDiffDraft(null)
        })
        return
      }
      if (key.name === 'backspace' || key.name === 'delete') {
        handled(() => {
          setTranscriptDiffDraft((draft) => (draft ? { ...draft, text: draft.text.slice(0, -1) } : null))
        })
        return
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
        handled(() => {
          setTranscriptDiffDraft((draft) => (draft ? { ...draft, text: draft.text + key.sequence } : null))
        })
        return
      }
      return
    }

    if (isModelEffortShortcut) {
      handled(() => { void openModelPicker() })
      return
    }

    // A pending tool approval blocks the turn — capture option nav / confirm /
    // number shortcuts so the user can allow or reject it. Other keys (scroll,
    // Ctrl+C interrupt) still fall through.
    if (pendingPermissions.length > 0 && !permissionActionLoading) {
      const activePermission = pendingPermissions[0]!
      const options = permissionOptionsFor(activePermission)
      if (key.name === 'left') {
        handled(() => setPermissionOptionIndex((i) => Math.max(0, i - 1)))
        return
      }
      if (key.name === 'right' || key.name === 'tab') {
        handled(() => setPermissionOptionIndex((i) => Math.min(options.length - 1, i + 1)))
        return
      }
      if (key.name === 'return') {
        const option = options[Math.min(permissionOptionIndex, options.length - 1)]
        if (option) handled(() => { void respondToTuiPermission(activePermission, option.response) })
        return
      }
      const digit = Number.parseInt(sequence, 10)
      if (!Number.isNaN(digit) && digit >= 1 && digit <= options.length) {
        const option = options[digit - 1]!
        handled(() => { void respondToTuiPermission(activePermission, option.response) })
        return
      }
    }

    // Shift+Tab cycles Claude permission modes from any focus state.
    if (key.name === 'tab' && key.shift) {
      const target = composerTargetSession ?? selectedSession
      if (target?.provider === 'claude') {
        handled(() => {
          cycleClaudeComposerPermissionMode(target)
        })
        return
      }
    }

    if (composerActive) {
      if (isCtrl('v')) {
        handled(() => { void pasteSystemClipboardToComposer() })
        return
      }
      if (key.name === 'escape') {
        if (composerMention && composerMentionResults.length > 0) {
          handled(() => {
            setComposerMentionDismissedStart(composerMention.start)
            setComposerMention(null)
            setComposerMentionResults([])
          })
          return
        }
        if (composerSlashOpen && composerSlashCommands.length > 0) {
          handled(() => {
            setComposerSlashDismissed(true)
            setComposerSlashIndex(0)
          })
          return
        }
        if (composerHistoryOpen) {
          handled(cancelComposerHistory)
          return
        }
        if (composerStashOpen) {
          handled(() => {
            setComposerStashOpen(false)
            setComposerStashIndex(0)
          })
          return
        }
        handled(() => {
          // While a turn is running, Esc hides the composer so the user can
          // read the transcript without cancelling. Use Ctrl+C to interrupt.
          if (composerSendState === 'sending') {
            rememberComposerCursor()
            setComposerWindowOpen(false)
            setComposerActive(false)
            return
          }
          if (composerWindowOpen) {
            rememberComposerCursor()
            setComposerWindowOpen(false)
          } else {
            setComposerActive(false)
          }
        })
        return
      }
      // Cancel in-flight send (Ctrl+C when composer is open) — requires two
      // presses within 5 s to prevent accidental interrupts.
      if (isCtrl('c') && composerSendState === 'sending') {
        if (isKeyRepeat) {
          key.preventDefault()
          key.stopPropagation()
          return
        }
        handled(() => {
          if (interruptPressActive) {
            cancelComposerSend()
            setComposerWindowOpen(false)
            setComposerActive(false)
          } else {
            setInterruptPressActive(true)
            if (interruptPressTimeoutRef.current) clearTimeout(interruptPressTimeoutRef.current)
            interruptPressTimeoutRef.current = setTimeout(() => {
              setInterruptPressActive(false)
              interruptPressTimeoutRef.current = null
            }, 5000)
          }
        })
        return
      }
      if (isCtrl('b') && composerSendState === 'sending' && composerTargetSession?.provider === 'claude' && activeRunningToolCount > 0) {
        if (isKeyRepeat) {
          key.preventDefault()
          key.stopPropagation()
          return
        }
        handled(() => { void backgroundComposerTasks() })
        return
      }
      if (isCtrl('o')) {
        handled(toggleComposerWindow)
        return
      }
      if (composerHistoryOpen) {
        if (key.name === 'tab' || key.name === 'return') {
          handled(commitComposerHistory)
          return
        }
        if (key.name === 'n' && key.ctrl) {
          handled(() => moveComposerHistory(-1))
          return
        }
        if (key.name === 'p' && key.ctrl) {
          handled(() => moveComposerHistory(1))
          return
        }
        if (key.name === 'down' || key.name === 'j') {
          handled(() => moveComposerHistory(1))
          return
        }
        if (key.name === 'up' || key.name === 'k') {
          handled(() => moveComposerHistory(-1))
          return
        }
        if (key.name === 'g' && !key.shift) {
          handled(() => selectComposerHistoryEntry(0))
          return
        }
        if (key.name === 'g' && key.shift) {
          handled(() => selectComposerHistoryEntry(sentHistory.length - 1))
          return
        }
        if (
          (!key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ')
          || key.name === 'backspace'
          || key.name === 'delete'
        ) {
          setComposerHistoryOpen(false)
          setComposerHistoryIndex(0)
          setHistoryIndex(-1)
          return
        }
      }
      if (composerStashOpen) {
        if (key.name === 'tab' || key.name === 'return') {
          handled(commitComposerStashEntry)
          return
        }
        if (key.name === 'n' && key.ctrl) {
          handled(() => selectComposerStashEntry(composerStashIndex + 1))
          return
        }
        if (key.name === 'p' && key.ctrl) {
          handled(() => selectComposerStashEntry(composerStashIndex - 1))
          return
        }
        if (key.name === 'down' || key.name === 'j') {
          handled(() => selectComposerStashEntry(composerStashIndex + 1))
          return
        }
        if (key.name === 'up' || key.name === 'k') {
          handled(() => selectComposerStashEntry(composerStashIndex - 1))
          return
        }
        if (key.name === 'g' && !key.shift) {
          handled(() => selectComposerStashEntry(0))
          return
        }
        if (key.name === 'g' && key.shift) {
          handled(() => selectComposerStashEntry(composerStash.length - 1))
          return
        }
      }
      if (composerMention && composerMentionResults.length > 0) {
        if (key.name === 'tab' || (key.name === 'return' && key.ctrl)) {
          handled(() => {
            const entry = composerMentionResults[composerMentionIndex] ?? composerMentionResults[0]
            if (entry) insertMentionAtCursor(entry)
          })
          return
        }
        if (key.name === 'n' && key.ctrl) {
          handled(() => setComposerMentionIndex((i) => Math.min(i + 1, composerMentionResults.length - 1)))
          return
        }
        if (key.name === 'p' && key.ctrl) {
          handled(() => setComposerMentionIndex((i) => Math.max(i - 1, 0)))
          return
        }
      }
      if (composerSlashOpen && composerSlashCommands.length > 0) {
        if (key.name === 'tab') {
          handled(() => {
            const entry = composerSlashCommands[composerSlashIndex] ?? composerSlashCommands[0]
            if (entry) insertSlashAtCursor(entry.command)
          })
          return
        }
        if (key.name === 'n' && key.ctrl) {
          handled(() => setComposerSlashIndex((i) => Math.min(i + 1, composerSlashCommands.length - 1)))
          return
        }
        if (key.name === 'p' && key.ctrl) {
          handled(() => setComposerSlashIndex((i) => Math.max(i - 1, 0)))
          return
        }
      }
      if (key.name === 'tab' && livePromptSuggestion && composerSendState !== 'sending') {
        handled(() => {
          composerTextareaRef.current?.setText(livePromptSuggestion)
          setComposerDraft(livePromptSuggestion)
          setLivePromptSuggestion(null)
        })
        return
      }
      if (key.name === 'p' && key.ctrl) {
        handled(() => moveComposerHistory(1))
        return
      }
      if (key.name === 'n' && key.ctrl && historyIndex !== -1) {
        handled(() => moveComposerHistory(-1))
        return
      }
      return
    }

    if (isCtrl('v')) {
      handled(() => {
        setComposerActive(true)
        void pasteSystemClipboardToComposer()
      })
      return
    }

    if (isCtrl('o')) {
      handled(openComposerWindow)
      return
    }

    if ((key.name === 'q' && !key.shift) || key.name === 'escape' || isCtrl('c')) {
      handled(requestExit)
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

    // Global handoff brief popover
    if (isShifted('H')) {
      handled(openHandoffBrief)
      return
    }

    // Global prompt library — saved prompts usable across providers
    if (isShifted('P')) {
      handled(openPromptLibrary)
      return
    }

    // Global live CLI channel bridge — push composer messages into a side-by-side `claude` session
    if (isShifted('C')) {
      handled(openChannelBridge)
      return
    }

    // Global task panel toggle — cycles: closed → tasks → agents → closed
    if (isShifted('T')) {
      handled(() => {
        if (!taskPanelOpen) {
          setTaskPanelOpen(true)
          setTaskPanelTab('tasks')
        } else if (taskPanelTab === 'tasks') {
          setTaskPanelTab('agents')
        } else {
          setTaskPanelOpen(false)
        }
      })
      return
    }

    // Task panel resize (only when open)
    if (taskPanelOpen && sequence === '_') {
      handled(() => resizeTaskPanel(-TASK_PANEL_RESIZE_STEP))
      return
    }
    if (taskPanelOpen && sequence === '+') {
      handled(() => resizeTaskPanel(TASK_PANEL_RESIZE_STEP))
      return
    }

    // Global task lineage popover
    if (isShifted('L')) {
      handled(() => setTaskPopoverOpen(true))
      return
    }

    // Global diagnostics popover
    if (isShifted('D') && selectedSession) {
      handled(() => openDiagnostics())
      return
    }

    // Global bookmarks browser (cross-session)
    if (isShifted('B')) {
      handled(() => { void openBookmarksOverlay() })
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

    // In the transcript, [ and ] jump between bookmarks. In the sidebar they
    // resize the rail (handled by the showRail blocks just below).
    if (effectiveFocus === 'messages' && sequence === ']') {
      handled(() => jumpToBookmark(1))
      return
    }

    if (effectiveFocus === 'messages' && sequence === '[') {
      handled(() => jumpToBookmark(-1))
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
        moveCursor(velocityScrollStep(1))
      })
      return
    }

    if (effectiveFocus === 'messages' && (key.name === 'k' || key.name === 'up')) {
      handled(() => {
        moveCursor(-velocityScrollStep(-1))
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

    if (effectiveFocus === 'messages' && key.name === 'b' && !key.shift) {
      handled(() => {
        void toggleBookmarkForCursor()
      })
      return
    }

    if (effectiveFocus === 'messages' && isShifted('Q')) {
      handled(() => {
        replySelectedMessage()
      })
      return
    }

    if (
      effectiveFocus === 'messages'
      && selectedTranscriptCard?.category === 'diff'
      && selectedTranscriptCardDisplay?.diffView
      && key.shift
      && (key.name === 'j' || key.name === 'down' || key.name === 'k' || key.name === 'up')
    ) {
      const selectedDiffView = selectedTranscriptCardDisplay.diffView
      if (!selectedDiffView) return
      handled(() => {
        const cardKey = selectedTranscriptCard.key
        const currentRows = diffLayout === 'split'
          ? selectedDiffView.splitRows
          : selectedDiffView.rows
        const visibleRows = currentRows.filter((row) => !transcriptDiffHiddenHunkHeaderCardKeys.has(cardKey) || row.tone !== 'hunk')
        if (visibleRows.length === 0) return
        const currentCursor = transcriptDiffRowCursorByCardKey[cardKey] ?? 0
        const currentIndex = clamp(currentCursor, 0, visibleRows.length - 1)
        const delta = key.name === 'j' || key.name === 'down' ? 1 : -1
        const nextIndex = clamp(currentIndex + delta, 0, visibleRows.length - 1)
        setTranscriptDiffSelectionAnchorByCardKey((prev) => (
          prev[cardKey] != null ? prev : { ...prev, [cardKey]: currentIndex }
        ))
        setTranscriptDiffRowCursorForCard(cardKey, nextIndex, true)
      })
      return
    }

    if (effectiveFocus === 'messages' && selectedTranscriptCard?.category === 'diff' && selectedTranscriptCardDisplay?.diffView) {
      const selectedDiffView = selectedTranscriptCardDisplay.diffView
      if (!selectedDiffView) return
      const cardKey = selectedTranscriptCard.key
      const currentRows = diffLayout === 'split'
        ? selectedDiffView.splitRows
        : selectedDiffView.rows
      const visibleRows = currentRows.filter((row) => !transcriptDiffHiddenHunkHeaderCardKeys.has(cardKey) || row.tone !== 'hunk')
      const currentCursor = transcriptDiffRowCursorByCardKey[cardKey] ?? 0
      const currentIndex = visibleRows.length > 0 ? clamp(currentCursor, 0, visibleRows.length - 1) : 0
      const currentRow = visibleRows[currentIndex] ?? null
      const noteAnchorNamespace = selectedSessionIdentity ?? 'no-session'
      const selectionAnchorIndex = transcriptDiffSelectionAnchorByCardKey[cardKey] ?? null
      const currentSelectionSpan = selectionAnchorIndex != null
        ? transcriptDiffSelectionSpanFromRowRange(noteAnchorNamespace, visibleRows, selectionAnchorIndex, currentIndex)
        : (currentRow
          ? transcriptDiffSelectionSpanFromRowRange(noteAnchorNamespace, visibleRows, currentIndex, currentIndex)
          : null)
      const noteSelection = currentSelectionSpan?.selection ?? null
      const noteSelectionKey = currentSelectionSpan?.key ?? null
      const hunkHeadersVisible = !transcriptDiffHiddenHunkHeaderCardKeys.has(cardKey)

      if (key.sequence === 'v') {
        handled(() => {
          toggleTranscriptDiffCardSet(setTranscriptDiffPlainCardKeys, cardKey)
          clearTranscriptDiffSelectionForCard(cardKey)
        })
        return
      }
      if (key.sequence === 'n') {
        handled(() => {
          toggleTranscriptDiffCardSet(setTranscriptDiffHiddenLineNumberCardKeys, cardKey)
          clearTranscriptDiffSelectionForCard(cardKey)
        })
        return
      }
      if (key.sequence === 'm') {
        handled(() => {
          toggleTranscriptDiffCardSet(setTranscriptDiffHiddenHunkHeaderCardKeys, cardKey)
          clearTranscriptDiffSelectionForCard(cardKey)
        })
        return
      }
      if (key.sequence === '{') {
        handled(() => {
          const next = nextTranscriptDiffRowIndex(visibleRows, currentIndex, -1, hunkHeadersVisible)
          if (next != null) setTranscriptDiffRowCursorForCard(cardKey, next)
        })
        return
      }
      if (key.sequence === '}') {
        handled(() => {
          const next = nextTranscriptDiffRowIndex(visibleRows, currentIndex, 1, hunkHeadersVisible)
          if (next != null) setTranscriptDiffRowCursorForCard(cardKey, next)
        })
        return
      }
      if (key.sequence === 'a') {
        handled(() => {
          if (!noteSelection) {
            showNotice('info', 'No diff row selected')
            return
          }
          openTranscriptDiffNote(noteSelection)
        })
        return
      }
      if (key.sequence === 'x') {
        handled(() => {
          if (!noteSelectionKey) {
            showNotice('info', 'No diff row selected')
            return
          }
          if (!transcriptDiffNotes.has(noteSelectionKey)) {
            showNotice('info', 'No note on the selected diff row')
            return
          }
          deleteTranscriptDiffNote(noteSelectionKey)
        })
        return
      }
      if (key.sequence === 'C') {
        handled(() => {
          if (!noteSelectionKey) {
            showNotice('info', 'No diff row selected')
            return
          }
          const note = transcriptDiffNotes.get(noteSelectionKey)
          if (!note) {
            showNotice('info', 'No note on the selected diff row')
            return
          }
          sendTranscriptDiffNoteToComposer(
            selectedTranscriptCard,
            note,
            currentSelectionSpan?.label ?? transcriptDiffSelectionLineLabel(note.range),
            cardDiffText(selectedTranscriptCard, resolvedExpandedKeys.has(selectedTranscriptCard.key)),
          )
          showNotice('info', 'Diff comment added to composer')
        })
        return
      }
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

    if (effectiveFocus === 'messages' && sequence === 's') {
      const selectedCard = visibleTranscriptCards[cursorIndex]
      if (selectedCard?.category === 'diff') {
        handled(() => {
          const next: TuiDiffLayout = diffLayout === 'stack' ? 'split' : 'stack'
          setDiffLayout(next)
          void writeTuiDiffLayout(next).catch((err) => {
            setError(err instanceof Error ? err.message : 'Failed to store diff layout')
          })
        })
        return
      }
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

    if (sequence === 'N' && !composerActive) {
      handled(() => {
        const targetProvider = provider === 'all'
          ? (selectedSession?.provider ?? 'claude')
          : provider
        const cwd = selectedSession?.cwd ?? process.cwd()
        void (async () => {
          try {
            const result = await createNewViewSession({ provider: targetProvider, cwd })
            const draft: Session = {
              sessionId: result.sessionId,
              provider: result.provider,
              cwd: result.cwd,
              createdAt: Date.now(),
              lastModified: Date.now(),
              summary: 'New session',
              isPending: result.isPending,
            }
            setOpenTabSessions((prev) => prev.some((s) => sessionKey(s) === sessionKey(draft)) ? prev : [...prev, draft])
            setSelectedSessionKey(sessionKey(draft))
            await refreshSessions(provider, true, false)
            setComposerActive(true)
            setNotice({
              tone: 'info',
              text: result.isPending
                ? `New ${formatProviderLabel(result.provider)} session ready — first message will create it.`
                : 'New session created.',
            })
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create session')
          }
        })()
      })
      return
    }

    if (sequence === 'R' && !composerActive) {
      handled(() => {
        const messages = sessionDetail?.threadedMessages
        if (!messages || messages.length === 0) return
        let lastUserText = ''
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const msg = messages[i]
          if (msg.role !== 'user') continue
          const text = msg.blocks
            .map((block) => {
              if (block.type === 'text') return block.text ?? ''
              if (block.type === 'local_command_stdout' && 'stdout' in block && typeof block.stdout === 'string') return block.stdout
              return ''
            })
            .join('\n')
            .trim()
          if (text.length > 0) {
            lastUserText = text
            break
          }
        }
        if (!lastUserText) return
        setComposerActive(true)
        composerTextareaRef.current?.setText(lastUserText)
        setComposerDraft(lastUserText)
      })
      return
    }

    if (sequence === 'i') {
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

    if (sequence === 'V') {
      handled(() => {
        setVelocityScrollEnabled((v) => {
          const next = !v
          void writeTuiVelocityScroll(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store velocity scroll'))
          setNotice({ tone: 'info', text: next ? 'Velocity scroll enabled' : 'Velocity scroll disabled' })
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

    if (sequence === 'v' && !key.ctrl && !key.meta) {
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
        `position ${visibleTranscriptCards.length === 0 ? '0' : `${Math.max(cursorIndex, 0) + 1}`}/${visibleTranscriptCards.length}`,
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
    [statusLabel, visibleTranscriptCards.length, cursorIndex, readerMode, sessionIdLabel, themeMode, provider, density, pendingNewCount, railVisible, width],
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
  const composerPlaceholder = composerTargetSession
    ? (composerSendState === 'sending'
        ? composerConfig.placeholderStreaming
        : composerExample)
    : composerConfig.placeholderNoSession
  const composerActiveAttachments = useMemo(
    () => prepareComposerSubmission(composerDraft, composerMentionAttachments, composerPromptParts).attachments,
    [composerDraft, composerMentionAttachments, composerPromptParts, prepareComposerSubmission],
  )
  const composerAttachmentLabel = attachmentCountLabel(composerActiveAttachments)
  const composerDockStatsSegments = useMemo<InlineTextSegment[]>(
    () => buildComposerStatsSegments(composerVisualLineCount),
    [composerAccentColor, composerAttachmentLabel, composerConfig.glyph, composerConfig.label, composerDraft.length, composerKnobSegments, composerLocationSegments, composerVisualLineCount, theme.cyan, theme.dim, theme.text],
  )
  const composerWindowStatsSegments = useMemo<InlineTextSegment[]>(
    () => buildComposerStatsSegments(composerWindowVisualLineCount),
    [composerAccentColor, composerAttachmentLabel, composerConfig.glyph, composerConfig.label, composerDraft.length, composerKnobSegments, composerLocationSegments, composerWindowVisualLineCount, theme.cyan, theme.dim, theme.text],
  )
  const composerBaseTextareaStyle = {
    backgroundColor: theme.surface,
    textColor: theme.text,
    focusedBackgroundColor: theme.surface,
    focusedTextColor: theme.text,
    placeholderColor: theme.dim,
  }
  const composerDockTextareaStyle = {
    ...composerBaseTextareaStyle,
    flexGrow: 1,
  }
  const sendingHintBase = interruptPressActive
    ? composerConfig.footerHintSending.replace('⌃C cancel', '⌃C again to interrupt')
    : composerTargetSession?.provider === 'claude' && activeRunningToolCount > 0
    ? `${composerConfig.footerHintSending} · ⌃B background`
    : composerConfig.footerHintSending
  const composerDockFooterHint = composerSendState === 'sending'
    ? sendingHintBase
    : `${composerIdleFooterHint} · ⌃O expand`
  // Size the hint box to exactly fit its text, capped by available width minus
  // 24 chars reserved for the stats side. Avoids the old proportional cap (62
  // chars) that truncated the full idle hint (~72 chars on most terminals).
  const composerDockFooterHintWidth = Math.max(
    18,
    Math.min(composerDockFooterHint.length + 1, composerDockTextareaWidth - 24),
  )
  const composerDockFooterStatsWidth = Math.max(composerDockTextareaWidth - composerDockFooterHintWidth - 1, 8)
  const composerWindowFooterHint = composerSendState === 'sending'
    ? `${sendingHintBase} · ⌃O dock`
    : '⏎ send · ⌥M model/effort · ⇧⏎ newline · ⌃O dock · Esc close'
  const composerWindowFooterHintWidth = Math.max(
    18,
    Math.min(composerWindowFooterHint.length + 1, composerWindowContentWidth - 16),
  )
  const composerWindowFooterStatsWidth = Math.max(composerWindowContentWidth - composerWindowFooterHintWidth - 1, 8)
  const submitComposerFromDock = () => {
    void sendComposerMessage(composerTextareaRef.current?.plainText ?? composerDraft)
  }
  const submitComposerFromWindow = () => {
    const draft = composerTextareaRef.current?.plainText ?? composerDraft
    if (draft.trim() && composerTargetSession) {
      rememberComposerCursor()
      setComposerWindowOpen(false)
    }
    void sendComposerMessage(draft)
  }
  const renderComposerTextarea = (
    onSubmit: () => void,
    options?: { height?: number; width?: number },
  ) => (
    <textarea
      ref={composerTextareaRef}
      focused={composerActive}
      width={options?.width}
      height={options?.height}
      placeholder={composerPlaceholder}
      initialValue={composerDraft}
      keyBindings={composerKeyBindings}
      syntaxStyle={composerSyntaxStyle}
      onContentChange={handleComposerContentChange}
      onSubmit={onSubmit}
      style={options?.height ? composerBaseTextareaStyle : composerDockTextareaStyle}
    />
  )
  const renderComposerMentionPanel = (panelWidth: number, rowWidth: number) => {
    if (!composerActive || !composerMention || composerMentionVisibleCount <= 0) return null
    const basenameWidth = Math.max(Math.min(28, Math.floor(rowWidth * 0.4)), 8)
    const pathWidth = Math.max(rowWidth - basenameWidth - 4, 4)
    const total = composerMentionResults.length
    const start = Math.max(0, Math.min(composerMentionIndex - Math.floor((composerMentionVisibleCount - 1) / 2), total - composerMentionVisibleCount))
    const end = Math.min(total, start + composerMentionVisibleCount)
    const hasMoreBelow = end < total
    const hasMoreAbove = start > 0
    return (
      <box
        width={panelWidth}
        height={composerMentionVisibleCount + 3}
        paddingX={1}
        backgroundColor={theme.surface2}
        border
        borderStyle="single"
        borderColor={theme.border2}
        flexDirection="column"
      >
        <text fg={composerAccentColor} wrapMode="none">
          {fitText(`${composerConfig.label} ${composerProvider === 'opencode' ? 'files/agents' : 'files'} · ⌃P/⌃N select · tab insert · esc cancel  (${composerMentionIndex + 1}/${total})${hasMoreAbove ? ' ↑' : ''}${hasMoreBelow ? ' ↓' : ''}`, rowWidth)}
        </text>
        {composerMentionResults.slice(start, end).map((entry, offset) => {
          const index = start + offset
          const active = index === composerMentionIndex
          const label = entry.kind === 'agent' ? `@${entry.name}` : entry.basename
          const detail = entry.kind === 'agent'
            ? [entry.mode, entry.description].filter(Boolean).join(' · ')
            : entry.path
          return (
            <box key={entry.kind === 'agent' ? `agent:${entry.name}` : `file:${entry.path}`} flexDirection="row" height={1} width={rowWidth}>
              <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
              <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{fitText(label, basenameWidth)}</text>
              <text fg={theme.dim} wrapMode="none">  </text>
              <text fg={theme.dim} wrapMode="none">{fitText(detail, pathWidth)}</text>
            </box>
          )
        })}
      </box>
    )
  }
  const renderComposerSlashPanel = (panelWidth: number, rowWidth: number) => {
    if (!composerActive || !composerSlashOpen || composerSlashVisibleCount <= 0 || composerMention) return null
    const hasHint = composerSlashCommands.some((entry) => Boolean(entry.argumentHint))
    const commandRatio = hasHint ? 0.45 : 0.3
    const commandCap = hasHint ? 36 : 22
    const commandWidth = Math.max(Math.min(commandCap, Math.floor(rowWidth * commandRatio)), 8)
    const descWidth = Math.max(rowWidth - commandWidth - 4, 4)
    const total = composerSlashCommands.length
    const start = Math.max(0, Math.min(composerSlashIndex - Math.floor((composerSlashVisibleCount - 1) / 2), total - composerSlashVisibleCount))
    const end = Math.min(total, start + composerSlashVisibleCount)
    const hasMoreBelow = end < total
    const hasMoreAbove = start > 0
    return (
      <box
        width={panelWidth}
        height={composerSlashVisibleCount + 3}
        paddingX={1}
        backgroundColor={theme.surface2}
        border
        borderStyle="single"
        borderColor={theme.border2}
        flexDirection="column"
      >
        <text fg={composerAccentColor} wrapMode="none">
          {fitText(`${composerConfig.label} commands · ⌃P/⌃N select · tab insert · esc cancel  (${composerSlashIndex + 1}/${total})${hasMoreAbove ? ' ↑' : ''}${hasMoreBelow ? ' ↓' : ''}`, rowWidth)}
        </text>
        {composerSlashCommands.slice(start, end).map((entry, offset) => {
          const index = start + offset
          const active = index === composerSlashIndex
          const commandText = entry.argumentHint
            ? fitText(`${entry.command} ${entry.argumentHint}`, commandWidth)
            : fitText(entry.command, commandWidth)
          return (
            <box key={entry.command} flexDirection="row" height={1} width={rowWidth}>
              <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
              <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{commandText}</text>
              <text fg={theme.dim} wrapMode="none">  </text>
              <text fg={theme.dim} wrapMode="none">{fitText(entry.description, descWidth)}</text>
            </box>
          )
        })}
      </box>
    )
  }
  const renderComposerHistoryPanel = (panelWidth: number, rowWidth: number) => {
    if (!composerActive || !composerHistoryOpen || composerHistoryVisibleCount <= 0 || composerMention) return null
    const total = sentHistory.length
    const start = Math.max(0, Math.min(composerHistoryIndex - Math.floor((composerHistoryVisibleCount - 1) / 2), total - composerHistoryVisibleCount))
    const end = Math.min(total, start + composerHistoryVisibleCount)
    const hasMoreBelow = end < total
    const hasMoreAbove = start > 0
    const metaWidth = Math.max(Math.min(22, Math.floor(rowWidth * 0.28)), 10)
    const textWidth = Math.max(rowWidth - metaWidth - 4, 8)
    return (
      <box
        width={panelWidth}
        height={composerHistoryVisibleCount + 3}
        paddingX={1}
        backgroundColor={theme.surface2}
        border
        borderStyle="single"
        borderColor={theme.border2}
        flexDirection="column"
      >
        <text fg={composerAccentColor} wrapMode="none">
          {fitText(`history · ⌃P older · ⌃N newer · tab/enter use · esc cancel  (${composerHistoryIndex + 1}/${total})${hasMoreAbove ? ' ↑' : ''}${hasMoreBelow ? ' ↓' : ''}`, rowWidth)}
        </text>
        {sentHistory.slice().reverse().slice(start, end).map((entry, offset) => {
          const index = start + offset
          const active = index === composerHistoryIndex
          const text = composerSnapshotText(entry)
          const compact = compactComposerEntryText(text)
          const lineCount = composerEntryLineCount(text)
          const attachmentLabel = attachmentCountLabel(entry.attachments)
          const meta = `${lineCount} line${lineCount === 1 ? '' : 's'} · ${text.length} chars${attachmentLabel ? ` · ${attachmentLabel}` : ''}`
          return (
            <box key={`history:${total - 1 - index}:${text.length}:${offset}`} flexDirection="row" height={1} width={rowWidth}>
              <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
              <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{fitText(compact, textWidth)}</text>
              <text fg={theme.dim} wrapMode="none">  </text>
              <text fg={theme.dim} wrapMode="none">{fitText(meta, metaWidth)}</text>
            </box>
          )
        })}
      </box>
    )
  }
  const renderComposerStashPanel = (panelWidth: number, rowWidth: number) => {
    if (!composerActive || !composerStashOpen || composerStashVisibleCount <= 0 || composerMention) return null
    const total = composerStash.length
    const start = Math.max(0, Math.min(composerStashIndex - Math.floor((composerStashVisibleCount - 1) / 2), total - composerStashVisibleCount))
    const end = Math.min(total, start + composerStashVisibleCount)
    const hasMoreBelow = end < total
    const hasMoreAbove = start > 0
    const metaWidth = Math.max(Math.min(22, Math.floor(rowWidth * 0.28)), 10)
    const textWidth = Math.max(rowWidth - metaWidth - 4, 8)
    return (
      <box
        width={panelWidth}
        height={composerStashVisibleCount + 3}
        paddingX={1}
        backgroundColor={theme.surface2}
        border
        borderStyle="single"
        borderColor={theme.border2}
        flexDirection="column"
      >
        <text fg={composerAccentColor} wrapMode="none">
          {fitText(`stash · ⌃P older · ⌃N newer · tab/enter restore · esc close  (${composerStashIndex + 1}/${total})${hasMoreAbove ? ' ↑' : ''}${hasMoreBelow ? ' ↓' : ''}`, rowWidth)}
        </text>
        {composerStash.slice().reverse().slice(start, end).map((entry, offset) => {
          const index = start + offset
          const active = index === composerStashIndex
          const text = composerSnapshotText(entry)
          const compact = compactComposerEntryText(text)
          const lineCount = composerEntryLineCount(text)
          const attachmentLabel = attachmentCountLabel(entry.attachments)
          const meta = `${lineCount} line${lineCount === 1 ? '' : 's'} · ${text.length} chars${attachmentLabel ? ` · ${attachmentLabel}` : ''}`
          return (
            <box key={`stash:${total - 1 - index}:${text.length}:${offset}`} flexDirection="row" height={1} width={rowWidth}>
              <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
              <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{fitText(compact, textWidth)}</text>
              <text fg={theme.dim} wrapMode="none">  </text>
              <text fg={theme.dim} wrapMode="none">{fitText(meta, metaWidth)}</text>
            </box>
          )
        })}
      </box>
    )
  }

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
            titleColor={theme.cyan}
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
                  scrollbarOptions={sidebarScrollbarOptions}
                >
                  {sidebarRowElements}
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
            titleColor={providerAccent}
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

          {!followTail ? (
            <box paddingX={1} marginTop={1}>
              <text fg={theme.amber}>
                {pendingNewCount > 0
                  ? fitText(`+${pendingNewCount} new messages waiting. Press u for first unread or f for live tail.`, rightPaneWidth - 4)
                  : ' '}
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
            {loadingDetail && visibleTranscriptCards.length === 0 ? (
              <Spinner label={fitText('Loading transcript…', rightPaneWidth - 6)} fg={theme.dim} />
            ) : visibleTranscriptCards.length === 0 ? (
              !selectedSession ? (
                <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1} paddingY={2}>
                  <ascii-font text="AGENT VIEWER" font="tiny" color={theme.dim} />
                  <box marginTop={1}>
                    <text fg={theme.dim}>Select a session to begin reading</text>
                  </box>
                </box>
              ) : (
                (() => {
                  const welcome = getProviderComposer(selectedSession.provider ?? null)
                  const welcomeAccent = ((theme as unknown as Record<string, string>)[welcome.tuiAccentKey]) ?? theme.cyan
                  const innerWidth = Math.max(rightPaneWidth - 4, 20)
                  return (
                    <box flexDirection="column" paddingY={1}>
                      <text fg={welcomeAccent} wrapMode="none">{fitText(welcome.welcomeTitle, innerWidth)}</text>
                      <text fg={theme.dim} wrapMode="none">{fitText(welcome.welcomeSubtitle, innerWidth)}</text>
                      {selectedSession.cwd ? (
                        <box marginTop={1}>
                          <text fg={theme.dim} wrapMode="none">{fitText(`cwd  ${selectedSession.cwd}`, innerWidth)}</text>
                        </box>
                      ) : null}
                      <box marginTop={1} flexDirection="column">
                        {welcome.welcomeBullets.map((bullet) => (
                          <box key={bullet} flexDirection="row" height={1} width={innerWidth}>
                            <text fg={welcomeAccent} wrapMode="none">{welcome.glyph} </text>
                            <text fg={theme.text} wrapMode="none">{fitText(bullet, innerWidth - 2)}</text>
                          </box>
                        ))}
                      </box>
                      <box marginTop={1}>
                        <text fg={theme.dim} wrapMode="none">{fitText('Press c to open the composer and start chatting.', innerWidth)}</text>
                      </box>
                    </box>
                  )
                })()
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
                scrollbarOptions={transcriptScrollbarOptions}
                >
                <box height={TRANSCRIPT_TOP_MARGIN} />
                <TuiErrorBoundary>
                  {transcriptChildren}
                </TuiErrorBoundary>

                {composerSendState === 'sending' && composerLiveText && !codexLiveAssistantTextVisible ? (
                  <box
                    key="live-stream-text"
                    flexDirection="column"
                    marginBottom={densityState.cardGap}
                  >
                    <box
                      borderStyle="single"
                      borderColor={providerAccent}
                      backgroundColor={theme.surface}
                    >
                      <box flexDirection="column" width={rightPaneWidth - 4}>
                        <box paddingX={1} paddingTop={1}>
                          <text fg={providerAccent}>
                            {fitText(`● assistant  streaming`, rightPaneWidth - 6)}
                          </text>
                        </box>
                        <box paddingX={1} paddingY={1}>
                          <text fg={theme.text} wrapMode="word">
                            {composerLiveText}
                          </text>
                        </box>
                      </box>
                    </box>
                  </box>
                ) : null}

              </scrollbox>
            )}
          </box>

          {followTail && visibleTranscriptCards.length > 0 ? (
            <box paddingX={2} paddingBottom={1}>
              <IdleTicker seed={selectedSessionKey ?? ''} fg={theme.dim} />
            </box>
          ) : null}
          </box>
        </box>

        {taskPanelOpen ? (
          <box width={taskPanelWidth} overflow="hidden" marginLeft={1}>
            <TaskSidePanel
              messages={taskPanelMessages}
              todos={composerLiveTodos}
              session={selectedSession}
              theme={theme}
              width={taskPanelWidth}
              height={mainContentHeight - 2}
              onSelectTask={(uuid) => {
                const idx = visibleTranscriptCards.findIndex((c) => c.key === uuid)
                if (idx >= 0) jumpToTranscriptIndex(idx)
              }}
              tab={taskPanelTab}
              liveSubagentText={liveSubagentText}
            />
          </box>
        ) : null}

        {(() => {
          // All floating select overlays share this palette so light-themed
          // backgrounds never wash out the overlay text.
          const ot = LIGHT_MODES.includes(themeMode) ? getThemePalette('dark') : theme
          return (<>
            {providerMenuOpen ? (
              <box
                position="absolute"
                top={focusMode ? 1 : 3}
                right={2}
                width={34}
                height={14}
                border
                borderStyle="single"
                borderColor={ot.border2}
                backgroundColor={ot.surface}
                zIndex={20}
                flexDirection="column"
              >
                <box paddingX={1} paddingTop={1}>
                  <text fg={ot.text}>PROVIDERS</text>
                </box>
                <box flexGrow={1} paddingX={1} paddingBottom={1}>
                  <select
                    style={{ height: 10 }}
                    focused
                    options={providerOptions}
                    selectedIndex={providerMenuIndex}
                    selectedBackgroundColor={ot.surface3}
                    selectedTextColor={ot.text}
                    textColor={ot.muted}
                    descriptionColor={ot.dim}
                    selectedDescriptionColor={ot.cyan}
                    backgroundColor={ot.surface}
                    focusedBackgroundColor={ot.surface}
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

            {modelPickerOpen ? (() => {
              const overlayWidth = Math.min(78, Math.max(width - 4, 44))
              const overlayHeight = Math.min(18, Math.max(height - 2, 12))
              const contentWidth = Math.max(overlayWidth - 5, 38)
              const modelWidth = Math.max(Math.floor(contentWidth * 0.6), 22)
              const effortWidth = Math.max(contentWidth - modelWidth - 1, 15)
              return (
                <box
                  position="absolute"
                  top={Math.max(1, Math.floor((height - overlayHeight) / 2))}
                  left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
                  width={overlayWidth}
                  height={overlayHeight}
                  border
                  borderStyle="single"
                  borderColor={ot.border2}
                  backgroundColor={ot.surface}
                  zIndex={70}
                  flexDirection="column"
                  title=" Composer settings "
                  titleColor={composerAccentColor}
                  titleAlignment="left"
                >
                  <box height={2} paddingX={1} flexDirection="row" alignItems="center">
                    <text fg={ot.text} wrapMode="none">
                      {`${String(modelPickerTarget?.provider ?? 'session').toUpperCase()} · MODEL & EFFORT`}
                    </text>
                    <box flexGrow={1} />
                    <text fg={ot.dim} wrapMode="none">tab/←/→ switch · enter apply · esc close</text>
                  </box>
                  <box flexGrow={1} paddingX={1} paddingBottom={1} flexDirection="row" gap={1}>
                    <box width={modelWidth} flexDirection="column">
                      <text fg={modelPickerFocus === 'model' ? ot.cyan : ot.dim} wrapMode="none">
                        {modelPickerFocus === 'model' ? '▸ MODEL' : '  MODEL'}
                      </text>
                      {modelPickerLoading ? (
                        <text fg={ot.dim} wrapMode="none">Loading provider models…</text>
                      ) : modelPickerError ? (
                        <text fg={ot.red} wrapMode="word">{modelPickerError}</text>
                      ) : modelPickerOptions.length === 0 ? (
                        <text fg={ot.dim} wrapMode="none">No models available</text>
                      ) : (
                        <select
                          style={{ height: Math.max(overlayHeight - 6, 6) }}
                          focused={modelPickerFocus === 'model'}
                          options={modelPickerOptions}
                          selectedIndex={modelPickerIndex}
                          selectedBackgroundColor={ot.surface3}
                          selectedTextColor={ot.text}
                          textColor={ot.muted}
                          descriptionColor={ot.dim}
                          selectedDescriptionColor={ot.cyan}
                          backgroundColor={ot.surface}
                          focusedBackgroundColor={ot.surface}
                          showScrollIndicator={false}
                          itemSpacing={0}
                          onChange={(index) => setModelPickerIndex(index)}
                          onSelect={(_, option) => {
                            const target = modelPickerTarget ?? composerTargetSession ?? selectedSession
                            const value = typeof option?.value === 'string' ? option.value : ''
                            if (target && value) {
                              setTuiModelOverride((prev) => ({ ...prev, [sessionKey(target)]: value }))
                              pushClaudeControl(target, { action: 'setModel', model: value })
                            }
                            if (modelPickerEffortOptions.length > 1) {
                              setModelPickerFocus('effort')
                            } else {
                              setTuiEffort('auto')
                              setModelPickerOpen(false)
                            }
                          }}
                        />
                      )}
                    </box>
                    <box width={effortWidth} flexDirection="column">
                      <text fg={modelPickerFocus === 'effort' ? ot.cyan : ot.dim} wrapMode="none">
                        {modelPickerFocus === 'effort' ? '▸ EFFORT' : '  EFFORT'}
                      </text>
                      <select
                        style={{ height: Math.max(overlayHeight - 6, 6) }}
                        focused={modelPickerFocus === 'effort'}
                        options={modelPickerEffortOptions}
                        selectedIndex={modelPickerEffortIndex}
                        selectedBackgroundColor={ot.surface3}
                        selectedTextColor={ot.text}
                        textColor={ot.muted}
                        descriptionColor={ot.dim}
                        selectedDescriptionColor={ot.cyan}
                        backgroundColor={ot.surface}
                        focusedBackgroundColor={ot.surface}
                        showScrollIndicator={false}
                        itemSpacing={0}
                        onChange={(index) => setModelPickerEffortIndex(index)}
                        onSelect={(_, option) => {
                          const value = option?.value
                          if (typeof value === 'string') setTuiEffort(value as TuiEffort)
                          setModelPickerOpen(false)
                        }}
                      />
                    </box>
                  </box>
                </box>
              )
            })() : null}
          </>)
        })()}

        {themeMenuOpen ? (() => {
          const originTheme = themeMenuOriginRef.current
          // Use the origin palette when it's dark; fall back to 'dark' when the
          // origin is a light theme so the overlay is always readable.
          const overlayTheme = originTheme && !LIGHT_MODES.includes(originTheme)
            ? getThemePalette(originTheme)
            : getThemePalette('dark')
          const menuHeight = Math.max(14, Math.min(height - 4, 32))
          const groupThemes = themeMenuGroup === 'light' ? LIGHT_MODES : DARK_MODES
          const currentTheme = THEMES[themeMenuIndex]
          const localIndex = Math.max(
            currentTheme && groupThemes.includes(currentTheme) ? groupThemes.indexOf(currentTheme) : 0,
            0,
          )
          const groupOptions = groupThemes.map((mode) => ({
            name: THEME_LABELS[mode] + (mode === originTheme ? ' ✓' : ''),
            description: THEME_DESCRIPTIONS[mode],
            value: mode,
          }))
          return (
            <box
              position="absolute"
              top={focusMode ? 1 : 3}
              right={2}
              width={36}
              height={menuHeight}
              border
              borderStyle="single"
              borderColor={overlayTheme.border2}
              backgroundColor={overlayTheme.surface}
              zIndex={20}
              flexDirection="column"
            >
              <box paddingX={2} paddingBottom={1} flexDirection="row">
                <text fg={themeMenuGroup === 'light' ? overlayTheme.cyan : overlayTheme.muted} wrapMode="none">LIGHT</text>
                <text fg={overlayTheme.dim} wrapMode="none">  |  </text>
                <text fg={themeMenuGroup === 'dark' ? overlayTheme.cyan : overlayTheme.muted} wrapMode="none">DARK</text>
                <text fg={overlayTheme.dim} wrapMode="none">   ← →</text>
              </box>
              <box flexGrow={1} paddingX={1} paddingBottom={1}>
                <select
                  style={{ height: menuHeight - 6 }}
                  focused
                  options={groupOptions}
                  selectedIndex={localIndex}
                  selectedBackgroundColor={overlayTheme.surface3}
                  selectedTextColor={overlayTheme.text}
                  textColor={overlayTheme.muted}
                  descriptionColor={overlayTheme.dim}
                  selectedDescriptionColor={overlayTheme.cyan}
                  backgroundColor={overlayTheme.surface}
                  focusedBackgroundColor={overlayTheme.surface}
                  showScrollIndicator={false}
                  showDescription={false}
                  itemSpacing={0}
                  onChange={(index) => {
                    const next = groupThemes[index]
                    if (next) {
                      setThemeMenuIndex(THEMES.indexOf(next))
                      setThemeMode(next)
                    }
                  }}
                  onSelect={(_, option) => {
                    const next = option?.value as TuiThemeMode | undefined
                    if (next) chooseTheme(next)
                  }}
                />
              </box>
            </box>
          )
        })() : null}

        {commandPaletteOpen ? (() => {
          const paletteW = Math.min(width - 8, 64)
          const labelW = paletteW - 10
          // Keep the absolute overlay bounded with a deterministic row window.
          // Stable slot keys avoid stale terminal cells as the window moves.
          const selectedRowIndex = paletteDisplayRows.findIndex((row) => row.kind === 'cmd' && row.cmdIndex === commandPaletteIndex)
          const maxStart = Math.max(0, paletteDisplayRows.length - commandPaletteBodyRows)
          const startIdx = clamp((selectedRowIndex === -1 ? 0 : selectedRowIndex) - Math.floor(commandPaletteBodyRows / 2), 0, maxStart)
          const visibleRows = paletteDisplayRows.slice(startIdx, startIdx + commandPaletteBodyRows)
          const hiddenAbove = startIdx
          const hiddenBelow = Math.max(0, paletteDisplayRows.length - (startIdx + commandPaletteBodyRows))
          const positionHint = filteredCommands.length > 0
            ? `  ${Math.min(commandPaletteIndex + 1, filteredCommands.length)}/${filteredCommands.length}`
            : ''
          return (
            <box
              position="absolute"
              top={commandPaletteTopOffset}
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
                <text fg={theme.dim}>{fitText(`> ${commandPaletteQuery}█  j/k  enter  esc${positionHint}`, paletteW - 4)}</text>
              </box>
              {hiddenAbove > 0 ? (
                <box paddingX={1}>
                  <text fg={theme.dim} wrapMode="none">{`▲ ${hiddenAbove} more`}</text>
                </box>
              ) : null}
              {filteredCommands.length === 0 ? (
                <box paddingX={1}>
                  <text fg={theme.dim}>no matches</text>
                </box>
              ) : visibleRows.map((row, i) => {
                if (row.kind === 'header') {
                  return (
                    <box key={`palette-row:${i}`} paddingX={1} backgroundColor={theme.surface2}>
                      <text fg={theme.dim}>{row.label.toUpperCase()}</text>
                    </box>
                  )
                }
                const isSelected = row.cmdIndex === commandPaletteIndex
                return (
                  <box
                    key={`palette-row:${i}`}
                    paddingX={1}
                    backgroundColor={isSelected ? theme.surface3 : theme.surface}
                    flexDirection="row"
                  >
                    <box flexGrow={1}>
                      <text fg={isSelected ? theme.text : theme.muted} wrapMode="none">
                        {fitText(row.cmd.label, labelW)}
                      </text>
                    </box>
                    <text fg={isSelected ? theme.cyan : theme.dim}>{row.cmd.key}</text>
                  </box>
                )
              })}
              {hiddenBelow > 0 ? (
                <box paddingX={1}>
                  <text fg={theme.dim} wrapMode="none">{`▼ ${hiddenBelow} more`}</text>
                </box>
              ) : null}
            </box>
          )
        })() : null}

        {bookmarksOverlayOpen ? (() => {
          const overlayW = Math.min(width - 6, 88)
          const labelW = overlayW - 4
          const maxRows = Math.max(Math.min(bookmarksOverlay.length, (focusMode ? height - 6 : height - 8)), 1)
          const startIdx = clamp(bookmarksOverlayIndex - Math.floor(maxRows / 2), 0, Math.max(0, bookmarksOverlay.length - maxRows))
          const visible = bookmarksOverlay.slice(startIdx, startIdx + maxRows)
          return (
            <box
              position="absolute"
              top={focusMode ? 2 : 4}
              left={Math.max(Math.floor((width - overlayW) / 2), 2)}
              width={overlayW}
              border
              borderStyle="single"
              borderColor={theme.amber}
              backgroundColor={theme.surface}
              zIndex={32}
              flexDirection="column"
            >
              <box paddingX={1} paddingTop={1} backgroundColor={theme.surface2}>
                <text fg={theme.amber}>{fitText(`★ BOOKMARKS  ·  ${bookmarksOverlay.length} saved  ·  j/k move  ·  enter open  ·  esc close`, overlayW - 4)}</text>
              </box>
              {bookmarksOverlay.length === 0 ? (
                <box paddingX={1} paddingY={1}>
                  <text fg={theme.dim}>No bookmarks yet — press b on a message to save one.</text>
                </box>
              ) : visible.map((record, i) => {
                const absoluteIndex = startIdx + i
                const isSelected = absoluteIndex === bookmarksOverlayIndex
                const tag = TUI_PROVIDER_TAG[record.provider] ?? record.provider
                const title = record.sessionTitle || 'Untitled session'
                const preview = (record.preview || '').replace(/\s+/g, ' ').trim()
                return (
                  <box key={`${record.provider}:${record.sessionId}:${record.uuid}`} paddingX={1} backgroundColor={isSelected ? theme.surface3 : theme.surface} flexDirection="column">
                    <box flexDirection="row">
                      <text fg={isSelected ? theme.cyan : theme.amber} wrapMode="none">{`${isSelected ? '> ' : '  '}[${tag}] `}</text>
                      <text fg={isSelected ? theme.text : theme.muted} wrapMode="none">{fitText(title, labelW - tag.length - 6)}</text>
                    </box>
                    {preview ? (
                      <box paddingLeft={2}>
                        <text fg={theme.dim} wrapMode="none">{fitText(preview, labelW - 2)}</text>
                      </box>
                    ) : null}
                  </box>
                )
              })}
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

      {pendingPermissions.length > 0 ? (() => {
        const permission = pendingPermissions[0]!
        const options = permissionOptionsFor(permission)
        const selectedIndex = Math.min(permissionOptionIndex, options.length - 1)
        const innerWidth = Math.max(width - 8, 20)
        const diffLines = permission.diff ? permission.diff.split('\n').slice(0, 12) : []
        return (
          <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
            <box borderStyle="single" borderColor={theme.amber} flexDirection="column" paddingX={1}>
              <text fg={theme.amber} wrapMode="none">{fitText(`● ${permission.title}`, innerWidth)}</text>
              {permission.reason ? (
                <text fg={theme.dim} wrapMode="word">{permission.reason}</text>
              ) : null}
              {permission.command ? (
                <text fg={theme.text} wrapMode="none">{fitText(`$ ${permission.command}`, innerWidth)}</text>
              ) : null}
              {permission.url ? (
                <text fg={theme.cyan} wrapMode="none">{fitText(`URL: ${permission.url}`, innerWidth)}</text>
              ) : null}
              {permission.paths && permission.paths.length > 0 ? (
                <text fg={theme.dim} wrapMode="none">{fitText(permission.paths.join(', '), innerWidth)}</text>
              ) : null}
              {diffLines.map((line, index) => (
                <text
                  key={`perm-diff:${index}`}
                  fg={line.startsWith('+') ? theme.green : line.startsWith('-') ? theme.red : theme.dim}
                  wrapMode="none"
                >
                  {fitText(line || ' ', innerWidth)}
                </text>
              ))}
              <box flexDirection="row" gap={2} marginTop={1} height={1}>
                {options.map((option, index) => {
                  const selected = index === selectedIndex
                  const color = option.response === 'reject' ? theme.red : theme.green
                  return (
                    <text key={option.response} fg={selected ? color : theme.dim} wrapMode="none">
                      {`${selected ? '▶' : ' '} [${index + 1}] ${option.label}`}
                    </text>
                  )
                })}
              </box>
              <text fg={theme.dim} wrapMode="none">
                {permissionActionLoading ? 'responding…' : '←/→ select · enter confirm · 1/2/3 quick'}
              </text>
            </box>
          </box>
        )
      })() : null}

      {(liveStatus === 'retrying' || liveStatus === 'compacting') && composerSendState === 'sending' ? (
        <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
          <text fg={theme.amber} wrapMode="none">
            {fitText(
              liveStatus === 'retrying'
                ? '● Retrying after a transient error…'
                : '● Compacting conversation to free up context…',
              Math.max(width - 4, 20),
            )}
          </text>
        </box>
      ) : null}

      {composerSendState === 'sending' && composerLiveReasoning.trim() ? (
        <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
          <text fg={theme.dim} wrapMode="none">
            {(() => {
              const t = composerLiveReasoning.replace(/\s+/g, ' ').trim()
              const preview = t.length > 100 ? `…${t.slice(-98)}` : t
              return fitText(`✻ thinking · ${preview}`, Math.max(width - 4, 20))
            })()}
          </text>
        </box>
      ) : null}

      {composerSendState === 'sending' && !composerLiveText && activeRunningToolCount === 0 ? (
        <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
          <ComposerWaitingStatus
            startedAt={composerSendStartedAt}
            seed={composerWaitingStatusSeed}
            suffix={composerWaitingSuffix}
            fg={theme.cyan}
            width={Math.max(width - 4, 20)}
          />
        </box>
      ) : null}

      {liveToolActivities.length > 0 && activeRunningToolCount > 0 ? (
        <box backgroundColor={theme.surface} paddingX={1} paddingTop={1} gap={1}>
          <text fg={theme.dim} wrapMode="none">
            {fitText(`tools: ${liveToolActivities.map((a) => `${a.label}${a.status === 'running' ? ' ●' : ' ✓'}`).join('  ')}`, Math.max(width - 4, 20))}
          </text>
        </box>
      ) : null}

      {(() => {
        const subagentEntries = Object.entries(liveSubagentText).filter(([, text]) => text.trim().length > 0)
        if (subagentEntries.length === 0) return null
        const [, latest] = subagentEntries[subagentEntries.length - 1]
        const tail = latest.replace(/\s+/g, ' ').trim().slice(-80)
        return (
          <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
            <text fg={theme.dim} wrapMode="none">
              {fitText(`↪ subagent: ${tail}`, Math.max(width - 4, 20))}
            </text>
          </box>
        )
      })()}

      {livePromptSuggestion && composerSendState !== 'sending' ? (
        <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
          <text fg={theme.cyan} wrapMode="none">
            {fitText(`Tab → ${livePromptSuggestion}`, Math.max(width - 4, 20))}
          </text>
        </box>
      ) : null}

      {composerTargetSession?.provider === 'claude' && composerPermissionMode !== 'default' ? (
        <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
          <text
            fg={composerPermissionMode === 'bypassPermissions' ? theme.red : composerPermissionMode === 'plan' ? theme.dim : theme.amber}
            wrapMode="none"
          >
            {fitText(
              `${PERMISSION_MODE_GLYPH[composerPermissionMode] ?? ''} ${PERMISSION_MODE_LABEL[composerPermissionMode] ?? composerPermissionMode} on  (shift+tab to cycle)`,
              Math.max(width - 4, 20),
            )}
          </text>
        </box>
      ) : null}

      {composerStatusMessage ? (
        composerSendState === 'sending' && composerLiveText && syntaxStyle && !composerError ? (
          // OpenTUI's <box height={n}> does not clip <markdown> overflow — once
          // the streaming preview grows beyond 4 rows it bleeds onto the
          // composer below. Render only the tail as plain wrapped text so the
          // preview always fits the reserved row slot.
          <box backgroundColor={theme.surface} paddingX={1} paddingTop={1} height={5} overflow="hidden">
            <text fg={theme.dim} wrapMode="word">
              {composerLiveText
                .replace(/\s+$/g, '')
                .split('\n')
                .slice(-4)
                .join('\n')}
            </text>
          </box>
        ) : (
          <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
            <text fg={composerError ? theme.red : theme.dim} wrapMode="none">
              {fitText(
                composerStatusMessage,
                Math.max(width - 4, 20),
              )}
            </text>
          </box>
        )
      ) : null}

      {composerTargetMessage ? (
        <box backgroundColor={theme.surface} paddingX={1}>
          <text fg={theme.cyan} wrapMode="none">
            {fitText(composerTargetMessage, Math.max(width - 4, 20))}
          </text>
        </box>
      ) : null}

      {!composerWindowOpen ? renderComposerMentionPanel(width, Math.max(width - 4, 20)) : null}

      {!composerWindowOpen && !composerHistoryOpen && !composerStashOpen ? renderComposerSlashPanel(width, Math.max(width - 4, 20)) : null}

      {!composerWindowOpen ? renderComposerHistoryPanel(width, Math.max(width - 4, 20)) : null}
      {!composerWindowOpen ? renderComposerStashPanel(width, Math.max(width - 4, 20)) : null}

      {!composerWindowOpen ? (
        <box
          paddingX={1}
          backgroundColor={theme.surface}
          border
          borderStyle="single"
          borderColor={composerActive ? composerAccentColor : theme.border}
          height={composerDockHeight}
          flexDirection="column"
        >
          {renderComposerTextarea(submitComposerFromDock, {
            height: composerDockTextareaHeight,
            width: composerDockTextareaWidth,
          })}
          <box height={1} flexDirection="row" alignItems="center">
            <box width={composerDockFooterStatsWidth} overflow="hidden">
              <text fg={composerSlashHint ? composerAccentColor : theme.dim} wrapMode="none">
                {composerSlashHint
                  ? fitText(composerSlashHint, composerDockFooterStatsWidth)
                  : renderInlineTextSegments(composerDockStatsSegments, composerDockFooterStatsWidth, theme.dim)}
              </text>
            </box>
            <box flexGrow={1} />
            <box width={composerDockFooterHintWidth} overflow="hidden">
              <text fg={composerSendState === 'sending' ? theme.dim : composerAccentColor} wrapMode="none">
                {fitText(composerDockFooterHint, composerDockFooterHintWidth)}
              </text>
            </box>
          </box>
        </box>
      ) : null}

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
          onSendDiffNoteToComposer={(prompt) => {
            appendDiffCommentPromptToComposer(prompt)
            showNotice('info', 'Diff comment added to composer')
          }}
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

      {handoffBriefOpen ? (
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

      {handoffBriefOpen ? (
        <HandoffBriefPopover
          session={selectedSessionTarget}
          detail={sessionDetail}
          bookmarkIds={bookmarkKeys}
          theme={theme}
          syntaxStyle={handoffBriefSyntaxStyle}
          width={width}
          height={height}
          onClose={() => setHandoffBriefOpen(false)}
          onCopy={async (text) => {
            try {
              await writeClipboard(text)
              showNotice('info', 'Copied handoff brief to clipboard')
            } catch (err) {
              showNotice('error', err instanceof Error ? err.message : 'Failed to copy handoff brief')
            }
          }}
          onKeyHandlerReady={(handler) => { handoffBriefKeyHandlerRef.current = handler }}
        />
      ) : null}

      {promptLibraryOpen ? (
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

      {promptLibraryOpen ? (
        <PromptLibraryPopover
          theme={theme}
          accentColor={composerAccentColor}
          width={width}
          height={height}
          activeProvider={selectedSessionTarget?.provider}
          loadPrompts={readTuiPrompts}
          loadPrompt={readTuiPrompt}
          savePrompt={saveTuiPrompt}
          deletePrompt={deleteTuiPrompt}
          onInsert={insertComposerPromptText}
          onClose={() => setPromptLibraryOpen(false)}
          onNotice={showNotice}
          onKeyHandlerReady={(handler) => { promptLibraryKeyHandlerRef.current = handler }}
        />
      ) : null}

      {channelBridgeOpen ? (
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

      {channelBridgeOpen ? (
        <ChannelBridgePopover
          theme={theme}
          accentColor={composerAccentColor}
          width={width}
          height={height}
          onClose={() => setChannelBridgeOpen(false)}
          onNotice={showNotice}
          onKeyHandlerReady={(handler) => { channelBridgeKeyHandlerRef.current = handler }}
        />
      ) : null}

      {taskPopoverOpen ? (
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

      {taskPopoverOpen ? (
        <TaskPanelPopover
          messages={taskPanelMessages}
          theme={theme}
          width={width}
          height={height}
          onClose={() => setTaskPopoverOpen(false)}
          onSelectTask={(uuid) => {
            const idx = visibleTranscriptCards.findIndex((c) => c.key === uuid)
            if (idx >= 0) jumpToTranscriptIndex(idx)
          }}
          onKeyHandlerReady={(handler) => { taskPopoverKeyHandlerRef.current = handler }}
        />
      ) : null}

      {composerWindowOpen ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={59}
        />
      ) : null}

      {composerWindowOpen ? (
        <box
          position="absolute"
          top={composerWindowTop}
          left={composerWindowLeft}
          width={composerWindowWidth}
          height={composerWindowHeight}
          border
          borderStyle="single"
          borderColor={composerActive ? composerAccentColor : theme.border2}
          backgroundColor={theme.surface}
          zIndex={60}
          flexDirection="column"
          title=" Composer "
          titleColor={composerAccentColor}
          titleAlignment="left"
        >
          <box
            height={composerWindowHeaderHeight}
            paddingX={1}
            border={['bottom']}
            borderStyle="single"
            borderColor={theme.border}
            flexDirection="row"
            alignItems="center"
          >
            <text fg={composerAccentColor} wrapMode="none">
              {fitText(`${composerConfig.glyph} ${composerConfig.label}`, Math.min(28, composerWindowContentWidth))}
            </text>
            <box flexGrow={1} />
            <text fg={theme.dim} wrapMode="none">
              {renderInlineTextSegments(composerWindowStatsSegments, Math.max(composerWindowContentWidth - 30, 12), theme.dim)}
            </text>
          </box>

          <box
            height={composerWindowEditorHeight}
            paddingX={1}
            paddingY={1}
            flexDirection="column"
            overflow="hidden"
          >
            {renderComposerTextarea(submitComposerFromWindow, {
              height: Math.max(composerWindowEditorHeight - 2, 2),
              width: composerWindowTextareaWidth,
            })}
          </box>

          {renderComposerMentionPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12))}
          {!composerHistoryOpen && !composerStashOpen ? renderComposerSlashPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12)) : null}
          {renderComposerHistoryPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12))}
          {renderComposerStashPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12))}

          <box
            height={composerWindowFooterHeight}
            paddingX={1}
            border={['top']}
            borderStyle="single"
            borderColor={theme.border}
            flexDirection="row"
            alignItems="center"
          >
            <box width={composerWindowFooterStatsWidth} overflow="hidden">
              <text fg={composerSlashHint ? composerAccentColor : theme.dim} wrapMode="none">
                {composerSlashHint
                  ? fitText(composerSlashHint, composerWindowFooterStatsWidth)
                  : renderInlineTextSegments(composerWindowStatsSegments, composerWindowFooterStatsWidth, theme.dim)}
              </text>
            </box>
            <box flexGrow={1} />
            <box width={composerWindowFooterHintWidth} overflow="hidden">
              <text fg={composerSendState === 'sending' ? theme.dim : composerAccentColor} wrapMode="none">
                {fitText(composerWindowFooterHint, composerWindowFooterHintWidth)}
              </text>
            </box>
          </box>
        </box>
      ) : null}

      {diagnosticsOpen ? (() => {
        const overlayWidth = Math.min(76, Math.max(width - 4, 40))
        const overlayHeight = Math.min(height - 2, 28)
        const isClaude = selectedSession?.provider === 'claude'
        const mcpSection = diagnosticsSections.find((s) => s.id === 'mcp')
        const mcpRows = mcpSection?.items.filter((i) => i !== 'None') ?? []
        return (
          <box
            position="absolute"
            top={1}
            left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
            width={overlayWidth}
            height={overlayHeight}
            border
            borderStyle="single"
            borderColor={theme.border2}
            backgroundColor={theme.surface}
            zIndex={30}
            flexDirection="column"
          >
            <box paddingX={1} paddingTop={1} flexDirection="row" gap={1}>
              <text fg={theme.text}>DIAGNOSTICS</text>
              {diagnosticsLoading ? <text fg={theme.dim}>· loading…</text> : null}
              {diagnosticsBusy ? <text fg={theme.cyan}>· {diagnosticsBusy}</text> : null}
            </box>
            {diagnosticsError ? (
              <box paddingX={1}>
                <text fg={theme.red} wrapMode="none">{fitText(diagnosticsError, overlayWidth - 4)}</text>
              </box>
            ) : null}
            <box flexGrow={1} paddingX={1} paddingBottom={1} flexDirection="column" overflow="hidden">
              {diagnosticsSections.map((section) => (
                <box key={section.id} flexDirection="column" marginTop={1} flexShrink={0}>
                  <box flexShrink={0} height={1}><text fg={theme.dim}>{section.title}</text></box>
                  {section.items.length === 0 || (section.items.length === 1 && section.items[0] === 'None') ? (
                    <box flexShrink={0} height={1}><text fg={theme.muted}>  None</text></box>
                  ) : section.id === 'mcp' && isClaude ? (
                    section.items.map((item, idx) => {
                      if (item === 'None') return <box key={idx} flexShrink={0} height={1}><text fg={theme.muted}>  None</text></box>
                      const [, rawStatus] = item.split(' · ')
                      const status = rawStatus?.trim() ?? ''
                      const selected = idx === diagnosticsMcpIndex
                      return (
                        <box key={idx} flexShrink={0} height={1}>
                          <text
                            fg={selected ? theme.cyan : (status === 'disabled' ? theme.dim : theme.text)}
                            wrapMode="none"
                          >
                            {fitText(`  ${selected ? '▶' : ' '} ${item}`, overlayWidth - 4)}
                          </text>
                        </box>
                      )
                    })
                  ) : (
                    section.items.slice(0, 10).map((item, idx) => (
                      <box key={idx} flexShrink={0} height={1}>
                        <text fg={theme.text} wrapMode="none">
                          {fitText(`  ${item}`, overlayWidth - 4)}
                        </text>
                      </box>
                    ))
                  )}
                </box>
              ))}
            </box>
            <box paddingX={1} paddingBottom={1}>
              <text fg={theme.dim} wrapMode="none">
                {fitText(
                  isClaude
                    ? `${mcpRows.length > 0 ? '↑↓ select MCP · r reconnect · t toggle · ' : ''}p reload plugins · Esc close`
                    : 'Esc close',
                  overlayWidth - 4,
                )}
              </text>
            </box>
          </box>
        )
      })() : null}

      {exitConfirmOpen ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={89}
        />
      ) : null}

      {exitConfirmOpen ? (() => {
        const overlayWidth = Math.min(Math.max(width - 6, 32), 58)
        const overlayHeight = 8
        const exitBodyText = exitCleanupInProgress
          ? 'Stopping running turns before closing...'
          : composerSendState === 'sending' || runningSessions.length > 0
            ? 'Running turns will be interrupted before quit.'
            : 'Close the terminal viewer now?'
        const exitActionText = exitCleanupInProgress
          ? 'Cleaning up...'
          : 'Enter/Y quit  ·  Esc/N cancel'
        return (
          <box
            position="absolute"
            top={Math.max(1, Math.floor((height - overlayHeight) / 2))}
            left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
            width={overlayWidth}
            height={overlayHeight}
            border
            borderStyle="single"
            borderColor={theme.red}
            backgroundColor={theme.surface}
            zIndex={90}
            flexDirection="column"
          >
            <box paddingX={1} paddingTop={1}>
              <text fg={theme.text}>EXIT AGENT VIEWER?</text>
            </box>
            <box paddingX={1} marginTop={1}>
              <text fg={theme.dim} wrapMode="none">
                {fitText(exitBodyText, overlayWidth - 4)}
              </text>
            </box>
            <box paddingX={1} marginTop={2}>
              <text fg={theme.red} wrapMode="none">
                {fitText(exitActionText, overlayWidth - 4)}
              </text>
            </box>
          </box>
        )
      })() : null}
    </box>
  )
}
