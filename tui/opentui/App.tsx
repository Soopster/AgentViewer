/** @jsxImportSource @opentui/react */
import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, startTransition, useState } from 'react'
import { spawn } from 'node:child_process'
import { GitPopover } from './GitPopover'
import { PullRequestPopover } from './PullRequestPopover'
import { FileViewerPopover } from './FileViewerPopover'
import { EditorPopover } from './EditorPopover'
import { NewSessionModal, NEW_SESSION_PROVIDERS } from './NewSessionModal'
import { AnalyticsPopover } from './AnalyticsPopover'
import { HandoffBriefPopover } from './HandoffBriefPopover'
import { PromptLibraryPopover } from './PromptLibraryPopover'
import { ChannelBridgePopover } from './ChannelBridgePopover'
import { readBridgeConfigFromEnv, subscribeToChannelEvents, type ChannelEvent } from '../../lib/channelBridge'
import {
  createChannelBridgeMessageId,
  flushChannelBridgeOutbox,
  sendDurableChannelMessage,
} from '../../lib/channelBridgeOutbox'
import { IdeBridgePopover } from './IdeBridgePopover'
import { readIdeBridgeConfigFromEnv, sendIdeAtMention } from '../../lib/ideBridge'
import { ToastOverlay, useToasts } from './ToastOverlay'
import { PiActivityPopover } from './PiActivityPopover'
import { toast } from './toastStore'
import { toBmpSafe } from './bmp'
import { loadBridgeMessagesForSession, addBridgeMessage, channelBridgeFileOutboxStorage } from '../../lib/bridgeMessages'
import { TaskSidePanel } from './TaskSidePanel'
import { TaskPanelPopover } from './TaskPanelPopover'
import {
  appendComposerSentHistory,
  flushComposerQueueWrites,
  readComposerDraft,
  readComposerQueue,
  readComposerSentHistory,
  scheduleWriteComposerDraft,
  scheduleWriteComposerQueue,
} from '../../lib/tuiComposerState'
import { registerExtraTreeSitterParsers } from './treeSitterParsers'
import { startTuiMetricsLogger, tuiMetricsEnabled, noteRenderFrame, noteTuiComposerLatency, registerTuiMetricsGauge, cardProfileEnabled, logCardRecompute } from './metricsLogger'
import {
  buildPierreDiffView,
  type TuiPierreDiffRow,
  type TuiPierreDiffView,
  type TuiPierreSplitRow,
  type TuiSplitRowSide,
} from './pierreDiffView'
import type { SelectedLineRange } from '@pierre/diffs'
import { RGBA, SyntaxStyle, MacOSScrollAccel, TextAttributes } from '@opentui/core'
import type { BaseRenderable, BoxRenderable, CliRenderer, MarkdownRenderable, MouseEvent, ScrollBoxRenderable, SelectOption, TabSelectOption, TabSelectRenderable, TextareaRenderable, TextareaAction } from '@opentui/core'
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
import { detectTuiCodeFiletypeFromPath } from '../codeFiletypes'
import { computeTurnDurationsMs, stripToolCallBlocks, type ThreadedMessage } from '../../lib/threading'
import { buildTaskRegistry } from '../../lib/taskRegistry'
import { isOpenCodeAssistantStreamEnvelope } from '../../lib/opencodeStreamEvents'
import { buildDiffCommentComposerPrompt } from '../../lib/diffCommentComposer'
import {
  clearComposerQueueTarget,
  createComposerQueueItemId,
  mergeComposerAttachments,
  rekeyComposerQueueTarget,
  removeComposerQueueItem,
  restoreComposerDraftPayload,
  selectComposerQueueTarget,
} from '../../lib/composerAttachments'
import {
  PROCEDURAL_THEME_NAMES,
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
  readTuiSessionMetadata,
  readTuiSidebarSort,
  readTuiSidebarWidth,
  readTuiShowToolCalls,
  readTuiTabsEnabled,
  readTuiSplitPanes,
  readTuiTheme,
  readTuiTranscriptView,
  readTuiTranscriptWidth,
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
  sendTuiCrossSessionMessage,
  interruptTuiSessionTurn,
  listTuiRunningSessions,
  listTuiAddressableSessions,
  readTuiRuntimeActivity,
  dismissTuiViewerAttention,
  createTuiSession,
  readTuiSlashCommands,
  readTuiComposerOptions,
  listTuiProtocolRuns,
  listTuiRunPlaybooks,
  readTuiProtocolRun,
  subscribeTuiProtocolRunChanges,
  startTuiProtocolRun,
  stopTuiProtocolRun,
  cleanupTuiProtocolRunWorktrees,
  createTuiWorktreeTask,
  findTuiWorktreeTask,
  mergeTuiWorktreeTask,
  removeTuiWorktreeTask,
  type WorktreeTask,
  prewarmTuiSession,
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
  writeTuiSplitPanes,
  writeTuiTheme,
  writeTuiThemeSync,
  writeTuiTranscriptView,
  writeTuiTranscriptWidth,
  writeTuiVelocityScroll,
  type TuiSessionDetail,
  type TuiDiffLayout,
  type TuiSidebarSort,
  type TuiTranscriptWidth,
} from '../../lib/tui/service'
import type { MessageBookmark } from '../../lib/messageBookmarks'
import type { PlaybookSummary, ProtocolAgent, ProtocolAutonomy, ProtocolRun, ProtocolRunSnapshot } from '../../lib/agentProtocol'
import {
  extractClaudeStreamToolInputDelta,
  extractClaudeStreamToolResults,
  extractClaudeStreamToolUse,
  normalizeClaudeStreamThreadedMessage,
  parseClaudeStreamToolInput,
} from '../../lib/claudeMapper'
import { normalizeCodexStreamThreadedMessage } from '../../lib/codexMapper'
import { readTuiSessionMetadataAsync } from './metadataWorkerClient'
import {
  readTuiSessionDetailAsync,
  readTuiSessionsAsync,
  formatTranscriptCardsAsync,
  getTranscriptCardsSync,
} from './sessionDetailWorkerClient'
import type { TuiSessionReaderState } from '../../lib/tuiState'
import type { AgentProvider, ContextUsage, ProviderSelection, ReasoningEffortLevel, RunningSessionRef, SendAttachment, SendState, Session, SessionComposerAgentOption, SessionModelInfo, SubagentSummary, ToolResultBlock } from '../../lib/types'
import { AttentionInboxPopover, attentionItemNeedsInput, type AttentionItem } from './AttentionInboxPopover'
import { CrossSessionMessagingPopover } from './CrossSessionMessagingPopover'
import { CheckpointPopover } from './CheckpointPopover'
import { CoordinationPopover } from './CoordinationPopover'
import { PlaybookManagerPopover } from './PlaybookManagerPopover'
import { getContinueInCliCommand } from '../../lib/cliContinue'
import { commandResultExpectsTranscript, isNativeComposerCommandText } from '../../lib/composerCommands'
import { deliverComposerSteer } from '../../lib/composerSteering'
import { parseClaudeCommandLifecycle, type ClaudeCommandLifecycleState } from '../../lib/claudeCommandLifecycle'
import { isTransientSendError, MAX_TRANSIENT_SEND_RETRIES, transientRetryBackoffMs, TransientAwareSendError } from '../../lib/transientError'
import { listProjectFiles } from '../../lib/projectFiles'
import { fetchGitSummary, type GitSummary } from '../../lib/gitProvider'
import { runGitCommand } from '../../lib/gitNodeProvider'
import { getSlashCommandSuggestions, filterSlashCommands, normalizeSlashCommandSuggestions, type SlashCommandSuggestion } from '../../lib/slashCommands'
import { parseCrossSessionComposerCommand } from '../../lib/crossSessionCommands'
import { getProviderComposer, pickProviderExample } from '../../lib/providerComposer'
import { extractPendingPermission, extractPendingPermissions, extractPermissionReply, type PendingPermission, type PendingQuestionAnswers, type PermissionResponse } from '../../lib/permissions'
import type { readViewSessionComposerOptions } from '../../lib/sessionBackend'
import {
  sessionMessageFingerprint,
  sessionMessageSequenceFingerprint,
  summarizeDurableSessionMessages,
} from './messageFingerprint'
import { appendFile, mkdirSync } from 'node:fs'
import { readFile, rm, stat } from 'node:fs/promises'
import { release, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  calculateSplitPaneBodyRows,
  calculateSplitPaneLayout,
  groupItemsBySplitPaneKey,
  isComposerTargetReady,
  preserveArrayIdentity,
  removeSplitPaneKey,
  resolveComposerTargetSession,
  resolveCoordinationTranscriptTarget,
  resolveSelectedSession,
  resolveSelectedSessionIndex,
  runComposerSessionPreparation,
  splitCommandKey,
} from './splitPaneState'

// Stable-reference event handler — reads the latest closure on every call
// without appearing in any deps array. Mirrors React's upcoming useEffectEvent
// (RFC #220) and the implementation already used internally by @opentui/react.
function useEffectEvent<T extends (...args: never[]) => unknown>(handler: T): T {
  const handlerRef = React.useRef(handler)
  React.useLayoutEffect(() => { handlerRef.current = handler })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useCallback((...args: Parameters<T>) => (handlerRef.current as T)(...args), []) as T
}

type SteeredComposerSend = {
  text: string
  messageUuid: string
  liveMessageUuid: string
  state?: Extract<ClaudeCommandLifecycleState, 'queued' | 'started' | 'completed'>
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
    // Keep the canary out of the frame it measures. A synchronous append here
    // created its own once-per-second outlier, especially on slower disks and
    // Windows antivirus-scanned worktrees.
    appendFile(PERF_LOG_PATH, line, () => { /* logging is best-effort */ })
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

function Spinner({
  label,
  fg,
  labelFg = fg,
  frames = SPINNER_FRAMES,
}: {
  label: string
  fg: string
  labelFg?: string
  frames?: readonly string[]
}) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), 80)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <text wrapMode="none">
      <span fg={fg}>{frames[frame % frames.length]}</span>
      <span fg={labelFg}>{` ${label}`}</span>
    </text>
  )
}

function IdleTicker({ seed, theme }: { seed: string; theme: TuiThemePalette }) {
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
  return (
    <Spinner
      label={IDLE_TICKER_PHRASES[phraseIndex]!}
      fg={theme.cyan}
      labelFg={theme.violet}
      frames={spinnerFrames}
    />
  )
}

function ComposerWaitingStatus({
  startedAt,
  seed,
  suffix,
  theme,
  width,
}: {
  startedAt: number | null
  seed: string
  suffix: string | null
  theme: TuiThemePalette
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
  // Segment the status so the live metadata reads as labelled chips: spinner +
  // message in accent, elapsed bright, then each "key:value" pair with a dim
  // key and a brighter value (ctx % colored by pressure).
  const segs: InlineTextSegment[] = [
    { text: `${frames[frame % frames.length]} `, fg: theme.cyan },
    { text: `${message}…`, fg: theme.text },
    { text: `  ${elapsed}`, fg: theme.cyan },
  ]
  if (suffix) {
    for (const chip of suffix.split(' · ')) {
      segs.push({ text: '  ·  ', fg: theme.dim })
      const colon = chip.indexOf(':')
      if (colon > 0) {
        const key = chip.slice(0, colon)
        const value = chip.slice(colon + 1)
        segs.push({ text: `${key} `, fg: theme.dim })
        if (key === 'ctx') {
          const m = value.match(/(\d+)%/)
          const valColor = m ? contextBarColor(Number(m[1]), theme) : theme.muted
          segs.push({ text: value, fg: valColor })
        } else {
          segs.push({ text: value, fg: theme.muted })
        }
      } else {
        segs.push({ text: chip, fg: theme.muted })
      }
    }
  }
  return <text wrapMode="none">{renderInlineTextSegments(segs, width, theme.dim)}</text>
}

const PROVIDERS: ProviderSelection[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'lmstudio', 'claude-acp', 'codex-acp', 'all']
const TUI_PROVIDER_TAG: Record<string, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  copilot: 'copilot',
  pi: 'pi',
}
const LIGHT_MODES: TuiThemeMode[] = [
  'airbnb',
  'alabaster',
  'apple',
  'ayu-light',
  'bone-china',
  'brushed-aluminium',
  'catppuccin-latte',
  'claude-cream',
  'cold-pressed',
  'cohere',
  'cursor',
  'everforest-light',
  'figma',
  'flexoki-light',
  'github-light',
  'gruvbox-light',
  'horizon-light',
  'iceberg-light',
  'imessage',
  'intercom',
  'light',
  'light-owl',
  'material-lighter',
  'min-light',
  'miro',
  'mistral',
  'mongodb',
  'nike',
  'nord-light',
  'notion',
  'nvidia',
  'one-light',
  'paper',
  'papercolor-light',
  'pinterest',
  'playstation',
  'posthog',
  'quiet-light',
  'replicate',
  'rose-pine-dawn',
  'slack',
  'solarized-light',
  'stripe',
  'supabase',
  'sunlit-alabaster',
  'tokyo-night-day',
  'tomorrow',
  'vitesse-light',
  'white',
]
const DARK_MODES: TuiThemeMode[] = [
  'abyss',
  'anodised-obsidian',
  'ayu-dark',
  'cappuccino',
  'carbon-surface',
  'catppuccin-mocha',
  'claude-code',
  'cobalt',
  'cyber',
  'cyber-wave',
  'willow-dream',
  'dark',
  'dark-ceramic',
  'dracula',
  'dune',
  'ember',
  'fancy-dracula',
  'ethereal',
  'everforest-dark',
  'ferrari',
  'flexoki-dark',
  'framer',
  'github-dark',
  'graphite',
  'gruvbox-dark',
  'hackerman',
  'iceberg',
  'kanagawa',
  'linear',
  'lumon',
  'material-darker',
  'matte-black',
  'metalterm',
  'miasma',
  'monokai',
  'night-owl',
  'nocturne',
  'nord',
  'obsidian',
  'oceanic-next',
  'one-dark',
  'orchestrator',
  'orchid',
  'osaka-jade',
  'palenight',
  'papercolor-dark',
  'phosphor',
  'raycast',
  'resend',
  'repo',
  'retro-82',
  'ristretto',
  'rose-pine',
  'sentry',
  'slate',
  'slack-dark',
  'smoked-glass',
  'snazzy',
  'solarized-dark',
  'solar-flare',
  'solstice',
  'synthwave',
  'tokyo-night',
  'tomorrow-night',
  'grape',
  'vantablack',
  'vitesse-dark',
  'zenburn',
]
const OMZ_MODES: TuiThemeMode[] = [
  'agnoster',
  'robbyrussell',
  'af-magic',
  'bira',
  'avit',
  'gentoo',
  'candy',
  'eastwood',
  'fishy',
  'frisk',
  'gnzh',
  'kennethreitz',
  'arrow',
  'bureau',
  'dogenpunk',
  'dst',
  'fox',
  'funky',
  'juanghurtado',
  'kolo',
  'lambda',
  'muse',
  'nanotech',
  'pygmalion',
  ...PROCEDURAL_THEME_NAMES,
]
const THEMES: TuiThemeMode[] = [...LIGHT_MODES, ...DARK_MODES, ...OMZ_MODES]
type ThemeMenuGroup = 'light' | 'dark' | 'omz'
const THEME_GROUPS: Array<{ key: ThemeMenuGroup; label: string; themes: TuiThemeMode[] }> = [
  { key: 'light', label: 'LIGHT', themes: LIGHT_MODES },
  { key: 'dark', label: 'DARK', themes: DARK_MODES },
  { key: 'omz', label: 'OMZ', themes: OMZ_MODES },
]
function filterThemeModes(modes: TuiThemeMode[], query: string): TuiThemeMode[] {
  const q = query.trim().toLowerCase()
  if (!q) return modes
  return modes.filter((mode) => THEME_LABELS[mode].toLowerCase().includes(q) || mode.toLowerCase().includes(q))
}
const SEARCH_MAX_CHARS = 80
const SESSION_REFRESH_MS = 5000
const DETAIL_REFRESH_MS = 2000
const RECENT_SESSION_ACTIVITY_MS = 60 * 60_000
// Cadence for reconciling against the in-process running-turn registry (a
// cheap synchronous read — the TUI and its backend share one process).
const REATTACH_POLL_MS = 1500
const COORDINATOR_FALLBACK_POLL_MS = 2000
const COORDINATOR_RECONCILE_MS = 30_000
const COORDINATOR_PUSH_DEBOUNCE_MS = 25
// Remote attach (agent-viewer --attach <url>): backend calls route through a
// running web daemon; shown in the footer so the mode is always visible.
const ATTACHED_DAEMON_HOST = (() => {
  const raw = process.env.AGENT_VIEWER_ATTACH?.trim()
  if (!raw) return null
  try {
    return new URL(raw).host
  } catch {
    return raw
  }
})()
// Most recent background turn completions kept in the attention inbox.
const ATTENTION_DONE_LIMIT = 20
// Debounce before opening a selected session's transcript. Scrubbing quickly
// through the sidebar (mouse or keyboard) lands on many sessions in passing;
// without this every fly-by would load + reformat a full transcript only to be
// discarded a few ms later. Short enough to feel instant once you settle.
const DETAIL_OPEN_DELAY_MS = 200
// While browsing (sidebar focused) only the last N cards of the selected
// session are mounted. OpenTUI's scrollbox lays out EVERY mounted card to
// compute scroll height (viewportCulling only skips paint, not layout), so a
// large transcript costs O(cards) — hundreds of ms to seconds — on every open.
// Capping the preview keeps browsing snappy; the full transcript mounts only
// when you focus the messages pane to actually read it.
const PREVIEW_CARD_CAP = 60
// Reader-mode virtualization. The messages pane used to mount the FULL
// transcript, so opening a huge session paid an O(cards) Yoga layout once and
// every commit while reading stayed that size. Instead mount a sliding window
// of READER_CARD_WINDOW cards: keyboard navigation recenters the window when
// the cursor nears an edge, and a scroll poll slides it when the user
// wheels/drags near the top or bottom of the mounted content. Sessions at or
// under the window size behave exactly as before (full mount, no sliding).
// Env override is a test hook (lets a harness exercise sliding against a
// modest session) and an escape hatch for very tall terminals.
const READER_CARD_WINDOW = Math.max(
  40,
  Number.parseInt(process.env.AGENT_VIEWER_READER_WINDOW ?? '', 10) || 240,
)
// Cards the window shifts per edge slide. Big enough that consecutive slides
// are rare while wheel-scrolling, small enough that a slide's remount stays
// cheap (slide-size new cards + one layout of the window).
const READER_WINDOW_SLIDE = Math.floor(READER_CARD_WINDOW / 2)
// Keyboard recenter margin: when the cursor gets within this many cards of a
// window edge (and more cards exist beyond it), recenter the window.
const READER_WINDOW_MARGIN = Math.max(8, Math.floor(READER_CARD_WINDOW / 10))
// Scroll poll: OpenTUI's scrollbox emits no scroll events, so while a window
// is active we poll scrollTop on an interval (two property reads — negligible)
// and slide when the viewport is within READER_EDGE_ROWS of the content edge.
const READER_EDGE_ROWS = 8
const READER_SCROLL_POLL_MS = 120
// Post-slide scroll fixups must wait for the next Yoga layout pass (layout is
// computed per render frame, not at React commit). The executor retries on a
// short timer until the anchor card's content offset moves (a slide always
// changes it — content was added/removed above the anchor), bounded by
// READER_FIXUP_MAX_TRIES as a safety net.
const READER_FIXUP_RETRY_MS = 16
const READER_FIXUP_MAX_TRIES = 12
// Above this many threaded messages, never format cards synchronously on the
// render thread (the fallback in baseTranscriptCards) — formatTranscriptCard ×
// N is a multi-second freeze on big sessions. The worker formats instead and
// the transcript pops in when it lands (usually within one frame budget).
const SYNC_FORMAT_CARD_LIMIT = 400
// Stable empty set for browse-mode preview rendering (all cards collapsed).
const EMPTY_EXPANDED_KEYS: ReadonlySet<string> = new Set<string>()
const NOOP_SELECT_AGENT_TOOL = (_groupKey: string, _toolKey: string) => {}
// Composer affordances (slash commands / agent options) cache. Refreshing
// these for a Claude session spawns a CLI subprocess, so cache generously —
// command lists change rarely (new files in .claude/commands etc.).
const COMPOSER_AFFORDANCES_TTL_MS = 5 * 60_000
const COMPOSER_AFFORDANCES_CACHE_MAX = 64
const COMPOSER_GIT_SUMMARY_POLL_MS = 5_000
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
// derived landmarks, so this cap bounds the resident footprint on long-running
// TUI sessions. 8 covers the settled session plus its prefetched neighbourhood
// (NEIGHBOR_PREFETCH_RADIUS on each side) with room for a couple of recents —
// paired with the foreground mtime guard it makes revisiting a recent session
// free (no worker re-read, no reformat). Matches the spirit of
// THREADING_CACHE_LIMIT (10) in threadingWorkerClient.ts, which already holds
// threaded messages + cards for the same neighbourhood.
const SESSION_CACHE_LIMIT = 8
const WORKTREE_TASK_CWD_SEGMENT = `${sep}.agent-viewer-worktrees${sep}`
// After a settle, warm the detail cache for the sessions adjacent to the
// current one in sidebar order so the *first* visit to a neighbour opens from
// cache instead of paying the full worker read (150ms–1s on big sessions).
// The delay keeps the worker free for the settled session's own load first;
// prefetches run one at a time and yield to any real open.
const NEIGHBOR_PREFETCH_DELAY_MS = 450
const NEIGHBOR_PREFETCH_RADIUS = 2
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
  kind: 'resume' | 'unread' | 'day' | 'gap' | 'turn'
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

type AgentToolGroupCard = TuiTranscriptCard & {
  agentToolCards?: TuiTranscriptCard[]
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
type QueuedComposerSend = {
  id: string
  targetKey: string
  text: string
  attachments: SendAttachment[]
  promptParts: ComposerPromptPart[]
}

function isQueuedComposerSend(value: unknown): value is QueuedComposerSend {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<QueuedComposerSend>
  if (typeof entry.id !== 'string' || !entry.id) return false
  if (typeof entry.targetKey !== 'string' || !entry.targetKey) return false
  if (typeof entry.text !== 'string') return false
  if (!Array.isArray(entry.attachments) || !entry.attachments.every((attachment) =>
    attachment && typeof attachment === 'object'
      && typeof (attachment as Partial<SendAttachment>).id === 'string'
      && typeof (attachment as Partial<SendAttachment>).type === 'string')) return false
  return Array.isArray(entry.promptParts) && entry.promptParts.every((part) => {
    if (!part || typeof part !== 'object') return false
    const candidate = part as Partial<ComposerPromptPart>
    if (typeof candidate.id !== 'string' || typeof candidate.marker !== 'string') return false
    if (candidate.kind === 'text') return typeof candidate.text === 'string'
    return candidate.kind === 'attachment'
      && Boolean(candidate.attachment && typeof candidate.attachment === 'object')
  })
}
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

// Local desktop clipboard tools (pbcopy, xclip, ...) aren't installed in a
// lot of remote/SSH/container environments this TUI runs in. OSC 52 is a
// terminal escape sequence that asks the *local* terminal emulator (the one
// the user is actually looking at) to set its clipboard, so it works over
// SSH/tmux/mosh with no server-side clipboard binary at all — it's the
// fallback for exactly the case the shell commands can't cover, so it only
// gets tried once every shell candidate has failed. renderer.isOsc52Supported()
// depends on a terminal capability probe that resolves shortly after startup,
// so a renderer passed in before that probe lands just means we skip the
// fallback and surface the original shell-command error, same as today.
async function writeClipboard(text: string, renderer?: CliRenderer): Promise<void> {
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

  if (renderer?.isOsc52Supported() && renderer.copyToClipboardOSC52(text)) return

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

// Segmented context gauge: the filled portion takes the threshold color (green →
// amber → red), the track stays dim, and the numbers read muted — so context
// pressure registers as a glanceable color, not a number you have to parse.
function contextBarSegments(
  totalTokens: number,
  maxTokens: number,
  percentage: number,
  theme: TuiThemePalette,
  barWidth = 18,
): InlineTextSegment[] {
  const pct = Math.max(0, Math.min(100, Math.round(percentage)))
  const filled = Math.round((pct / 100) * barWidth)
  const fillColor = contextBarColor(pct, theme)
  return [
    { text: `${fmtTokens(totalTokens)}/${fmtTokens(maxTokens)}  `, fg: theme.muted },
    { text: '▕', fg: theme.dim },
    { text: '█'.repeat(filled), fg: fillColor },
    { text: '░'.repeat(barWidth - filled), fg: theme.dim },
    { text: '▏', fg: theme.dim },
    { text: ` ${pct}%`, fg: fillColor },
  ]
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
  const withSettings = cleaned.replace('⏎ send', '⏎ send · ⌥M settings')
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

function openExternalUrl(url: string): Promise<void> {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'linux'
    ? 'xdg-open'
    : null
  if (!command) return Promise.reject(new Error(`Open this URL in a browser: ${url}`))
  return new Promise((resolve, reject) => {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' })
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
    child.once('error', reject)
  })
}

type InlineTextSegment = {
  text: string
  fg: string
  bg?: string
  attributes?: number
}

function composerSendingHintSegments(value: string, theme: TuiThemePalette): InlineTextSegment[] {
  const segments: InlineTextSegment[] = []
  value.split(' · ').forEach((group, index) => {
    if (index > 0) segments.push({ text: ' · ', fg: theme.dim })
    const match = group.match(/^(\S+)(?:\s+(.*))?$/)
    const key = match?.[1] ?? group
    const label = match?.[2]
    const normalized = group.toLowerCase()
    const color = normalized.includes('cancel') || normalized.includes('interrupt')
      ? theme.red
      : normalized.includes('queue') || normalized.includes('background')
        ? theme.amber
        : normalized.includes('running') || normalized.includes('streaming') || normalized.includes('thinking') || normalized.includes('responding')
          ? theme.green
          : theme.cyan

    if (!label) {
      segments.push({ text: group, fg: color })
      return
    }
    segments.push({ text: key, fg: color })
    segments.push({ text: ` ${label}`, fg: color })
  })
  return segments
}

function clipText(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length <= width) return value
  if (width === 1) return value.slice(0, 1)
  return `${value.slice(0, width - 1)}…`
}

function cleanLivePreviewText(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/^```[^\n]*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
}

function wrapLivePreviewTail(value: string, width: number, maxLines: number): string[] {
  if (width <= 0 || maxLines <= 0) return []
  const cleaned = cleanLivePreviewText(value).trimEnd()
  if (!cleaned) return []

  // Live buffers can grow large. Only inspect enough trailing source to fill
  // the fixed preview card so streaming updates stay bounded.
  const sourceLimit = Math.max(width * maxLines * 6, 1024)
  const source = cleaned.slice(-sourceLimit)
  const wrapped: string[] = []

  for (const rawLine of source.split('\n')) {
    let remaining = rawLine.replace(/\s+/g, ' ').trim()
    if (!remaining) {
      if (wrapped.length > 0 && wrapped[wrapped.length - 1] !== '') wrapped.push('')
      continue
    }
    while (remaining.length > width) {
      let splitAt = remaining.lastIndexOf(' ', width)
      if (splitAt < Math.floor(width * 0.4)) splitAt = width
      wrapped.push(remaining.slice(0, splitAt).trimEnd())
      remaining = remaining.slice(splitAt).trimStart()
    }
    if (remaining) wrapped.push(remaining)
  }

  return wrapped.slice(-maxLines)
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
    out.push(<span key={i} fg={segment.fg} bg={segment.bg} attributes={segment.attributes}>{clipped}</span>)
    remaining -= clipped.length
  }
  if (remaining > 0) {
    out.push(<span key="pad" fg={padFg}>{' '.repeat(remaining)}</span>)
  }
  return out
}

// `code` and **bold** are the only spans the native CLIs surface in prose, and
// the only two low-risk enough to detect without mangling identifiers (`__init__`,
// `file_name`, `a*b`). Both require a matching close on the same line; stray
// markers fall through as literal text.
const INLINE_MARKDOWN_PATTERN = /(`[^`]+`)|(\*\*[^*]+?\*\*)/
const INLINE_MARKDOWN_PATTERN_G = /(`[^`]+`)|(\*\*[^*]+?\*\*)/g

function hasInlineMarkdown(text: string): boolean {
  return INLINE_MARKDOWN_PATTERN.test(text)
}

type InlineMarkdownToken = { text: string; kind: 'plain' | 'code' | 'bold' }

// Split one line of prose into plain / `code` / **bold** runs. Markers are
// stripped; anything unmatched stays plain. Shared by the wrapping and
// width-clamped renderers below so every view parses markdown identically.
function parseInlineMarkdownTokens(text: string): InlineMarkdownToken[] {
  const tokens: InlineMarkdownToken[] = []
  let last = 0
  INLINE_MARKDOWN_PATTERN_G.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_MARKDOWN_PATTERN_G.exec(text)) !== null) {
    if (match.index > last) tokens.push({ text: text.slice(last, match.index), kind: 'plain' })
    if (match[1]) tokens.push({ text: match[1].slice(1, -1), kind: 'code' })
    else if (match[2]) tokens.push({ text: match[2].slice(2, -2), kind: 'bold' })
    last = INLINE_MARKDOWN_PATTERN_G.lastIndex
  }
  if (last < text.length) tokens.push({ text: text.slice(last), kind: 'plain' })
  return tokens
}

function inlineMarkdownTokenFg(token: InlineMarkdownToken, theme: TuiThemePalette, baseFg: string): string {
  return token.kind === 'code' ? theme.cyan : baseFg
}

function inlineMarkdownTokenAttrs(token: InlineMarkdownToken): number | undefined {
  return token.kind === 'bold' ? TextAttributes.BOLD : undefined
}

// Wrapping context (Stream view, wrapMode="word"): emit sibling <span>s so
// **bold**/`code` render like the native CLIs while the parent <text> keeps
// flowing/wrapping the assembled StyledText — width stays the caller's job.
function renderInlineMarkdownSpans(
  text: string,
  theme: TuiThemePalette,
  baseFg: string,
  keyPrefix: string,
): React.ReactNode[] {
  return parseInlineMarkdownTokens(text).map((token, index) => (
    <span
      key={`${keyPrefix}:${index}`}
      fg={inlineMarkdownTokenFg(token, theme, baseFg)}
      attributes={inlineMarkdownTokenAttrs(token)}
    >
      {token.text}
    </span>
  ))
}

// Width-clamped context (reader/agent cards, wrapMode="none" on pre-wrapped
// lines): same styling, but clip to `width` the way fitText would so the
// single-line layout is preserved. No trailing pad — matches the plain path.
function renderInlineMarkdownClipped(
  text: string,
  theme: TuiThemePalette,
  baseFg: string,
  width: number,
  keyPrefix: string,
): React.ReactNode[] {
  if (width <= 0) return []
  const out: React.ReactNode[] = []
  let remaining = width
  const tokens = parseInlineMarkdownTokens(text)
  for (let i = 0; i < tokens.length; i += 1) {
    if (remaining <= 0) break
    const token = tokens[i]
    const clipped = clipText(token.text, remaining)
    if (!clipped) continue
    out.push(
      <span
        key={`${keyPrefix}:${i}`}
        fg={inlineMarkdownTokenFg(token, theme, baseFg)}
        attributes={inlineMarkdownTokenAttrs(token)}
      >
        {clipped}
      </span>,
    )
    remaining -= clipped.length
  }
  return out
}

const LIVE_PREVIEW_HEIGHT = 6
const LIVE_PREVIEW_BODY_LINES = LIVE_PREVIEW_HEIGHT - 2

function LivePreviewCard({
  title,
  lines,
  accentColor,
  bodyColor,
  theme,
}: {
  title: string
  lines: string[]
  accentColor: string
  bodyColor: string
  theme: TuiThemePalette
}) {
  const lastLineIndex = lines.length - 1
  return (
    <box backgroundColor={theme.surface2} paddingX={1} height={LIVE_PREVIEW_HEIGHT}>
      <box
        border
        borderStyle="single"
        borderColor={accentColor}
        backgroundColor={theme.surface}
        height={LIVE_PREVIEW_HEIGHT}
        flexGrow={1}
        flexDirection="column"
        paddingX={1}
        overflow="hidden"
        title={` ${title} `}
        titleColor={accentColor}
        titleAlignment="left"
      >
        {lines.map((line, index) => (
          <text key={`${index}:${line}`} wrapMode="none">
            <span fg={bodyColor}>{line || ' '}</span>
            {index === lastLineIndex ? <span fg={accentColor}> ▌</span> : null}
          </text>
        ))}
      </box>
    </box>
  )
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
// Chat mode has no border to budget rows for — just the input line(s) plus
// the one dim stats row underneath.
const CHAT_COMPOSER_CHROME_HEIGHT = 1
const CHAT_COMPOSER_MIN_HEIGHT = 2
const COMPOSER_DOCK_CHROME_HEIGHT = 3
const COMPOSER_WINDOW_MAX_WIDTH = 88
const COMPOSER_WINDOW_MAX_HEIGHT = 24
const CODEX_LIVE_ASSISTANT_UUID = 'live-codex-assistant'
const CLAUDE_LIVE_ASSISTANT_UUID_PREFIX = 'live-claude-assistant:'
type ComposerKeyBinding = { name: string; action: TextareaAction; shift?: boolean; alt?: boolean; meta?: boolean; ctrl?: boolean }
const TUI_SLASH_HINTS: Record<string, string[]> = {
  claude: ['/sessions', '/message', '/clear', '/compact', '/help', '/model'],
  codex: ['/sessions', '/message', '/clear', '/diff', '/status', '/compact'],
  opencode: ['/sessions', '/message', '/clear', '/summarize', '/help'],
  copilot: ['/sessions', '/message', '/help', '/clear'],
  pi: ['/sessions', '/message', '/help', '/model', '/thinking', '/compact'],
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
const TRANSCRIPT_TOP_MARGIN = 1
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

// OpenTUI's OSC escape writers — desktop notifications (OSC 9/99) and clipboard
// (OSC 52) — call straight into the native renderer (opentui.dll) over FFI. On
// Windows that native path is implicated in hard segfaults; critically, a fault
// in native code CANNOT be caught by a surrounding JS try/catch, so the existing
// "silently ignore" guard offers false reassurance — a faulting OSC write would
// take the whole process down. We disable the native OSC calls on Windows, and
// elsewhere gate them on the terminal actually advertising the capability.
const IS_WINDOWS = typeof process !== 'undefined' && process.platform === 'win32'
const NATIVE_OSC_ENABLED = !IS_WINDOWS

// toBmpSafe (astral-plane / variation-selector stripping for native OSC writers)
// now lives in ./bmp and is imported above — shared with the toast store.
// If the Claude send stream goes fully silent for this long — no data AND no
// heartbeat (the server pulses one every 15s) — the socket is presumed dead.
// We stop reading and let the persisted-detail poll surface the rest of the
// still-running turn instead of blocking on read() for minutes.
const CLAUDE_STREAM_STALL_MS = 45_000
const STREAM_STALL_SENTINEL = Symbol('claude-stream-stall')
// Coalesce live streaming-text flushes to ~30fps. Uses a timer, NOT
// requestAnimationFrame: OpenTUI's RAF only fires on the renderer's frame loop,
// which goes idle during a pure-text streaming turn (deltas touch a ref and
// schedule a flush with no React commit to drive a frame), freezing the preview
// after the first token. A timer is render-loop-independent and each flush's
// setState drives a repaint.
const LIVE_TEXT_FLUSH_MS = 33
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
  const options: PermissionOption[] = [{
    response: 'once',
    label: permission.elicitation?.mode === 'url' ? 'Open & continue' : 'Allow',
  }]
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
    if (!isOpenCodeAssistantStreamEnvelope(record)) return null
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

  if (record.type === 'lmstudio_delta') {
    return typeof record.delta === 'string' ? record.delta : null
  }

  if (record.type === 'opencode_event') {
    if (!isOpenCodeAssistantStreamEnvelope(record)) return null
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
    if (!isOpenCodeAssistantStreamEnvelope(record)) return false
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

// Attach a tool's real result to its live card. Until this lands the card
// keeps `result: null`, which the formatters render as a compact running
// state — a streaming tool is genuinely still running once its input has
// finished streaming, so it must not be dressed up as complete.
function applyLiveToolResult(messages: ThreadedMessage[], result: ToolResultBlock): ThreadedMessage[] {
  const targetUuid = `live-tool:${result.tool_use_id}`
  return messages.map((message) => {
    if (message.uuid !== targetUuid) return message
    return {
      ...message,
      blocks: message.blocks.map((block) => block.type === 'tool_thread' && !block.result
        ? { ...block, result }
        : block),
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

function codexQuestionMessageUuid(permissionId: string): string {
  return `live-tool:codex-question:${permissionId}`
}

function codexQuestionLiveMessage(
  permission: PendingPermission,
  targetSession: Session,
): ThreadedMessage | null {
  const questions = permission.questions ?? []
  if (
    permission.provider !== 'codex'
    || permission.toolName !== 'item/tool/requestUserInput'
    || questions.length === 0
  ) return null

  const toolUseId = `${codexQuestionMessageUuid(permission.id)}:tool`
  return {
    role: 'assistant',
    uuid: codexQuestionMessageUuid(permission.id),
    sessionId: permission.sessionId ?? targetSession.sessionId,
    provider: 'codex',
    blocks: [{
      type: 'tool_thread',
      toolUse: {
        type: 'tool_use',
        id: toolUseId,
        name: 'AskUserQuestion',
        input: {
          questions: questions.map((question) => ({
            id: question.id,
            header: question.header,
            question: question.question,
            multiSelect: question.multiSelect,
            options: question.options,
          })),
        },
      },
      result: null,
    }],
  }
}

function completeCodexQuestionLiveMessage(
  messages: ThreadedMessage[],
  permission: PendingPermission,
  answers: PendingQuestionAnswers | null,
): ThreadedMessage[] {
  if (permission.provider !== 'codex' || permission.toolName !== 'item/tool/requestUserInput') return messages
  const messageUuid = codexQuestionMessageUuid(permission.id)
  const toolUseId = `${messageUuid}:tool`
  const displayAnswers = Object.fromEntries((permission.questions ?? []).flatMap((question) => {
    const values = answers?.[question.id ?? question.question]
    return values && values.length > 0 ? [[question.question, values.join(', ')]] : []
  }))
  return messages.map((message) => message.uuid !== messageUuid ? message : {
    ...message,
    blocks: message.blocks.map((block) => block.type !== 'tool_thread' || block.toolUse.id !== toolUseId ? block : {
      ...block,
      result: {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: answers ? JSON.stringify({ answers: displayAnswers }) : 'Question skipped by user.',
        is_error: answers ? undefined : true,
      },
    }),
  })
}

function liveMessageSessionKey(message: ThreadedMessage): string | null {
  if (!message.sessionId) return null
  return `${message.provider ?? 'claude'}:${message.sessionId}`
}

function hasLiveAssistantMessage(messages: ThreadedMessage[], key: string): boolean {
  return messages.some((message) => liveMessageSessionKey(message) === key && message.role === 'assistant')
}

function isLiveAssistantTextMessage(message: ThreadedMessage): boolean {
  return message.role === 'assistant'
    && message.blocks.some((block) => block.type === 'text' && block.text.length > 0)
}

function hasPersistedAssistantAfterBaseline(rawMessages: import('../../lib/types').SessionMessage[], baselineCount: number): boolean {
  const durableCount = summarizeDurableSessionMessages(rawMessages).count
  const start = durableCount > baselineCount
    ? baselineCount
    : Math.max(baselineCount - 1, 0)
  let durableIndex = 0
  for (const message of rawMessages) {
    if (!isDurableSessionMessage(message)) continue
    if (durableIndex >= start && message.type === 'assistant') return true
    durableIndex++
  }
  return false
}

function hasPersistedUserAfterBaseline(rawMessages: import('../../lib/types').SessionMessage[], baselineCount: number): boolean {
  if (summarizeDurableSessionMessages(rawMessages).count <= baselineCount) return false
  let durableIndex = 0
  for (const message of rawMessages) {
    if (!isDurableSessionMessage(message)) continue
    if (durableIndex >= baselineCount && message.type === 'user') return true
    durableIndex++
  }
  return false
}

function makeLiveUserMessage(session: Session, text: string, uuid = 'live-user'): ThreadedMessage {
  return {
    role: 'user',
    uuid,
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

function liveAssistantTextKey(payload: Record<string, unknown>, provider: ProviderSelection | undefined): string {
  if (provider === 'opencode') {
    const event = payload.event && typeof payload.event === 'object'
      ? payload.event as Record<string, unknown>
      : {}
    const properties = event.properties && typeof event.properties === 'object'
      ? event.properties as Record<string, unknown>
      : {}
    const part = properties.part && typeof properties.part === 'object'
      ? properties.part as Record<string, unknown>
      : {}
    const id = typeof properties.partID === 'string' && properties.partID
      ? properties.partID
      : typeof part.id === 'string' && part.id
        ? part.id
        : typeof properties.messageID === 'string' && properties.messageID
          ? properties.messageID
          : 'assistant'
    return `live-opencode:${id}`
  }

  if (provider === 'copilot') {
    const event = payload.event && typeof payload.event === 'object'
      ? payload.event as Record<string, unknown>
      : {}
    const data = event.data && typeof event.data === 'object'
      ? event.data as Record<string, unknown>
      : {}
    const id = typeof data.messageId === 'string' && data.messageId
      ? data.messageId
      : typeof event.id === 'string' && event.id
        ? event.id
        : 'assistant'
    return `live-copilot:${id}`
  }

  if (provider === 'pi') {
    return 'live-pi:assistant'
  }

  return `live-${provider ?? 'assistant'}-assistant`
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

function isSessionRecentlyTouched(session: Session, now = Date.now()): boolean {
  const activityMs = sessionActivityMs(session)
  return activityMs > 0 && activityMs >= now - RECENT_SESSION_ACTIVITY_MS
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
      || prev.parentSessionId !== next.parentSessionId
    ) return false
  }
  return true
}

function isDurableSessionMessage(message: import('../../lib/types').SessionMessage): boolean {
  return message.ephemeral !== true
}

/** A nested sidebar row under a parent session: either a provider-native child
 * session keyed by parentSessionId or a synthesized summary for providers
 * whose subagents live only inside the parent transcript. */
type SidebarSubagentEntry =
  | { kind: 'session'; session: Session }
  | { kind: 'summary'; summary: SubagentSummary }

type SidebarEntry =
  | { type: 'project'; key: string; projectName: string; count: number }
  | { type: 'session'; key: string; session: Session; absoluteIndex: number }
  | { type: 'subagent'; key: string; parentSession: Session; entry: SidebarSubagentEntry; depth: number }

function sidebarEntrySession(entry: SidebarEntry): Session | null {
  if (entry.type === 'session') return entry.session
  if (entry.type === 'subagent' && entry.entry.kind === 'session') return entry.entry.session
  return null
}

function buildSidebarEntries(
  sessions: Session[],
  sort: TuiSidebarSort,
  childrenByParentId?: Map<string, SidebarSubagentEntry[]>,
): SidebarEntry[] {
  const entries: SidebarEntry[] = []
  // Real child sessions are nested under their parent instead of
  // appearing as unrelated top-level rows — but only when the parent is
  // actually present in this list (search/filter can exclude it).
  const presentIds = new Set(sessions.map(sessionKey))
  const isNestedChild = (session: Session) =>
    !!session.parentSessionId
    && presentIds.has(sessionKey({ sessionId: session.parentSessionId, provider: session.provider }))
  const pushSubagents = (
    parentSession: Session,
    parentKey: string,
    depth = 1,
    lineage = new Set<string>(),
  ) => {
    const parentIdentity = sessionKey(parentSession)
    if (lineage.has(parentIdentity)) return
    const nextLineage = new Set(lineage).add(parentIdentity)
    const children = childrenByParentId?.get(parentIdentity)
    if (!children || children.length === 0) return
    for (const child of children) {
      const key = child.kind === 'session'
        ? `subagent:${parentKey}:${sessionKey(child.session)}`
        : `subagent:${parentKey}:${child.summary.agentId}`
      entries.push({ type: 'subagent', key, parentSession, entry: child, depth })
      if (child.kind === 'session') pushSubagents(child.session, key, depth + 1, nextLineage)
    }
  }

  const visibleSessions = sessions.filter((session) => !isNestedChild(session))
  const orderedSessions = visibleSessions
    .map((session) => ({ session, absoluteIndex: sessions.indexOf(session) }))
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
      const sessionEntryKey = `session:${session.provider ?? 'claude'}:${session.sessionId}`
      entries.push({
        type: 'session',
        key: sessionEntryKey,
        session,
        absoluteIndex,
      })
      pushSubagents(session, sessionEntryKey)
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
      const sessionEntryKey = `session:${session.provider ?? 'claude'}:${session.sessionId}`
      entries.push({
        type: 'session',
        key: sessionEntryKey,
        session,
        absoluteIndex,
      })
      pushSubagents(session, sessionEntryKey)
    }
  }
  return entries
}

type CoordinatorSidebarEntry =
  | { type: 'run'; key: string; runId: string; run: ProtocolRun; agentCount: number }
  | { type: 'agent'; key: string; runId: string; agent: ProtocolAgent; isLast: boolean; taskTitle: string | null }

/** Sidebar analogue of buildSidebarEntries: one header per run, lead first
 * then teammates in roster order — mirrors the topology tree already used
 * in CoordinationControlCenter, flattened for a linear list like project
 * groups flatten into session rows. */
function buildCoordinatorEntries(runs: ProtocolRun[], snapshots: Map<string, ProtocolRunSnapshot>): CoordinatorSidebarEntry[] {
  const entries: CoordinatorSidebarEntry[] = []
  for (const run of runs) {
    const snapshot = snapshots.get(run.id)
    const agents = snapshot?.agents ?? []
    const tasksById = new Map((snapshot?.tasks ?? []).map((task) => [task.id, task]))
    const ordered = [
      ...agents.filter((agent) => agent.role === 'lead'),
      ...agents.filter((agent) => agent.role !== 'lead'),
    ]
    entries.push({ type: 'run', key: `run:${run.id}`, runId: run.id, run, agentCount: ordered.length })
    ordered.forEach((agent, index) => {
      entries.push({
        type: 'agent',
        key: `run-agent:${run.id}:${agent.id}`,
        runId: run.id,
        agent,
        isLast: index === ordered.length - 1,
        taskTitle: (agent.taskId ? tasksById.get(agent.taskId)?.title : undefined) ?? null,
      })
    })
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
  bodyPad: number
  streamGap: number
  streamUserGap: number
} {
  switch (density) {
    // bodyPad is the trailing blank row inside each card. Comfortable keeps it
    // for breathing room; balanced/dense drop it so the bottom border hugs the
    // last line and the transcript packs tighter.
    // streamGap/streamUserGap are the Stream-view equivalents of cardGap: the
    // flat view packs assistant prose tight by default (gap only after user
    // prompts), comfortable opens a row after every card, dense drops them all.
    case 'comfortable':
      return { cardGap: 1, bodyIndent: 3, bodyLines: 6, headerRows: 2, bodyPad: 1, streamGap: 1, streamUserGap: 1 }
    case 'dense':
      return { cardGap: 0, bodyIndent: 1, bodyLines: 12, headerRows: 1, bodyPad: 0, streamGap: 0, streamUserGap: 0 }
    default:
      return { cardGap: 1, bodyIndent: 2, bodyLines: 8, headerRows: 2, bodyPad: 0, streamGap: 0, streamUserGap: 1 }
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

function streamUserBackground(theme: TuiThemePalette): string {
  const lightTheme = (relativeLuminance(theme.bg) ?? relativeLuminance(theme.surface) ?? 0) > 0.5
  return mixHexColor(theme.violet, theme.userBg, lightTheme ? 0.16 : 0.24) ?? theme.userBg
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
    // Markdown prose captures — OpenTUI's <markdown> renderer styles inline
    // elements via these `markup.*` keys. Without them, inline code, bold, and
    // headings fall back to the flat default fg (the SelectableMarkdown "plain"
    // look). Match the per-line inline renderer: code → cyan, strong → bold.
    'markup.raw': { fg: RGBA.fromHex(theme.cyan) },
    'markup.raw.block': { fg: RGBA.fromHex(theme.cyan) },
    'markup.strong': { fg: RGBA.fromHex(theme.text), bold: true },
    'markup.italic': { fg: RGBA.fromHex(theme.text), italic: true },
    'markup.strikethrough': { fg: RGBA.fromHex(theme.muted) },
    'markup.heading': { fg: RGBA.fromHex(keywordColor), bold: true },
    'markup.link': { fg: RGBA.fromHex(theme.cyan) },
    'markup.link.label': { fg: RGBA.fromHex(theme.cyan) },
    'markup.link.url': { fg: RGBA.fromHex(theme.dim) },
    'markup.list': { fg: RGBA.fromHex(builtinColor) },
    'markup.quote': { fg: RGBA.fromHex(theme.dim), italic: true },
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

function toolNameFromTranscriptLine(text: string): string {
  const cleaned = text.replace(/^tool\s+/i, '').trim()
  const colon = cleaned.indexOf(':')
  return (colon >= 0 ? cleaned.slice(0, colon) : cleaned.split(/\s+/, 1)[0] ?? '').trim()
}

function transcriptToolColor(name: string, theme: TuiThemePalette): string {
  switch (name.toLowerCase()) {
    case 'bash':
      return theme.amber
    case 'edit':
    case 'multiedit':
    case 'filechange':
    case 'notebookedit':
      return theme.green
    case 'write':
      return theme.cyan
    case 'read':
    case 'webfetch':
      return theme.violet
    case 'grep':
      return theme.red
    case 'glob':
      return theme.pink
    case 'agent':
    case 'task':
    case 'taskcreate':
    case 'taskget':
    case 'taskupdate':
    case 'tasklist':
    case 'taskstop':
    case 'task_status':
    case 'agentswitch':
      return theme.pink
    case 'websearch':
    case 'toolsearch':
      return theme.cyan
    case 'todowrite':
      return theme.green
    default:
      return theme.muted
  }
}

function transcriptColor(line: TuiTranscriptCardLine, theme: TuiThemePalette): string {
  switch (line.tone) {
    case 'tool':
      return transcriptToolColor(toolNameFromTranscriptLine(line.text), theme)
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

function streamLineMarker(line: TuiTranscriptCardLine, role: TuiTranscriptCard['role']): string {
  if (role === 'user') return '❯'
  switch (line.tone) {
    case 'result_ok':
      return '●'
    case 'result_error':
      return '×'
    case 'system':
      return '▲'
    default:
      return '•'
  }
}

function streamContinuationMarker(line: TuiTranscriptCardLine): string {
  switch (line.tone) {
    case 'result_ok':
      return '  └ '
    case 'result_error':
      return '  └ '
    case 'system':
      return '  └ '
    case 'tool':
      return '  └ '
    default:
      return '    '
  }
}

function streamToolGroupMarker(cards: TuiTranscriptCard[]): string {
  let hasWarning = false
  let hasPending = false
  for (const card of cards) {
    if (card.pending) hasPending = true
    for (const line of [...card.lines, ...card.expandedLines]) {
      if (line.tone === 'result_error') return '×'
      if (line.tone === 'system') hasWarning = true
    }
  }
  if (hasWarning) return '▲'
  // A called-but-unfinished tool reads as an open circle until its result
  // lands, so a streaming turn shows what is still running at a glance.
  return hasPending ? '○' : '●'
}

function streamToolCardMarker(card: TuiTranscriptCard): string {
  return streamToolGroupMarker([card])
}

function streamStatusColor(marker: string, theme: TuiThemePalette): string {
  if (marker === '✓') return theme.green
  if (marker === '×') return theme.red
  if (marker === '▲') return theme.amber
  if (marker === '●') return theme.green
  if (marker === '○') return theme.amber
  return theme.dim
}

function streamLandmarkText(landmark: CardLandmark, width: number): string {
  if (landmark.kind === 'turn') {
    return landmark.text
      ? fitText(`─ ${landmark.text} `, width).padEnd(width, '─')
      : '─'.repeat(Math.max(width, 1))
  }
  return fitText(`─ ${landmark.text} `, width).padEnd(width, '─')
}

function streamCardLatestTimestampMs(card: TuiTranscriptCard): number | null {
  let latest = card.timestampMs ?? null
  for (const toolCard of (card as AgentToolGroupCard).agentToolCards ?? []) {
    if (toolCard.timestampMs != null && (latest == null || toolCard.timestampMs > latest)) {
      latest = toolCard.timestampMs
    }
  }
  return latest
}

function streamCompletedTurnHint(cards: TuiTranscriptCard[]): string | null {
  let userIndex = -1
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    if (cards[index].role === 'user') {
      userIndex = index
      break
    }
  }
  if (userIndex < 0 || userIndex === cards.length - 1) return null

  const startedAt = cards[userIndex].timestampMs
  if (startedAt == null) return null

  let completedAt = startedAt
  for (let index = userIndex + 1; index < cards.length; index += 1) {
    completedAt = Math.max(completedAt, streamCardLatestTimestampMs(cards[index]) ?? completedAt)
  }
  const elapsedMs = completedAt - startedAt
  return elapsedMs >= 1000 ? `Worked for ${formatElapsedClock(elapsedMs)}` : null
}

function transcriptBackground(line: TuiTranscriptCardLine, theme: TuiThemePalette): string | undefined {
  switch (line.tone) {
    // Tool result summaries (✓ OK, ✓ -2 +10 lines, command output) previously
    // reused the diff add/remove fills as a full-width band, which read as a
    // saturated highlight bar dominating the transcript. The green/red text color
    // + ✓/✗ glyph already carry the success/error semantic, so no band is needed —
    // the diff fills stay reserved for actual diff content below.
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

// Editor-style sign column: a continuous left gutter bar tinted by change type
// (green add / red remove / cyan file·hunk / faint border for context) so a
// diff's shape reads at a glance, matching the ▎ accent bars used elsewhere.
function diffGutterBar(row: TuiPierreDiffRow, theme: TuiThemePalette): string {
  switch (row.tone) {
    case 'addition':
      return theme.green
    case 'deletion':
      return theme.red
    case 'file':
    case 'hunk':
      return theme.cyan
    default:
      return theme.border
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
  streamMode: boolean,
): CardLandmark[][] {
  const result: CardLandmark[][] = new Array(cards.length)
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const prev = i > 0 ? cards[i - 1] : null
    let landmarks: CardLandmark[] | null = null

    if (
      streamMode
      && prev
      && (
        card.role === 'user'
        || (
          card.role === 'assistant'
          && (card.category === 'conversation' || card.category === 'insight')
          && (prev.category === 'technical' || prev.category === 'diff')
        )
      )
    ) {
      landmarks = landmarks ?? []
      let text = ''
      if (card.role === 'user' && prev.timestampMs != null) {
        for (let turnIndex = i - 1; turnIndex >= 0; turnIndex -= 1) {
          const turnCard = cards[turnIndex]
          if (turnCard.role !== 'user') continue
          if (turnCard.timestampMs != null && prev.timestampMs >= turnCard.timestampMs) {
            const elapsedMs = prev.timestampMs - turnCard.timestampMs
            if (elapsedMs >= 1000) text = `Worked for ${formatElapsedClock(elapsedMs)}`
          }
          break
        }
      }
      landmarks.push({ kind: 'turn', text })
    }

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
  agentsMode: boolean = false,
  fullText: boolean = false,
): TuiTranscriptCardLine[] {
  if (agentsMode && (card.key.startsWith('agents-tools:') || isAgentsToolOnlyCard(card))) {
    return agentsToolCollapsedLines(card)
  }

  const useExpandedLines = isExpanded || thinkingFull || fullText
  const source = useExpandedLines ? card.expandedLines : card.lines
  let base: TuiTranscriptCardLine[]
  if (useExpandedLines) {
    // Parsed diff rows own expanded patches in every transcript view. Keeping
    // the raw diff lines here would render the same patch once as body prose
    // and again in the interactive diff immediately below it.
    base = source.filter((line) => !['diff_add', 'diff_remove', 'diff_meta'].includes(line.tone))
  } else if (card.category === 'diff') {
    // Keep diff_meta (file path header) but strip raw diff lines — Pierre renders those
    base = source.filter((line) => line.tone !== 'diff_add' && line.tone !== 'diff_remove')
  } else {
    base = source.slice(0, previewLimit)
  }
  if (base.length > 0) return base
  // A thinking card with thinking hidden has nothing to show here — the
  // thinking-mode hint rendered beneath already explains the empty state, so the
  // "No visible content" placeholder is pure noise (and it stacked up on every
  // hidden-thinking turn). Suppress it for thinking cards; keep it elsewhere so a
  // genuinely empty non-thinking card still says something. Both cardHeight and
  // the renderer call this, so the row count stays in lockstep.
  const isThinkingCard = card.lines.some((line) => line.tone === 'thinking')
  return isThinkingCard ? [] : [{ text: 'No visible content', tone: 'dim' }]
}

function isAgentsToolOnlyCard(card: TuiTranscriptCard): boolean {
  // Provider mappers do not all express operations with a `tool`-tone header:
  // command output, task notifications, agent results, and some MCP events can
  // arrive as result/agent/dim lines. Category classification is the canonical
  // cross-provider signal, so group every operational or diff card and keep
  // prose/insight/system cards as natural group boundaries.
  return card.category === 'technical' || card.category === 'diff'
}

function agentsToolCollapsedLines(card: TuiTranscriptCard): TuiTranscriptCardLine[] {
  const summary = agentsToolSummaryLine(card)
  if (card.lines.length === 0) return [summary]
  const toolIndex = card.lines.findIndex((line) => line.tone === 'tool')
  if (toolIndex === -1) return [summary, ...card.lines]
  if (card.lines[toolIndex]?.text === summary.text) return card.lines
  const lines = card.lines.slice()
  lines[toolIndex] = summary
  return lines
}

function agentsToolSummaryLine(card: TuiTranscriptCard): TuiTranscriptCardLine {
  const toolLine = card.lines.find((line) => line.tone === 'tool')
    ?? card.expandedLines.find((line) => line.tone === 'tool')
    ?? card.expandedLines[0]
    ?? card.lines[0]
  const fallback = toolLine ?? { text: 'tool call', tone: 'tool' as const }
  return enrichAgentsFileChangeSummary(card, fallback)
}

function enrichAgentsFileChangeSummary(card: TuiTranscriptCard, line: TuiTranscriptCardLine): TuiTranscriptCardLine {
  if (line.tone !== 'tool' || !/^tool\s+FileChange:/i.test(line.text.trim())) return line
  const metadata = fileChangeSummaryMetadata(card)
  if (!metadata) return line

  const label = line.text.replace(/^tool\s+FileChange:\s*/i, '').trim()
  const genericLabel = /^\d+\s+file\s+changes?$/i.test(label) || label.toLowerCase() === 'file change'
  const detail = genericLabel
    ? metadata
    : mergeFileChangeSummaryLabel(label, metadata)
  return { ...line, text: `tool FileChange: ${detail}` }
}

function mergeFileChangeSummaryLabel(label: string, metadata: string): string {
  if (!label) return metadata
  if (metadata === label || metadata.startsWith(`${label} `) || metadata.startsWith(`${label} ·`)) return metadata
  return `${label} · ${metadata}`
}

function fileChangeSummaryMetadata(card: TuiTranscriptCard): string | null {
  const diffText = cardDiffText(card, true)
  const metaPath = filePathFromDiffText(diffText, diffMetaFilePath(card) ?? '')
  const pathLabel = metaPath ? compactPathTail(metaPath, 2) : ''
  const hunkLabel = firstDiffHunkLabel(diffText)
  const statsLabel = diffStatsLabel(diffText, card.expandedLines)
  const parts = [pathLabel, hunkLabel, statsLabel].filter((part) => part.length > 0)
  return parts.length > 0 ? parts.join(' ') : null
}

function diffMetaFilePath(card: TuiTranscriptCard): string | null {
  for (const line of card.expandedLines) {
    if (line.tone !== 'diff_meta') continue
    const match = line.text.match(/^(?:FILE CHANGE|CREATE|UPDATE|DELETE|MODIFY|RENAME|MOVE)\s+(.+)$/i)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

function compactPathTail(value: string, segmentCount: number): string {
  const cleaned = value.trim().replace(/\\/g, '/')
  if (!cleaned) return ''
  const parts = cleaned.split('/').filter(Boolean)
  if (parts.length <= segmentCount) return parts.join('/') || cleaned
  return parts.slice(-segmentCount).join('/')
}

function firstDiffHunkLabel(diffText: string | null): string {
  if (!diffText) return ''
  const hunk = diffText.split('\n').find((line) => line.startsWith('@@ '))
  const match = hunk?.match(/\+(\d+)/)
  return match?.[1] ? `@${match[1]}` : ''
}

function diffStatsLabel(diffText: string | null, fallbackLines: TuiTranscriptCardLine[]): string {
  let additions = 0
  let deletions = 0
  if (diffText) {
    for (const line of diffText.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue
      if (line.startsWith('+')) additions += 1
      else if (line.startsWith('-')) deletions += 1
    }
  } else {
    additions = fallbackLines.filter((line) => line.tone === 'diff_add').length
    deletions = fallbackLines.filter((line) => line.tone === 'diff_remove').length
  }
  return additions > 0 || deletions > 0 ? `+${additions} -${deletions}` : ''
}

// A stream "ghost" card renders nothing (or only the "No visible content"
// placeholder) in Stream view: no real body lines, no markdown, no code, no
// diff. TranscriptCard already collapses these to zero height via
// streamHasBody; filtering them out of the visible list as well keeps them
// from remaining as invisible j/k cursor stops.
function isStreamGhostCard(card: TuiTranscriptCard): boolean {
  if (card.key.startsWith('agents-tools:')) return false
  if (card.codeBlocks?.length) return false
  if (card.editDiff) return false
  if (card.markdownContent && card.markdownContent.trim().length > 0) return false
  const hasRealLine = (lines: TuiTranscriptCardLine[]) =>
    lines.some((line) => {
      const text = line.text.trim()
      return text.length > 0 && text !== 'No visible content'
    })
  return !hasRealLine(card.lines) && !hasRealLine(card.expandedLines)
}

function groupToolCards(
  cards: TuiTranscriptCard[],
  shouldGroup: (card: TuiTranscriptCard) => boolean,
): TuiTranscriptCard[] {
  const grouped: TuiTranscriptCard[] = []
  let pending: TuiTranscriptCard[] = []

  const flush = () => {
    if (pending.length === 0) return
    if (pending.length === 1) {
      grouped.push(pending[0])
      pending = []
      return
    }

    const first = pending[0]
    const last = pending[pending.length - 1]
    const lines = pending.map(agentsToolSummaryLine)
    const searchText = pending.map((card) => card.searchText).join('\n')
    const groupCard: AgentToolGroupCard = {
      ...first,
      key: `agents-tools:${first.key}:${last.key}:${pending.length}`,
      agentToolCards: pending,
      label: `${pending.length} tool ${pending.length === 1 ? 'call' : 'calls'}`,
      category: 'technical',
      autoFold: true,
      compactSummary: lines.map((line) => line.text).join(' · '),
      lines,
      expandedLines: lines,
      searchText,
      searchHaystackLower: `${pending.map((card) => card.label).join('\n')}\n${searchText}`.toLowerCase(),
      codeBlocks: undefined,
      editDiff: undefined,
      markdownContent: undefined,
      hasMermaidDiagrams: false,
    }
    grouped.push(groupCard)
    pending = []
  }

  for (const card of cards) {
    if (shouldGroup(card)) {
      pending.push(card)
    } else {
      flush()
      grouped.push(card)
    }
  }
  flush()
  return grouped
}

function groupAgentsToolCards(cards: TuiTranscriptCard[]): TuiTranscriptCard[] {
  return groupToolCards(cards, isAgentsToolOnlyCard)
}

function groupStreamToolCards(cards: TuiTranscriptCard[]): TuiTranscriptCard[] {
  // Keep file edits as standalone stream events so repeated updates retain
  // their own compact excerpt. Routine technical calls still collapse into a
  // single Claude-style activity narration row.
  return groupToolCards(cards, (card) => card.category === 'technical')
}

function isStreamOperationalCard(card: TuiTranscriptCard): boolean {
  return card.key.startsWith('agents-tools:') || card.category === 'technical'
}

// Agents view uses one consistent card language for prose, standalone tools,
// and grouped tools. Stream keeps that treatment only for operational rows.
// Keeping this decision shared between body preparation and element creation
// prevents a single tool from receiving grouped lines but a native wrapper (or
// vice versa).
export function usesAgentCardPresentation(
  card: TuiTranscriptCard,
  transcriptView: TuiTranscriptView,
): boolean {
  return transcriptView === 'agents'
    || ((transcriptView === 'stream' || transcriptView === 'chat') && isStreamOperationalCard(card))
}

export function shouldCenterTranscriptCard(
  card: TuiTranscriptCard,
  transcriptWidth: TuiTranscriptWidth,
  agentsMode: boolean,
): boolean {
  return transcriptWidth === 'centered'
    && (card.category !== 'diff' || agentsMode)
}

function agentToolCardsFor(card: TuiTranscriptCard): TuiTranscriptCard[] {
  const grouped = (card as AgentToolGroupCard).agentToolCards
  if (grouped && grouped.length > 0) return grouped
  return isAgentsToolOnlyCard(card) ? [card] : []
}

function agentToolCardIsExpanded(
  card: TuiTranscriptCard,
  expandedKeys: ReadonlySet<string>,
  collapsedKeys: ReadonlySet<string>,
): boolean {
  return card.autoFold ? expandedKeys.has(card.key) : !collapsedKeys.has(card.key)
}

function transcriptToolLineSegments(
  text: string,
  theme: TuiThemePalette,
  marker = 'tool ',
  markerColor = theme.dim,
  emphasizeName = false,
): InlineTextSegment[] {
  const cleaned = text.replace(/^tool\s+/i, '').trim()
  const colon = cleaned.indexOf(':')
  const name = colon >= 0
    ? cleaned.slice(0, colon).trim()
    : cleaned.split(/\s+/, 1)[0] || cleaned
  const detail = colon >= 0
    ? cleaned.slice(colon + 1).trim()
    : cleaned.slice(name.length).trim()
  if (name.toLowerCase() === 'bash' && detail) {
    return [
      { text: marker, fg: markerColor },
      { text: name, fg: transcriptToolColor(name, theme), attributes: emphasizeName ? TextAttributes.BOLD : undefined },
      { text: ' ', fg: theme.dim },
      ...bashCommandSegments(detail, theme),
    ]
  }
  return [
    { text: marker, fg: markerColor },
    { text: name || 'tool', fg: transcriptToolColor(name, theme), attributes: emphasizeName ? TextAttributes.BOLD : undefined },
    ...(detail ? [{ text: ` ${detail}`, fg: theme.dim }] : []),
  ]
}

function streamDiffOperationLabel(card: TuiTranscriptCard): string | null {
  if (card.category !== 'diff') return null
  const diffText = cardDiffText(card, false)
  const path = filePathFromDiffText(diffText, diffMetaFilePath(card) ?? card.label)
  if (!path) return null
  let operation = 'Update'
  if (diffText?.includes('--- /dev/null')) operation = 'Create'
  else if (diffText?.includes('+++ /dev/null')) operation = 'Delete'
  else {
    const toolName = streamToolSummaryName(card)
    if (toolName === 'write') operation = 'Create'
  }
  return `${operation}(${path})`
}

function streamToolSummarySegments(card: TuiTranscriptCard, theme: TuiThemePalette): InlineTextSegment[] {
  const summary = agentsToolSummaryLine(card)
  const marker = streamToolCardMarker(card)
  const markerColor = streamStatusColor(marker, theme)
  const diffLabel = streamDiffOperationLabel(card)
  if (diffLabel) {
    return [
      { text: `${marker} `, fg: markerColor },
      { text: diffLabel, fg: theme.text, attributes: TextAttributes.BOLD },
    ]
  }
  if (summary.tone === 'tool') {
    const cleaned = summary.text.replace(/^tool\s+/i, '').trim()
    const colon = cleaned.indexOf(':')
    const name = colon >= 0 ? cleaned.slice(0, colon).trim() : toolNameFromTranscriptLine(summary.text)
    const detail = colon >= 0 ? cleaned.slice(colon + 1).trim() : ''
    if (name.toLowerCase() === 'bash') {
      return [
        { text: `${marker} `, fg: markerColor },
        { text: 'Ran', fg: transcriptToolColor('bash', theme), attributes: TextAttributes.BOLD },
        ...(detail ? [{ text: ' ', fg: theme.dim }, ...bashCommandSegments(detail, theme)] : []),
      ]
    }
    return transcriptToolLineSegments(summary.text, theme, `${marker} `, markerColor, true)
  }
  return [
    { text: `${marker} `, fg: markerColor },
    { text: summary.text, fg: transcriptColor(summary, theme) },
  ]
}

function streamToolSummaryName(card: TuiTranscriptCard): string {
  const summary = agentsToolSummaryLine(card)
  return summary.tone === 'tool' ? toolNameFromTranscriptLine(summary.text).toLowerCase() : ''
}

function isStreamActivityToolCard(card: TuiTranscriptCard): boolean {
  const name = streamToolSummaryName(card)
  return name === 'bash' || name === 'grep' || name === 'glob' || name === 'read'
}

function streamActivitySummarySegments(cards: TuiTranscriptCard[], theme: TuiThemePalette): InlineTextSegment[] | null {
  let shellCount = 0
  let searchCount = 0
  let readCount = 0
  const activityCards: TuiTranscriptCard[] = []
  for (const card of cards) {
    const name = streamToolSummaryName(card)
    if (name === 'bash') shellCount += 1
    else if (name === 'grep' || name === 'glob') searchCount += 1
    else if (name === 'read') readCount += 1
    else continue
    activityCards.push(card)
  }
  if (activityCards.length === 0) return null
  const marker = streamToolGroupMarker(activityCards)
  const segments: InlineTextSegment[] = [
    { text: `${marker} `, fg: streamStatusColor(marker, theme) },
    { text: 'Activity', fg: theme.text, attributes: TextAttributes.BOLD },
  ]
  const appendCount = (detail: string) => {
    if (segments.length > 1) segments.push({ text: '  ·  ', fg: theme.dim })
    segments.push({ text: detail, fg: theme.dim })
  }
  if (readCount > 0) appendCount(`${readCount} ${readCount === 1 ? 'file' : 'files'}`)
  if (searchCount > 0) appendCount(`${searchCount} ${searchCount === 1 ? 'search' : 'searches'}`)
  if (shellCount > 0) appendCount(`${shellCount} shell ${shellCount === 1 ? 'command' : 'commands'}`)
  return segments
}

function streamToolDetailLine(card: TuiTranscriptCard): TuiTranscriptCardLine | null {
  const summaryText = agentsToolSummaryLine(card).text.trim()
  const seen = new Set<string>()
  const lines = [...card.lines, ...card.expandedLines]
  const orderedLines = streamToolSummaryName(card) === 'bash'
    ? [
        ...lines.filter((line) => line.tone === 'muted'),
        ...lines.filter((line) => line.tone !== 'muted'),
      ]
    : lines
  for (const line of orderedLines) {
    const text = line.text.trim()
    if (!text || text === summaryText || text === 'No visible content' || seen.has(text)) continue
    seen.add(text)
    if (line.tone === 'tool' || line.tone === 'diff_add' || line.tone === 'diff_remove') continue
    if (/^[└├│─\s]+$/.test(text) || /^[✓✔]️?\s*(?:OK|done)?$/i.test(text)) continue
    return line
  }
  return null
}

function bashCommandSegments(detail: string, theme: TuiThemePalette): InlineTextSegment[] {
  let command = detail.replace(/^\$\s*/, '').trim()
  const launcher = command.match(/^(?:\/[^\s]+\/)?(?:zsh|bash|sh)\s+-lc\s+(['"])([\s\S]*)\1$/)
  if (launcher?.[2]) command = launcher[2]

  const parts = command.split(/(\s+|&&|\|\||[|;])/).filter(Boolean)
  let expectsCommand = true
  return parts.map((part): InlineTextSegment => {
    if (/^\s+$/.test(part)) return { text: part, fg: theme.dim }
    if (part === '&&' || part === '||' || part === '|' || part === ';') {
      expectsCommand = true
      return { text: part, fg: theme.pink }
    }
    if (expectsCommand) {
      expectsCommand = false
      return { text: part, fg: theme.green }
    }
    if (/^-{1,2}[A-Za-z0-9]/.test(part)) return { text: part, fg: theme.amber }
    if (/^(?:\.?\.?\/|~\/|\/)/.test(part)) return { text: part, fg: theme.cyan }
    if (/^(['"`]).*\1$/.test(part)) return { text: part, fg: theme.text }
    return { text: part, fg: theme.muted }
  })
}

function nestedAgentToolDisplay(
  card: TuiTranscriptCard,
  provider: ProviderSelection | undefined,
  isExpanded: boolean,
  bodyLineLimit: number,
  syntaxEnabled: boolean,
  thinkingMode: boolean,
): CardDisplayData {
  const providerKey = card.provider ?? provider
  const isThinkingCard = card.lines.some((line) => line.tone === 'thinking')
  const isInsight = card.category === 'insight'
  const isTechnical = card.category === 'technical'
  const isDiff = card.category === 'diff'
  const isSystem = card.category === 'system'
  return {
    landmarks: EMPTY_LANDMARKS,
    bodyLines: renderedBodyLines(card, isExpanded, bodyLineLimit, thinkingMode && isThinkingCard, false),
    diffView: cardDiffView(card, isExpanded),
    codeBlockLineCounts: isExpanded && card.codeBlocks
      ? card.codeBlocks.map((cb) => countCodeBlockLines(cb.content))
      : [],
    headerMeta: joinMeta([card.timestamp ?? null]),
    accent: transcriptAccent(card.role, providerKey),
    isThinkingCard,
    categoryEmoji: isInsight ? '✦ ' : isTechnical ? '⚒ ' : isDiff ? '✎ ' : isSystem ? '⚙ ' : '',
    isInsight,
    markdownFallbackLines: isExpanded && card.markdownContent && !card.hasMermaidDiagrams && !syntaxEnabled
      ? card.markdownContent.split('\n')
      : null,
  }
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

const STREAM_DIFF_PREVIEW_MAX_ROWS = 7

type StreamDiffPreviewData = {
  rows: TuiPierreDiffRow[]
  hiddenRows: number
  gutterWidth: number
  filetype: string | undefined
  additions: number
  deletions: number
}

const STREAM_DIFF_PREVIEW_CACHE = new WeakMap<TuiTranscriptCard, StreamDiffPreviewData | null>()

function streamDiffPreviewData(card: TuiTranscriptCard): StreamDiffPreviewData | null {
  if (STREAM_DIFF_PREVIEW_CACHE.has(card)) return STREAM_DIFF_PREVIEW_CACHE.get(card) ?? null
  const diffView = cardDiffView(card, false)
  if (!diffView) {
    STREAM_DIFF_PREVIEW_CACHE.set(card, null)
    return null
  }
  const contentRows = diffView.rows.filter((row) => row.oldLine != null || row.newLine != null)
  if (contentRows.length === 0) {
    STREAM_DIFF_PREVIEW_CACHE.set(card, null)
    return null
  }
  const firstChangeIndex = contentRows.findIndex((row) => row.tone === 'addition' || row.tone === 'deletion')
  const startIndex = Math.max((firstChangeIndex >= 0 ? firstChangeIndex : 0) - 2, 0)
  const rows = contentRows.slice(startIndex, startIndex + STREAM_DIFF_PREVIEW_MAX_ROWS)
  const largestLineNumber = rows.reduce((largest, row) => Math.max(largest, row.newLine ?? row.oldLine ?? 0), 0)
  const diffText = cardDiffText(card, false)
  const filePath = filePathFromDiffText(diffText, diffMetaFilePath(card) ?? card.label)
  const value = {
    rows,
    hiddenRows: contentRows.length - rows.length,
    gutterWidth: Math.max(String(largestLineNumber).length, 2),
    filetype: detectTuiCodeFiletypeFromPath(filePath),
    additions: contentRows.filter((row) => row.tone === 'addition').length,
    deletions: contentRows.filter((row) => row.tone === 'deletion').length,
  }
  STREAM_DIFF_PREVIEW_CACHE.set(card, value)
  return value
}

function StreamDiffPreview({
  card,
  theme,
  syntaxStyle,
  width,
  selectionColors,
}: {
  card: TuiTranscriptCard
  theme: TuiThemePalette
  syntaxStyle: SyntaxStyle | null
  width: number
  selectionColors: SelectionColors
}) {
  const preview = streamDiffPreviewData(card)
  if (!preview) return null
  const gutterWidth = preview.gutterWidth + 4
  const codeWidth = Math.max(width - gutterWidth, 8)
  const codeContent = preview.rows.map((row) => row.text).join('\n')
  const changeParts = [
    preview.additions > 0
      ? `Added ${preview.additions} ${preview.additions === 1 ? 'line' : 'lines'}`
      : '',
    preview.deletions > 0
      ? `${preview.additions > 0 ? 'removed' : 'Removed'} ${preview.deletions} ${preview.deletions === 1 ? 'line' : 'lines'}`
      : '',
  ].filter(Boolean)
  return (
    <box flexDirection="column" paddingLeft={2} marginTop={0}>
      {changeParts.length > 0 ? (
        <text fg={theme.text} wrapMode="none" selectable {...selectionColors}>
          <span fg={theme.dim}>{'└  '}</span>
          {changeParts.join(', ')}
        </text>
      ) : null}
      <box flexDirection="row" height={preview.rows.length}>
        <box width={gutterWidth} flexDirection="column">
          {preview.rows.map((row) => {
            const lineNumber = row.newLine ?? row.oldLine
            return (
              <text fg={diffRowColor(row, theme)} wrapMode="none" selectable {...selectionColors} key={`${row.key}:gutter`}>
                {`${formatDiffLineNumber(lineNumber, preview.gutterWidth)} ${row.indicator ?? diffRowIndicator(row)} `}
              </text>
            )
          })}
        </box>
        {syntaxStyle ? (
          <code
            content={codeContent}
            filetype={preview.filetype}
            syntaxStyle={syntaxStyle}
            drawUnstyledText={true}
            selectable
            {...selectionColors}
            style={{ height: preview.rows.length }}
            width={codeWidth}
          />
        ) : (
          <box width={codeWidth} flexDirection="column">
            {preview.rows.map((row) => (
              <text fg={diffRowColor(row, theme)} wrapMode="none" selectable {...selectionColors} key={`${row.key}:plain`}>
                {fitText(row.text, codeWidth)}
              </text>
            ))}
          </box>
        )}
      </box>
      {preview.hiddenRows > 0 ? (
        <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
          {fitText(`   … ${preview.hiddenRows} more lines`, width)}
        </text>
      ) : null}
    </box>
  )
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

// Collapsed system cards (session notices, thinking_tokens, init) carry no
// actionable body — only a label and timestamp. Rendering each in a full
// bordered box wastes ~4 rows of dead space apiece and visually shouts over
// the conversation. When folded we render them as a single quiet line; the
// full box returns on expand. Height math below must mirror that branch.
function isCompactSystemCard(card: TuiTranscriptCard, isExpanded: boolean): boolean {
  return card.category === 'system' && !isExpanded
}

// Tail-follow normally owns the scroll position, so the outer cursor does not
// request a reveal there. Nested tool navigation is different: its parent card
// key stays fixed while the highlighted child moves, and that child still needs
// to be brought into view even when the group is the latest transcript card.
export function transcriptCursorScrollTargetKey(
  transcriptCursorKey: string | null,
  agentToolCursorKey: string | null,
  followTail: boolean,
): string | null {
  if (agentToolCursorKey) return agentToolCursorKey
  return followTail ? null : transcriptCursorKey
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
  if (isCompactSystemCard(card, isExpanded)) {
    const landmarkRows = transcriptLandmarks(cards, index, resumeMarkerIndex, unreadBoundaryIndex, pendingNewCount).length
    return landmarkRows + 1 + cardGap
  }
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

const TRANSCRIPT_VIEWS: TuiTranscriptView[] = ['conversation', 'full', 'continue', 'stream', 'agents', 'chat']

const TRANSCRIPT_VIEW_LABELS: Record<TuiTranscriptView, string> = {
  conversation: 'CONVERSATION',
  full: 'FULL',
  continue: 'CONTINUE',
  stream: 'STREAM',
  agents: 'AGENTS',
  chat: 'CHAT',
}

const TRANSCRIPT_VIEW_DESCRIPTIONS: Record<TuiTranscriptView, string> = {
  conversation: 'Conversation with technical details folded',
  full: 'Every transcript card expanded',
  continue: 'Focus on the latest continuation',
  stream: 'Chronological Claude-style activity stream',
  agents: 'Group tool activity by agent',
  chat: 'Composer flows inline with the conversation, no dock',
}

const PROVIDER_SELECT_OPTIONS: SelectOption[] = PROVIDERS.map((provider) => ({
  name: provider.toUpperCase(),
  description: provider === 'all' ? 'All providers' : `${provider} sessions`,
  value: provider,
}))

const COORD_RUN_PROVIDERS: AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi']
const COORD_MODAL_FOCUS_ORDER = [
  'prompt', 'acceptance', 'nonGoals', 'manualQa', 'escalation',
  'playbook', 'playbookArgs', 'provider', 'pool', 'agents', 'tokenBudget',
  'durationBudget', 'worktrees', 'gate', 'autonomy', 'plans', 'review', 'launch',
] as const
type CoordModalFocus = (typeof COORD_MODAL_FOCUS_ORDER)[number]

function moveCoordModalFocus(current: CoordModalFocus, direction: 1 | -1): CoordModalFocus {
  const index = COORD_MODAL_FOCUS_ORDER.indexOf(current)
  return COORD_MODAL_FOCUS_ORDER[(index + direction + COORD_MODAL_FOCUS_ORDER.length) % COORD_MODAL_FOCUS_ORDER.length]
}

function cycleCoordProvider(current: AgentProvider, direction: 1 | -1): AgentProvider {
  const index = COORD_RUN_PROVIDERS.indexOf(current)
  return COORD_RUN_PROVIDERS[(Math.max(index, 0) + direction + COORD_RUN_PROVIDERS.length) % COORD_RUN_PROVIDERS.length]
}

const COORD_AUTONOMY_LEVELS: ProtocolAutonomy[] = ['low', 'medium', 'high']

function cycleCoordAutonomy(current: ProtocolAutonomy, direction: 1 | -1): ProtocolAutonomy {
  const index = COORD_AUTONOMY_LEVELS.indexOf(current)
  return COORD_AUTONOMY_LEVELS[(Math.max(index, 0) + direction + COORD_AUTONOMY_LEVELS.length) % COORD_AUTONOMY_LEVELS.length]
}

function parseCoordContractLines(value: string): string[] {
  return value.split(/\r?\n|;/).map((line) => line.trim()).filter(Boolean)
}

type TuiEffort = 'auto' | ReasoningEffortLevel
type TuiCodexApproval = 'auto' | 'untrusted' | 'on-request' | 'never'
type TuiCopilotPermissionMode = 'off' | 'auto' | 'on'
type ModelPickerFocus = 'model' | 'effort' | 'permissions'
type ModelPickerOption = SelectOption & Pick<SessionModelInfo, 'supportsEffort' | 'supportedEffortLevels'>

function filterModelPickerOptions(options: ModelPickerOption[], query: string): ModelPickerOption[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return options
  return options.filter((option) => {
    const haystack = `${option.name} ${String(option.value ?? '')} ${option.description ?? ''}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

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

function proceduralThemeLabel(name: string): string {
  return name.replace(/[-_+]/g, ' ').trim().toUpperCase()
}

const PROCEDURAL_THEME_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  PROCEDURAL_THEME_NAMES.map((name) => [name, `Generated palette · ${proceduralThemeLabel(name)}`]),
)

const PROCEDURAL_THEME_LABELS: Record<string, string> = Object.fromEntries(
  PROCEDURAL_THEME_NAMES.map((name) => [name, proceduralThemeLabel(name)]),
)

const THEME_DESCRIPTIONS_BASE: Record<Exclude<TuiThemeMode, (typeof PROCEDURAL_THEME_NAMES)[number]>, string> = {
  light: 'Crisp white background',
  alabaster: 'Minimal white with sparse color',
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
  'bone-china': 'Porcelain, warm white',
  'cold-pressed': 'Rag paper, neutral cool',
  'sunlit-alabaster': 'Translucent stone, warm',
  'brushed-aluminium': 'Silver, machined',
  'light-owl': 'Night Owl daylight palette',
  'papercolor-light': 'PaperColor neutral light',
  tomorrow: 'Tomorrow clean daylight',
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
  'solar-flare': 'Smoky charcoal with forest green',
  nord: 'Cool arctic greys',
  'gruvbox-dark': 'Gruvbox retro dark',
  dracula: 'Purple-heavy dracula',
  'fancy-dracula': 'Dracula on a cool slate canvas',
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
  'claude-code': 'Claude Code charcoal + olive',
  'oceanic-next': 'Oceanic blue-grey',
  'papercolor-dark': 'PaperColor neutral dark',
  snazzy: 'Snazzy neon contrast',
  'tomorrow-night': 'Tomorrow muted night',
  ethereal: 'Ethereal indigo dusk',
  hackerman: 'Hackerman neon green',
  lumon: 'Lumon Severance blue',
  'matte-black': 'Matte black with amber',
  miasma: 'Miasma olive haze',
  'osaka-jade': 'Osaka jade temple',
  'retro-82': 'Retro 82 neon arcade',
  ristretto: 'Ristretto warm coffee',
  vantablack: 'Vantablack pure dark',
  orchestrator: 'Black terminal with cyan rails and yellow focus',
  'anodised-obsidian': 'Pulp brush, warm room',
  'dark-ceramic': 'Sintered, one softbox',
  'carbon-surface': 'Forged fibre, matte coat',
  'smoked-glass': 'Cover glass over graphite',
  metalterm: 'Soot, orange accent',
  graphite: 'Neutral warm grey',
  ember: 'Amber on soot',
  abyss: 'Cyan on ink',
  orchid: 'Violet, magenta lift',
  phosphor: 'Green CRT glass',
  nocturne: 'Slate blue, low glare',
  slate: 'Graphite blue',
  solstice: 'Teal ink, low contrast',
  dune: 'Retro earth',
  grape: 'Night purple, candy',
  repo: 'Blue-grey, code host',
  cappuccino: 'Mocha, soft pastels',
  linear: 'Linear lavender dusk',
  sentry: 'Sentry deep violet',
  'slack-dark': 'Slack charcoal aubergine',
  raycast: 'Raycast near-black',
  framer: 'Framer gradient blue',
  ferrari: 'Ferrari racing red',
  resend: 'Resend neon glow',
  cyber: 'Neon accents',
  'cyber-wave': 'Deep teal with electric accents',
  'willow-dream': 'Soft willow teal with lavender',
  agnoster: 'Powerline blue-black segments',
  robbyrussell: 'Classic oh-my-zsh green arrow',
  'af-magic': 'Matrix-style terminal green',
  bira: 'Two-line blue and pink prompt',
  avit: 'Purple and magenta git-aware',
  gentoo: 'Gentoo purple and white',
  candy: 'Playful pink and violet candy',
  eastwood: 'Western tan and brown',
  fishy: 'Aqua blue fish scale',
  frisk: 'Minimal grey-green',
  gnzh: 'Bold red and black',
  kennethreitz: 'Clean cyan and slate',
  arrow: 'Minimal red arrow accent',
  bureau: 'Professional blue-grey',
  dogenpunk: 'Neon punk purple and pink',
  dst: 'Subdued dark teal',
  fox: 'Warm orange and rust',
  funky: 'Bright playful magenta and lime',
  juanghurtado: 'Minimalist slate blue',
  kolo: 'Cool teal grid',
  lambda: 'Minimal lambda-calculus violet',
  muse: 'Soft creative pastel',
  nanotech: 'Futuristic cyan-green tech',
  pygmalion: 'Elegant magenta and gold',
}

const THEME_DESCRIPTIONS: Record<TuiThemeMode, string> = {
  ...THEME_DESCRIPTIONS_BASE,
  ...PROCEDURAL_THEME_DESCRIPTIONS,
} as Record<TuiThemeMode, string>

const THEME_LABELS_BASE: Record<Exclude<TuiThemeMode, (typeof PROCEDURAL_THEME_NAMES)[number]>, string> = {
  light: 'LIGHT',
  alabaster: 'ALABASTER',
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
  'bone-china': 'BONE CHINA',
  'cold-pressed': 'COLD-PRESSED',
  'sunlit-alabaster': 'SUNLIT ALABASTER',
  'brushed-aluminium': 'BRUSHED ALUMINIUM',
  'light-owl': 'LIGHT OWL',
  'papercolor-light': 'PAPERCOLOR LIGHT',
  tomorrow: 'TOMORROW',
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
  'solar-flare': 'SOLAR FLARE',
  nord: 'NORD',
  'gruvbox-dark': 'GRUVBOX DARK',
  dracula: 'DRACULA',
  'fancy-dracula': 'FANCY DRACULA',
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
  'claude-code': 'CLAUDE CODE',
  'oceanic-next': 'OCEANIC NEXT',
  'papercolor-dark': 'PAPERCOLOR DARK',
  snazzy: 'SNAZZY',
  'tomorrow-night': 'TOMORROW NIGHT',
  ethereal: 'ETHEREAL',
  hackerman: 'HACKERMAN',
  lumon: 'LUMON',
  'matte-black': 'MATTE BLACK',
  miasma: 'MIASMA',
  'osaka-jade': 'OSAKA JADE',
  'retro-82': 'RETRO 82',
  ristretto: 'RISTRETTO',
  vantablack: 'VANTABLACK',
  orchestrator: 'ORCHESTRATOR',
  'anodised-obsidian': 'ANODISED OBSIDIAN',
  'dark-ceramic': 'DARK CERAMIC',
  'carbon-surface': 'CARBON SURFACE',
  'smoked-glass': 'SMOKED GLASS',
  metalterm: 'METALTERM',
  graphite: 'GRAPHITE',
  ember: 'EMBER',
  abyss: 'ABYSS',
  orchid: 'ORCHID',
  phosphor: 'PHOSPHOR',
  nocturne: 'NOCTURNE',
  slate: 'SLATE',
  solstice: 'SOLSTICE',
  dune: 'DUNE',
  grape: 'GRAPE',
  repo: 'REPO',
  cappuccino: 'CAPPUCCINO',
  linear: 'LINEAR',
  sentry: 'SENTRY',
  'slack-dark': 'SLACK DARK',
  raycast: 'RAYCAST',
  framer: 'FRAMER',
  ferrari: 'FERRARI',
  resend: 'RESEND',
  cyber: 'CYBER',
  'cyber-wave': 'CYBER WAVE',
  'willow-dream': 'WILLOW DREAM',
  agnoster: 'AGNOSTER',
  robbyrussell: 'ROBBYRUSSELL',
  'af-magic': 'AF-MAGIC',
  bira: 'BIRA',
  avit: 'AVIT',
  gentoo: 'GENTOO',
  candy: 'CANDY',
  eastwood: 'EASTWOOD',
  fishy: 'FISHY',
  frisk: 'FRISK',
  gnzh: 'GNZH',
  kennethreitz: 'KENNETHREITZ',
  arrow: 'ARROW',
  bureau: 'BUREAU',
  dogenpunk: 'DOGENPUNK',
  dst: 'DST',
  fox: 'FOX',
  funky: 'FUNKY',
  juanghurtado: 'JUANGHURTADO',
  kolo: 'KOLO',
  lambda: 'LAMBDA',
  muse: 'MUSE',
  nanotech: 'NANOTECH',
  pygmalion: 'PYGMALION',
}

const THEME_LABELS: Record<TuiThemeMode, string> = {
  ...THEME_LABELS_BASE,
  ...PROCEDURAL_THEME_LABELS,
} as Record<TuiThemeMode, string>

type PaletteCommand = { id: string; label: string; key: string; category: string }
type PaletteRow =
  | { kind: 'header'; label: string }
  | { kind: 'cmd'; cmd: PaletteCommand; cmdIndex: number }

const RUNNING_INSIDE_TMUX = Boolean(process.env.TMUX)
const FLEET_PAGE_SIZE = 9

const COMMANDS: PaletteCommand[] = [
  // Navigation
  { id: 'live',       label: 'Jump to live tail',      key: 'f',  category: 'Navigation' },
  { id: 'unread',     label: 'Jump to first unread',   key: 'u',  category: 'Navigation' },
  { id: 'mark',       label: 'Mark position',          key: 'm',  category: 'Navigation' },
  // Transcript
  { id: 'search',     label: 'Search messages',        key: '/',  category: 'Transcript' },
  { id: 'session-search', label: 'Search sessions',    key: '/',  category: 'Session'    },
  { id: 'next-attention', label: 'Jump to next attention item', key: '⌃N', category: 'Session' },
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
  { id: 'composer-toggle', label: 'Show/hide composer',   key: '⇧E', category: 'Session'    },
  { id: 'composer-stash', label: 'Stash composer prompt', key: 'stash', category: 'Session' },
  { id: 'composer-stash-pop', label: 'Pop composer stash', key: 'pop', category: 'Session' },
  { id: 'composer-stash-list', label: 'List composer stash', key: 'list', category: 'Session' },
  { id: 'new',        label: 'New agent session',      key: 'N',  category: 'Session'    },
  { id: 'reuse',      label: 'Reuse last prompt',      key: 'R',  category: 'Session'    },
  { id: 'rename',     label: 'Rename session',         key: '^R', category: 'Session'    },
  { id: 'cli',        label: 'Copy CLI resume command', key: 'C',  category: 'Session'    },
  { id: 'channel-bridge', label: 'Channel bridge',      key: '⇧C', category: 'Session'    },
  { id: 'channel-bridge-route', label: 'Toggle composer → bridge routing', key: 'route', category: 'Session' },
  { id: 'ide-bridge', label: 'IDE bridge',              key: '⇧I', category: 'Session'    },
  { id: 'ide-bridge-route', label: 'Toggle composer → IDE routing', key: 'route', category: 'Session' },
  { id: 'git',        label: 'Git status',             key: '^G', category: 'Session'    },
  { id: 'pull-requests', label: 'Review pull requests', key: '^⇧G', category: 'Session'   },
  { id: 'files',      label: 'Browse project files',   key: '^F', category: 'Session'    },
  { id: 'editor',     label: 'Open project editor',    key: '^E', category: 'Session'    },
  { id: 'analytics',  label: 'Session analytics',      key: '^A', category: 'Session'    },
  { id: 'attention',  label: 'Attention inbox',        key: '!',  category: 'Session'    },
  { id: 'messaging',  label: 'Cross-session messaging', key: '⇧M', category: 'Session'   },
  { id: 'worktree-new',     label: 'New worktree task',              key: '⇧F', category: 'Worktree' },
  { id: 'worktree-merge',   label: 'Merge worktree task into main',  key: '',   category: 'Worktree' },
  { id: 'worktree-discard', label: 'Discard worktree task',          key: '',   category: 'Worktree' },
  { id: 'coord-start', label: 'Start coordinated run', key: '^⇧N', category: 'Coordination' },
  { id: 'coord-board', label: 'Open Agent Operations', key: '^⇧A', category: 'Coordination' },
  { id: 'coord-cleanup', label: 'Clean completed worktrees', key: 'c', category: 'Coordination' },
  { id: 'coord-stop', label: 'Stop coordinated run', key: '', category: 'Coordination' },
  { id: 'fleet',      label: 'Toggle fleet strip',      key: '⇧A', category: 'View'       },
  { id: 'checkpoints', label: 'Checkpoints & review',   key: '⇧U', category: 'Session'    },
  { id: 'handoff-brief', label: 'Handoff brief',       key: 'H',  category: 'Session'    },
  { id: 'prompt-library', label: 'Prompt library',     key: '⇧P', category: 'Session'    },
  { id: 'diagnostics', label: 'Session diagnostics',   key: 'D',  category: 'Session'    },
  { id: 'provider',   label: 'Switch provider',        key: 'p',  category: 'Session'    },
  { id: 'sort',       label: 'Toggle sidebar sort',    key: 'S',  category: 'Session'    },
  { id: 'sidebar-view', label: 'Switch sidebar view',  key: 'a',  category: 'Session'    },
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
  { id: 'view',       label: 'Switch transcript view', key: 'v',  category: 'View'       },
  { id: 'width',      label: 'Toggle transcript width', key: '⇧W', category: 'View'       },
  { id: 'split-add',    label: 'Split transcript pane',    key: splitCommandKey('%', RUNNING_INSIDE_TMUX), category: 'View'  },
  { id: 'split-close',  label: 'Close split pane',         key: splitCommandKey('x', RUNNING_INSIDE_TMUX), category: 'View'  },
  { id: 'split-focus',  label: 'Focus next split pane',    key: splitCommandKey('o', RUNNING_INSIDE_TMUX), category: 'View'  },
  { id: 'split-focus-back', label: 'Focus reader (leave split pane)', key: 'esc', category: 'View' },
  { id: 'split-cycle',  label: 'Next session in split pane', key: splitCommandKey('n', RUNNING_INSIDE_TMUX), category: 'View' },
  { id: 'split-toggle', label: 'Toggle split panes',       key: splitCommandKey('z', RUNNING_INSIDE_TMUX), category: 'View'  },
  { id: 'rail',       label: 'Toggle session rail',    key: 'h',  category: 'View'       },
  { id: 'focus',      label: 'Toggle focus mode',      key: 'z',  category: 'View'       },
  { id: 'tools',      label: 'Toggle tool calls',      key: 'X',  category: 'View'       },
  { id: 'velocity-scroll', label: 'Toggle velocity scroll', key: '⇧V', category: 'View'  },
  { id: 'mode',       label: 'Cycle provider mode',    key: 'M',  category: 'Session'    },
  { id: 'model',      label: 'Composer settings',      key: '⌥M', category: 'Session'    },
  { id: 'workflow',   label: 'Toggle workflow tool',   key: '',   category: 'Session'    },
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

type DensityState = { bodyLines: number; bodyIndent: number; cardGap: number; bodyPad: number; streamGap: number; streamUserGap: number }

// Conversation prose becomes difficult to scan when cards stretch across an
// ultrawide terminal. Keep normal cards at a readable measure while allowing
// diffs to use the full reader width for side-by-side content.
const MAX_TRANSCRIPT_CARD_WIDTH = 144
const MAX_USER_CARD_WIDTH = 112

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
  transcriptWidth: TuiTranscriptWidth
  streamMode: boolean
  agentsMode: boolean
  agentToolCursorKey: string | null
  agentToolExpandedKeys: ReadonlySet<string>
  agentToolCollapsedKeys: ReadonlySet<string>
  onSelectAgentTool: (groupKey: string, toolKey: string) => void
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
  diffPlainCardKeys: ReadonlySet<string>
  diffHiddenLineNumberCardKeys: ReadonlySet<string>
  diffHiddenHunkHeaderCardKeys: ReadonlySet<string>
  diffRowCursorByCardKey: Readonly<Record<string, number>>
  diffSelectionAnchorByCardKey: Readonly<Record<string, number>>
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

// Shared block-markdown body for the Stream and Agents views. Mirrors the
// reader card's three-way decision: full <markdown> (tables/headings/lists/
// fenced code) when syntax is on, the raw-source fallback with inline styling
// when it isn't, or null so the caller keeps its own bodyLines rendering.
// Both gated on the same `shouldRenderSyntaxMarkdown`/`markdownFallbackLines`
// the reader computes, so all views agree on when a card is "markdown".
function renderCardMarkdownBody(opts: {
  markdownContent: string | null | undefined
  markdownFallbackLines: string[] | null
  shouldRenderSyntaxMarkdown: boolean
  syntaxStyle: SyntaxStyle | null
  theme: TuiThemePalette
  fg: string
  width: number
  selectionColors: SelectionColors
  keyPrefix: string
}): React.ReactNode | null {
  const {
    markdownContent, markdownFallbackLines, shouldRenderSyntaxMarkdown,
    syntaxStyle, theme, fg, width, selectionColors, keyPrefix,
  } = opts
  if (shouldRenderSyntaxMarkdown && markdownContent && syntaxStyle) {
    return (
      <SelectableMarkdown
        content={markdownContent}
        syntaxStyle={syntaxStyle}
        fg={fg}
        width={width}
        selectionColors={selectionColors}
        borderColor={theme.border}
      />
    )
  }
  if (markdownFallbackLines) {
    return (
      <box flexDirection="column">
        {markdownFallbackLines.map((line, index) => (
          <text key={`${keyPrefix}:mdf:${index}`} fg={fg} wrapMode="none" selectable {...selectionColors}>
            {hasInlineMarkdown(line)
              ? renderInlineMarkdownClipped(line, theme, fg, width, `${keyPrefix}:mdf:${index}`)
              : fitText(line, width)}
          </text>
        ))}
      </box>
    )
  }
  return null
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
  transcriptWidth,
  streamMode,
  agentsMode,
  agentToolCursorKey,
  agentToolExpandedKeys,
  agentToolCollapsedKeys,
  onSelectAgentTool,
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
  diffPlainCardKeys,
  diffHiddenLineNumberCardKeys,
  diffHiddenHunkHeaderCardKeys,
  diffRowCursorByCardKey,
  diffSelectionAnchorByCardKey,
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
  const cardBg = card.role === 'user'
    ? theme.userBg
    : hasCursor
      ? theme.surface3
      : isSelected
        ? theme.surface2
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
  const availableCardWidth = Math.max(rightPaneWidth - 4, 20)
  // Native diff review keeps the full reader width. Once a diff is presented
  // as an Agents operation, its outer container should follow the same centered
  // width as every multi-tool group; the nested diff still fills that container.
  const centeredCard = shouldCenterTranscriptCard(card, transcriptWidth, agentsMode)
  const readableCardWidth = centeredCard
    ? Math.min(availableCardWidth, MAX_TRANSCRIPT_CARD_WIDTH)
    : availableCardWidth
  const userBubble = centeredCard && card.role === 'user'
  const cardWidth = userBubble
    ? Math.min(Math.max(Math.floor(readableCardWidth * 0.78), 20), MAX_USER_CARD_WIDTH)
    : readableCardWidth
  const imessageUserBubble = userBubble && imessageStyle
  const maxTitleWidth = Math.max(cardWidth - 4, 20)
  const titleMeta = joinMeta([
    headerMeta,
    card.category === 'diff' ? `s ${diffLayout}` : null,
    isSearchHit ? 'match' : null,
    card.usageSummary ?? null,
    card.durationLabel ? `⏱ ${card.durationLabel}` : null,
    hasCursor ? 'y copy  b bookmark  Q reply' : null,
  ])
  const bookmarkGlyph = bookmarked ? '★ ' : ''
  const cardTitleFull = `${marker} ${bookmarkGlyph}${categoryEmoji}${card.label}${titleMeta ? `  ${titleMeta}` : ''}`
  const cardTitle = cardTitleFull.length > maxTitleWidth
    ? cardTitleFull.slice(0, maxTitleWidth - 1) + '…'
    : cardTitleFull
  const bubbleTextColor = imessageUserBubble ? '#ffffff' : theme.text
  const bodyInnerWidth = Math.max(cardWidth - densityState.bodyIndent - 8, 16)
  const markdownWidth = Math.max(cardWidth - densityState.bodyIndent - 8, 20)
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
  const diffTextWidth = Math.max(bodyInnerWidth - (diffShowLineNumbers ? (diffGutterWidth * 2 + 2) : 0) - 5 - diffBadgeWidth - 1, 12)
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
  // Keys pop in cyan, labels stay muted — same scan-at-a-glance convention as
  // the main status bar (see footerSegments). The `syntax` status is rendered
  // as a real status chip (green dot = active), not disguised as a keybinding,
  // and only when parsed mode is actually highlighting.
  const diffFooterSegments = card.category === 'diff'
    ? (() => {
        const controls: Array<[string, string]> = [
          ['v', diffPlain ? 'parsed' : 'plain'],
          ['s', diffLayout],
          ['n', diffShowLineNumbers ? '#' : 'no#'],
          ['m', diffShowHunkHeaders ? '@@' : 'no@@'],
          ['{}', 'hunk'],
          ['⇧j/k', 'range'],
          ['a', 'note'],
          ['A', 'composer'],
          ['x', 'del'],
        ]
        const segs: InlineTextSegment[] = []
        controls.forEach(([keyGlyph, label], i) => {
          if (i > 0) segs.push({ text: '  ', fg: theme.dim })
          segs.push({ text: keyGlyph, fg: theme.cyan })
          segs.push({ text: ` ${label}`, fg: theme.muted })
        })
        if (!diffPlain) {
          segs.push({ text: '   ● ', fg: theme.green })
          segs.push({ text: 'syntax', fg: theme.muted })
        }
        return segs
      })()
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
  const landmarkWidth = readableCardWidth - 4
  const selectionColors = terminalSelectionColors(theme)

  if (agentsMode) {
    const agentWidth = Math.max(readableCardWidth, 24)
    const toolCards = agentToolCardsFor(card)
    const operationalCard = toolCards.length > 0
    const streamAskUserCard = streamMode
      && toolCards.length === 1
      && streamToolSummaryName(toolCards[0]) === 'ask user'
      ? toolCards[0]
      : null
    const streamAskUserLines = streamAskUserCard
      ? isExpanded ? streamAskUserCard.expandedLines : streamAskUserCard.lines
      : []
    const agentAccent = operationalCard ? theme.amber : accent
    const agentBg = hasCursor
      ? theme.surface3
      : isSelected
        ? theme.surface2
        : operationalCard
          ? mixHexColor(theme.amber, theme.surface, 0.08) ?? theme.surface
          : cardBg
    const streamAgentBg = hasCursor
      ? isExpanded && agentToolCursorKey
        ? theme.surface2
        : theme.userBg
      : undefined
    const contentWidth = Math.max(agentWidth - 2, 16)
    const agentBodyWidth = Math.max(contentWidth - 2, 12)
    const agentMarkdownBody = renderCardMarkdownBody({
      markdownContent: card.markdownContent,
      markdownFallbackLines,
      shouldRenderSyntaxMarkdown,
      syntaxStyle,
      theme,
      fg: theme.text,
      width: agentBodyWidth,
      selectionColors,
      keyPrefix: `${card.key}:agent`,
    })
    const toolCount = toolCards.length || bodyLines.filter((line) => line.tone === 'tool' && /^tool\s+/i.test(line.text.trim())).length || 1
    const headerLabel = operationalCard
      ? `${toolCount} tool ${toolCount === 1 ? 'call' : 'calls'}`
      : card.label
    const streamGroupMarker = operationalCard ? streamToolGroupMarker(toolCards) : '•'
    const agentsMarker = hasCursor ? '>' : operationalCard ? '⚙' : card.role === 'user' ? '▸' : '●'
    const agentsTitleMeta = joinMeta([
      headerMeta,
      isSearchHit ? 'match' : null,
      bookmarked ? 'bookmarked' : null,
      card.usageSummary ?? null,
      card.durationLabel ? `⏱ ${card.durationLabel}` : null,
      hasCursor ? 'y copy  b bookmark  Q reply' : null,
    ])
    const agentsMaxTitleWidth = Math.max(agentWidth - 4, 20)
    const agentsCardTitleFull = `${agentsMarker} ${headerLabel}${agentsTitleMeta ? `  ${agentsTitleMeta}` : ''}`
    const agentsCardTitle = agentsCardTitleFull.length > agentsMaxTitleWidth
      ? agentsCardTitleFull.slice(0, agentsMaxTitleWidth - 1) + '…'
      : agentsCardTitleFull
    const expandedToolDisplays = isExpanded && toolCards.length > 0 && !streamAskUserCard
      ? toolCards.map((toolCard) => {
          const toolExpanded = agentToolCardIsExpanded(toolCard, agentToolExpandedKeys, agentToolCollapsedKeys)
          return {
            card: toolCard,
            display: nestedAgentToolDisplay(
              toolCard,
              toolCard.provider,
              toolExpanded,
              densityState.bodyLines,
              Boolean(syntaxStyle),
              thinkingMode,
            ),
            isExpanded: toolExpanded,
            hasCursor: hasCursor && agentToolCursorKey === toolCard.key,
          }
        })
      : []
    const rendersCollapsedStreamTools = streamMode && operationalCard && !isExpanded
    const collapsedStreamToolCards = toolCards
    const streamActivitySegments = rendersCollapsedStreamTools
      ? streamActivitySummarySegments(collapsedStreamToolCards, theme)
      : null
    const streamDetailToolCards = collapsedStreamToolCards
    let streamActivityToolCount = 0
    let lastStreamActivityIndex = -1
    for (let index = 0; index < streamDetailToolCards.length; index += 1) {
      if (isStreamActivityToolCard(streamDetailToolCards[index])) {
        streamActivityToolCount += 1
        lastStreamActivityIndex = index
      }
    }
    const hasSingleStreamActivity = streamActivityToolCount === 1
    return (
      <box
        flexDirection="column"
        marginBottom={streamMode ? densityState.streamGap : densityState.cardGap}
        width={agentWidth}
        alignSelf={centeredCard ? 'center' : undefined}
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
            <box key={`${card.key}:agent-landmark:${landmarkIndex}`} paddingX={1}>
              <text fg={color} width={landmarkWidth} wrapMode="none" selectable {...selectionColors}>
                {streamMode
                  ? streamLandmarkText(landmark, landmarkWidth)
                  : fitText(landmark.text, landmarkWidth)}
              </text>
            </box>
          )
        })}
        <box
          id={`card:${card.key}`}
          flexDirection="row"
          width={agentWidth}
          border={!streamMode}
          borderStyle={streamMode ? undefined : hasCursor ? 'heavy' : 'single'}
          borderColor={streamMode ? undefined : hasCursor || isSearchHit ? agentAccent : borderColor}
          backgroundColor={streamMode ? streamAgentBg : agentBg}
          title={streamMode ? undefined : agentsCardTitle}
          titleColor={agentAccent}
          onMouseDown={(event) => {
            if (event.button !== 0) return
            onSelectCard(card.key)
          }}
        >
          <box
            flexDirection="column"
            width={contentWidth}
            paddingX={1}
            paddingBottom={streamMode ? 0 : densityState.bodyPad}
          >
            {streamAskUserCard ? (
              <box flexDirection="column">
                {streamAskUserLines.map((line, lineIndex) => (
                  <text
                    key={`${card.key}:stream-ask-user:${lineIndex}`}
                    fg={transcriptColor(line, theme)}
                    wrapMode="none"
                    selectable
                    {...selectionColors}
                  >
                    {line.tone === 'tool'
                      ? renderInlineTextSegments(
                          transcriptToolLineSegments(line.text, theme),
                          agentBodyWidth,
                          theme.dim,
                        )
                      : hasInlineMarkdown(line.text)
                        ? renderInlineMarkdownClipped(
                            line.text,
                            theme,
                            transcriptColor(line, theme),
                            agentBodyWidth,
                            `${card.key}:stream-ask-user-md:${lineIndex}`,
                          )
                        : fitText(line.text, agentBodyWidth)}
                  </text>
                ))}
              </box>
            ) : rendersCollapsedStreamTools ? (
              <box flexDirection="column">
                {streamActivitySegments && !hasSingleStreamActivity ? (
                  <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
                    {renderInlineTextSegments(
                      hasCursor && streamActivitySegments[0]
                        ? [{ text: '❯ ', fg: theme.text }, ...streamActivitySegments.slice(1)]
                        : streamActivitySegments,
                      agentBodyWidth,
                      theme.dim,
                    )}
                  </text>
                ) : null}
                {streamDetailToolCards.map((toolCard, toolIndex) => {
                  let segments = streamToolSummarySegments(toolCard, theme)
                  const diffPreview = toolCard.category === 'diff' ? streamDiffPreviewData(toolCard) : null
                  const isActivityTool = Boolean(streamActivitySegments && isStreamActivityToolCard(toolCard))
                  const isSingleActivityTool = hasSingleStreamActivity && isActivityTool
                  const detailLine = diffPreview ? null : streamToolDetailLine(toolCard)
                  const isLastActivityTool = isActivityTool && toolIndex === lastStreamActivityIndex
                  if (isSingleActivityTool && segments[0]) {
                    if (hasCursor && segments[0]) segments[0] = { text: '❯ ', fg: theme.text }
                  } else if (isActivityTool && segments[0]) {
                    segments[0] = { text: isLastActivityTool ? '  └ ' : '  ├ ', fg: theme.dim }
                  } else if (hasCursor && streamActivitySegments === null && toolIndex === 0 && segments[0]) {
                    segments[0] = { text: '❯ ', fg: theme.text }
                  }
                  if (hasCursor && toolIndex === streamDetailToolCards.length - 1) {
                    segments.push({ text: '  ·  e details', fg: theme.dim })
                  }
                  return (
                    <box
                      key={`${card.key}:stream-tool-summary:${toolCard.key}`}
                      flexDirection="column"
                    >
                      <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
                        {renderInlineTextSegments(segments, agentBodyWidth, theme.dim)}
                      </text>
                      {detailLine ? (
                        <text fg={transcriptColor(detailLine, theme)} wrapMode="none" selectable {...selectionColors}>
                          {renderInlineTextSegments([
                            {
                              text: isActivityTool
                                ? isLastActivityTool ? '    └ ' : '  │ └ '
                                : '  └ ',
                              fg: theme.dim,
                            },
                            { text: detailLine.text.trim(), fg: transcriptColor(detailLine, theme) },
                          ], agentBodyWidth, theme.dim)}
                        </text>
                      ) : null}
                      {diffPreview ? (
                        <StreamDiffPreview
                          card={toolCard}
                          theme={theme}
                          syntaxStyle={syntaxStyle}
                          width={agentBodyWidth}
                          selectionColors={selectionColors}
                        />
                      ) : null}
                    </box>
                  )
                })}
              </box>
            ) : streamMode ? (
              <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
                {renderInlineTextSegments([
                  { text: hasCursor ? '❯ ' : `${streamGroupMarker} `, fg: hasCursor ? theme.text : streamStatusColor(streamGroupMarker, theme) },
                  { text: `${headerLabel}  ·  e collapse  ·  j/k select`, fg: theme.dim },
                ], agentBodyWidth, theme.dim)}
              </text>
            ) : null}
            {expandedToolDisplays.length > 0 ? (
              <box flexDirection="column" marginTop={streamMode ? 0 : 1}>
                {expandedToolDisplays.map((toolEntry, toolIndex) => {
                  const toolCard = toolEntry.card
                  return (
                    <TranscriptCard
                      key={`${card.key}:agent-tool-card:${toolCard.key}:${toolIndex}`}
                      card={toolCard}
                      display={toolEntry.display}
                      theme={theme}
                      densityState={densityState}
                      syntaxStyle={syntaxStyle}
                      rightPaneWidth={agentBodyWidth + 4}
                      isExpanded={toolEntry.isExpanded}
                      hasCursor={toolEntry.hasCursor}
                      isSelected={toolEntry.hasCursor}
                      isSearchHit={false}
                      isActiveMatch={false}
                      bookmarked={false}
                      onSelectCard={() => {
                        onSelectCard(card.key)
                        onSelectAgentTool(card.key, toolCard.key)
                      }}
                      thinkingMode={thinkingMode}
                      diffLayout={diffLayout}
                      imessageStyle={imessageStyle}
                      transcriptWidth="full"
                      streamMode={streamMode}
                      agentsMode={false}
                      agentToolCursorKey={null}
                      agentToolExpandedKeys={EMPTY_EXPANDED_KEYS}
                      agentToolCollapsedKeys={EMPTY_EXPANDED_KEYS}
                      onSelectAgentTool={NOOP_SELECT_AGENT_TOOL}
                      noteNamespace={noteNamespace}
                      diffNotes={diffNotes}
                      diffDraft={diffDraft}
                      hoveredDiffAnchor={hoveredDiffAnchor}
                      activateDiffHover={activateDiffHover}
                      openDiffNote={openDiffNote}
                      sendDiffNoteToComposer={sendDiffNoteToComposer}
                      diffPlain={diffPlainCardKeys.has(toolCard.key)}
                      diffShowLineNumbers={!diffHiddenLineNumberCardKeys.has(toolCard.key)}
                      diffShowHunkHeaders={!diffHiddenHunkHeaderCardKeys.has(toolCard.key)}
                      diffRowCursor={diffRowCursorByCardKey[toolCard.key] ?? 0}
                      diffSelectionAnchor={diffSelectionAnchorByCardKey[toolCard.key] ?? null}
                      diffPlainCardKeys={diffPlainCardKeys}
                      diffHiddenLineNumberCardKeys={diffHiddenLineNumberCardKeys}
                      diffHiddenHunkHeaderCardKeys={diffHiddenHunkHeaderCardKeys}
                      diffRowCursorByCardKey={diffRowCursorByCardKey}
                      diffSelectionAnchorByCardKey={diffSelectionAnchorByCardKey}
                      setDiffRowCursor={setDiffRowCursor}
                      setDiffSelectionAnchor={setDiffSelectionAnchor}
                    />
                  )
                })}
              </box>
            ) : rendersCollapsedStreamTools || streamAskUserCard ? null : agentMarkdownBody ? (
              agentMarkdownBody
            ) : bodyLines.map((line, lineIndex) => {
              const toolLine = operationalCard && line.tone === 'tool'
              return (
                <box
                  key={`${card.key}:agent-line:${lineIndex}`}
                  backgroundColor={!streamMode && toolLine ? theme.surface2 : undefined}
                >
                  <text fg={transcriptColor(line, theme)} wrapMode="none" selectable {...selectionColors}>
                    {toolLine
                      ? renderInlineTextSegments(transcriptToolLineSegments(line.text, theme, streamMode ? '  └ ' : '› ', theme.dim, streamMode), agentBodyWidth, theme.dim)
                      : hasInlineMarkdown(line.text)
                        ? renderInlineMarkdownClipped(line.text, theme, transcriptColor(line, theme), agentBodyWidth, `${card.key}:agent-md:${lineIndex}`)
                        : fitText(line.text, agentBodyWidth)}
                  </text>
                </box>
              )
            })}
          </box>
        </box>
      </box>
    )
  }

  // Keep collapsed diffs compact in Stream mode, but route expanded diffs
  // through the full card renderer below. That renderer owns the existing
  // split/stack/plain views, hunk navigation, range selection, notes, and
  // composer actions; duplicating it here would make the two views drift.
  if (streamMode && !(card.category === 'diff' && isExpanded)) {
    // Collapsed diff rows stay inside the centered column too (unlike the
    // reader path's diff exemption) — only expanded diffs, routed to the full
    // renderer above, keep the whole pane width.
    const streamCentered = transcriptWidth === 'centered'
    // The transcript pane spends two columns on its border and two more on
    // the surrounding paddingX={1}; bodyIndent is budgeted separately below.
    const streamAvailableWidth = Math.max(rightPaneWidth - 4, 16)
    const streamWidth = streamCentered
      ? Math.max(Math.min(streamAvailableWidth - densityState.bodyIndent, MAX_TRANSCRIPT_CARD_WIDTH), 16)
      : Math.max(streamAvailableWidth - densityState.bodyIndent, 16)
    const streamLandmarkWidth = streamWidth + densityState.bodyIndent
    // Subagent cards prefix the marker with one ↪ per spawn-chain level
    // (`subagent:parent/child` origin), widening the marker gutter to match.
    const streamSubagentArrows = card.subagentDepth ? '↪'.repeat(Math.min(card.subagentDepth, 3)) : ''
    const streamMarkerWidth = 2 + streamSubagentArrows.length
    const streamTextWidth = Math.max(streamWidth - streamMarkerWidth, 12)
    const streamChildTextWidth = Math.max(streamWidth - 4, 10)
    const firstLine = bodyLines[0]
    const streamBaseMarker = hasCursor
      ? '❯'
      : firstLine
        ? streamLineMarker(firstLine, card.role)
        : card.role === 'user' ? '❯' : '•'
    const streamMarker = `${streamSubagentArrows}${streamBaseMarker}`
    const streamMarkerColor = hasCursor
      ? theme.text
      : isSearchHit
        ? theme.cyan
        : card.role === 'user'
          ? accent
          : firstLine && ['tool', 'result_ok', 'result_error', 'system'].includes(firstLine.tone)
            ? transcriptColor(firstLine, theme)
            : theme.text
    const streamFirstLineColor = hasCursor && firstLine
      ? theme.text
      : firstLine
        ? transcriptColor(firstLine, theme)
        : theme.dim
    const remainingLines = bodyLines.slice(1)
    const streamDiffPreview = card.category === 'diff' ? streamDiffPreviewData(card) : null
    const streamDiffHeaderSegments = streamDiffPreview
      ? (() => {
          const segments = streamToolSummarySegments(card, theme)
          if (hasCursor && segments[0]) segments[0] = { text: '❯ ', fg: theme.text }
          if (hasCursor) segments.push({ text: '  ·  e details', fg: theme.dim })
          return segments
        })()
      : null
    // Full block markdown (tables/headings/lists/fenced code) for expanded
    // text cards, same as the reader view — null for everything else, so the
    // per-line stream rendering below still owns tool cards and previews.
    const streamMarkdownBody = renderCardMarkdownBody({
      markdownContent: card.markdownContent,
      markdownFallbackLines,
      shouldRenderSyntaxMarkdown,
      syntaxStyle,
      theme,
      fg: theme.text,
      width: streamTextWidth,
      selectionColors,
      keyPrefix: `${card.key}:stream`,
    })
    // Turn boundaries and tool-only assistant messages carry no text body. They
    // would otherwise render a "(no output)" row of pure noise in Stream view —
    // drop the body entirely, even when focused. A card with no body and no
    // landmarks collapses to zero height (id anchor preserved for scroll-to).
    const streamHasBody = Boolean(streamMarkdownBody)
      || Boolean(streamDiffPreview)
      || Boolean(firstLine)
      || remainingLines.length > 0
      || (isExpanded && (card.codeBlocks?.length ?? 0) > 0)
    const streamRendersSomething = streamHasBody || landmarks.length > 0
    // User prompts get a full-width tinted band plus an accent rail so they
    // remain obvious even in palettes whose base user background is subtle.
    const streamBg = card.role === 'user'
      ? streamUserBackground(theme)
      : hasCursor
        ? theme.userBg
        : undefined
    return (
      <box
        id={`card:${card.key}`}
        flexDirection="column"
        marginBottom={streamRendersSomething
          ? (card.role === 'user' ? densityState.streamUserGap : densityState.streamGap)
          : 0}
        alignSelf={streamCentered ? 'center' : undefined}
        width={streamCentered ? streamWidth + densityState.bodyIndent : undefined}
        onMouseDown={(event) => {
          if (event.button !== 0) return
          onSelectCard(card.key)
        }}
      >
        {landmarks.map((landmark, landmarkIndex) => {
          const lmColor = landmark.kind === 'resume'
            ? theme.cyan
            : landmark.kind === 'unread'
              ? theme.amber
              : landmark.kind === 'day'
                ? theme.violet
                : theme.dim
          return (
            <text
              {...selectionColors}
              key={`${card.key}:lm:${landmarkIndex}`}
              fg={lmColor}
              width={streamLandmarkWidth}
              wrapMode="none"
              selectable
            >
              {streamLandmarkText(landmark, streamLandmarkWidth)}
            </text>
          )
        })}
        {streamHasBody && (
        <box
          flexDirection="column"
          width={streamLandmarkWidth}
          border={card.role === 'user' ? ['left'] : undefined}
          borderStyle={card.role === 'user' ? 'heavy' : undefined}
          borderColor={card.role === 'user' ? theme.violet : undefined}
          paddingLeft={card.role === 'user'
            ? Math.max(densityState.bodyIndent - 1, 0)
            : densityState.bodyIndent}
          paddingBottom={0}
          backgroundColor={streamBg}
        >
        {streamDiffPreview && streamDiffHeaderSegments ? (
          <box flexDirection="column">
            <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
              {renderInlineTextSegments(streamDiffHeaderSegments, streamTextWidth, theme.dim)}
            </text>
            <StreamDiffPreview
              card={card}
              theme={theme}
              syntaxStyle={syntaxStyle}
              width={streamTextWidth}
              selectionColors={selectionColors}
            />
          </box>
        ) : streamMarkdownBody ? (
          <box flexDirection="row">
            <text
              fg={streamMarkerColor}
              width={streamMarkerWidth}
              wrapMode="none"
              selectable
              {...selectionColors}
            >
              {`${streamMarker} `}
            </text>
            <box flexDirection="column" width={streamTextWidth}>
              {streamMarkdownBody}
            </box>
          </box>
        ) : (
        <>
        {firstLine ? (
          <box flexDirection="row">
            <text fg={streamMarkerColor} width={streamMarkerWidth} wrapMode="none" selectable {...selectionColors}>
              {`${streamMarker} `}
            </text>
            <text
              fg={streamFirstLineColor}
              width={streamTextWidth}
              wrapMode={firstLine.tone === 'tool' ? 'none' : 'word'}
              attributes={card.role === 'user' ? TextAttributes.BOLD : undefined}
              selectable
              {...selectionColors}
            >
              {firstLine.tone === 'tool'
                ? renderInlineTextSegments(transcriptToolLineSegments(firstLine.text, theme, '', theme.dim, true), streamTextWidth, theme.dim)
                : hasInlineMarkdown(firstLine.text)
                  ? renderInlineMarkdownSpans(firstLine.text, theme, streamFirstLineColor, `${card.key}:f`)
                  : firstLine.text}
            </text>
          </box>
        ) : (
          <text fg={theme.dim} selectable {...selectionColors}>{`${streamMarker} (no output)`}</text>
        )}
        {remainingLines.map((line, lineIndex) => {
          const continuationMarker = streamContinuationMarker(line)
          return (
            <box key={`${card.key}:s:${lineIndex}`} flexDirection="row">
              <text fg={theme.dim} width={4} wrapMode="none" selectable {...selectionColors}>
                {continuationMarker}
              </text>
              <text
                {...selectionColors}
                fg={transcriptColor(line, theme)}
                width={streamChildTextWidth}
                wrapMode={line.tone === 'tool' ? 'none' : 'word'}
                selectable
              >
                {line.tone === 'tool'
                  ? renderInlineTextSegments(transcriptToolLineSegments(line.text, theme, '', theme.dim, true), streamChildTextWidth, theme.dim)
                  : hasInlineMarkdown(line.text)
                    ? renderInlineMarkdownSpans(line.text, theme, transcriptColor(line, theme), `${card.key}:s:${lineIndex}`)
                    : line.text}
              </text>
            </box>
          )
        })}
        {isExpanded && card.codeBlocks?.map((codeBlock, codeBlockIndex) => {
          const lineCount = codeBlockLineCounts[codeBlockIndex] ?? countCodeBlockLines(codeBlock.content)
          const renderHeight = codeBlockHeight(codeBlock, lineCount)
          const visibleCode = sliceCodeBlockLines(codeBlock.content, renderHeight)
          return (
            <box key={codeBlock.key} flexDirection="column" paddingLeft={2} marginTop={1}>
              <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
                {fitText(codeBlockLabel(codeBlock), streamTextWidth)}
              </text>
              {syntaxStyle ? (
                <code
                  content={visibleCode}
                  filetype={codeBlock.filetype}
                  syntaxStyle={syntaxStyle}
                  drawUnstyledText={true}
                  selectable
                  {...selectionColors}
                  style={{ height: renderHeight }}
                  width={streamTextWidth}
                />
              ) : visibleCode.split('\n').map((codeLine, lineIndex) => (
                <text {...selectionColors} key={`${codeBlock.key}:stream:${lineIndex}`} fg={theme.text} wrapMode="none" selectable>
                  {fitText(codeLine, streamTextWidth)}
                </text>
              ))}
            </box>
          )
        })}
        </>
        )}
        </box>
        )}
      </box>
    )
  }

  if (isCompactSystemCard(card, isExpanded)) {
    const compactWidth = Math.max(readableCardWidth - 2, 16)
    // The descriptor ("thinking_tokens", "session resumed", …) lives in the body,
    // not the label, so fold the first body line in — minus a redundant leading
    // "system " that the label already conveys.
    const firstBody = bodyLines.length > 0 ? bodyLines[0].text.trim() : ''
    const descriptor = firstBody && firstBody.toLowerCase() !== card.label.toLowerCase()
      ? firstBody.replace(/^system[\s·:]+/i, '')
      : ''
    const headLabel = `${marker} ${bookmarkGlyph}${categoryEmoji}${card.label}${descriptor ? ` · ${descriptor}` : ''}`
    const lineColor = hasCursor
      ? accent
      : isActiveMatch
        ? theme.amber
        : isSearchHit
          ? theme.cyan
          : theme.dim
    const compactBg = hasCursor ? theme.surface3 : isSelected ? theme.surface2 : undefined
    const labelWidth = Math.max(compactWidth - (headerMeta ? headerMeta.length + 2 : 0), 8)
    return (
      <box flexDirection="column" marginBottom={densityState.cardGap} width={readableCardWidth}>
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
          paddingX={1}
          width={readableCardWidth}
          flexDirection="row"
          justifyContent="space-between"
          backgroundColor={compactBg}
          onMouseDown={(event) => {
            if (event.button !== 0) return
            onSelectCard(card.key)
          }}
        >
          <text fg={lineColor} wrapMode="none" selectable {...selectionColors}>
            {fitText(headLabel, labelWidth)}
          </text>
          {headerMeta ? (
            <text fg={theme.dim} wrapMode="none" selectable {...selectionColors}>
              {fitText(headerMeta, headerMeta.length)}
            </text>
          ) : null}
        </box>
      </box>
    )
  }

  return (
    <box
      flexDirection="column"
      marginBottom={densityState.cardGap}
      alignSelf={centeredCard ? 'center' : undefined}
      width={readableCardWidth}
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
        alignSelf={userBubble ? 'flex-end' : undefined}
        width={cardWidth}
        border={!streamMode}
        borderStyle={streamMode ? undefined : hasCursor ? 'heavy' : 'single'}
        borderColor={streamMode ? undefined : borderColor}
        backgroundColor={cardBg}
        flexDirection="column"
        title={streamMode ? undefined : cardTitle}
        titleColor={accent}
        onMouseDown={(event) => {
          if (event.button !== 0) return
          onSelectCard(card.key)
        }}
      >
        <box flexDirection="column" paddingLeft={densityState.bodyIndent} paddingBottom={densityState.bodyPad}>
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
                  {hasInlineMarkdown(line)
                    ? renderInlineMarkdownClipped(line, theme, bubbleTextColor, markdownWidth, `${card.key}:md-fallback:${lineIndex}`)
                    : fitText(line, markdownWidth)}
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
                    {line.tone === 'tool' && !imessageUserBubble
                      ? renderInlineTextSegments(transcriptToolLineSegments(line.text, theme), bodyInnerWidth, theme.dim)
                      : hasInlineMarkdown(line.text)
                        ? renderInlineMarkdownClipped(line.text, theme, imessageUserBubble ? bubbleTextColor : transcriptColor(line, theme), bodyInnerWidth, `${card.key}:body-md:${lineIndex}`)
                        : fitText(line.text, bodyInnerWidth)}
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
                        <text fg={diffGutterBar(row, theme)} wrapMode="none">▎</text>
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
            <box paddingX={1} marginTop={bodyLines.length > 0 ? 1 : 0}>
              <text fg={thinkingMode ? theme.cyan : theme.dim}>
                {thinkingMode ? '✦ thinking shown · T to hide' : '✦ thinking hidden · T to show'}
              </text>
            </box>
          ) : null}
        </box>
      </box>
    </box>
  )
}

const TranscriptCard = React.memo(TranscriptCardInner)

export type TranscriptCardSelectionVariants = {
  cardKey: string
  idle: React.ReactNode
  selected: React.ReactNode
  focused: React.ReactNode
}

type TranscriptCardVariantProps = Omit<TranscriptCardProps, 'hasCursor' | 'isSelected'>
type TranscriptCardVariantCacheEntry = {
  props: TranscriptCardVariantProps
  variants: TranscriptCardSelectionVariants
}

function makeTranscriptCardSelectionVariants(
  props: TranscriptCardVariantProps,
): TranscriptCardSelectionVariants {
  const render = (hasCursor: boolean, isSelected: boolean) => (
    <TranscriptCard
      key={props.card.key}
      {...props}
      hasCursor={hasCursor}
      isSelected={isSelected}
    />
  )
  return {
    cardKey: props.card.key,
    idle: render(false, false),
    selected: render(false, true),
    focused: render(true, true),
  }
}

function transcriptCardVariantPropsEqual(
  left: TranscriptCardVariantProps,
  right: TranscriptCardVariantProps,
): boolean {
  const keys = Object.keys(left) as Array<keyof TranscriptCardVariantProps>
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) {
    if (!Object.is(left[key], right[key])) return false
  }
  return true
}

function cachedTranscriptCardSelectionVariants(
  cache: WeakMap<TuiTranscriptCard, TranscriptCardVariantCacheEntry>,
  props: TranscriptCardVariantProps,
): TranscriptCardSelectionVariants {
  const previous = cache.get(props.card)
  if (previous && transcriptCardVariantPropsEqual(previous.props, props)) return previous.variants
  const variants = makeTranscriptCardSelectionVariants(props)
  cache.set(props.card, { props, variants })
  return variants
}

// Cursor movement used to rebuild a fresh React element for every mounted
// card, even though React.memo ultimately rendered only the old and new
// selection. Reuse the exact prebuilt element for every unchanged card so
// React can skip reconciliation by identity. The chosen TranscriptCard and
// its props are identical to the previous implementation; this adds no
// wrapper or native node and cannot change card geometry or scroll offsets.
export function selectTranscriptCardVariants<T extends TranscriptCardSelectionVariants>(
  variants: readonly T[],
  cursorKey: string | null,
  focused: boolean,
): React.ReactNode[] {
  return variants.map((variant) => variant.cardKey === cursorKey
    ? focused ? variant.focused : variant.selected
    : variant.idle)
}

type TranscriptIndexLookup = {
  get: (key: string) => number | undefined
}

// Build an index only if a detached reader actually asks for one. When the
// visible list is a stable persisted prefix plus a tiny live suffix, reuse the
// prefix lookup across streamed-token arrays and index only that suffix. The
// suffix is checked first to preserve Map's last-key-wins behavior.
export function createLazyTranscriptIndexLookup(
  cards: readonly TuiTranscriptCard[],
  stablePrefix?: { length: number; lookup: TranscriptIndexLookup },
): TranscriptIndexLookup {
  let indexByKey: Map<string, number> | null = null
  return {
    get(key: string): number | undefined {
      if (!indexByKey) {
        const start = stablePrefix?.length ?? 0
        indexByKey = new Map<string, number>()
        for (let index = start; index < cards.length; index += 1) {
          indexByKey.set(cards[index].key, index)
        }
      }
      const suffixIndex = indexByKey.get(key)
      if (suffixIndex !== undefined) return suffixIndex
      return stablePrefix?.lookup.get(key)
    },
  }
}

// ── Split transcript panes ───────────────────────────────────────────────────
// A split pane is a read-only tail view of another open tab, mounted beside the
// primary reader so two (or three) sessions can be watched at once. It owns its
// own detail read + card format — deliberately NOT the primary reader's
// pipeline, which is entangled with the cursor, search, live overlay and
// composer. Panes stay collapsed and tail-anchored: they answer "what is that
// agent doing right now", not "let me read that transcript".
const SPLIT_PANE_MIN_WIDTH = 46
const SPLIT_PANE_MAX = 2
// Tail-only mount budget. OpenTUI's scrollbox lays out every mounted child, so
// a pane that mounted the whole transcript would cost the same as a second
// reader; 80 collapsed cards provides deeper scroll-back while retaining the
// existing paged growth behavior for older history.
const SPLIT_PANE_CARD_WINDOW = 80
const SPLIT_PANE_POLL_MS = 2500
const SPLIT_PANE_EMPTY_NOTES: Map<string, TranscriptDiffNote> = new Map()
const SPLIT_PANE_EMPTY_NUMBERS: Readonly<Record<string, number>> = {}
const SPLIT_PANE_EMPTY_LIVE: ThreadedMessage[] = []
const noopSelectCard = () => {}
const noopSelectAgentTool = () => {}
const noopDiffHover = () => {}
const noopOpenDiffNote = () => {}
const noopSendDiffNote = () => {}
const noopSetDiffRow = () => {}
const noopSetDiffAnchor = () => {}

export function shouldPollSplitPaneDetail(
  previous: { key: string; variant: string; lastModified: number } | null,
  key: string,
  variant: string,
  lastModified: number | undefined,
  active: boolean,
): boolean {
  return active
    || previous === null
    || previous.key !== key
    || previous.variant !== variant
    || lastModified === undefined
    || previous.lastModified < lastModified
}

// Imperative scroll surface a focused pane hands to the root key dispatcher.
// The pane keeps its own tail-follow flag inside these methods, so scrolling up
// detaches from the live tail and G re-attaches — the root never has to know.
type SplitPaneHandle = {
  scrollByRows: (rows: number) => void
  scrollToTop: () => void
  scrollToBottom: () => void
  // Card-level reader controls. The root dispatcher owns the keymap; the pane
  // owns the state, so both readers behave identically without the pane having
  // to re-implement clipboard, bookmarks or the composer.
  moveCursor: (delta: number) => void
  cursorToEdge: (edge: 'first' | 'last') => void
  toggleExpandedAtCursor: () => void
  collapseAll: () => void
  getCursorCard: () => TuiTranscriptCard | null
  getSession: () => Session
  toggleBookmarkAtCursor: () => Promise<boolean>
}

type SplitTranscriptPaneProps = {
  session: Session
  theme: TuiThemePalette
  densityState: DensityState
  density: TuiDensity
  showToolCalls: boolean
  syntaxStyle: SyntaxStyle | null
  thinkingMode: boolean
  diffLayout: TuiDiffLayout
  imessageStyle: boolean
  transcriptWidth: TuiTranscriptWidth
  transcriptView: TuiTranscriptView
  width: number
  height: number
  paneIndex: number
  focused: boolean
  // Live overlay for THIS pane's session, sliced from the app-wide live stream.
  liveMessages: ThreadedMessage[]
  running: boolean
  liveText: string | null
  registerHandle: (paneIndex: number, handle: SplitPaneHandle | null) => void
  onActivate: (paneIndex: number) => void
}

function SplitTranscriptPaneInner({
  session,
  theme,
  densityState,
  density,
  showToolCalls,
  syntaxStyle,
  thinkingMode,
  diffLayout,
  imessageStyle,
  transcriptWidth,
  transcriptView,
  width,
  height,
  paneIndex,
  focused,
  liveMessages,
  running,
  liveText,
  registerHandle,
  onActivate,
}: SplitTranscriptPaneProps) {
  const [cards, setCards] = useState<TuiTranscriptCard[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [followTail, setFollowTail] = useState(true)
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const selectionVariantCacheRef = useRef(new WeakMap<TuiTranscriptCard, TranscriptCardVariantCacheEntry>())
  const key = sessionKey(session)
  const variant = `${density}|${showToolCalls ? 1 : 0}`
  const activityVisible = running || liveMessages.length > 0 || Boolean(liveText)
  const lastLoadedRef = useRef<{ key: string; variant: string; lastModified: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const load = async () => {
      const lastModified = typeof session.lastModified === 'number' ? session.lastModified : undefined
      if (!shouldPollSplitPaneDetail(lastLoadedRef.current, key, variant, lastModified, activityVisible)) {
        timer = setTimeout(() => { void load() }, SPLIT_PANE_POLL_MS)
        return
      }
      try {
        const detail = await readTuiSessionDetailAsync(session, density, showToolCalls)
        if (cancelled) return
        const cached = getTranscriptCardsSync(session, detail.threadedMessages, density, showToolCalls)
        const next = cached ?? await formatTranscriptCardsAsync(session, detail.threadedMessages, density, showToolCalls)
        if (cancelled) return
        setCards((prev) => {
          // Identity bail-out: an idle session re-reads to the same cached card
          // array every poll, and keeping the reference skips the whole
          // display-data + card subtree rebuild below.
          return preserveArrayIdentity(prev, next)
        })
        if (lastModified !== undefined) lastLoadedRef.current = { key, variant, lastModified }
        setStatus('ready')
        setError(null)
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Failed to load transcript')
      } finally {
        if (!cancelled) timer = setTimeout(() => { void load() }, SPLIT_PANE_POLL_MS)
      }
    }

    setStatus('loading')
    void load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [activityVisible, key, session, density, showToolCalls, variant])

  // Tail window. A pane starts at the last SPLIT_PANE_CARD_WINDOW cards (the
  // mount budget that keeps a pane cheap) and grows a page at a time as the
  // reader walks back, so the whole transcript is reachable without paying for
  // it up front.
  const [windowSize, setWindowSize] = useState(SPLIT_PANE_CARD_WINDOW)
  useEffect(() => { setWindowSize(SPLIT_PANE_CARD_WINDOW) }, [key])
  const persistedTailCards = useMemo(
    () => (cards.length > windowSize ? cards.slice(-windowSize) : cards),
    [cards, windowSize],
  )
  const cardCountRef = useRef(0)

  // Live overlay: the pane polls persisted state every few seconds, but a
  // running turn streams through the app-wide live list — formatting that here
  // is what makes a pane a real-time window instead of a stale snapshot. Live
  // cards win over persisted ones with the same key, so the poll that finally
  // lands the message doesn't render it twice.
  const liveCards = useMemo(
    () => liveMessages.map((message) => {
      const formatted = formatTranscriptCard(message, density)
      return isLiveAssistantTextMessage(message)
        ? { ...formatted, markdownContent: undefined }
        : formatted
    }),
    [liveMessages, density],
  )
  const tailCards = useMemo(() => {
    if (liveCards.length === 0) return persistedTailCards
    const liveKeys = new Set(liveCards.map((card) => card.key))
    return [...persistedTailCards.filter((card) => !liveKeys.has(card.key)), ...liveCards]
  }, [persistedTailCards, liveCards])

  // Cursor: null means "following the tail". Set once the reader focuses this
  // pane and moves, which is also what detaches tail-follow.
  const [cursorKey, setCursorKey] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(EMPTY_EXPANDED_KEYS)
  const tailCardsRef = useRef<TuiTranscriptCard[]>(tailCards)
  const cursorKeyRef = useRef<string | null>(cursorKey)

  // Display data mirrors the reader's, minus search/landmarks: expansion is
  // per-pane, so an expanded card in a pane costs only that pane's body.
  const displayDataCacheRef = useRef(new WeakMap<TuiTranscriptCard, {
    isExpanded: boolean
    bodyLineLimit: number
    providerKey: ProviderSelection | undefined
    isLatest: boolean
    value: CardDisplayData
  }>())
  const displayData = useMemo((): CardDisplayData[] => tailCards.map((card, index) => {
    const isExpanded = expandedKeys.has(card.key)
    const providerKey = card.provider ?? session.provider ?? undefined
    const isLatest = index === tailCards.length - 1
    const previous = displayDataCacheRef.current.get(card)
    if (
      previous
      && previous.isExpanded === isExpanded
      && previous.bodyLineLimit === densityState.bodyLines
      && previous.providerKey === providerKey
      && previous.isLatest === isLatest
    ) {
      return previous.value
    }
    const bodyLines = renderedBodyLines(card, isExpanded, densityState.bodyLines, false, false, false)
    const isInsight = card.category === 'insight'
    const value: CardDisplayData = {
      landmarks: EMPTY_LANDMARKS,
      bodyLines,
      diffView: cardDiffView(card, isExpanded),
      codeBlockLineCounts: (isExpanded && card.codeBlocks)
        ? card.codeBlocks.map((block) => countCodeBlockLines(block.content))
        : [],
      headerMeta: joinMeta([
        card.timestamp ?? null,
        isLatest ? 'latest' : null,
        isExpanded ? 'e collapse' : null,
      ]),
      accent: transcriptAccent(card.role, providerKey),
      isThinkingCard: card.lines.some((line) => line.tone === 'thinking'),
      categoryEmoji: isInsight ? '✦ ' : card.category === 'technical' ? '⚒ ' : card.category === 'diff' ? '✎ ' : card.category === 'system' ? '⚙ ' : '',
      isInsight,
      markdownFallbackLines: null,
    }
    displayDataCacheRef.current.set(card, {
      isExpanded,
      bodyLineLimit: densityState.bodyLines,
      providerKey,
      isLatest,
      value,
    })
    return value
  }), [tailCards, expandedKeys, densityState.bodyLines, session.provider])

  const sessionRef = useRef(session)

  // Bookmarks are per session, so a pane loads its own set rather than
  // borrowing the reader's — and owns the toggle so the state stays local.
  const [bookmarkedKeys, setBookmarkedKeys] = useState<ReadonlySet<string>>(EMPTY_EXPANDED_KEYS)
  const bookmarkedKeysRef = useRef<ReadonlySet<string>>(bookmarkedKeys)
  useLayoutEffect(() => {
    cardCountRef.current = cards.length
    tailCardsRef.current = tailCards
    cursorKeyRef.current = cursorKey
    sessionRef.current = session
    bookmarkedKeysRef.current = bookmarkedKeys
  }, [bookmarkedKeys, cards.length, cursorKey, session, tailCards])
  useEffect(() => {
    let cancelled = false
    void readTuiSessionBookmarkIds({ sessionId: session.sessionId, provider: session.provider } as Session)
      .then((ids) => { if (!cancelled) setBookmarkedKeys(new Set(ids)) })
      .catch(() => { if (!cancelled) setBookmarkedKeys(EMPTY_EXPANDED_KEYS) })
    return () => { cancelled = true }
  }, [key, session.provider, session.sessionId])

  const selectPaneCard = useCallback((cardKey: string) => {
    setCursorKey(cardKey)
    onActivate(paneIndex)
  }, [onActivate, paneIndex])

  // The handle is registered once per pane index; every method reads through a
  // ref so it never goes stale as cards stream in.
  useEffect(() => {
    const maxScroll = (sb: ScrollBoxRenderable): number => Math.max(sb.scrollHeight - sb.viewport.height, 0)
    const scrollTo = (position: number, follow: boolean) => {
      const sb = scrollRef.current
      if (!sb) return
      sb.scrollTop = position
      setFollowTail(follow)
    }
    const growWindow = () => {
      setWindowSize((current) => (current >= cardCountRef.current ? current : current + SPLIT_PANE_CARD_WINDOW))
    }
    const cursorIndexNow = (): number => {
      const list = tailCardsRef.current
      const current = cursorKeyRef.current
      if (!current) return list.length - 1
      const found = list.findIndex((card) => card.key === current)
      return found >= 0 ? found : list.length - 1
    }
    const handle: SplitPaneHandle = {
      scrollByRows: (rows) => {
        const sb = scrollRef.current
        if (!sb) return
        const limit = maxScroll(sb)
        const next = clamp(sb.scrollTop + rows, 0, limit)
        scrollTo(next, next >= limit)
      },
      scrollToTop: () => {
        const sb = scrollRef.current
        if (!sb) return
        scrollTo(0, maxScroll(sb) === 0)
      },
      scrollToBottom: () => {
        const sb = scrollRef.current
        if (!sb) return
        scrollTo(maxScroll(sb), true)
      },
      moveCursor: (delta) => {
        const list = tailCardsRef.current
        if (list.length === 0) return
        const next = clamp(cursorIndexNow() + delta, 0, list.length - 1)
        const nextCard = list[next]
        if (!nextCard) return
        setCursorKey(nextCard.key)
        // Cursor at the last card means the reader is watching the tail again.
        setFollowTail(next === list.length - 1)
        // Walking off the top loads the previous page; the cursor is a key, so
        // it stays on the same card while older ones appear above it.
        if (next === 0) growWindow()
      },
      cursorToEdge: (edge) => {
        const list = tailCardsRef.current
        if (list.length === 0) return
        const target = edge === 'first' ? list[0] : list[list.length - 1]
        if (!target) return
        setCursorKey(target.key)
        setFollowTail(edge === 'last')
        const sb = scrollRef.current
        if (sb) scrollTo(edge === 'first' ? 0 : maxScroll(sb), edge === 'last')
        if (edge === 'first') growWindow()
      },
      toggleExpandedAtCursor: () => {
        const list = tailCardsRef.current
        const card = list[cursorIndexNow()]
        if (!card) return
        setCursorKey(card.key)
        setExpandedKeys((current) => {
          const next = new Set(current)
          if (next.has(card.key)) next.delete(card.key)
          else next.add(card.key)
          return next
        })
      },
      collapseAll: () => setExpandedKeys(EMPTY_EXPANDED_KEYS),
      getCursorCard: () => tailCardsRef.current[cursorIndexNow()] ?? null,
      getSession: () => sessionRef.current,
      toggleBookmarkAtCursor: async () => {
        const card = tailCardsRef.current[cursorIndexNow()]
        if (!card) throw new Error('No message selected')
        if (card.key.startsWith('live-')) throw new Error('Cannot bookmark a streaming message')
        const target = sessionRef.current
        const adding = !bookmarkedKeysRef.current.has(card.key)
        setBookmarkedKeys((current) => {
          const next = new Set(current)
          if (adding) next.add(card.key)
          else next.delete(card.key)
          return next
        })
        try {
          const ids = await toggleTuiSessionBookmark(
            { sessionId: target.sessionId, provider: target.provider } as Session,
            card.key,
            adding,
            adding
              ? {
                  role: card.role,
                  label: card.role === 'user' ? 'user' : 'assistant',
                  preview: (card.compactSummary || card.searchText || '').replace(/\s+/g, ' ').trim().slice(0, 200) || undefined,
                  sessionTitle: formatSessionTitle(target) || undefined,
                  messageTimestamp: card.timestamp,
                }
              : undefined,
          )
          setBookmarkedKeys(new Set(ids))
        } catch (err) {
          // Roll the optimistic flip back so the gutter never lies.
          setBookmarkedKeys((current) => {
            const next = new Set(current)
            if (adding) next.delete(card.key)
            else next.add(card.key)
            return next
          })
          throw err
        }
        return adding
      },
    }
    registerHandle(paneIndex, handle)
    return () => registerHandle(paneIndex, null)
  }, [paneIndex, registerHandle])

  // Keep the cursor card in view as the cursor moves or new cards arrive.
  useEffect(() => {
    if (!cursorKey) return
    scrollRef.current?.scrollChildIntoView(`card:${cursorKey}`)
  }, [cursorKey, tailCards])

  // Focus changes intentionally do not touch cursorKey, followTail, or the
  // scrollbox. Each pane owns its viewport, so cycling reader → pane → pane
  // returns to the exact card and offset that pane had before losing focus.

  const scrollbarOptions = useMemo(
    () => ({ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }),
    [theme.muted, theme.surface2],
  )

  const accent = transcriptAccent('assistant', session.provider ?? undefined)
  const innerWidth = Math.max(width - 4, 12)
  const statusRowCount = (liveText || (running && tailCards.length > 0)) ? 1 : 0
  // Exact row budget, or the frame shrinks: border (2) + meta row (1) + the
  // body box's own paddingBottom (1) + the optional live row + one action row.
  // The action row is reserved in every pane so focus never changes viewport
  // height or the meaning of its stored scrollTop.
  const bodyRows = calculateSplitPaneBodyRows(height, statusRowCount)
  // Count against the PERSISTED window only — live cards are additions, not
  // part of the loaded history, and would otherwise undercount what's above.
  const hiddenCount = Math.max(cards.length - persistedTailCards.length, 0)
  const splitCardVariants = useMemo(() => tailCards.map((card, index) => {
    const display = displayData[index]
    if (!display) return null
    return cachedTranscriptCardSelectionVariants(selectionVariantCacheRef.current, {
      card,
      display,
      theme,
      densityState,
      syntaxStyle,
      rightPaneWidth: width,
      isExpanded: expandedKeys.has(card.key),
      isSearchHit: false,
      isActiveMatch: false,
      bookmarked: bookmarkedKeys.has(card.key),
      onSelectCard: selectPaneCard,
      thinkingMode,
      diffLayout,
      imessageStyle,
      transcriptWidth,
      streamMode: transcriptView === 'stream' || transcriptView === 'chat',
      agentsMode: false,
      agentToolCursorKey: null,
      agentToolExpandedKeys: EMPTY_EXPANDED_KEYS,
      agentToolCollapsedKeys: EMPTY_EXPANDED_KEYS,
      onSelectAgentTool: noopSelectAgentTool,
      noteNamespace: `split:${key}`,
      diffNotes: SPLIT_PANE_EMPTY_NOTES,
      diffDraft: null,
      hoveredDiffAnchor: null,
      activateDiffHover: noopDiffHover,
      openDiffNote: noopOpenDiffNote,
      sendDiffNoteToComposer: noopSendDiffNote,
      diffPlain: false,
      diffShowLineNumbers: true,
      diffShowHunkHeaders: true,
      diffRowCursor: 0,
      diffSelectionAnchor: null,
      diffPlainCardKeys: EMPTY_EXPANDED_KEYS,
      diffHiddenLineNumberCardKeys: EMPTY_EXPANDED_KEYS,
      diffHiddenHunkHeaderCardKeys: EMPTY_EXPANDED_KEYS,
      diffRowCursorByCardKey: SPLIT_PANE_EMPTY_NUMBERS,
      diffSelectionAnchorByCardKey: SPLIT_PANE_EMPTY_NUMBERS,
      setDiffRowCursor: noopSetDiffRow,
      setDiffSelectionAnchor: noopSetDiffAnchor,
    })
  }).filter((variant): variant is TranscriptCardSelectionVariants => variant !== null), [
    tailCards,
    displayData,
    theme,
    densityState,
    syntaxStyle,
    width,
    expandedKeys,
    bookmarkedKeys,
    selectPaneCard,
    thinkingMode,
    diffLayout,
    imessageStyle,
    transcriptWidth,
    transcriptView,
    key,
  ])
  const splitCardElements = useMemo(
    () => selectTranscriptCardVariants(splitCardVariants, cursorKey, focused),
    [splitCardVariants, cursorKey, focused],
  )

  return (
    <box
      width={width}
      height={height}
      border
      borderStyle="single"
      // Focused frame lights in the provider accent, exactly like the reader
      // and sidebar — one visual language for "this pane has the keyboard".
      borderColor={focused ? accent : theme.border}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={fitText(formatSessionTitle(session), Math.max(width - 4, 8))}
      titleColor={accent}
      onMouseDown={(event) => {
        if (event.button === 0) onActivate(paneIndex)
      }}
    >
      <box paddingX={1} flexDirection="row">
        <text fg={running ? theme.green : accent} wrapMode="none">{focused ? '▶ ' : running ? '◐ ' : '● '}</text>
        <text fg={theme.dim} wrapMode="none">
          {fitText(
            [
              formatSessionProject(session),
              running ? 'running' : null,
              `${cards.length} card${cards.length === 1 ? '' : 's'}`,
              hiddenCount > 0 ? `tail ${tailCards.length}` : null,
              followTail ? null : 'paused',
            ].filter(Boolean).join('  ·  '),
            Math.max(innerWidth - 2, 8),
          )}
        </text>
      </box>
      <box flexGrow={1} paddingX={1} paddingBottom={1} overflow="hidden">
        {status === 'error' ? (
          <text fg={theme.red} wrapMode="none">{fitText(error ?? 'Failed to load transcript', innerWidth)}</text>
        ) : status === 'loading' && tailCards.length === 0 ? (
          <Spinner label={fitText('Loading…', innerWidth)} fg={theme.dim} />
        ) : tailCards.length === 0 ? (
          <text fg={theme.dim} wrapMode="none">{fitText('No messages yet', innerWidth)}</text>
        ) : (
          <scrollbox
            ref={scrollRef}
            style={{ height: bodyRows }}
            backgroundColor={theme.surface}
            // Sticky only while the pane is still following: once the reader
            // scrolls it up, new cards must not yank the view back down.
            stickyScroll={followTail}
            stickyStart="bottom"
            scrollY
            scrollAcceleration={MESSAGE_SCROLL_ACCEL}
            viewportCulling
            scrollbarOptions={scrollbarOptions}
          >
            <TuiErrorBoundary>
              {hiddenCount > 0 ? (
                <box key="split-earlier-hint" paddingX={1}>
                  <text fg={theme.dim} wrapMode="none">
                    {fitText(`↑ ${hiddenCount} earlier message${hiddenCount === 1 ? '' : 's'} — k/g to load`, Math.max(innerWidth - 2, 8))}
                  </text>
                </box>
              ) : null}
              {splitCardElements}
            </TuiErrorBoundary>
          </scrollbox>
        )}
      </box>
      {liveText ? (
        <box paddingX={1} height={1}>
          <text fg={accent} wrapMode="none">{fitText(`● ${liveText.replace(/\s+/g, ' ')}`, innerWidth)}</text>
        </box>
      ) : running && tailCards.length > 0 ? (
        <box paddingX={1} height={1}>
          <Spinner label={fitText('working…', Math.max(innerWidth - 2, 8))} fg={theme.dim} />
        </box>
      ) : null}
      <box paddingX={1} height={1}>
        <text fg={theme.dim} wrapMode="none">
          {focused
            ? fitText(running ? 'j/k card  e fold  y copy  b mark  c send  ⌃C stop  ↵ open  esc reader' : 'j/k card  e fold  y copy  b mark  Q reply  c send  ↵ open  esc reader', innerWidth)
            : ' '}
        </text>
      </box>
    </box>
  )
}

const SplitTranscriptPane = React.memo(SplitTranscriptPaneInner)

export default function OpenTuiApp() {
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()

  // Frame-timing canary (no-op unless AGENT_VIEWER_PERF=1). Stamp at the top of
  // every render; the effect below reads it after commit.
  const renderStartedAt = FRAME_TIMING_NEEDED ? performance.now() : 0
  useEffect(() => {
    if (!FRAME_TIMING_NEEDED) return
    const durationMs = performance.now() - renderStartedAt
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
  const [agentToolCursorByGroupKey, setAgentToolCursorByGroupKey] = useState<Record<string, string>>({})
  const [transcriptView, setTranscriptView] = useState<TuiTranscriptView>('conversation')
  // Chat reuses stream's chronological, borderless card grouping — the two views
  // diverge only in composer placement (docked vs. inline-with-transcript).
  const isChatLikeView = transcriptView === 'stream' || transcriptView === 'chat'
  const [transcriptWidth, setTranscriptWidth] = useState<TuiTranscriptWidth>('centered')
  const [focusMode, setFocusMode] = useState(false)
  const [railVisible, setRailVisible] = useState(true)
  const [tabsEnabled, setTabsEnabled] = useState(true)
  // Number of read-only split panes mounted beside the reader (0 = off), and
  // which of the other open tabs they start from.
  const [splitPaneCount, setSplitPaneCount] = useState(0)
  // Panes are PINNED to explicit session keys, never derived positionally from
  // "the tabs that aren't active". A positional derivation reshuffles every
  // pane the moment the active tab changes (the candidate list reindexes), which
  // reads as panes randomly swapping while you navigate. The reconcile effect
  // below is the only thing that rewrites these keys.
  const [splitPinnedKeys, setSplitPinnedKeys] = useState<string[]>([])
  // tmux-style prefix state: true between ⌃B and the command key that follows.
  const [splitChordPending, setSplitChordPending] = useState(false)
  // Which split pane owns the keyboard (null = the reader does). Panes register
  // an imperative scroll handle here so the root dispatcher can drive the
  // focused one without every pane subscribing to the key stream.
  const [splitFocusIndex, setSplitFocusIndex] = useState<number | null>(null)
  // When the composer is opened from a focused pane it talks to THAT session:
  // typing while looking at a pane should reach the agent you're looking at.
  // Declared here (not derived from splitPaneSessions, which the layout
  // computes much later) so the composer target memo can read it.
  const [composerPaneTargetKey, setComposerPaneTargetKey] = useState<string | null>(null)
  // Creating a session is an explicit routing choice. Keep that target pinned
  // while its composer is open so the sole-running-session convenience fallback
  // cannot redirect the first prompt into an older OpenCode (or other provider)
  // turn.
  const [composerPreferredTargetKey, setComposerPreferredTargetKey] = useState<string | null>(null)
  const [composerPreparingTargetKey, setComposerPreparingTargetKey] = useState<string | null>(null)
  const composerPreparingTargetKeyRef = useRef<string | null>(null)
  const splitPaneHandlesRef = useRef(new Map<number, SplitPaneHandle>())
  const registerSplitPaneHandle = useEffectEvent((paneIndex: number, handle: SplitPaneHandle | null) => {
    if (handle) splitPaneHandlesRef.current.set(paneIndex, handle)
    else splitPaneHandlesRef.current.delete(paneIndex)
  })
  const [showToolCalls, setShowToolCalls] = useState(true)
  const [velocityScrollEnabled, setVelocityScrollEnabled] = useState(false)
  const [sidebarSort, setSidebarSort] = useState<TuiSidebarSort>('project')
  const [sidebarView, setSidebarView] = useState<'sessions' | 'coordinator'>('sessions')
  const [coordinatorRuns, setCoordinatorRuns] = useState<ProtocolRun[]>([])
  const [coordinatorSnapshots, setCoordinatorSnapshots] = useState<Map<string, ProtocolRunSnapshot>>(new Map())
  const [coordinatorSelectedKey, setCoordinatorSelectedKey] = useState<string | null>(null)
  const [sidebarWidthPreference, setSidebarWidthPreference] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [taskPanelWidth, setTaskPanelWidth] = useState(TASK_PANEL_DEFAULT_WIDTH)
  const [sessions, setSessions] = useState<Session[]>([])
  const [runningSessions, setRunningSessions] = useState<RunningSessionRef[]>([])
  const [waitingSessions, setWaitingSessions] = useState<Awaited<ReturnType<typeof readTuiRuntimeActivity>>['waiting']>([])
  const [viewerAttentionNotes, setViewerAttentionNotes] = useState<Awaited<ReturnType<typeof readTuiRuntimeActivity>>['attention']>([])
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null)
  const [sessionDetail, setSessionDetail] = useState<TuiSessionDetail | null>(null)
  const sessionDetailRef = useRef<TuiSessionDetail | null>(sessionDetail)
  useLayoutEffect(() => {
    sessionDetailRef.current = sessionDetail
  }, [sessionDetail])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [refreshingSessions, setRefreshingSessions] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toasts = useToasts()
  const [focusedPane, setFocusedPane] = useState<PaneFocus>('sessions')
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [providerMenuIndex, setProviderMenuIndex] = useState(0)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [themeMenuIndex, setThemeMenuIndex] = useState(0)
  const [themeMenuGroup, setThemeMenuGroup] = useState<ThemeMenuGroup>('dark')
  const [themeMenuQuery, setThemeMenuQuery] = useState('')
  const [transcriptViewMenuOpen, setTranscriptViewMenuOpen] = useState(false)
  const [transcriptViewMenuIndex, setTranscriptViewMenuIndex] = useState(0)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0)
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)
  const [exitCleanupInProgress, setExitCleanupInProgress] = useState(false)
  const [gitOpen, setGitOpen] = useState(false)
  const gitKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [pullRequestOpen, setPullRequestOpen] = useState(false)
  const pullRequestKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean) | null>(null)
  const [fileViewerOpen, setFileViewerOpen] = useState(false)
  const fileViewerKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorInitialPath, setEditorInitialPath] = useState<string | null>(null)
  const editorKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; meta?: boolean; sequence: string }) => boolean) | null>(null)
  // New agent session modal: pick a folder (via the file picker in folder-select
  // mode) and provider before creating, instead of defaulting to the viewed cwd.
  const [newSessionModalOpen, setNewSessionModalOpen] = useState(false)
  const [newSessionProvider, setNewSessionProvider] = useState<AgentProvider>('claude')
  const [newSessionCwd, setNewSessionCwd] = useState<string>('')
  const [newSessionBusy, setNewSessionBusy] = useState(false)
  const [folderPickerForNewSession, setFolderPickerForNewSession] = useState(false)
  const newSessionKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const analyticsKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [handoffBriefOpen, setHandoffBriefOpen] = useState(false)
  const handoffBriefKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false)
  const promptLibraryKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }) => void) | null>(null)
  const [channelBridgeOpen, setChannelBridgeOpen] = useState(false)
  const channelBridgeKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }) => void) | null>(null)
  // Global Channel Bridge binding: when on, the main composer's send routes to
  // the live `claude` CLI session instead of the active provider (mirrors the
  // web "route composer through bridge" toggle).
  const [routeComposerToBridge, setRouteComposerToBridge] = useState(false)
  const routeComposerToBridgeRef = useRef(false)
  // IDE bridge — third Claude composer flow (agentViewer hosts a Claude Code IDE
  // endpoint a `claude` CLI connects to; see channels/agentviewer-ide.ts).
  const [ideBridgeOpen, setIdeBridgeOpen] = useState(false)
  const ideBridgeKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }) => void) | null>(null)
  // When on, the main composer pushes its line as an @file mention into the
  // connected `claude` session instead of sending a provider turn.
  const [routeComposerToIde, setRouteComposerToIde] = useState(false)
  const routeComposerToIdeRef = useRef(false)
  useLayoutEffect(() => {
    routeComposerToBridgeRef.current = routeComposerToBridge
    routeComposerToIdeRef.current = routeComposerToIde
  }, [routeComposerToBridge, routeComposerToIde])
  const lastBridgeChatIdRef = useRef<string | undefined>(undefined)
  // Track bridge sent/reply entries for inline display in the transcript
  const [bridgeTranscriptEntries, setBridgeTranscriptEntries] = useState<
    Array<{ kind: 'sent' | 'reply'; text: string; timestamp: string }>
  >([])
  // Track which bridge entries we've persisted to disk
  const persistedBridgeCountRef = useRef(0)
  // Attention inbox — cross-session triage of prompts blocked on a human and
  // background turns that finished while the user was elsewhere.
  const [attentionOpen, setAttentionOpen] = useState(false)
  const attentionKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [crossSessionMessagingOpen, setCrossSessionMessagingOpen] = useState(false)
  const crossSessionMessagingKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean) | null>(null)
  // Pending Claude prompts from running sessions OTHER than the selected one
  // (the selected session's prompts live in pendingPermissions). Fed by the
  // registry poll.
  const [backgroundPrompts, setBackgroundPrompts] = useState<PendingPermission[]>([])
  // Turns that finished on sessions the user wasn't viewing; dismissed by
  // opening the session, pressing x in the inbox, or falling off the cap.
  const [attentionDone, setAttentionDone] = useState<Array<{
    key: string
    sessionId: string
    provider: AgentProvider
    sessionKey: string
    title: string
    createdAt: number
  }>>([])
  const [attentionRespondingId, setAttentionRespondingId] = useState<string | null>(null)
  // Prompt ids already announced via desktop notification (notify once each).
  const attentionNotifiedRef = useRef(new Set<string>())
  // Worktree task orchestration: ⇧F names a task, which spawns a session in an
  // isolated git worktree; merge/discard act on the selected session's task.
  const [worktreeModalOpen, setWorktreeModalOpen] = useState(false)
  const [worktreeDraft, setWorktreeDraft] = useState('')
  const [worktreeBusy, setWorktreeBusy] = useState(false)
  // The selected session's worktree task (cwd inside .agent-viewer-worktrees),
  // or null. Drives the composer badge and gates merge/discard.
  const [selectedWorktreeTask, setSelectedWorktreeTask] = useState<WorktreeTask | null>(null)
  const selectedWorktreeTaskCacheRef = useRef(new Map<string, WorktreeTask | null>())
  const [worktreeConfirm, setWorktreeConfirm] = useState<'merge' | 'discard' | null>(null)
  const worktreeSubmitInFlightRef = useRef(false)
  const [coordModalOpen, setCoordModalOpen] = useState(false)
  const [coordBoardOpen, setCoordBoardOpen] = useState(false)
  const [coordDraft, setCoordDraft] = useState('')
  const [coordAcceptanceDraft, setCoordAcceptanceDraft] = useState('')
  const [coordNonGoalsDraft, setCoordNonGoalsDraft] = useState('')
  const [coordManualQaDraft, setCoordManualQaDraft] = useState('')
  const [coordEscalationDraft, setCoordEscalationDraft] = useState('')
  const [coordPlaybooks, setCoordPlaybooks] = useState<PlaybookSummary[]>([])
  const [coordPlaybookName, setCoordPlaybookName] = useState<string | null>(null)
  const [coordPlaybookArgsDraft, setCoordPlaybookArgsDraft] = useState('')
  const [playbookManagerOpen, setPlaybookManagerOpen] = useState(false)
  const playbookManagerKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean) | null>(null)
  // Total agent budget for the next run, including the lead.
  const [coordMaxAgents, setCoordMaxAgents] = useState(3)
  // Quality gate command (TaskCompleted-hook equivalent) for the next run.
  const [coordGateDraft, setCoordGateDraft] = useState('')
  // Plan-approval guard: teammates must plan first and wait for lead approval.
  const [coordRequirePlanApproval, setCoordRequirePlanApproval] = useState(true)
  const [coordAutonomy, setCoordAutonomy] = useState<ProtocolAutonomy>('medium')
  const [coordRequireReview, setCoordRequireReview] = useState(true)
  const [coordMaxTokens, setCoordMaxTokens] = useState('')
  const [coordMaxDurationMinutes, setCoordMaxDurationMinutes] = useState('')
  // Isolate teammate edits by default, with an explicit shared-checkout mode.
  const [coordUseWorktrees, setCoordUseWorktrees] = useState(true)
  const [coordProviderOverride, setCoordProviderOverride] = useState<AgentProvider | null>(null)
  const [coordTeammateProviderOverride, setCoordTeammateProviderOverride] = useState<AgentProvider[] | null>(null)
  const [coordProviderPoolIndex, setCoordProviderPoolIndex] = useState(0)
  const [coordModalFocus, setCoordModalFocus] = useState<CoordModalFocus>('prompt')
  // Multiline prompt editor (composer-window treatment: ⏎ starts, ⇧⏎ newline).
  const coordTextareaRef = useRef<TextareaRenderable | null>(null)
  // Runs started this session being watched for terminal/blocked transitions.
  const [coordWatchIds, setCoordWatchIds] = useState<string[]>([])
  const coordWatchStateRef = useRef(new Map<string, { status: string; blockedAgents: Set<string> }>())
  const [coordBusy, setCoordBusy] = useState(false)
  // Run the board opens on (a just-started run); null = latest.
  const [coordBoardRunId, setCoordBoardRunId] = useState<string | null>(null)
  const [coordError, setCoordError] = useState<string | null>(null)
  const coordStartInFlightRef = useRef(false)
  const coordBoardKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  // Fleet strip visibility preference (the strip only renders when it has
  // cells: running sessions or fresh background completions).
  const [fleetStripEnabled, setFleetStripEnabled] = useState(true)
  const [fleetPage, setFleetPage] = useState(0)
  // Checkpoints & review popover (⇧U): turn snapshots + per-hunk review.
  const [checkpointOpen, setCheckpointOpen] = useState(false)
  const checkpointKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [taskPanelOpen, setTaskPanelOpen] = useState(false)
  const [taskPanelTab, setTaskPanelTab] = useState<'tasks' | 'agents'>('tasks')
  const [taskPopoverOpen, setTaskPopoverOpen] = useState(false)
  const taskPopoverKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [awaitingPersistedTurn, setAwaitingPersistedTurn] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnosticsSections, setDiagnosticsSections] = useState<import('../../lib/types').SessionDiagnosticSection[]>([])
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null)
  const [diagnosticsNotice, setDiagnosticsNotice] = useState<string | null>(null)
  const [diagnosticsBusy, setDiagnosticsBusy] = useState<string | null>(null)
  const [diagnosticsMcpIndex, setDiagnosticsMcpIndex] = useState(0)
  const [diagnosticsMcpPermissionModes, setDiagnosticsMcpPermissionModes] = useState<Record<string, 'default' | 'auto'>>({})
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
  useLayoutEffect(() => {
    bookmarkKeysRef.current = bookmarkKeys
  }, [bookmarkKeys])
  // Global bookmarks overlay (cross-session/provider browser).
  const [bookmarksOverlayOpen, setBookmarksOverlayOpen] = useState(false)
  const [bookmarksOverlay, setBookmarksOverlay] = useState<MessageBookmark[]>([])
  const [bookmarksOverlayIndex, setBookmarksOverlayIndex] = useState(0)
  // When jumping to a bookmark in another session, remember where to land once
  // that session's transcript has loaded.
  const pendingBookmarkCursorRef = useRef<{ sessionKey: string; uuid: string } | null>(null)
  const [followTail, setFollowTail] = useState(true)
  // Absolute index (into visibleTranscriptCards) of the first mounted reader
  // card when the window is detached from the tail. null = pinned to the tail
  // (derived), which is also the followTail shape. See READER_CARD_WINDOW.
  const [readerWindowStart, setReaderWindowStart] = useState<number | null>(null)
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
  const [composerHidden, setComposerHidden] = useState(false)
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
  const composerMentionAttachmentsRef = useRef<SendAttachment[]>([])
  const composerPromptPartsRef = useRef<ComposerPromptPart[]>([])
  useEffect(() => { composerMentionAttachmentsRef.current = composerMentionAttachments }, [composerMentionAttachments])
  useEffect(() => { composerPromptPartsRef.current = composerPromptParts }, [composerPromptParts])
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
  // A turn is running for the selected session that this composer does not own
  // a stream for — the send stream died but the turn survived (turns are
  // decoupled from their stream), or a turn from another view is still
  // finishing. Detected by polling the in-process running registry while idle;
  // mirrors the web composer's reattach flow.
  const [reattachedRunning, setReattachedRunning] = useState(false)
  const reattachedRunningRef = useRef(false)
  useEffect(() => { reattachedRunningRef.current = reattachedRunning }, [reattachedRunning])
  // Session key the registry poll currently reports as running-but-unowned.
  // The detail poll consults this to keep refreshing a session whose leftover
  // live baseline would otherwise pause background polls (the dead-stream case).
  const reattachedRunningKeyRef = useRef<string | null>(null)
  // Sidebar running marks added by the registry poll (as opposed to the send
  // loop's own mark), so the poll only clears marks it added itself.
  const reattachMarksRef = useRef(new Map<string, RunningSessionRef>())
  // Session key of the turn the local send stream currently owns; the registry
  // poll never treats that session as reattached.
  const ownedTurnKeyRef = useRef<string | null>(null)
  // AskUserQuestion picker state (keyed off the active pending permission's id).
  const [questionFocusIndex, setQuestionFocusIndex] = useState(0)
  const [questionOptionIndex, setQuestionOptionIndex] = useState(0)
  const [questionSelections, setQuestionSelections] = useState<Record<number, string[]>>({})
  const [questionFreeformAnswers, setQuestionFreeformAnswers] = useState<Record<number, string>>({})
  const [questionFreeformEditing, setQuestionFreeformEditing] = useState(false)
  const questionPermissionIdRef = useRef<string | null>(null)
  const [composerWaitingSeed, setComposerWaitingSeed] = useState('')
  const [composerError, setComposerError] = useState<string | null>(null)
  const [composerLiveText, setComposerLiveText] = useState('')
  // Reasoning streams on its own dim channel (see liveReasoning render below).
  const [composerLiveReasoning, setComposerLiveReasoning] = useState('')
  // Live thinking-token estimate (SDK `thinking_tokens` messages); shown on the
  // THINKING preview header, reset each turn.
  const [composerThinkingTokens, setComposerThinkingTokens] = useState(0)
  const [liveTranscriptMessages, setLiveTranscriptMessages] = useState<ThreadedMessage[]>([])
  // Queued prompts waiting for the active turn to finish (CLI-style FIFO —
  // a single slot here used to silently overwrite the first queued message).
  const [queuedComposerSends, setQueuedComposerSends] = useState<QueuedComposerSend[]>(() =>
    readComposerQueue(isQueuedComposerSend))
  const queuedComposerSendsRef = useRef<QueuedComposerSend[]>(queuedComposerSends)
  const [composerQueueDurable, setComposerQueueDurable] = useState(true)
  const [runningRegistryReady, setRunningRegistryReady] = useState(false)
  // Follow-up queue mutations must be crash-safe before the next render. Keep
  // the transient ref and atomic queue file in lockstep in the originating
  // interaction; relying only on effects leaves immediate-exit windows where
  // the newest enqueue/cancel state can be lost or replayed.
  const commitQueuedComposerSends = useEffectEvent((next: QueuedComposerSend[]) => {
    queuedComposerSendsRef.current = next
    scheduleWriteComposerQueue(next)
    setComposerQueueDurable(flushComposerQueueWrites())
    setQueuedComposerSends(next)
  })
  const activeComposerTurnRequestIdRef = useRef<string | null>(null)
  // Last message delivered INTO the running turn via native steering — shown
  // in the composer status line while the turn is still streaming.
  const [steeredSendNotice, setSteeredSendNotice] = useState<string | null>(null)
  const steeredEchoCounterRef = useRef(0)
  const steeredComposerSendsRef = useRef<SteeredComposerSend[]>([])
  const [livePromptSuggestion, setLivePromptSuggestion] = useState<string | null>(null)
  const [liveStatus, setLiveStatus] = useState<'requesting' | 'compacting' | 'retrying' | null>(null)
  const [liveSubagentText, setLiveSubagentText] = useState<Record<string, string>>({})
  const [liveOutputTokens, setLiveOutputTokens] = useState(0)
  const [liveToolActivities, setLiveToolActivities] = useState<TuiLiveToolActivity[]>([])
  const [taskBudgetTokens, setTaskBudgetTokens] = useState<number | null>(null)
  const [composerEnableWorkflow, setComposerEnableWorkflow] = useState(false)
  // Provider-agnostic send knobs. Forwarded into the streamTuiSessionTurn
  // body so the TUI composer matches the web composer's send-time controls
  // (model / reasoning effort / provider permission mode). Defaults of `auto`
  // / `default` mean "let the SDK keep whatever the session was using".
  const [tuiEffort, setTuiEffort] = useState<TuiEffort>('auto')
  const [tuiPermissionModeByKey, setTuiPermissionModeByKey] = useState<Record<string, TuiPermissionMode>>({})
  const tuiPermissionModeByKeyRef = useRef<Record<string, TuiPermissionMode>>({})
  const [tuiCodexApprovalByKey, setTuiCodexApprovalByKey] = useState<Record<string, TuiCodexApproval>>({})
  const [tuiCopilotPermissionModeByKey, setTuiCopilotPermissionModeByKey] = useState<Record<string, TuiCopilotPermissionMode>>({})
  const [tuiCopilotMode, setTuiCopilotMode] = useState<'interactive' | 'plan' | 'autopilot' | 'shell'>('interactive')
  const [tuiOpenCodeAgent, setTuiOpenCodeAgent] = useState('')
  const [tuiModelOverride, setTuiModelOverride] = useState<Record<string, string>>({})
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelPickerTarget, setModelPickerTarget] = useState<Session | null>(null)
  const [modelPickerFocus, setModelPickerFocus] = useState<ModelPickerFocus>('model')
  const [modelPickerOptions, setModelPickerOptions] = useState<ModelPickerOption[]>([])
  const [modelPickerPermissionOptions, setModelPickerPermissionOptions] = useState<SelectOption[]>([])
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const [modelPickerIndex, setModelPickerIndex] = useState(0)
  const [modelPickerEffortIndex, setModelPickerEffortIndex] = useState(0)
  const [modelPickerPermissionIndex, setModelPickerPermissionIndex] = useState(0)
  const [modelPickerLoading, setModelPickerLoading] = useState(false)
  const [modelPickerError, setModelPickerError] = useState<string | null>(null)
  const [sentHistory, setSentHistory] = useState<ComposerDraftSnapshot[]>(() =>
    readComposerSentHistory().map((text) => ({ text, attachments: [], promptParts: [] })),
  )
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
  // Pending scroll correction for the commit that slides the reader window.
  // 'anchor' restores the pre-slide visual position relative to a card mounted
  // in both windows; 'cursor' scrolls the cursor card into view once mounted.
  const readerScrollFixupRef = useRef<
    | { kind: 'anchor'; anchorKey: string; prevContentOffset: number; viewportOffset: number }
    | { kind: 'cursor'; cardKey: string }
    | null
  >(null)
  // Metrics-only mirror of the mounted card window (assigned during render,
  // read by the gauge timer).
  const readerWindowGaugeRef = useRef({ start: 0, end: 0, total: 0 })
  const sidebarScrollRef = useRef<ScrollBoxRenderable>(null)
  // The reader box is flex-sized (flexGrow inside a stretched row), so its real
  // height is a few rows more than the mainContentHeight arithmetic implies.
  // Split panes must match the frame the reader actually gets, so measure it
  // once per commit and size panes from that instead of recomputing the budget.
  const readerBoxRef = useRef<BoxRenderable>(null)
  const [measuredReaderBoxHeight, setMeasuredReaderBoxHeight] = useState(0)
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
  const previousTranscriptRef = useRef<{ sessionKey: string | null; length: number; lastKey: string | null }>({
    sessionKey: null,
    length: 0,
    lastKey: null,
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
  useEffect(() => () => {
    if (composerRetryTimerRef.current) clearTimeout(composerRetryTimerRef.current)
  }, [])
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
  const liveTranscriptBaselineRef = useRef(new Map<string, {
    count: number
    lastFingerprint: string | null
    sequenceFingerprint: string
    startedAt: number
  }>())
  const liveTranscriptMessagesRef = useRef<ThreadedMessage[]>([])
  const awaitingPersistedTurnRef = useRef(false)
  const liveTextFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingLiveTextRef = useRef('')
  const pendingLiveReasoningRef = useRef('')
  const liveTextTargetSessionRef = useRef<Session | null>(null)
  const loadingDetailRef = useRef(false)
  // Single-flight coalescing for foreground detail loads. The threading worker
  // processes transcripts serially and can't cancel in-flight work, so firing a
  // load per settled session while scrubbing backs its queue up — opens start
  // fast then get progressively slower as the backlog grows. We run at most one
  // foreground load at a time and remember only the latest target requested
  // while it's busy; the in-flight load picks that up when it frees, skipping
  // every fly-by session in between.
  const foregroundLoadInFlightRef = useRef(false)
  const pendingForegroundLoadRef = useRef<Session | null>(null)
  const backgroundRefreshInFlightRef = useRef(new Set<string>())
  const sessionDetailMtimeRef = useRef(new Map<string, number>())
  const selectedSessionKeyRef = useRef<string | null>(null)
  const openTabSessionsRef = useRef<Session[]>([])
  const runningSessionsRef = useRef<RunningSessionRef[]>([])
  const tabsEnabledRef = useRef(true)
  const themeMenuOriginRef = useRef<TuiThemeMode | null>(null)
  const transcriptViewMenuOriginRef = useRef<TuiTranscriptView | null>(null)
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
  const composerFocusBlocked = Boolean(
    exitConfirmOpen
    || searchMode
    || sessionSearchMode
    || gitOpen
    || pullRequestOpen
    || analyticsOpen
    || crossSessionMessagingOpen
    || handoffBriefOpen
    || promptLibraryOpen
    || channelBridgeOpen
    || ideBridgeOpen
    || bookmarksOverlayOpen
    || taskPopoverOpen
    || diagnosticsOpen
    || coordModalOpen
    || coordBoardOpen
    || renameSessionKey
    || newSessionModalOpen
    || providerMenuOpen
    || modelPickerOpen
    || themeMenuOpen
    || transcriptViewMenuOpen
    || commandPaletteOpen
    || transcriptDiffDraft,
  )
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
    readerWindowStart: readerWindowGaugeRef.current.start,
    readerWindowEnd: readerWindowGaugeRef.current.end,
    readerWindowTotal: readerWindowGaugeRef.current.total,
  })), [sessions.length, sessionDetail])
  useEffect(() => {
    if (!composerActive && composerWindowOpen) setComposerWindowOpen(false)
  }, [composerActive, composerWindowOpen])
  useLayoutEffect(() => {
    if (!composerActive || composerFocusBlocked) return
    const renderable = composerTextareaRef.current
    if (!renderable) return
    const offset = composerCursorOffsetRef.current
    if (offset != null) {
      renderable.cursorOffset = Math.min(offset, renderable.plainText.length)
      composerCursorOffsetRef.current = null
    }
    if (renderer.currentFocusedRenderable !== renderable) renderable.focus()
  }, [composerActive, composerFocusBlocked, composerWindowOpen, renderer])
  // Overlay pickers (theme menu, transcript-view menu, etc.) own a search
  // <input> that unmounts when the overlay closes, and the renderer hands
  // focus to whatever else declares `focused` (the transcript scrollbox) as
  // part of that same unmount — after the layout effect above already ran,
  // so its focus() call loses the race. Defer one tick past that fallback
  // and reclaim focus for the composer whenever the last blocking overlay
  // closes.
  useEffect(() => {
    if (!composerActive || composerFocusBlocked) return
    const renderable = composerTextareaRef.current
    if (!renderable) return
    const timer = setTimeout(() => {
      if (renderer.currentFocusedRenderable !== renderable) renderable.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [composerActive, composerFocusBlocked, renderer])
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
  const selectedIndex = useMemo(
    () => resolveSelectedSessionIndex(selectedSessionKey, sessions, sessionKey),
    [selectedSessionKey, sessions],
  )
  // Latest sessions list keyed for ref-time lookups. refreshSelectedSessionDetail
  // receives identity-stable SKELETON sessions ({sessionId, provider} — see
  // selectedSessionTarget), so it must resolve list-level metadata like
  // lastModified here; reading it off the passed session silently disabled the
  // mtime guards (typeof undefined !== 'number') and made every 2s poll and
  // every scrub settle re-read the full session file.
  const sessionsByKeyRef = useRef(new Map<string, Session>())
  useEffect(() => {
    const byKey = new Map<string, Session>()
    for (const session of sessions) byKey.set(sessionKey(session), session)
    sessionsByKeyRef.current = byKey
  }, [sessions])
  // Fall back to openTabSessions when the key doesn't match anything in
  // `sessions` — that's the case for freshly created pending provider sessions
  // (added to openTabSessions immediately, but only appears in `sessions` once
  // the SDK materialises it on first send).
  const selectedSession = useMemo<Session | null>(
    () => resolveSelectedSession(
      selectedSessionKey,
      selectedIndex,
      sessions,
      openTabSessions,
      sessionKey,
      (session) => Boolean(session.isPending),
    ),
    [openTabSessions, selectedIndex, selectedSessionKey, sessions],
  )
  const selectedSessionIdentity = selectedSession ? sessionKey(selectedSession) : null
  useEffect(() => {
    setTranscriptDiffDraft(null)
    setHoveredTranscriptDiffAnchor(null)
    setTranscriptDiffSelectionAnchorByCardKey({})
  }, [selectedSessionIdentity])
  // Reflect the active session in the terminal tab/window title so users with
  // several terminals can tell them apart, with a ● prefix while its turn runs.
  // Gated like the other native-OSC features (off on Windows); the computed
  // string is memoized so setTerminalTitle only fires when the title changes.
  const selectedSessionBusy = useMemo(() => {
    if (!selectedSession) return false
    const sid = selectedSession.sessionId
    const prov = selectedSession.provider ?? 'claude'
    return runningSessions.some((running) => running.sessionId === sid && running.provider === prov)
  }, [runningSessions, selectedSession])
  const terminalTitle = useMemo(() => {
    if (!selectedSession) return 'agent-viewer'
    const label = formatProviderLabel(selectedSession.provider)
    const name = formatSessionTitle(selectedSession).slice(0, 48)
    return toBmpSafe(`${selectedSessionBusy ? '● ' : ''}agent-viewer · ${label} · ${name}`)
  }, [selectedSession, selectedSessionBusy])
  useEffect(() => {
    if (!NATIVE_OSC_ENABLED) return
    try {
      renderer.setTerminalTitle(terminalTitle)
    } catch {
      // terminal doesn't support OSC title sequences — ignore
    }
  }, [renderer, terminalTitle])
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
  // The session that the currently-loaded `sessionDetail` actually belongs to.
  // Memoized on `info` alone so its identity is stable as long as the detail is
  // — this is what keeps the transcript card cache from being busted mid-scrub.
  const detailSession = useMemo<Session | null>(() => {
    const info = sessionDetail?.info
    if (!info) return null
    return { sessionId: info.sessionId, provider: info.provider }
  }, [sessionDetail?.info])
  // Key the transcript off the session the detail belongs to, not the live
  // selection. While scrubbing quickly, `selectedSessionTarget` races ahead of
  // the debounced `sessionDetail` load; using it here would mismatch
  // `threadedMessages` and force a full uncached reformat of the (large) visible
  // transcript on every step. Falling back to `detailSession` keeps a stable
  // identity (cache hit) until the load we land on commits.
  const transcriptSession = useMemo<Session | null>(() => {
    if (!detailSession) return selectedSessionTarget
    if (
      selectedSessionTarget
      && selectedSessionTarget.sessionId === detailSession.sessionId
      && (selectedSessionTarget.provider ?? 'claude') === (detailSession.provider ?? 'claude')
    ) {
      return selectedSessionTarget
    }
    return detailSession
  }, [detailSession, selectedSessionTarget])
  // Key of the session whose transcript is actually on screen. Lags the live
  // `selectedSessionKey` by the open-debounce: while scrubbing it stays pinned
  // to the displayed session, so per-session effects (reader-state reset,
  // cursor reconcile, bookmark load) that would otherwise reset/rebuild the
  // transcript on every step simply don't fire until you settle. This is the
  // load-bearing guard against scrub jank on large sessions.
  const committedSessionKey = useMemo(
    () => (transcriptSession ? sessionKey(transcriptSession) : null),
    [transcriptSession],
  )
  // True while the live selection has moved ahead of the displayed transcript —
  // i.e. you're mid-scrub and the debounced open hasn't landed yet. Building the
  // full transcript element tree is O(cards) and costs 100s of ms–1s+ on large
  // sessions (OpenTUI lays out every card to compute scroll height, even with
  // viewportCulling). Keeping it mounted makes EVERY commit that size, so we
  // unmount it while scrubbing and rebuild once, when the selection settles.
  const isScrubbing = selectedSessionKey != null && selectedSessionKey !== committedSessionKey
  const providerRunningSessions = useMemo(() => (
    runningSessions.filter((running) => provider === 'all' || running.provider === provider)
  ), [provider, runningSessions])
  // The session behind the focused pane, resolved from the pins rather than the
  // rendered pane list (which the layout computes much later). Session-scoped
  // features read this so they follow the pane you are looking at.
  const focusedSplitPaneSession = useMemo<Session | null>(() => {
    if (splitFocusIndex === null) return null
    const pinnedKey = splitPinnedKeys[splitFocusIndex]
    if (!pinnedKey) return null
    return openTabSessions.find((tab) => sessionKey(tab) === pinnedKey) ?? null
  }, [splitFocusIndex, splitPinnedKeys, openTabSessions])

  const composerTargetSession = useMemo<Session | null>(() => resolveComposerTargetSession({
    paneTargetKey: composerPaneTargetKey,
    preferredTargetKey: composerPreferredTargetKey,
    selectedSession,
    runningSessions: providerRunningSessions,
    sessions,
    openTabSessions,
    keyOf: sessionKey,
  }), [composerPaneTargetKey, composerPreferredTargetKey, openTabSessions, providerRunningSessions, selectedSession, sessions])
  const composerTargetSessionIdentity = composerTargetSession
    ? sessionKey(composerTargetSession)
    : null
  const activeQueuedComposerSends = useMemo(
    () => selectComposerQueueTarget(queuedComposerSends, composerTargetSessionIdentity),
    [composerTargetSessionIdentity, queuedComposerSends],
  )
  const composerTargetTurnKnownRunning = Boolean(
    composerTargetSessionIdentity
    && providerRunningSessions.some((running) => sessionKey(running) === composerTargetSessionIdentity),
  )
  const composerTargetSessionRef = useRef<Session | null>(null)
  useEffect(() => { composerTargetSessionRef.current = composerTargetSession }, [composerTargetSession])
  const canUseChannelBridge = Boolean(
    selectedSessionTarget
    && (selectedSessionTarget.provider ?? 'claude') === 'claude'
    && composerTargetSession
    && (composerTargetSession.provider ?? 'claude') === 'claude',
  )
  // The IDE bridge shares the channel bridge's Claude-only availability gate.
  const canUseIdeBridge = canUseChannelBridge
  const composerAutoTargetingRunning = Boolean(
    composerTargetSession
    && selectedSession
    && (
      composerTargetSession.sessionId !== selectedSession.sessionId
      || composerTargetSession.provider !== selectedSession.provider
    ),
  )
  // Unified attention list: prompts blocking any running turn (selected
  // session's from pendingPermissions, others' from the registry poll), then
  // background turn completions. Prompt order is arrival order within each
  // source; needs-input always sorts above finished.
  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []
    const seenPromptIds = new Set<string>()
    for (const prompt of [...pendingPermissions, ...backgroundPrompts]) {
      if (!prompt.id || seenPromptIds.has(prompt.id)) continue
      seenPromptIds.add(prompt.id)
      const promptProvider = prompt.provider ?? composerTargetSession?.provider ?? 'claude'
      // Stream-delivered prompts without a session id ride the composer's
      // current target — that is the turn that produced them.
      const sessionId = prompt.sessionId ?? composerTargetSession?.sessionId ?? ''
      const key = sessionKey({ sessionId, provider: promptProvider })
      const session = sessionsByKeyRef.current.get(key)
      items.push({
        key: `prompt:${prompt.id}`,
        kind: prompt.questions && prompt.questions.length > 0
          ? 'question'
          : prompt.toolName === 'ExitPlanMode'
          ? 'plan'
          : 'permission',
        sessionId,
        provider: promptProvider,
        sessionKey: key,
        sessionTitle: session ? formatSessionTitle(session) : sessionId.slice(-8) || 'unknown session',
        title: prompt.title,
        detail: prompt.detail ?? prompt.command ?? prompt.paths?.[0] ?? prompt.url,
        permission: prompt,
        createdAt: 0,
      })
    }
    for (const waiting of waitingSessions) {
      const key = sessionKey(waiting)
      const session = sessionsByKeyRef.current.get(key)
      const taskCount = waiting.backgroundTasks.length
      const cronCount = waiting.sessionCrons.length
      const details = [
        ...waiting.backgroundTasks.map((task) => task.description || `${task.type} ${task.status}`),
        ...waiting.sessionCrons.map((cron) => `scheduled ${cron.schedule}`),
      ]
      items.push({
        key: `waiting:${key}`,
        kind: 'waiting',
        sessionId: waiting.sessionId,
        provider: waiting.provider,
        sessionKey: key,
        sessionTitle: session ? formatSessionTitle(session) : waiting.sessionId.slice(-8),
        title: `${taskCount} background task${taskCount === 1 ? '' : 's'}, ${cronCount} scheduled wakeup${cronCount === 1 ? '' : 's'}`,
        detail: details.slice(0, 2).join(' · '),
        createdAt: waiting.updatedAt,
      })
    }
    for (const note of viewerAttentionNotes) {
      const key = sessionKey(note)
      const session = sessionsByKeyRef.current.get(key)
      items.push({
        key: `viewer:${note.id}`,
        kind: 'viewer-note',
        sessionId: note.sessionId,
        provider: note.provider,
        sessionKey: key,
        sessionTitle: session ? formatSessionTitle(session) : note.sessionId.slice(-8),
        title: note.title,
        detail: note.detail,
        attentionId: note.id,
        createdAt: note.createdAt,
      })
    }
    for (const done of attentionDone) {
      items.push({
        key: done.key,
        kind: 'turn-done',
        sessionId: done.sessionId,
        provider: done.provider,
        sessionKey: done.sessionKey,
        sessionTitle: done.title,
        title: 'Turn finished',
        createdAt: done.createdAt,
      })
    }
    return items
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPermissions, backgroundPrompts, waitingSessions, viewerAttentionNotes, attentionDone, sessions, composerTargetSession])
  const attentionNeedsInputCount = useMemo(
    () => attentionItems.filter(attentionItemNeedsInput).length,
    [attentionItems],
  )

  // Keep the sidebar's activity marker aligned with the fleet strip. Running
  // sessions are actively receiving transcript events; attention takes
  // precedence so a blocked turn is visible even while its runtime is live.
  const sidebarSessionActivity = useMemo(() => {
    const needsInputKeys = new Set(
      attentionItems.filter(attentionItemNeedsInput).map((item) => item.sessionKey),
    )
    const activity = new Map<string, 'needs-input' | 'running' | 'waiting'>()
    for (const running of runningSessions) {
      const key = sessionKey(running)
      activity.set(key, needsInputKeys.has(key) ? 'needs-input' : 'running')
    }
    for (const waiting of waitingSessions) {
      const key = sessionKey(waiting)
      if (!activity.has(key)) activity.set(key, needsInputKeys.has(key) ? 'needs-input' : 'waiting')
    }
    for (const note of viewerAttentionNotes) {
      const key = sessionKey(note)
      if (!activity.has(key)) activity.set(key, 'needs-input')
    }
    return activity
  }, [attentionItems, runningSessions, waitingSessions, viewerAttentionNotes])

  // Fleet strip: one cell per live session (running or blocked on input) plus
  // recent background completions — mission-control ambient awareness while
  // reading any single transcript. Digits 1-9 jump to a cell; ⇧A toggles.
  const fleetEntries = useMemo<Array<{
    key: string
    sessionId: string
    provider: AgentProvider
    title: string
    status: 'needs-input' | 'running' | 'waiting' | 'done'
  }>>(() => {
    const needsInputKeys = new Set(
      attentionItems.filter(attentionItemNeedsInput).map((item) => item.sessionKey),
    )
    const entries: Array<{
      key: string
      sessionId: string
      provider: AgentProvider
      title: string
      status: 'needs-input' | 'running' | 'waiting' | 'done'
    }> = runningSessions.map((ref) => {
      const key = sessionKey({ sessionId: ref.sessionId, provider: ref.provider })
      const session = sessionsByKeyRef.current.get(key)
      return {
        key,
        sessionId: ref.sessionId,
        provider: ref.provider,
        title: session ? formatSessionTitle(session) : ref.sessionId.slice(-8),
        status: needsInputKeys.has(key) ? 'needs-input' as const : 'running' as const,
      }
    })
    const liveKeys = new Set(entries.map((entry) => entry.key))
    for (const waiting of waitingSessions) {
      const key = sessionKey(waiting)
      if (liveKeys.has(key)) continue
      const session = sessionsByKeyRef.current.get(key)
      entries.push({
        key,
        sessionId: waiting.sessionId,
        provider: waiting.provider,
        title: session ? formatSessionTitle(session) : waiting.sessionId.slice(-8),
        status: needsInputKeys.has(key) ? 'needs-input' : 'waiting',
      })
      liveKeys.add(key)
    }
    for (const note of viewerAttentionNotes) {
      const key = sessionKey(note)
      if (liveKeys.has(key)) continue
      const session = sessionsByKeyRef.current.get(key)
      entries.push({
        key,
        sessionId: note.sessionId,
        provider: note.provider,
        title: session ? formatSessionTitle(session) : note.sessionId.slice(-8),
        status: 'needs-input',
      })
      liveKeys.add(key)
    }
    for (const done of attentionDone) {
      if (liveKeys.has(done.sessionKey)) continue
      entries.push({
        key: done.sessionKey,
        sessionId: done.sessionId,
        provider: done.provider,
        title: done.title,
        status: 'done' as const,
      })
    }
    // Blocked cells first — they are why the strip exists.
    return entries.sort((a, b) => {
      const rank = (status: string) => (status === 'needs-input' ? 0 : status === 'running' ? 1 : status === 'waiting' ? 2 : 3)
      return rank(a.status) - rank(b.status)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningSessions, waitingSessions, viewerAttentionNotes, attentionItems, attentionDone, sessions])
  const fleetStripVisible = fleetStripEnabled && !focusMode && fleetEntries.length > 0
  const fleetPageCount = Math.max(Math.ceil(fleetEntries.length / FLEET_PAGE_SIZE), 1)
  const activeFleetPage = Math.min(fleetPage, fleetPageCount - 1)
  const visibleFleetEntries = useMemo(
    () => fleetEntries.slice(activeFleetPage * FLEET_PAGE_SIZE, (activeFleetPage + 1) * FLEET_PAGE_SIZE),
    [activeFleetPage, fleetEntries],
  )
  useEffect(() => {
    if (fleetPage !== activeFleetPage) setFleetPage(activeFleetPage)
  }, [activeFleetPage, fleetPage])
  const fleetStripSegments = useMemo<InlineTextSegment[]>(() => {
    if (!fleetStripVisible) return []
    const pageLabel = fleetPageCount > 1 ? ` ${activeFleetPage + 1}/${fleetPageCount}` : ''
    const segs: InlineTextSegment[] = [{ text: `FLEET${pageLabel}  `, fg: theme.dim }]
    visibleFleetEntries.forEach((entry, index) => {
      const selected = entry.key === selectedSessionKey
      const accent = getProviderAccent(entry.provider)
      const glyph = entry.status === 'needs-input' ? '⚠' : entry.status === 'running' ? '●' : entry.status === 'waiting' ? '◌' : '✓'
      const glyphColor = entry.status === 'needs-input' ? theme.amber : entry.status === 'running' ? accent : entry.status === 'waiting' ? theme.cyan : theme.green
      if (index > 0) segs.push({ text: '   ', fg: theme.dim })
      segs.push({ text: `${index + 1} `, fg: selected ? accent : theme.dim })
      segs.push({ text: `${glyph} `, fg: glyphColor })
      segs.push({
        text: entry.title.length > 18 ? `${entry.title.slice(0, 17)}…` : entry.title,
        fg: selected ? theme.text : theme.muted,
      })
    })
    if (fleetPageCount > 1) segs.push({ text: '  { } pages', fg: theme.dim })
    return segs
  }, [activeFleetPage, fleetPageCount, fleetStripVisible, selectedSessionKey, theme, visibleFleetEntries])

  // Viewing a session resolves its "turn finished" notice.
  useEffect(() => {
    if (!selectedSessionKey) return
    setAttentionDone((prev) => {
      const next = prev.filter((done) => done.sessionKey !== selectedSessionKey)
      return next.length === prev.length ? prev : next
    })
  }, [selectedSessionKey])

  const composerProvider = composerTargetSession?.provider ?? selectedSession?.provider ?? null
  const composerPermissionMode = useMemo<TuiPermissionMode>(() => {
    if (composerTargetSession?.provider !== 'claude') return 'default'
    return tuiPermissionModeByKey[sessionKey(composerTargetSession)] ?? 'default'
  }, [composerTargetSession, tuiPermissionModeByKey])
  const composerCodexApproval = composerTargetSession?.provider === 'codex'
    ? tuiCodexApprovalByKey[sessionKey(composerTargetSession)] ?? 'auto'
    : 'auto'
  const composerCopilotPermissionMode = composerTargetSession?.provider === 'copilot'
    ? tuiCopilotPermissionModeByKey[sessionKey(composerTargetSession)] ?? 'off'
    : 'off'
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

  useEffect(() => {
    if (canUseChannelBridge) return
    setChannelBridgeOpen(false)
    setRouteComposerToBridge(false)
    setBridgeTranscriptEntries([])
    persistedBridgeCountRef.current = 0
    lastBridgeChatIdRef.current = undefined
  }, [canUseChannelBridge])

  useEffect(() => {
    if (canUseIdeBridge) return
    setIdeBridgeOpen(false)
    setRouteComposerToIde(false)
  }, [canUseIdeBridge])

  // Subscribe only while a Claude session can actively use the bridge.
  useEffect(() => {
    if (!canUseChannelBridge || (!channelBridgeOpen && !routeComposerToBridge)) return
    const config = readBridgeConfigFromEnv()
    let entrySeq = 0
    const unsubscribe = subscribeToChannelEvents(
      config,
      (event: ChannelEvent) => {
        if (event.type === 'reply') {
          const timestamp = new Date(Date.now() + entrySeq * 100).toISOString()
          setBridgeTranscriptEntries((prev) => [...prev, { kind: 'reply', text: event.text, timestamp }])
          entrySeq += 1
        }
      },
      (status) => {
        if (status !== 'connected' || !selectedSessionTarget) return
        void flushChannelBridgeOutbox(
          channelBridgeFileOutboxStorage,
          config,
          selectedSessionTarget.sessionId,
        ).then((result) => {
          if (result.error) showNotice('error', `Channel message remains queued: ${result.error.message}`)
        })
      },
    )
    return unsubscribe
  }, [canUseChannelBridge, channelBridgeOpen, routeComposerToBridge, selectedSessionTarget?.sessionId])

  // Load persisted bridge messages when selected session changes
  useEffect(() => {
    if (!canUseChannelBridge || !selectedSessionTarget) {
      setBridgeTranscriptEntries([])
      persistedBridgeCountRef.current = 0
      return
    }
    let isMounted = true
    ;(async () => {
      const persisted = await loadBridgeMessagesForSession(selectedSessionTarget.provider, selectedSessionTarget.sessionId)
      if (isMounted) {
        const entries = persisted.map((msg) => ({
          kind: msg.kind,
          text: msg.text,
          timestamp: msg.timestamp,
        }))
        setBridgeTranscriptEntries(entries)
        persistedBridgeCountRef.current = entries.length
      }
    })().catch(console.error)
    return () => { isMounted = false }
  }, [canUseChannelBridge, selectedSessionTarget?.provider, selectedSessionTarget?.sessionId])

  // Persist new bridge messages to disk when they arrive
  useEffect(() => {
    if (!canUseChannelBridge || !selectedSessionTarget) return
    const newCount = bridgeTranscriptEntries.length
    const persistedCount = persistedBridgeCountRef.current
    if (newCount <= persistedCount) return

    // Persist only the new entries
    const newEntries = bridgeTranscriptEntries.slice(persistedCount)
    let cancelled = false
    ;(async () => {
      for (const entry of newEntries) {
        if (cancelled) return
        await addBridgeMessage(selectedSessionTarget.provider, selectedSessionTarget.sessionId, entry.kind, entry.text, entry.timestamp)
      }
      if (!cancelled) {
        persistedBridgeCountRef.current = newCount
      }
    })().catch(console.error)
    return () => { cancelled = true }
  }, [canUseChannelBridge, selectedSessionTarget?.provider, selectedSessionTarget?.sessionId, bridgeTranscriptEntries.length])

  const liveTranscriptMessagesCacheRef = useRef<ThreadedMessage[] | null>(null)
  const liveTranscriptMessagesForSession = useMemo(() => {
    if (!selectedSessionTarget) return []
    const key = sessionKey(selectedSessionTarget)
    const filtered = liveTranscriptMessages.filter((message) => liveMessageSessionKey(message) === key)
    const prev = liveTranscriptMessagesCacheRef.current
    if (prev && prev.length === filtered.length && prev.every((m, i) => m === filtered[i])) {
      return prev
    }
    return filtered
  }, [liveTranscriptMessages, selectedSessionTarget])
  useLayoutEffect(() => {
    liveTranscriptMessagesCacheRef.current = liveTranscriptMessagesForSession
  }, [liveTranscriptMessagesForSession])

  const taskPanelMessages = useMemo(() => {
    const persisted = sessionDetail?.threadedMessages ?? []
    const live = liveTranscriptMessagesForSession
    if (live.length === 0) return persisted
    const seen = new Set(live.map((m) => m.uuid))
    return [...live, ...persisted.filter((m) => !seen.has(m.uuid))]
  }, [sessionDetail?.threadedMessages, liveTranscriptMessagesForSession])
  const liveAssistantTextCardVisible = useMemo(
    () => liveTranscriptMessagesForSession.some(isLiveAssistantTextMessage),
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
  // Bumped when the warm-cache effect finishes an off-thread format, so the
  // memo below re-runs its (now-hitting) sync cache lookup. Only relevant for
  // sessions above SYNC_FORMAT_CARD_LIMIT, where the main-thread fallback is
  // skipped.
  const [workerCardCacheVersion, setWorkerCardCacheVersion] = useState(0)
  const baseTranscriptCards = useMemo<TuiTranscriptCard[]>(() => {
    const profileStart = CARD_PROFILE ? performance.now() : 0
    if (!transcriptSession || !sessionDetail) return []
    let cards: TuiTranscriptCard[]
    let recomputed = 0
    const cachedSync = getTranscriptCardsSync(
      transcriptSession,
      sessionDetail.threadedMessages,
      density,
      showToolCalls,
    )
    if (cachedSync) {
      cards = cachedSync
    } else if (sessionDetail.threadedMessages.length > SYNC_FORMAT_CARD_LIMIT) {
      // Too large to format on the render thread (this path is a multi-second
      // freeze on big sessions). The warm-cache effect below formats in the
      // worker and bumps workerCardCacheVersion when the cards are ready.
      cards = []
    } else {
      const filtered = showToolCalls
        ? sessionDetail.threadedMessages
        : stripToolCallBlocks(sessionDetail.threadedMessages)
      const activeForms = buildTaskActiveForms(filtered)
      const taskRegistry = buildTaskRegistry(filtered)
      const durations = computeTurnDurationsMs(filtered)
      cards = filtered.map((msg) => formatTranscriptCard(msg, density, activeForms, taskRegistry, durations.get(msg.uuid)))
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
  }, [density, sessionDetail, transcriptSession, showToolCalls, workerCardCacheVersion])

  // ── Task context for live cards — stable across streaming deltas ───────────
  // buildTaskActiveForms and buildTaskRegistry scan the full base transcript.
  // Memoizing them separately ensures the O(N_base) scan runs at most once per
  // sessionDetail update (2s poll cadence), never per streamed token.
  // Live messages occasionally contain TaskCreate/TaskUpdate calls; their task
  // events appear in the persisted transcript (and therefore here) on the next
  // poll, which is the correct behaviour — the live overlay is ephemeral.
  // Only the live/bridge overlay cards consume this context (base cards are
  // formatted in the worker), so skip the two O(N_base) scans entirely when no
  // overlay exists — i.e. on every settled scrub/open of an idle session.
  const hasTranscriptOverlay = liveTranscriptMessagesForSession.length > 0 || bridgeTranscriptEntries.length > 0
  const baseTaskContext = useMemo(() => {
    if (!sessionDetail || !hasTranscriptOverlay) return { activeForms: new Map() as ReturnType<typeof buildTaskActiveForms>, taskRegistry: new Map() as ReturnType<typeof buildTaskRegistry> }
    const filtered = showToolCalls
      ? sessionDetail.threadedMessages
      : stripToolCallBlocks(sessionDetail.threadedMessages)
    return {
      activeForms: buildTaskActiveForms(filtered),
      taskRegistry: buildTaskRegistry(filtered),
    }
  }, [sessionDetail, hasTranscriptOverlay, showToolCalls])
  const liveTurnStartedAt = selectedSessionTarget
    ? liveTranscriptBaselineRef.current.get(sessionKey(selectedSessionTarget))?.startedAt
    : undefined

  // Bridge entries change rarely compared with streamed assistant deltas.
  // Format and interleave them with the persisted transcript separately so a
  // token update does not rebuild bridge cards or sort all N persisted cards.
  const baseAndBridgeTranscriptCards = useMemo<TuiTranscriptCard[]>(() => {
    if (bridgeTranscriptEntries.length === 0) return baseTranscriptCards
    const bridgeCards: TuiTranscriptCard[] = bridgeTranscriptEntries.map((entry, i) => {
      const bridgeMessage: ThreadedMessage = {
        role: entry.kind === 'sent' ? 'user' : 'assistant',
        uuid: `bridge-${i}`,
        timestamp: entry.timestamp,
        origin: { kind: 'bridge' },
        blocks: [{ type: 'text', text: entry.text }],
      }
      return {
        ...formatTranscriptCard(bridgeMessage, density, baseTaskContext.activeForms, baseTaskContext.taskRegistry),
        key: `bridge:${i}`,
      }
    })
    return [...baseTranscriptCards, ...bridgeCards]
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))
  }, [baseTaskContext, baseTranscriptCards, bridgeTranscriptEntries, density])

  const latestBaseAndBridgeTimestamp = useMemo(
    () => baseAndBridgeTranscriptCards.reduce(
      (latest, card) => Math.max(latest, card.timestampMs ?? 0),
      0,
    ),
    [baseAndBridgeTranscriptCards],
  )

  // ── Live overlay — O(N_live) per delta, base cards always cache-hit ────────
  const transcriptCards = useMemo<TuiTranscriptCard[]>(() => {
    const profileStart = CARD_PROFILE ? performance.now() : 0
    // No live overlay (the common case while browsing/scrubbing): return the
    // stable persisted/bridge array as-is. Skipping the copy + sort keeps array
    // identity stable so every downstream per-card WeakMap cache keeps hitting.
    if (liveTranscriptMessagesForSession.length === 0) {
      if (CARD_PROFILE) {
        logCardRecompute({
          scope: 'transcriptCards',
          totalCards: baseAndBridgeTranscriptCards.length,
          recomputed: 0,
          liveCards: 0,
          durationMs: performance.now() - profileStart,
        })
      }
      return baseAndBridgeTranscriptCards
    }
    const liveMessages = showToolCalls
      ? liveTranscriptMessagesForSession
      : stripToolCallBlocks(liveTranscriptMessagesForSession)
    const liveTimestampBase = liveTurnStartedAt ?? latestBaseAndBridgeTimestamp + 1
    const liveCards = liveMessages.map((message, index) => {
      const timestampedMessage = message.timestamp
        ? message
        : { ...message, timestamp: new Date(liveTimestampBase + index).toISOString() }
      const formatted = formatTranscriptCard(
        timestampedMessage,
        density,
        baseTaskContext.activeForms,
        baseTaskContext.taskRegistry,
      )
      return {
        ...formatted,
        // Live prose changes every few milliseconds. Render its already-
        // formatted text lines synchronously while it grows; the markdown
        // renderer is intentionally restored when the durable card replaces
        // this overlay, avoiding a blank async-markdown frame per new block.
        markdownContent: isLiveAssistantTextMessage(message) ? undefined : formatted.markdownContent,
        key: `live:${message.uuid}`,
      }
    })

    // Live turns normally follow every persisted/bridge card. Avoid sorting the
    // full transcript on every token in that overwhelmingly common case. Keep
    // the sort fallback for imported/provider events carrying an older clock.
    const firstLiveTimestamp = liveCards[0]?.timestampMs ?? liveTimestampBase
    const liveCardsAreOrdered = liveCards.every((card, index) => (
      index === 0 || (liveCards[index - 1]?.timestampMs ?? 0) <= (card.timestampMs ?? 0)
    ))
    const sortedCards = firstLiveTimestamp >= latestBaseAndBridgeTimestamp && liveCardsAreOrdered
      ? [...baseAndBridgeTranscriptCards, ...liveCards]
      : [...baseAndBridgeTranscriptCards, ...liveCards]
        .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))

    if (CARD_PROFILE) {
      logCardRecompute({
        scope: 'transcriptCards',
        totalCards: sortedCards.length,
        recomputed: liveCards.length,
        liveCards: liveCards.length,
        durationMs: performance.now() - profileStart,
      })
    }
    return sortedCards
  }, [baseAndBridgeTranscriptCards, baseTaskContext, density, latestBaseAndBridgeTimestamp, liveTranscriptMessagesForSession, liveTurnStartedAt, showToolCalls])

  // Continue is prose-only. Stream mirrors native agent CLIs: conversation plus
  // compact operational rows, while low-level system bookkeeping stays hidden.
  const groupedToolView = transcriptView === 'agents' || isChatLikeView
  const visibleTranscriptCards = useMemo(
    () => {
      if (transcriptView === 'continue') {
        return transcriptCards.filter((card) => !card.autoFold)
      }
      if (isChatLikeView) {
        // Cards with no renderable content (turn boundaries, empty tool-only
        // messages) collapse to zero height in Stream view but would still be
        // selectable ghost stops for j/k — drop them from the list entirely.
        return groupStreamToolCards(transcriptCards.filter((card) => card.category !== 'system'))
          .filter((card) => !isStreamGhostCard(card))
      }
      if (transcriptView === 'agents') return groupAgentsToolCards(transcriptCards)
      return transcriptCards
    },
    [transcriptCards, transcriptView],
  )

  useLayoutEffect(() => {
    if (!selectedSessionTarget || !sessionDetail) return
    const key = sessionKey(selectedSessionTarget)
    const baseline = liveTranscriptBaselineRef.current.get(key)
    if (!baseline) return
    const durableSummary = summarizeDurableSessionMessages(sessionDetail.rawMessages)
    const persistedTurnArrived =
      durableSummary.count > baseline.count
      || durableSummary.lastFingerprint !== baseline.lastFingerprint
      || durableSummary.sequenceFingerprint !== baseline.sequenceFingerprint
    if (!persistedTurnArrived) return
    const liveAssistantVisible = Boolean(composerLiveText.trim())
      || hasLiveAssistantMessage(liveTranscriptMessagesForSession, key)
    if (liveAssistantVisible && !hasPersistedAssistantAfterBaseline(sessionDetail.rawMessages, baseline.count)) {
      // The assistant is still streaming. Swap the live user echo for the real
      // persisted row ONLY once that row has actually landed as a durable
      // message — `persistedTurnArrived` is a coarse change signal (count OR
      // fingerprint OR sequence), so removing the echo on any change can drop
      // the user's message before its persisted card exists, leaving a
      // poll-timed gap until the assistant finishes. Keep the echo until the
      // persisted user message is genuinely present (which also avoids a
      // duplicate, since echo and persisted row have different uuids).
      if (hasPersistedUserAfterBaseline(sessionDetail.rawMessages, baseline.count)) {
        setLiveTranscriptMessages((prev) => {
          const next = prev.filter((message) => !(liveMessageSessionKey(message) === key && message.role === 'user'))
          return next.length === prev.length ? prev : next
        })
      }
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
    if (!sessionDetail || !transcriptSession) return
    const cachedSync = getTranscriptCardsSync(
      transcriptSession,
      sessionDetail.threadedMessages,
      density,
      showToolCalls,
    )
    if (cachedSync) return
    let cancelled = false
    void formatTranscriptCardsAsync(
      transcriptSession,
      sessionDetail.threadedMessages,
      density,
      showToolCalls,
    ).then(() => {
      // Re-render so baseTranscriptCards picks the cards up from the sync
      // cache — required for over-SYNC_FORMAT_CARD_LIMIT sessions, which
      // render empty until this format lands.
      if (!cancelled) setWorkerCardCacheVersion((version) => version + 1)
    }).catch(() => { /* worker errors surface elsewhere */ })
    return () => {
      cancelled = true
    }
  }, [density, sessionDetail, transcriptSession, showToolCalls])
  const baseTranscriptIndexByKey = useMemo(
    () => createLazyTranscriptIndexLookup(baseAndBridgeTranscriptCards),
    [baseAndBridgeTranscriptCards],
  )
  const stableVisiblePrefixLength = (
    visibleTranscriptCards === transcriptCards
    && baseAndBridgeTranscriptCards.length <= visibleTranscriptCards.length
    && (
      baseAndBridgeTranscriptCards.length === 0
      || (
        visibleTranscriptCards[0] === baseAndBridgeTranscriptCards[0]
        && visibleTranscriptCards[baseAndBridgeTranscriptCards.length - 1]
          === baseAndBridgeTranscriptCards[baseAndBridgeTranscriptCards.length - 1]
      )
    )
  ) ? baseAndBridgeTranscriptCards.length : null
  const transcriptIndexByKey = useMemo(
    () => createLazyTranscriptIndexLookup(
      visibleTranscriptCards,
      stableVisiblePrefixLength == null
        ? undefined
        : { length: stableVisiblePrefixLength, lookup: baseTranscriptIndexByKey },
    ),
    [baseTranscriptIndexByKey, stableVisiblePrefixLength, visibleTranscriptCards],
  )

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

  const selectSidebarSession = useCallback((session: Session) => {
    setSelectedSessionKey(sessionKey(session))
    setError(null)
    setFocusedPane('sessions')
  }, [])

  const toggleSidebarSort = useCallback(() => {
    setSidebarSort((current) => {
      const next: TuiSidebarSort = current === 'project' ? 'time' : 'project'
      void writeTuiSidebarSort(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store sidebar sort'))
      return next
    })
  }, [])
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
      const shouldAutoFold = (
        transcriptView === 'conversation'
        || isChatLikeView
        || transcriptView === 'agents'
      ) && card.autoFold
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
    if (followTail) return visibleTranscriptCards.length - 1
    const index = transcriptCursorKey ? transcriptIndexByKey.get(transcriptCursorKey) ?? -1 : -1
    if (index >= 0) return index
    return 0
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

  // null (not 'unknown') so joinMeta drops it — a session whose model we can't
  // resolve shows just its project, never a dangling "· unknown".
  const readerModel = sessionDetail?.info?.currentModel ?? null
  // Git follows the focused split pane when there is one: the popover is
  // cwd-scoped, and the pane you are looking at is the repo you mean.
  const gitRepoCwd = focusedSplitPaneSession?.cwd ?? sessionDetail?.info?.cwd ?? selectedSession?.cwd ?? null
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
  // Some providers expose subagents inside a parent transcript instead of as
  // durable child sessions. Fetch their lightweight summaries lazily for the
  // currently open session. Providers with real children (OpenCode/Codex) are
  // already represented through parentSessionId and return no summaries here.
  // The cache is additive, so revisiting a parent does not reread its history.
  const [providerSubagentSummaries, setProviderSubagentSummaries] = useState<Map<string, SubagentSummary[]>>(new Map())
  useEffect(() => {
    const target = selectedSessionTarget
    if (!target) return
    const cacheKey = sessionKey(target)
    if (providerSubagentSummaries.has(cacheKey)) return
    let cancelled = false
    fetch(`/api/sessions/${target.sessionId}/subagents?provider=${target.provider ?? 'claude'}`)
      .then((res) => (res.ok ? res.json() : { subagents: [] }))
      .then((data: { subagents?: SubagentSummary[] }) => {
        if (cancelled) return
        setProviderSubagentSummaries((prev) => {
          const next = new Map(prev)
          next.set(cacheKey, data.subagents ?? [])
          return next
        })
      })
      .catch(() => {
        if (!cancelled) setProviderSubagentSummaries((prev) => new Map(prev).set(cacheKey, []))
      })
    return () => { cancelled = true }
  }, [selectedSessionTarget, providerSubagentSummaries])

  const childrenByParentId = useMemo(() => {
    const map = new Map<string, SidebarSubagentEntry[]>()
    for (const session of filteredSessionsForSidebar) {
      if (!session.parentSessionId) continue
      const parentKey = sessionKey({ sessionId: session.parentSessionId, provider: session.provider })
      const siblings = map.get(parentKey)
      const entry: SidebarSubagentEntry = { kind: 'session', session }
      if (siblings) siblings.push(entry)
      else map.set(parentKey, [entry])
    }
    for (const [parentKey, summaries] of providerSubagentSummaries) {
      if (summaries.length === 0) continue
      const parentSession = filteredSessionsForSidebar.find((session) => sessionKey(session) === parentKey)
      if (!parentSession) continue
      const entries: SidebarSubagentEntry[] = summaries.map((summary) => ({ kind: 'summary', summary }))
      const existing = map.get(parentKey)
      if (existing) existing.push(...entries)
      else map.set(parentKey, entries)
    }
    return map
  }, [filteredSessionsForSidebar, providerSubagentSummaries])

  const sidebarEntries = useMemo(() => {
    const entries = buildSidebarEntries(filteredSessionsForSidebar, sidebarSort, childrenByParentId)
    if (filteredSessionsForSidebar === sessions) return entries
    const originalIndex = new Map<string, number>()
    sessions.forEach((s, i) => { originalIndex.set(sessionKey(s), i) })
    return entries.map((entry) => {
      if (entry.type !== 'session') return entry
      const idx = originalIndex.get(sessionKey(entry.session))
      return idx === undefined ? entry : { ...entry, absoluteIndex: idx }
    })
  }, [filteredSessionsForSidebar, sessions, sidebarSort, childrenByParentId])
  // Ref mirror for the neighbour-prefetch effect: it needs the current sidebar
  // order at fire time without re-triggering on every 5s sessions poll (the
  // entries array gets a fresh identity each refresh).
  const sidebarEntriesRef = useRef<SidebarEntry[]>([])
  useEffect(() => {
    sidebarEntriesRef.current = sidebarEntries
  }, [sidebarEntries])
  const sidebarSortLabel = sidebarSort === 'project' ? 'PROJECT' : 'TIME'
  const selectedSidebarEntryIndex = useMemo(() => {
    const selected = selectedIndex >= 0 ? sessions[selectedIndex] : null
    const idx = selected
      ? sidebarEntries.findIndex((entry) => {
          const entrySession = sidebarEntrySession(entry)
          return entrySession ? sessionKey(entrySession) === sessionKey(selected) : false
        })
      : -1
    return idx >= 0 ? idx : 0
  }, [sidebarEntries, selectedIndex, sessions])

  // Coordinator tab: local ledger writes and attached-daemon SSE frames push
  // immediate refreshes. Retain a slow reconciliation poll for cross-process
  // SQLite writes, with the old 2s cadence only if subscription setup fails.
  useEffect(() => {
    if (sidebarView !== 'coordinator') return
    let cancelled = false
    let refreshInFlight = false
    let refreshQueued = false
    let pushTimer: ReturnType<typeof setTimeout> | null = null
    const changedRunIds = new Set<string>()
    const refresh = async () => {
      if (refreshInFlight) {
        refreshQueued = true
        return
      }
      refreshInFlight = true
      try {
        do {
          refreshQueued = false
          const runs = await listTuiProtocolRuns(20).catch(() => [] as ProtocolRun[])
          if (cancelled) return
          setCoordinatorRuns(runs)
          const snapshots = await Promise.all(runs.map((run) => readTuiProtocolRun(run.id).catch(() => null)))
          if (cancelled) return
          setCoordinatorSnapshots(new Map(snapshots.flatMap((snapshot) => snapshot ? [[snapshot.run.id, snapshot] as const] : [])))
        } while (refreshQueued && !cancelled)
      } finally {
        refreshInFlight = false
      }
    }
    const refreshChangedRun = async (runId: string) => {
      const snapshot = await readTuiProtocolRun(runId).catch(() => undefined)
      if (cancelled || snapshot === undefined) return
      if (!snapshot) {
        setCoordinatorRuns((current) => current.filter((run) => run.id !== runId))
        setCoordinatorSnapshots((current) => {
          const updated = new Map(current)
          updated.delete(runId)
          return updated
        })
        return
      }
      setCoordinatorRuns((current) => {
        const existingIndex = current.findIndex((run) => run.id === runId)
        if (existingIndex >= 0) {
          const updated = [...current]
          updated[existingIndex] = snapshot.run
          return updated
        }
        return [snapshot.run, ...current]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 20)
      })
      setCoordinatorSnapshots((current) => {
        const updated = new Map(current)
        updated.set(runId, snapshot)
        return updated
      })
    }
    void refresh()
    const unsubscribe = subscribeTuiProtocolRunChanges((runId) => {
      if (runId === null) {
        void refresh()
        return
      }
      changedRunIds.add(runId)
      if (pushTimer) clearTimeout(pushTimer)
      pushTimer = setTimeout(() => {
        const ids = [...changedRunIds]
        changedRunIds.clear()
        void Promise.all(ids.map(refreshChangedRun))
      }, COORDINATOR_PUSH_DEBOUNCE_MS)
    })
    const timer = setInterval(refresh, unsubscribe ? COORDINATOR_RECONCILE_MS : COORDINATOR_FALLBACK_POLL_MS)
    return () => {
      cancelled = true
      unsubscribe?.()
      if (pushTimer) clearTimeout(pushTimer)
      clearInterval(timer)
    }
  }, [sidebarView])

  const coordinatorEntries = useMemo(
    () => buildCoordinatorEntries(coordinatorRuns, coordinatorSnapshots),
    [coordinatorRuns, coordinatorSnapshots],
  )
  const coordinatorAgentEntries = useMemo(
    () => coordinatorEntries.filter((entry): entry is Extract<CoordinatorSidebarEntry, { type: 'agent' }> => entry.type === 'agent'),
    [coordinatorEntries],
  )
  const moveCoordinatorSelection = useEffectEvent((delta: number) => {
    if (coordinatorAgentEntries.length === 0) return
    const currentPos = coordinatorAgentEntries.findIndex((entry) => entry.key === coordinatorSelectedKey)
    const nextPos = clamp((currentPos >= 0 ? currentPos : 0) + delta, 0, coordinatorAgentEntries.length - 1)
    setCoordinatorSelectedKey(coordinatorAgentEntries[nextPos]?.key ?? null)
  })
  const jumpCoordinatorSelection = useEffectEvent((edge: 'first' | 'last') => {
    const target = edge === 'first' ? coordinatorAgentEntries[0] : coordinatorAgentEntries.at(-1)
    if (target) setCoordinatorSelectedKey(target.key)
  })
  const openSelectedCoordinatorAgent = useEffectEvent(() => {
    const selected = coordinatorAgentEntries.find((entry) => entry.key === coordinatorSelectedKey)
    if (selected) openCoordinationAgentSession(selected.agent)
  })
  const composerDraftLines = composerDraft.length === 0 ? 1 : composerDraft.split('\n').length
  const composerHeight = transcriptView === 'chat'
    ? Math.max(CHAT_COMPOSER_MIN_HEIGHT, composerDraftLines + CHAT_COMPOSER_CHROME_HEIGHT)
    : Math.max(COMPOSER_MIN_HEIGHT, Math.min(COMPOSER_MAX_HEIGHT, composerDraftLines + COMPOSER_DOCK_CHROME_HEIGHT))
  const composerDockHeight = composerWindowOpen || composerHidden ? 0 : composerHeight
  const composerDockTextareaHeight = transcriptView === 'chat'
    ? Math.max(1, composerDockHeight - CHAT_COMPOSER_CHROME_HEIGHT)
    : Math.max(2, composerDockHeight - COMPOSER_DOCK_CHROME_HEIGHT)
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
  const filteredModelPickerOptions = useMemo(
    () => filterModelPickerOptions(modelPickerOptions, modelPickerQuery),
    [modelPickerOptions, modelPickerQuery],
  )
  const highlightedModelPickerOption = filteredModelPickerOptions[modelPickerIndex]
  const modelPickerEffortOptions = useMemo(
    () => effortPickerOptions(modelPickerTarget?.provider, highlightedModelPickerOption),
    [highlightedModelPickerOption, modelPickerTarget?.provider],
  )
  const modelPickerPermissionLabel = modelPickerTarget?.provider === 'codex' ? 'APPROVALS' : 'PERMISSIONS'
  const modelPickerPermissionValue = modelPickerTarget?.provider === 'claude'
    ? tuiPermissionModeByKey[sessionKey(modelPickerTarget)] ?? 'default'
    : modelPickerTarget?.provider === 'codex'
      ? tuiCodexApprovalByKey[sessionKey(modelPickerTarget)] ?? 'auto'
      : modelPickerTarget?.provider === 'copilot'
        ? tuiCopilotPermissionModeByKey[sessionKey(modelPickerTarget)] ?? 'off'
        : 'native'
  const compactModelPickerEffortOptions = useMemo(
    () => modelPickerEffortOptions.map((option) => ({ name: option.name, value: option.value, description: '' })),
    [modelPickerEffortOptions],
  )
  const compactModelPickerPermissionOptions = useMemo(
    () => modelPickerPermissionOptions.map((option) => ({ name: option.name, value: option.value, description: '' })),
    [modelPickerPermissionOptions],
  )
  const modelPickerFocusedOption = modelPickerFocus === 'model'
    ? highlightedModelPickerOption
    : modelPickerFocus === 'effort'
      ? modelPickerEffortOptions[modelPickerEffortIndex]
      : modelPickerPermissionOptions[modelPickerPermissionIndex]
  const modelPickerFocusedLabel = modelPickerFocus === 'model'
    ? 'MODEL'
    : modelPickerFocus === 'effort'
      ? 'EFFORT'
      : modelPickerPermissionLabel
  const modelPickerFocusedDescription = modelPickerFocusedOption?.description
    || String(modelPickerFocusedOption?.value ?? '')
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
    if (composerCurrentModel) {
      parts.push({ text: `model:${composerCurrentModel}`, fg: composerAccentColor })
    } else if (composerTargetSession?.provider && composerTargetSession.provider !== 'claude-acp' && composerTargetSession.provider !== 'codex-acp') {
      // Custom-model providers (LM Studio, opencode/copilot custom endpoints,
      // Claude on a non-default deployment) can take a moment to report their
      // current model on a cold session — surface that instead of silently
      // omitting the chip, so it's clear a send won't yet know which model
      // it's hitting.
      parts.push({ text: 'model:loading…', fg: theme.dim })
    }
    if (composerContextUsage) parts.push({ text: `ctx:${composerContextUsage}`, fg: theme.green })
    parts.push({ text: `effort:${tuiEffort}`, fg: theme.amber })
    if (composerTargetSession?.provider === 'opencode' && tuiOpenCodeAgent) {
      parts.push({ text: `agent:${tuiOpenCodeAgent}`, fg: theme.cyan })
    }
    if (composerTargetSession?.provider === 'claude' && composerPermissionMode !== 'default') {
      parts.push({ text: `mode:${composerPermissionMode}`, fg: theme.violet })
    }
    if (composerTargetSession?.provider === 'codex' && composerCodexApproval !== 'auto') {
      parts.push({ text: `approvals:${composerCodexApproval}`, fg: theme.violet })
    }
    if (composerTargetSession?.provider === 'copilot' && tuiCopilotMode !== 'interactive') {
      parts.push({ text: `mode:${tuiCopilotMode}`, fg: theme.cyan })
    }
    if (composerTargetSession?.provider === 'copilot' && composerCopilotPermissionMode !== 'off') {
      parts.push({ text: `permissions:${composerCopilotPermissionMode}`, fg: composerCopilotPermissionMode === 'on' ? theme.red : theme.amber })
    }
    if (composerTargetSession?.provider === 'claude' && composerEnableWorkflow) {
      parts.push({ text: 'workflow:on', fg: theme.cyan })
    }
    return parts
  }, [composerAccentColor, composerCodexApproval, composerContextUsage, composerCopilotPermissionMode, composerCurrentModel, composerEnableWorkflow, composerPermissionMode, composerTargetSession?.provider, theme.amber, theme.cyan, theme.dim, theme.green, theme.red, theme.violet, tuiCopilotMode, tuiEffort, tuiOpenCodeAgent])
  const composerKnobsChip = useMemo(
    () => composerKnobSegments.length > 0
      ? `· ${composerKnobSegments.map((part) => part.text).join(' · ')}`
      : '',
    [composerKnobSegments],
  )
  const composerWorkingDirectory = composerTargetSessionInfo?.cwd ?? composerTargetSession?.cwd ?? null
  const composerGitBranch = composerTargetSessionInfo?.gitBranch ?? null
  const [composerGitSummary, setComposerGitSummary] = useState<GitSummary | null>(null)
  useEffect(() => {
    if (!composerWorkingDirectory) {
      setComposerGitSummary(null)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    setComposerGitSummary(null)
    const refresh = async () => {
      const summary = await fetchGitSummary(composerWorkingDirectory, runGitCommand)
      if (cancelled) return
      setComposerGitSummary(summary)
      timer = setTimeout(() => { void refresh() }, COMPOSER_GIT_SUMMARY_POLL_MS)
    }
    void refresh()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [composerWorkingDirectory])
  const composerLocationSegments = useMemo<InlineTextSegment[]>(() => {
    const parts: InlineTextSegment[] = []
    if (composerWorkingDirectory) parts.push({ text: `${composerWorkingDirectory}  `, fg: theme.dim })
    const branch = composerGitSummary?.branch ?? composerGitBranch
    if (branch) parts.push({ text: branch, fg: theme.green })
    if (composerGitSummary?.modified) parts.push({ text: `  ~${composerGitSummary.modified}`, fg: theme.amber })
    if (composerGitSummary?.untracked) parts.push({ text: `  ?${composerGitSummary.untracked}`, fg: theme.dim })
    if (composerGitSummary?.stashes) parts.push({ text: `  *${composerGitSummary.stashes}`, fg: theme.amber })
    if (selectedWorktreeTask) {
      const counts = [
        selectedWorktreeTask.dirtyFiles > 0 ? `${selectedWorktreeTask.dirtyFiles} dirty` : null,
        selectedWorktreeTask.aheadCommits > 0 ? `+${selectedWorktreeTask.aheadCommits}` : null,
      ].filter(Boolean).join(' ')
      parts.push({ text: ` · ⧉ worktree task${counts ? ` · ${counts}` : ''}`, fg: theme.amber })
    }
    return parts
  }, [composerGitBranch, composerGitSummary, composerWorkingDirectory, selectedWorktreeTask, theme.amber, theme.dim, theme.green])
  const buildComposerStatsSegments = (lineCount: number): InlineTextSegment[] => {
    const segments: InlineTextSegment[] = []
    if (composerDraft.length === 0) {
      segments.push({ text: ` ${composerConfig.label} `, fg: theme.surface, bg: composerAccentColor })
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
      segments.push(...composerLocationSegments)
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
  useEffect(() => {
    if (!modelPickerOpen) return
    const index = modelPickerPermissionOptions.findIndex((option) => option.value === modelPickerPermissionValue)
    setModelPickerPermissionIndex(index >= 0 ? index : 0)
  }, [modelPickerOpen, modelPickerPermissionOptions, modelPickerPermissionValue])
  useEffect(() => {
    if (!modelPickerOpen) return
    setModelPickerIndex((current) => Math.min(current, Math.max(filteredModelPickerOptions.length - 1, 0)))
  }, [filteredModelPickerOptions.length, modelPickerOpen])
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

  const composerAffordancesCacheRef = useRef(new Map<string, {
    commands: SlashCommandSuggestion[]
    options: Awaited<ReturnType<typeof readViewSessionComposerOptions>>
    ts: number
  }>())
  // Composer affordances (slash commands, agent pickers). For Claude,
  // readViewSessionSlashCommands SPAWNS a full `claude` CLI subprocess
  // (createSessionControlQuery → query({resume}), ~1–3s of a CPU core) — so:
  // - never track the live selection or a raw `selectedSession` object (one
  //   spawn per scrub step / per 5s sessions poll — the original progressive
  //   scrub slowdown);
  // - key on the SETTLED committedSessionKey with a per-session TTL cache so
  //   revisits spawn nothing;
  // - for Claude, DON'T fetch on settle at all. Scrubbing across N distinct
  //   sessions still spawned one CLI per settle, sustaining 3–5 concurrent
  //   node processes for the whole scrub — enough system CPU pressure to
  //   starve the render loop for seconds (measured: multi-second commit gaps
  //   mid-scrub). Slash commands and agent pickers only matter once the user
  //   actually engages the composer, so the Claude fetch is deferred to
  //   composerActive. Other providers answer over their SDK/server (no
  //   subprocess) and keep the eager fetch, e.g. for the OpenCode agent chip.
  const committedSessionKeyRef = useRef<string | null>(null)
  useEffect(() => { committedSessionKeyRef.current = committedSessionKey }, [committedSessionKey])
  const composerAffordancesInFlightRef = useRef(new Set<string>())
  const clearComposerAffordances = useCallback(() => {
    setComposerLiveSlashCommands([])
    setComposerAgentOptions([])
    setComposerMentionAgents([])
    setTuiOpenCodeAgent('')
  }, [])
  const applyComposerAffordances = useCallback((
    target: Session,
    commands: SlashCommandSuggestion[],
    composerOptions: Awaited<ReturnType<typeof readViewSessionComposerOptions>>,
  ) => {
    setComposerLiveSlashCommands(commands)
    const agentOptions = composerOptions.agents ?? []
    setComposerAgentOptions(agentOptions)
    setComposerMentionAgents(composerOptions.mentionAgents ?? [])
    if (target.provider === 'opencode') {
      const currentAgent = composerOptions.currentAgent
      setTuiOpenCodeAgent(
        currentAgent && agentOptions.some((agent) => agent.value === currentAgent)
          ? currentAgent
          : agentOptions[0]?.value ?? '',
      )
    } else {
      setTuiOpenCodeAgent('')
    }
  }, [])
  const fetchComposerAffordances = useCallback(async (target: Session, key: string) => {
    if (composerAffordancesInFlightRef.current.has(key)) return
    composerAffordancesInFlightRef.current.add(key)
    try {
      const [live, composerOptions] = await Promise.all([
        readTuiSlashCommands(target.sessionId, target.provider),
        readTuiComposerOptions(target.sessionId, target.provider),
      ])
      const commands = live.map((entry) => ({
        command: entry.command,
        description: entry.description,
        argumentHint: entry.argumentHint && entry.argumentHint.trim() ? entry.argumentHint.trim() : undefined,
      }))
      // Cache even when the session has changed since — the work is done, and
      // the next visit to this session should not spawn again.
      touchMapEntry(composerAffordancesCacheRef.current, key, {
        commands,
        options: composerOptions,
        ts: Date.now(),
      })
      while (composerAffordancesCacheRef.current.size > COMPOSER_AFFORDANCES_CACHE_MAX) {
        const oldest = composerAffordancesCacheRef.current.keys().next().value
        if (oldest === undefined) break
        composerAffordancesCacheRef.current.delete(oldest)
      }
      if (committedSessionKeyRef.current === key) applyComposerAffordances(target, commands, composerOptions)
    } catch {
      if (committedSessionKeyRef.current === key) clearComposerAffordances()
    } finally {
      composerAffordancesInFlightRef.current.delete(key)
    }
  }, [applyComposerAffordances, clearComposerAffordances])
  useEffect(() => {
    const target = transcriptSession
    if (!target || !committedSessionKey) {
      clearComposerAffordances()
      return
    }
    const cached = composerAffordancesCacheRef.current.get(committedSessionKey)
    if (cached && Date.now() - cached.ts < COMPOSER_AFFORDANCES_TTL_MS) {
      applyComposerAffordances(target, cached.commands, cached.options)
      return
    }
    // Don't let the previous session's commands/agents linger while (or
    // whether) this session's fetch runs.
    clearComposerAffordances()
    if ((target.provider ?? 'claude') === 'claude' && !composerActiveRef.current) return
    void fetchComposerAffordances(target, committedSessionKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedSessionKey, fetchComposerAffordances])
  // Composer engagement: warm the send path while the user types, then fetch
  // the deferred Claude affordances. Prewarm spawns the pool Query the send
  // will attach to (removing the ~1-3s CLI boot from first-token latency) or
  // resumes the Codex thread; running the affordances fetch AFTER it lets the
  // Claude branch reuse the warm Query instead of spawning a second CLI.
  const composerPrewarmInFlightRef = useRef(new Set<string>())
  useEffect(() => {
    if (!composerActive) return
    const target = transcriptSession
    if (!target || !committedSessionKey) return
    const fullSession = sessionsByKeyRef.current.get(committedSessionKey)
    const isPending = fullSession?.isPending === true
    // Pi's ~19s cold open is what prewarm hides for a pending session
    // (createPiAgentSession is idempotent on the id). Claude also benefits:
    // prewarmViewSession forces the SDK to adopt the reserved id as its real
    // session id, so the first real send finds a warm pool entry instead of
    // cold-spawning. Pending Codex/Copilot sessions still have no resumable
    // identity yet, so prewarmViewSession no-ops them — skip the work here too.
    if (isPending && target.provider !== 'pi' && target.provider !== 'claude') return
    const needsAffordances = !isPending && (() => {
      const cached = composerAffordancesCacheRef.current.get(committedSessionKey)
      return !cached || Date.now() - cached.ts >= COMPOSER_AFFORDANCES_TTL_MS
    })()
    let cancelled = false
    const prewarm = composerPrewarmInFlightRef.current.has(committedSessionKey)
      ? Promise.resolve()
      : (() => {
          composerPrewarmInFlightRef.current.add(committedSessionKey)
          return prewarmTuiSession(
            { ...target, cwd: fullSession?.cwd },
            {
              model: tuiModelOverride[committedSessionKey] || undefined,
              effort: tuiEffort === 'auto' ? undefined : tuiEffort,
              isPending,
            },
          ).catch(() => { /* best-effort: the send pays the usual cold cost */ })
            .finally(() => { composerPrewarmInFlightRef.current.delete(committedSessionKey) })
        })()
    if (needsAffordances) {
      void prewarm.then(() => {
        if (!cancelled) void fetchComposerAffordances(target, committedSessionKey)
      })
    }
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerActive, committedSessionKey, fetchComposerAffordances, tuiEffort, tuiModelOverride])
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
    const nextMention = !mention || (dismissedStart !== null && mention.start === dismissedStart)
      ? null
      : mention
    if (nextMention && (!composerMention || composerMention.start !== nextMention.start || composerMention.query !== nextMention.query)) {
      setComposerMentionIndex(0)
    }
    setComposerMention((current) => {
      if (!nextMention) return current ? null : current
      return current && current.start === nextMention.start && current.query === nextMention.query ? current : nextMention
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
    || activeQueuedComposerSends.length > 0
    || (composerSendState === 'sending' && (composerLiveText || activeRunningToolCount > 0))
    // Steered notices render while a turn runs, owned or reattached — count
    // them even before the turn streams any output.
    || (steeredSendNotice && (composerSendState === 'sending' || reattachedRunning))
  )
  const composerStatusBlockHeight = (() => {
    let rows = 0
    if (
      composerSendState === 'sending'
      && !composerLiveText
      && !composerLiveReasoning.trim()
      && activeRunningToolCount === 0
    ) rows += 2
    if (hasSubagentTail) rows += 2
    if (liveToolActivities.length > 0 && activeRunningToolCount > 0) rows += 2
    if (livePromptSuggestion && composerSendState !== 'sending') rows += 2
    if (composerTargetSession?.provider === 'claude' && composerPermissionMode !== 'default') rows += 2
    if (hasComposerStatusMessage) {
      const streamingResponse = composerSendState === 'sending' && composerLiveText && !composerError
      rows += streamingResponse
        ? isChatLikeView || liveAssistantTextCardVisible ? 0 : LIVE_PREVIEW_HEIGHT
        : 2
    }
    if (awaitingPersistedTurn) rows += 2
    if (composerAutoTargetingRunning && composerTargetSession) rows += 1
    if ((liveStatus === 'retrying' || liveStatus === 'compacting') && composerSendState === 'sending') rows += 2
    if (composerSendState === 'sending' && composerLiveReasoning.trim() && transcriptView !== 'stream') rows += LIVE_PREVIEW_HEIGHT
    // Reattached-turn banner (rendered when a turn runs without an owned stream).
    if (composerSendState !== 'sending' && reattachedRunning && !awaitingPersistedTurn) rows += 2
    if (pendingPermissions.length > 0) {
      const permission = pendingPermissions[0]!
      const questions = permission.questions ?? []
      if (questions.length > 0) {
        // The AskUserQuestion picker renders one row per question plus one per
        // option, so it must be measured question-by-question — the flat
        // permission budget below leaves it too few rows and the option lines
        // composite on top of the question line.
        // border(2) + outer padding(1) + title(1) + hint(1)
        let questionRows = 5
        for (const question of questions) {
          // Questions after the first carry a blank marginTop row.
          questionRows += 1 + question.options.length + (question.allowFreeform ? 1 : 0)
        }
        questionRows += questions.length - 1
        rows += questionRows
      } else {
        const permInnerWidth = Math.max(width - 8, 20)
        // border(2) + outer padding(1) + title(1) + options marginTop(1)
        // + options(1) + hint(1)
        let permRows = 7
        if (permission.toolName === 'ExitPlanMode') {
          const planLines = permission.plan ? permission.plan.split('\n') : []
          permRows += Math.min(planLines.length, 16)
          if (planLines.length > 16) permRows += 1
          if (permission.allowedPrompts && permission.allowedPrompts.length > 0) permRows += 1
        } else {
          // The reason renders with word wrap, so it can take several rows.
          if (permission.reason) permRows += Math.max(Math.ceil(permission.reason.length / permInnerWidth), 1)
          if (permission.command) permRows += Math.min(permission.command.split('\n').length, 12)
          if (permission.url) permRows += 1
          if (permission.paths && permission.paths.length > 0) permRows += 1
          if (permission.diff) permRows += Math.min(permission.diff.split('\n').length, 12)
        }
        rows += permRows
      }
    }
    return rows
  })()
  // Chat mode renders the composer bar as the reader box's own trailing child
  // (inside its border) rather than a sibling row below it, so its height comes
  // out of the scrollbox's budget (transcriptViewportRows), not this one.
  const mainContentHeight = Math.max(
    height
    - 3
    - (searchMode || sessionSearchMode ? 4 : 1)
    - (transcriptView === 'chat' ? 0 : composerDockHeight)
    - composerPopoverHeight
    - composerStatusBlockHeight,
    8,
  )
  const effectiveTaskPanelWidth = taskPanelOpen ? taskPanelWidth : 0
  const maxSidebarWidth = Math.max(MIN_SIDEBAR_WIDTH, width - 4 - 1 - MIN_READER_WIDTH - effectiveTaskPanelWidth - (taskPanelOpen ? 1 : 0))
  const sidebarWidth = showRail ? clamp(sidebarWidthPreference, MIN_SIDEBAR_WIDTH, maxSidebarWidth) : 0
  const readerAreaWidth = Math.max(width - 4 - sidebarWidth - (showRail ? 1 : 0) - effectiveTaskPanelWidth - (taskPanelOpen ? 1 : 0), 40)
  // Split panes take their width out of the reader area, so `rightPaneWidth`
  // (the primary transcript's layout width, threaded through every card) keeps
  // being the single source of truth for the reader. Panes are dropped one at a
  // time until both they and the reader clear their minimum widths, so shrinking
  // the terminal degrades to fewer panes instead of unreadable ones.
  const splitCandidateSessions = openTabSessions.filter((tab) => sessionKey(tab) !== selectedSessionKey)
  // Resolve pins to live tab objects. A pin whose tab closed, or that the user
  // navigated into (it is now the reader), resolves to nothing and its pane
  // simply doesn't mount this frame — the reconcile effect repairs the list.
  const splitPinnedSessions = splitPinnedKeys.flatMap((pinnedKey) => {
    if (pinnedKey === selectedSessionKey) return []
    const tab = openTabSessions.find((candidate) => sessionKey(candidate) === pinnedKey)
    return tab ? [tab] : []
  })
  const splitLayout = calculateSplitPaneLayout({
    readerAreaWidth,
    requestedCount: splitPaneCount,
    availableCount: splitPinnedSessions.length,
    maxPanes: SPLIT_PANE_MAX,
    minPaneWidth: SPLIT_PANE_MIN_WIDTH,
    minReaderWidth: MIN_READER_WIDTH,
  })
  const visibleSplitPaneCount = splitLayout.visibleCount
  const splitPaneWidth = splitLayout.paneWidth
  const splitPaneSessions = visibleSplitPaneCount > 0
    ? splitPinnedSessions.slice(0, visibleSplitPaneCount)
    : []
  const rightPaneWidth = splitLayout.readerWidth
  const splitPaneKeys = splitPaneSessions.map((pane) => sessionKey(pane))
  const splitPaneKeysSignature = splitPaneKeys.join('\u0000')
  // Live slices for the split panes. The app-wide live list is already tagged
  // by session, so a pane needs no second subscription — but each slice keeps
  // its array identity across polls (the same trick the reader uses) so an idle
  // pane's card pipeline bails out instead of reformatting every 2s.
  const splitPaneLiveCacheRef = useRef(new Map<string, ThreadedMessage[]>())
  const splitPaneLiveMessages = useMemo(() => {
    const cache = splitPaneLiveCacheRef.current
    return groupItemsBySplitPaneKey(
      splitPaneKeys,
      liveTranscriptMessages,
      liveMessageSessionKey,
      cache,
    )
  }, [liveTranscriptMessages, splitPaneKeysSignature])
  useEffect(() => {
    splitPaneLiveCacheRef.current = splitPaneLiveMessages
  }, [splitPaneLiveMessages])

  // Which pane sessions have a turn in flight — drives the ◐ running glyph and
  // the working spinner, so a background agent's activity is visible without
  // switching to its tab.
  const splitPaneRunningKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const running of runningSessions) {
      keys.add(`${running.provider ?? 'claude'}:${running.sessionId}`)
    }
    return keys
  }, [runningSessions])

  const textareaInnerWidth = Math.max(rightPaneWidth - 4, 10)
  const composerDockTextareaWidth = Math.max(width - 4, 20)
  const composerVisualLineCount = composerDraft.length === 0
    ? 1
    : composerDraft.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / textareaInnerWidth)), 0)
  const composerWindowWidth = Math.max(
    20,
    Math.min(
      Math.max(width - 4, 20),
      Math.max(64, Math.min(COMPOSER_WINDOW_MAX_WIDTH, Math.floor(width * 0.78))),
    ),
  )
  const composerWindowHeight = Math.max(
    10,
    Math.min(
      Math.max(height - 4, 10),
      Math.max(14, Math.min(COMPOSER_WINDOW_MAX_HEIGHT, Math.floor(height * 0.62))),
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
  const livePreviewContentWidth = Math.max(width - 8, 14)
  const liveAssistantPreviewLines = useMemo(
    () => wrapLivePreviewTail(composerLiveText, livePreviewContentWidth, LIVE_PREVIEW_BODY_LINES),
    [composerLiveText, livePreviewContentWidth],
  )
  const liveReasoningPreviewLines = useMemo(
    () => wrapLivePreviewTail(composerLiveReasoning, livePreviewContentWidth, LIVE_PREVIEW_BODY_LINES),
    [composerLiveReasoning, livePreviewContentWidth],
  )

  const isPreviewMode = tabsEnabled && !!selectedSessionKey && !openTabSessions.some((s) => sessionKey(s) === selectedSessionKey)
  const visibleTabSessions = useMemo(() => (
    isPreviewMode && selectedSession
      ? [...openTabSessions, selectedSession]
      : openTabSessions
  ), [isPreviewMode, openTabSessions, selectedSession])
  const showTabs = tabsEnabled && visibleTabSessions.length > 0
  const showPreviewBar = false
  // Panes are siblings of the reader COLUMN, which puts the tab strip above the
  // reader box. Without matching that offset a pane's top border shares the tab
  // strip's row and the two frames read as different windows.
  const splitPaneTopOffset = (showTabs || showPreviewBar) ? 1 : 0
  // Fall back to the arithmetic budget for the first frame, then track the
  // reader's measured frame so both sides always end on the same row.
  const splitPaneBoxHeight = Math.max(
    measuredReaderBoxHeight > 0 ? measuredReaderBoxHeight : mainContentHeight - 2 - splitPaneTopOffset,
    8,
  )
  const TAB_BAR_HEIGHT = 1
  const streamTurnFooterText = useMemo(() => {
    if (
      transcriptView !== 'stream'
      || composerSendState === 'sending'
      || reattachedRunning
      || awaitingPersistedTurn
    ) return null
    return streamCompletedTurnHint(visibleTranscriptCards)
  }, [awaitingPersistedTurn, composerSendState, reattachedRunning, transcriptView, visibleTranscriptCards])
  const streamActionFooterRows = isChatLikeView && transcriptView !== 'chat' && visibleTranscriptCards.length > 0 ? 1 : 0
  const transcriptViewportRows = Math.max(
    mainContentHeight
    - (focusMode ? 4 : 7)
    - (showTabs || showPreviewBar ? TAB_BAR_HEIGHT : 0)
    // Fleet strip is one header row when visible.
    - (fleetStripVisible ? 1 : 0)
    - streamActionFooterRows
    // The chat-mode composer bar lives inside this same bordered box, below
    // the scrollbox, so its rows come out of the viewport budget here.
    - (transcriptView === 'chat' && !composerWindowOpen && !composerHidden ? composerDockHeight : 0),
    8,
  )

  const activeTabIndex = useMemo(() => {
    if (!selectedSessionKey) return -1
    return visibleTabSessions.findIndex((s) => sessionKey(s) === selectedSessionKey)
  }, [selectedSessionKey, visibleTabSessions])

  const tabOptions = useMemo((): TabSelectOption[] => (
    visibleTabSessions.map((s) => {
      // A tab already mounted in a split pane is marked, so the strip explains
      // why selecting it swaps rather than opening a second copy.
      const splitPosition = splitPinnedKeys.indexOf(sessionKey(s))
      const inSplit = splitPosition >= 0 && splitPosition < splitPaneCount
      return {
        name: isPreviewMode && selectedSessionKey === sessionKey(s)
          ? `PREVIEW · ${formatSessionTitle(s)}`
          : inSplit
            ? `▏${formatSessionTitle(s)}`
            : formatSessionTitle(s),
        description: isPreviewMode && selectedSessionKey === sessionKey(s)
          ? 'Preview tab'
          : inSplit
            ? `in split pane ${splitPosition + 1}`
            : formatProviderLabel(s.provider ?? 'claude'),
        value: sessionKey(s),
      }
    })
  ), [isPreviewMode, selectedSessionKey, visibleTabSessions, splitPinnedKeys, splitPaneCount])

  const tabWidth = useMemo(() => {
    if (visibleTabSessions.length === 0) return 16
    // Fill available width proportionally so tabs look natural at any count,
    // capped to avoid very wide tabs when only a few sessions are open.
    // The strip spans the reader area (reader box plus any split panes), so
    // tabs get the full width instead of being squeezed into the reader column.
    const available = Math.max(readerAreaWidth - 6, 20)
    const fill = Math.floor(available / visibleTabSessions.length)
    return Math.max(10, Math.min(fill, 24))
  }, [readerAreaWidth, visibleTabSessions.length])
  const sidebarRowBudget = Math.max(mainContentHeight - 2, 4)
  const sidebarInnerWidth = Math.max(sidebarWidth - 5, 17)
  const showProviderInSessionRows = provider === 'all'
  const sidebarSessionCountLabel = normalizedSessionQuery
    ? `SESSIONS ${filteredSessionsForSidebar.length}/${Math.max(sessions.length, 0)}`
    : `SESSIONS ${Math.max(sessions.length, 0)}`
  const sidebarProviderLabel = provider === 'all' ? 'ALL' : formatProviderLabel(provider)
  const sidebarHeaderWidth = Math.max(sidebarInnerWidth, 12)
  const sidebarProviderBadgeText = ` ${fitText(sidebarProviderLabel, Math.max(sidebarHeaderWidth - 11, 3)).trimEnd()} `
  const sidebarHeaderPrefix = `${sidebarSessionCountLabel} · `
  const sidebarHeaderPrefixWidth = Math.min(
    sidebarHeaderPrefix.length,
    Math.max(sidebarHeaderWidth - sidebarProviderBadgeText.length - 1, 8),
  )
  const sidebarHeaderSuffix = ` · ${joinMeta([
    `sort ${sidebarSortLabel}`,
    normalizedSessionQuery ? `/${sessionSearchQuery}` : '/ search',
    'a agents',
  ])}`
  const sidebarHeaderSuffixWidth = Math.max(
    sidebarHeaderWidth - sidebarHeaderPrefixWidth - sidebarProviderBadgeText.length,
    0,
  )
  const sidebarHeaderBaseText = `${fitText(sidebarHeaderPrefix, sidebarHeaderPrefixWidth)}${sidebarProviderBadgeText}${
    sidebarHeaderSuffixWidth > 1 ? fitText(sidebarHeaderSuffix, sidebarHeaderSuffixWidth) : '·'
  }`
  const sidebarProviderAccent = getProviderAccent(provider)
  const coordinatorSidebarHeader = useMemo(
    () => fitText(
      joinMeta([`COORDINATOR ${coordinatorAgentEntries.length}`, `${coordinatorRuns.length} run${coordinatorRuns.length === 1 ? '' : 's'}`, 'a sessions']),
      Math.max(sidebarInnerWidth - 2, 12),
    ),
    [sidebarInnerWidth, coordinatorAgentEntries.length, coordinatorRuns.length],
  )
  // Mounted-card window. Browsing (sidebar focused) caps to the most-recent
  // PREVIEW_CARD_CAP cards so scrubbing never pays for a giant session; the
  // focused reader mounts a READER_CARD_WINDOW slice that follows the tail
  // (followTail) or the detached readerWindowStart anchor (slides/recenters).
  // This window bounds the ENTIRE per-card pipeline below (stableCardData →
  // allLandmarks → cardDisplayData → transcriptChildren), not just element
  // construction — and OpenTUI's scrollbox lays out every mounted card on
  // every commit (viewportCulling only skips paint), so it also bounds the
  // per-commit Yoga layout cost while reading.
  const totalTranscriptCards = visibleTranscriptCards.length
  let transcriptRenderStart: number
  let transcriptRenderEnd: number
  if (effectiveFocus !== 'messages') {
    transcriptRenderStart = Math.max(0, totalTranscriptCards - PREVIEW_CARD_CAP)
    transcriptRenderEnd = totalTranscriptCards
  } else if (totalTranscriptCards <= READER_CARD_WINDOW) {
    transcriptRenderStart = 0
    transcriptRenderEnd = totalTranscriptCards
  } else if (followTail || readerWindowStart == null) {
    transcriptRenderStart = totalTranscriptCards - READER_CARD_WINDOW
    transcriptRenderEnd = totalTranscriptCards
  } else {
    transcriptRenderStart = clamp(readerWindowStart, 0, totalTranscriptCards - READER_CARD_WINDOW)
    transcriptRenderEnd = transcriptRenderStart + READER_CARD_WINDOW
  }
  const renderedTranscriptCards = useMemo(
    () => transcriptRenderStart === 0 && transcriptRenderEnd === visibleTranscriptCards.length
      ? visibleTranscriptCards
      : visibleTranscriptCards.slice(transcriptRenderStart, transcriptRenderEnd),
    [transcriptRenderStart, transcriptRenderEnd, visibleTranscriptCards],
  )
  useLayoutEffect(() => {
    readerWindowGaugeRef.current = { start: transcriptRenderStart, end: transcriptRenderEnd, total: totalTranscriptCards }
  }, [totalTranscriptCards, transcriptRenderEnd, transcriptRenderStart])
  // Browse-mode preview renders every card COLLAPSED. Text cards are expanded
  // by default in conversation view, and an expanded card mounts its entire
  // body — for prompt-heavy sessions that means feeding 100KB+ of markdown to
  // OpenTUI's <markdown> renderable, whose marked lexer alone cost seconds of
  // main-thread time per scrub settle (CPU-profiled: ~25% in marked block
  // regexes). Collapsed bodies are truncated to densityState.bodyLines lines,
  // so a preview mount is bounded no matter what the cards contain. Expansion
  // state applies only once the reader pane is focused.
  const expandedKeysForRender = effectiveFocus === 'messages' || transcriptView === 'agents'
    ? resolvedExpandedKeys
    : EMPTY_EXPANDED_KEYS
  // Stable per-card data: body lines, diffs, code blocks. Cached by card reference so
  // when only one card's expansion toggles (transcriptCards ref unchanged), the other
  // cards reuse their prior StableCardData object — TranscriptCard memo then bails out.
  const stableCardCacheRef = useRef(new WeakMap<TuiTranscriptCard, {
    isExpanded: boolean
    bodyLineLimit: number
    thinkingFull: boolean
    agentsMode: boolean
    fullText: boolean
    value: StableCardData
  }>())
  const stableCardData = useMemo((): StableCardData[] => {
    const cache = stableCardCacheRef.current
    const profileStart = CARD_PROFILE ? performance.now() : 0
    let recomputed = 0
    const result = renderedTranscriptCards.map((card) => {
      const isExpanded = expandedKeysForRender.has(card.key)
      const thinkingFull = thinkingFullKeys.has(card.key)
      const agentsModeForCard = usesAgentCardPresentation(card, transcriptView)
      // Stream is a chronological transcript, not a collapsed card preview:
      // feed prose its untruncated formatter lines and let the text renderer
      // wrap them to the active transcript width. Technical cards stay bounded.
      const fullTextForCard = isChatLikeView
        && (card.category === 'conversation' || card.category === 'insight')
      const prev = cache.get(card)
      if (
        prev
        && prev.isExpanded === isExpanded
        && prev.bodyLineLimit === densityState.bodyLines
        && prev.thinkingFull === thinkingFull
        && prev.agentsMode === agentsModeForCard
        && prev.fullText === fullTextForCard
      ) {
        return prev.value
      }
      recomputed += 1
      const bodyLines = renderedBodyLines(
        card,
        isExpanded,
        densityState.bodyLines,
        thinkingFull,
        agentsModeForCard,
        fullTextForCard,
      )
      const diffView = cardDiffView(card, isExpanded)
      const codeBlockLineCounts = (isExpanded && card.codeBlocks)
        ? card.codeBlocks.map((cb) => countCodeBlockLines(cb.content))
        : []
      const value: StableCardData = { bodyLines, diffView, codeBlockLineCounts }
      cache.set(card, {
        isExpanded,
        bodyLineLimit: densityState.bodyLines,
        thinkingFull,
        agentsMode: agentsModeForCard,
        fullText: fullTextForCard,
        value,
      })
      return value
    })
    if (CARD_PROFILE) {
      logCardRecompute({
        scope: 'stableCardData',
        totalCards: renderedTranscriptCards.length,
        recomputed,
        liveCards: liveTranscriptMessagesForSession.length,
        durationMs: performance.now() - profileStart,
      })
    }
    return result
  }, [renderedTranscriptCards, expandedKeysForRender, densityState.bodyLines, thinkingFullKeys, transcriptView])

  const allLandmarksRef = useRef<CardLandmark[][] | null>(null)
  const allLandmarks = useMemo(() => {
    // Marker indices are absolute; shift them into window space. A marker that
    // falls before the preview window goes negative and simply never matches.
    const next = computeAllLandmarks(
      renderedTranscriptCards,
      resumeMarkerIndex - transcriptRenderStart,
      unreadBoundaryIndex - transcriptRenderStart,
      pendingNewCount,
      allLandmarksRef.current,
      isChatLikeView,
    )
    return next
  }, [renderedTranscriptCards, transcriptRenderStart, resumeMarkerIndex, unreadBoundaryIndex, pendingNewCount, transcriptView])
  useLayoutEffect(() => {
    allLandmarksRef.current = allLandmarks
  }, [allLandmarks])

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
    const result = renderedTranscriptCards.map((card, index) => {
      const isExpanded = expandedKeysForRender.has(card.key)
      // Latest = last card of the FULL transcript; a detached reader window
      // may end before it.
      const isLatest = transcriptRenderStart + index === totalTranscriptCards - 1
      const isAutoFoldedTechnical = (transcriptView === 'conversation' || transcriptView === 'agents') && card.autoFold && !isExpanded
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
      // BMP-safe category glyphs (all < U+FFFF, text presentation, no variation
      // selectors). The prior set used an astral wrench (U+1F527) and pencil/gear
      // with U+FE0F variation selectors; those rendered into every card header and
      // fed the native text-width/layout pass — exactly the documented Windows
      // render hazard and a candidate trigger for the opentui.dll layout-recursion
      // segfault.
      const categoryEmoji = isInsight ? '✦ ' : isTechnical ? '⚒ ' : isDiff ? '✎ ' : isSystem ? '⚙ ' : ''
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
        totalCards: renderedTranscriptCards.length,
        recomputed,
        liveCards: liveTranscriptMessagesForSession.length,
        durationMs: performance.now() - profileStart,
      })
    }
    return result
  }, [
    allLandmarks,
    stableCardData,
    renderedTranscriptCards,
    transcriptRenderStart,
    totalTranscriptCards,
    expandedKeysForRender,
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
  // Diff-note namespace tracks the session whose transcript is actually
  // displayed (the debounced `transcriptSession`), NOT the live selection.
  // Keying it off `selectedSessionIdentity` would (a) mislabel notes during the
  // open-debounce window when the old transcript is still showing, and (b) — far
  // worse for perf — make the `transcriptChildren` memo below rebuild all N card
  // elements on every scrub step, since it reads this value. Stable during a
  // scrub → the whole transcript subtree keeps element identity and React skips
  // reconciling it.
  const transcriptNoteNamespace = committedSessionKey ?? 'no-session'
  const selectAgentTool = useCallback((groupKey: string, toolKey: string) => {
    setAgentToolCursorByGroupKey((current) => current[groupKey] === toolKey ? current : { ...current, [groupKey]: toolKey })
  }, [])
  const transcriptCardVariantCacheRef = useRef(new WeakMap<TuiTranscriptCard, TranscriptCardVariantCacheEntry>())
  const transcriptCardVariants = useMemo(() => renderedTranscriptCards.map((card, i) => {
      // cardDisplayData/stableCardData are window-relative (index i); search
      // matches are absolute indices into visibleTranscriptCards.
      const absoluteIndex = transcriptRenderStart + i
      const display = cardDisplayData[i]
      if (!display) return null
      const isExpanded = expandedKeysForRender.has(card.key)
      const isSearchHit = searchMatchSet.has(absoluteIndex)
      const isActiveMatch = isSearchHit && activeMatchTargetIndex === absoluteIndex
      return cachedTranscriptCardSelectionVariants(transcriptCardVariantCacheRef.current, {
        card,
        display,
        theme,
        densityState,
        syntaxStyle,
        rightPaneWidth,
        isExpanded,
        isSearchHit,
        isActiveMatch,
        bookmarked: bookmarkKeys.has(card.key),
        onSelectCard: selectTranscriptCard,
        thinkingMode,
        diffLayout,
        imessageStyle,
        transcriptWidth,
        streamMode: isChatLikeView,
        agentsMode: usesAgentCardPresentation(card, transcriptView),
        agentToolCursorKey: groupedToolView ? agentToolCursorByGroupKey[card.key] ?? null : null,
        agentToolExpandedKeys: groupedToolView ? expandedCardKeys : EMPTY_EXPANDED_KEYS,
        agentToolCollapsedKeys: groupedToolView ? collapsedCardKeys : EMPTY_EXPANDED_KEYS,
        onSelectAgentTool: selectAgentTool,
        noteNamespace: transcriptNoteNamespace,
        diffNotes: transcriptDiffNotes,
        diffDraft: transcriptDiffDraft,
        hoveredDiffAnchor: hoveredTranscriptDiffAnchor,
        activateDiffHover: activateTranscriptDiffHover,
        openDiffNote: openTranscriptDiffNote,
        sendDiffNoteToComposer: sendTranscriptDiffNoteToComposer,
        diffPlain: transcriptDiffPlainCardKeys.has(card.key),
        diffShowLineNumbers: !transcriptDiffHiddenLineNumberCardKeys.has(card.key),
        diffShowHunkHeaders: !transcriptDiffHiddenHunkHeaderCardKeys.has(card.key),
        diffRowCursor: transcriptDiffRowCursorByCardKey[card.key] ?? 0,
        diffSelectionAnchor: transcriptDiffSelectionAnchorByCardKey[card.key] ?? null,
        diffPlainCardKeys: transcriptDiffPlainCardKeys,
        diffHiddenLineNumberCardKeys: transcriptDiffHiddenLineNumberCardKeys,
        diffHiddenHunkHeaderCardKeys: transcriptDiffHiddenHunkHeaderCardKeys,
        diffRowCursorByCardKey: transcriptDiffRowCursorByCardKey,
        diffSelectionAnchorByCardKey: transcriptDiffSelectionAnchorByCardKey,
        setDiffRowCursor: setTranscriptDiffRowCursorForCard,
        setDiffSelectionAnchor: setTranscriptDiffSelectionAnchorForCard,
      })
    }).filter((variant): variant is TranscriptCardSelectionVariants => variant !== null), [
    renderedTranscriptCards,
    transcriptRenderStart,
    cardDisplayData,
    expandedKeysForRender,
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
    transcriptWidth,
    transcriptView,
    groupedToolView,
    agentToolCursorByGroupKey,
    expandedCardKeys,
    collapsedCardKeys,
    selectAgentTool,
    transcriptNoteNamespace,
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
    transcriptDiffSelectionAnchorByCardKey,
    setTranscriptDiffSelectionAnchorForCard,
    setTranscriptDiffRowCursorForCard,
  ])
  const transcriptChildren = useMemo(() => {
    const cards: React.ReactNode[] = selectTranscriptCardVariants(
      transcriptCardVariants,
      transcriptCursorKey,
      effectiveFocus === 'messages',
    )
    if (transcriptRenderStart > 0) {
      cards.unshift(
        <box key="preview-cap-hint" paddingX={1}>
          <text fg={theme.dim} wrapMode="none">
            {fitText(
              effectiveFocus === 'messages'
                ? `↑ ${transcriptRenderStart} earlier message${transcriptRenderStart === 1 ? '' : 's'} — scroll up to load`
                : `↑ ${transcriptRenderStart} earlier message${transcriptRenderStart === 1 ? '' : 's'} — open the session (Enter) to view all`,
              rightPaneWidth - 2,
            )}
          </text>
        </box>,
      )
    }
    if (transcriptRenderEnd < totalTranscriptCards) {
      const laterCount = totalTranscriptCards - transcriptRenderEnd
      cards.push(
        <box key="reader-window-tail-hint" paddingX={1}>
          <text fg={theme.dim} wrapMode="none">
            {fitText(`↓ ${laterCount} later message${laterCount === 1 ? '' : 's'} — scroll down to load, G for latest`, rightPaneWidth - 2)}
          </text>
        </box>,
      )
    }
    return cards
  }, [
    transcriptCardVariants,
    transcriptRenderStart,
    transcriptRenderEnd,
    totalTranscriptCards,
    transcriptCursorKey,
    effectiveFocus,
    theme,
    rightPaneWidth,
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
      const nextSessions = await readTuiSessionsAsync(nextProvider)
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
    includeContextUsage = true,
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

      if (
        includeContextUsage
        && !isRunningSession
        && sessionContextUsageCacheRef.current.get(cacheKey)
      ) return
    }

    const metadataTtl = isSelectedTab
      ? (session.provider === 'claude' ? CLAUDE_METADATA_REFRESH_MS : DEFAULT_METADATA_REFRESH_MS)
      : (session.provider === 'claude' ? CLAUDE_BACKGROUND_METADATA_REFRESH_MS : DEFAULT_BACKGROUND_METADATA_REFRESH_MS)
    const lastMetadataFetch = sessionMetadataFetchedAtRef.current.get(cacheKey) ?? 0
    const hasCachedModel = Boolean(
      cachedDetailSnapshot?.info?.currentModel
      || detailSnapshot?.info?.currentModel
      || sessionDetailCacheRef.current.get(cacheKey)?.info?.currentModel
    )
    const hasCachedMetadata = hasCachedModel || (
      includeContextUsage && Boolean(sessionContextUsageCacheRef.current.get(cacheKey))
    )
    const metadataIsFresh = lastMetadataFetch > 0 && Date.now() - lastMetadataFetch < metadataTtl
    const shouldFetchMetadata = !sessionMetadataInFlightRef.current.has(cacheKey) && (
      !hasCachedMetadata && !metadataIsFresh
      || hasCachedMetadata && Date.now() - lastMetadataFetch >= metadataTtl
    )
    if (!shouldFetchMetadata) return

    const metadataRequestId = ++metadataRequestRef.current
    sessionMetadataInFlightRef.current.add(cacheKey)
    if (includeContextUsage && foreground && isSelectedTab) {
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
          if (includeContextUsage && foreground && isSelectedTab) {
            startTransition(() => setContextUsageStatus('unavailable'))
          }
          return
        }
        startTransition(() => {
          if (includeContextUsage && metadata.contextUsage) {
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
          if (includeContextUsage && !metadata.contextUsage && isSelectedTab) {
            setContextUsageStatus('unavailable')
          }
        })
      })
      .catch(() => {
        if (includeContextUsage && foreground && isSelectedTab) {
          startTransition(() => setContextUsageStatus('unavailable'))
        }
      })
      .finally(() => {
        sessionMetadataInFlightRef.current.delete(cacheKey)
      })
  }, [])

  const refreshSelectedSessionDetail = useCallback(async (session: Session, foreground = true) => {
    const cacheKeyForGuards = sessionKey(session)
    // Callers pass identity-stable skeleton sessions; pull lastModified from
    // the latest sessions list (see sessionsByKeyRef) or the guards below
    // never fire and every poll/settle re-reads the full session file.
    const sessionLastModified = typeof session.lastModified === 'number'
      ? session.lastModified
      : sessionsByKeyRef.current.get(cacheKeyForGuards)?.lastModified
    if (!foreground && (loadingDetailRef.current || backgroundRefreshInFlightRef.current.has(cacheKeyForGuards))) return
    // A live baseline normally means an owned stream is rendering the turn, so
    // background polls pause. Reattached turns have no stream — the poll is the
    // only way their progress lands, so keep polling those.
    if (
      !foreground
      && liveTranscriptBaselineRef.current.has(cacheKeyForGuards)
      && !awaitingPersistedTurnRef.current
      && reattachedRunningKeyRef.current !== cacheKeyForGuards
    ) return

    // Skip background polls when the session file hasn't changed since the
    // cached detail was populated — avoids re-reading and re-threading the
    // full message file every interval for idle sessions. Worst case the
    // sidebar's lastModified is stale and we skip one poll; the next sidebar
    // refresh catches us up.
    if (!foreground && !awaitingPersistedTurnRef.current && typeof sessionLastModified === 'number') {
      const recordedMtime = sessionDetailMtimeRef.current.get(cacheKeyForGuards)
      if (recordedMtime != null && recordedMtime >= sessionLastModified) return
    }
    // Cache-first for foreground loads — show the last-known detail immediately
    // rather than flashing a spinner while disk IO / JSON parsing runs. A
    // background refresh still fires below so the UI catches up.
    if (foreground) {
      // Coalesce FIRST, before touching the display: if a foreground load is
      // already running, the user is still scrubbing — just remember the latest
      // target and bail without rendering this fly-by session. The in-flight
      // load's finally runs the latest pending target when the worker frees, so
      // neither the worker queue nor the transcript view churns mid-scrub.
      if (foregroundLoadInFlightRef.current) {
        pendingForegroundLoadRef.current = session
        return
      }
      foregroundLoadInFlightRef.current = true

      // Worker idle → this is a settled open. Show the last-known detail
      // immediately (cache hit) rather than flashing a spinner while the
      // background refresh below runs.
      const cached = sessionDetailCacheRef.current.get(cacheKeyForGuards)
      if (cached) {
        setSessionDetail(cached)
        setLoadingDetail(false)
        if (!cached.info?.currentModel) {
          setTimeout(() => {
            refreshSessionMetadata(session, false, cached, cached, false)
          }, 0)
        }
        // Session file unchanged since the cached detail was read → the worker
        // re-read would return identical content. Skip it entirely so settling
        // on a recently-visited session costs nothing (the same guard the
        // background poll uses; the next sessions-list refresh catches a stale
        // lastModified). Never skip while a live turn is in flight.
        const recordedMtime = sessionDetailMtimeRef.current.get(cacheKeyForGuards)
        if (
          typeof sessionLastModified === 'number'
          && recordedMtime != null
          && recordedMtime >= sessionLastModified
          && !awaitingPersistedTurnRef.current
          && !liveTranscriptBaselineRef.current.has(cacheKeyForGuards)
        ) {
          setError((current) => current?.startsWith('Failed to load session detail') ? null : current)
          foregroundLoadInFlightRef.current = false
          const next = pendingForegroundLoadRef.current
          if (next) {
            pendingForegroundLoadRef.current = null
            void refreshSelectedSessionDetail(next, true)
          }
          return
        }
      } else {
        setLoadingDetail(true)
      }
    }
    // Take the request id only once this call is actually going to read.
    // Taking it before the coalesce branch above meant every DEFERRED call
    // (each scrub settle while a load was running) bumped the counter and
    // invalidated the in-flight read — whose completed result was then thrown
    // away wholesale, cache fill included. Scrubbing through big sessions
    // degenerated into a chain of full reads that never displayed and never
    // cached, which read as the TUI getting progressively slower.
    const requestId = ++detailRequestRef.current
    if (!foreground) backgroundRefreshInFlightRef.current.add(cacheKeyForGuards)
    setError((current) => current?.startsWith('Failed to load session detail') ? null : current)

    try {
      const detail = await readTuiSessionDetailAsync(session, densityRef.current, showToolCallsRef.current)
      // Cache the completed read BEFORE the staleness gate. A newer request
      // superseding this one only makes the result too old to display — the
      // read itself is still the freshest snapshot of this session, and
      // discarding it forced the next visit to pay the full read again.
      if (typeof sessionLastModified === 'number') {
        sessionDetailMtimeRef.current.set(cacheKeyForGuards, sessionLastModified)
      }
      const cacheKey = sessionKey(session)
      const pinnedKeys = new Set([
        ...openTabSessionsRef.current.map((openSession) => sessionKey(openSession)),
        selectedSessionKeyRef.current,
      ].filter((key): key is string => Boolean(key)))
      touchMapEntry(sessionDetailCacheRef.current, cacheKey, detail)
      if (detail.contextUsage) {
        touchMapEntry(sessionContextUsageCacheRef.current, cacheKey, detail.contextUsage)
      }
      pruneSessionCaches(
        sessionDetailCacheRef.current,
        sessionContextUsageCacheRef.current,
        sessionMetadataFetchedAtRef.current,
        pinnedKeys,
      )
      // Still scrubbing — a newer settle queued while this read ran. Cache
      // only (above); the chained call in `finally` opens the latest target,
      // so fly-by sessions never pay a transcript mount.
      if (foreground && pendingForegroundLoadRef.current) return
      if (requestId !== detailRequestRef.current) return
      const liveBaseline = liveTranscriptBaselineRef.current.get(cacheKeyForGuards)
      if (liveBaseline) {
        const durableSummary = summarizeDurableSessionMessages(detail.rawMessages)
        const persistedTurnArrived =
          durableSummary.count > liveBaseline.count
          || durableSummary.lastFingerprint !== liveBaseline.lastFingerprint
          || durableSummary.sequenceFingerprint !== liveBaseline.sequenceFingerprint
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
      startTransition(() => {
        const displayedDetail = sessionDetailRef.current
        const unchanged = displayedDetail !== null
          && displayedDetail.rawMessages.length === detail.rawMessages.length
          && sessionMessageFingerprint(displayedDetail.rawMessages.at(-1)) === sessionMessageFingerprint(detail.rawMessages.at(-1))
          && sessionMessageSequenceFingerprint(displayedDetail.rawMessages) === sessionMessageSequenceFingerprint(detail.rawMessages)
          && displayedDetail.info?.currentModel === detail.info?.currentModel
          && displayedDetail.info?.customTitle === detail.info?.customTitle
        if (unchanged) {
          // Keep the displayed and cached identities aligned so cache-first
          // revisits do not trigger a full transcript reformat on idle polls.
          touchMapEntry(sessionDetailCacheRef.current, cacheKey, displayedDetail)
        } else {
          setSessionDetail(detail)
        }
        if (detail.contextUsage && cacheKey === selectedSessionKeyRef.current) {
          setContextUsage(detail.contextUsage)
          setContextUsageStatus('ready')
        }
      })

      // Session detail is the transcript-critical path. If it could not report
      // a model, fill only that composer metadata in the background; context
      // usage remains disabled for open tabs.
      if (!detail.info?.currentModel) {
        setTimeout(() => {
          refreshSessionMetadata(session, false, detail, null, false)
        }, 0)
      }
    } catch (err) {
      if (requestId !== detailRequestRef.current) return
      // Only clear the view if we have nothing cached to fall back on — keeps
      // the last-known good detail visible during transient read failures.
      if (!sessionDetailCacheRef.current.has(cacheKeyForGuards)) setSessionDetail(null)
      setError(err instanceof Error ? `Failed to load session detail: ${err.message}` : 'Failed to load session detail')
    } finally {
      if (requestId === detailRequestRef.current && foreground) setLoadingDetail(false)
      if (!foreground) backgroundRefreshInFlightRef.current.delete(cacheKeyForGuards)
      if (foreground) {
        foregroundLoadInFlightRef.current = false
        // Run only the most-recent target requested while we were busy — every
        // session scrubbed past in between is skipped, so the worker never sees
        // a backlog.
        const next = pendingForegroundLoadRef.current
        if (next) {
          pendingForegroundLoadRef.current = null
          void refreshSelectedSessionDetail(next, true)
        }
      }
    }
  }, [refreshSessionMetadata])

  // Cache-only warm read for a sidebar neighbour. Never touches display state,
  // detailRequestRef, or loading/error flags — its only output is a filled
  // sessionDetailCache + mtime record, so the user's next settle on this
  // session takes refreshSelectedSessionDetail's cached-and-unchanged fast
  // path (instant open, no worker read).
  const prefetchSessionDetail = useCallback(async (session: Session): Promise<void> => {
    const key = sessionKey(session)
    if (backgroundRefreshInFlightRef.current.has(key)) return
    if (liveTranscriptBaselineRef.current.has(key)) return
    const lastModified = typeof session.lastModified === 'number'
      ? session.lastModified
      : sessionsByKeyRef.current.get(key)?.lastModified
    const cached = sessionDetailCacheRef.current.has(key)
    if (cached) {
      // Fresh enough already — and without an mtime to compare, whatever is
      // cached is good enough for a prefetch (the open's background refresh
      // catches real staleness).
      if (typeof lastModified !== 'number') return
      const recorded = sessionDetailMtimeRef.current.get(key)
      if (recorded != null && recorded >= lastModified) return
    }
    backgroundRefreshInFlightRef.current.add(key)
    try {
      const detail = await readTuiSessionDetailAsync(session, densityRef.current, showToolCallsRef.current)
      if (typeof lastModified === 'number') sessionDetailMtimeRef.current.set(key, lastModified)
      touchMapEntry(sessionDetailCacheRef.current, key, detail)
      if (detail.contextUsage) {
        touchMapEntry(sessionContextUsageCacheRef.current, key, detail.contextUsage)
      }
      const pinnedKeys = new Set([
        ...openTabSessionsRef.current.map((openSession) => sessionKey(openSession)),
        selectedSessionKeyRef.current,
      ].filter((pinned): pinned is string => Boolean(pinned)))
      pruneSessionCaches(
        sessionDetailCacheRef.current,
        sessionContextUsageCacheRef.current,
        sessionMetadataFetchedAtRef.current,
        pinnedKeys,
      )
    } catch {
      // Best-effort: a failed prefetch just means the eventual open pays the
      // normal read (which surfaces its own error if it also fails).
    } finally {
      backgroundRefreshInFlightRef.current.delete(key)
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
    const sessionEntries = sidebarEntries.flatMap((entry) => {
      const session = sidebarEntrySession(entry)
      return session ? [session] : []
    })
    if (sessionEntries.length === 0) return
    const selected = selectedIndex >= 0 ? sessions[selectedIndex] : null
    const currentPos = selected
      ? sessionEntries.findIndex((session) => sessionKey(session) === sessionKey(selected))
      : -1
    const nextPos = clamp((currentPos >= 0 ? currentPos : 0) + delta, 0, sessionEntries.length - 1)
    const next = sessionEntries[nextPos]
    if (next) {
      setSelectedSessionKey(sessionKey(next))
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

  const moveAgentToolCursor = useEffectEvent((delta: -1 | 1): boolean => {
    if (!groupedToolView) return false
    const groupCard = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
    if (!groupCard || !resolvedExpandedKeys.has(groupCard.key)) return false
    const toolCards = agentToolCardsFor(groupCard)
    if (toolCards.length === 0) return false
    const currentKey = agentToolCursorByGroupKey[groupCard.key] ?? null
    const currentIndex = currentKey
      ? toolCards.findIndex((toolCard) => toolCard.key === currentKey)
      : -1
    if (currentIndex === -1) {
      if (delta < 0) return false
      const first = toolCards[0]
      if (!first) return false
      setAgentToolCursorByGroupKey((current) => current[groupCard.key] === first.key ? current : { ...current, [groupCard.key]: first.key })
      return true
    }
    const nextIndex = currentIndex + delta
    if (nextIndex < 0 || nextIndex >= toolCards.length) return false
    const next = toolCards[nextIndex]
    if (!next) return false
    setAgentToolCursorByGroupKey((current) => current[groupCard.key] === next.key ? current : { ...current, [groupCard.key]: next.key })
    return true
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

  const toggleExpansion = useEffectEvent((scope: 'selected' | 'parent' = 'selected') => {
    const card = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
    if (!card) return
    const agentToolCards = groupedToolView && resolvedExpandedKeys.has(card.key)
      ? agentToolCardsFor(card)
      : []
    const agentToolKey = agentToolCursorByGroupKey[card.key] ?? null
    const selectedAgentTool = scope === 'selected' && agentToolKey
      ? agentToolCards.find((toolCard) => toolCard.key === agentToolKey) ?? null
      : null
    const targetCard = selectedAgentTool ?? card
    const isAgentToolTarget = selectedAgentTool !== null
    const shouldAutoFold = (
      transcriptView === 'conversation'
      || isChatLikeView
      || transcriptView === 'agents'
    ) && targetCard.autoFold
    const isExpanded = isAgentToolTarget
      ? agentToolCardIsExpanded(targetCard, expandedCardKeys, collapsedCardKeys)
      : resolvedExpandedKeys.has(targetCard.key)

    if (!isAgentToolTarget && !isExpanded && card.key.startsWith('agents-tools:')) {
      const firstTool = agentToolCardsFor(card)[0]
      if (firstTool) {
        setAgentToolCursorByGroupKey((current) => (
          current[card.key] === firstTool.key
            ? current
            : { ...current, [card.key]: firstTool.key }
        ))
      }
    }

    if (shouldAutoFold) {
      setCollapsedCardKeys((current) => {
        if (!current.has(targetCard.key)) return current
        const next = new Set(current)
        next.delete(targetCard.key)
        return next
      })
      setExpandedCardKeys((current) => {
        const next = new Set(current)
        if (isExpanded) next.delete(targetCard.key)
        else next.add(targetCard.key)
        return next
      })
      return
    }

    setExpandedCardKeys((current) => {
      if (!current.has(targetCard.key)) return current
      const next = new Set(current)
      next.delete(targetCard.key)
      return next
    })
    setCollapsedCardKeys((current) => {
      const next = new Set(current)
      if (isExpanded) next.add(targetCard.key)
      else next.delete(targetCard.key)
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
    setThemeMenuGroup(
      LIGHT_MODES.includes(themeMode) ? 'light' : OMZ_MODES.includes(themeMode) ? 'omz' : 'dark',
    )
    setThemeMenuQuery('')
    setThemeMenuOpen(true)
  })

  const closeThemeMenu = useEffectEvent(() => {
    const originTheme = themeMenuOriginRef.current
    setThemeMenuOpen(false)
    setThemeMenuQuery('')
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

  const openTranscriptViewMenu = useEffectEvent(() => {
    transcriptViewMenuOriginRef.current = transcriptView
    setTranscriptViewMenuIndex(Math.max(TRANSCRIPT_VIEWS.indexOf(transcriptView), 0))
    setTranscriptViewMenuOpen(true)
  })

  const closeTranscriptViewMenu = useEffectEvent(() => {
    const originView = transcriptViewMenuOriginRef.current
    setTranscriptViewMenuOpen(false)
    if (originView) {
      setTranscriptView(originView)
      setTranscriptViewMenuIndex(Math.max(TRANSCRIPT_VIEWS.indexOf(originView), 0))
    } else {
      setTranscriptViewMenuIndex(Math.max(TRANSCRIPT_VIEWS.indexOf(transcriptView), 0))
    }
    transcriptViewMenuOriginRef.current = null
  })

  const chooseTranscriptView = useCallback((nextView: TuiTranscriptView) => {
    setTranscriptView(nextView)
    setTranscriptViewMenuIndex(Math.max(TRANSCRIPT_VIEWS.indexOf(nextView), 0))
    transcriptViewMenuOriginRef.current = null
    void writeTuiTranscriptView(nextView).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store transcript view')
    })
    setTranscriptViewMenuOpen(false)
  }, [])

  const persistTheme = useCallback(() => {
    try { writeTuiThemeSync(currentThemeRef.current) } catch { /* best-effort */ }
  }, [])

  const confirmExit = useCallback(() => {
    if (exitInProgressRef.current) return
    exitInProgressRef.current = true
    setExitCleanupInProgress(true)
    scheduleWriteComposerQueue(queuedComposerSendsRef.current)
    flushComposerQueueWrites()

    const cleanupPromise = activeComposerSendCleanupRef.current
    const controller = composerAbortRef.current
    const activeTurnRequestId = activeComposerTurnRequestIdRef.current
    const activeTurnTarget = composerTargetSessionRef.current
    const runningRefs = [...runningSessionsRef.current]
    if (controller && !controller.signal.aborted) controller.abort()

    void (async () => {
      const cleanupTasks: Promise<unknown>[] = []
      if (activeTurnTarget && activeTurnRequestId) {
        cleanupTasks.push(interruptTuiSessionTurn({
          sessionId: activeTurnTarget.sessionId,
          provider: activeTurnTarget.provider,
          turnRequestId: activeTurnRequestId,
        }).catch(() => undefined))
      }
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
      showNotice('info', 'Pick a session first')
      return
    }
    setModelPickerTarget(target)
    setModelPickerFocus('model')
    setModelPickerError(null)
    setModelPickerOptions([])
    setModelPickerPermissionOptions([])
    setModelPickerQuery('')
    setModelPickerIndex(0)
    setModelPickerPermissionIndex(0)
    setModelPickerLoading(true)
    setModelPickerOpen(true)
    try {
      const [meta, composerOptions] = await Promise.all([
        readTuiSessionMetadata(target),
        readTuiComposerOptions(target.sessionId, target.provider),
      ])
      const permissionOptions = (composerOptions.permissionModes ?? []).map((mode): SelectOption => ({
        name: mode.label,
        value: mode.value,
        description: mode.description ?? '',
      }))
      setModelPickerPermissionOptions(permissionOptions)
      const reportedPermissionMode = composerOptions.currentPermissionMode
      if (target.provider === 'copilot' && (reportedPermissionMode === 'off' || reportedPermissionMode === 'auto' || reportedPermissionMode === 'on')) {
        setTuiCopilotPermissionModeByKey((prev) => ({ ...prev, [sessionKey(target)]: reportedPermissionMode }))
      }
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

  const applyModelPickerOption = useEffectEvent((selectedOption?: ModelPickerOption) => {
    const option = selectedOption ?? filteredModelPickerOptions[modelPickerIndex]
    const target = modelPickerTarget ?? composerTargetSession ?? selectedSession
    const value = typeof option?.value === 'string' ? option.value : ''
    if (!target || !value) return
    setTuiModelOverride((prev) => ({ ...prev, [sessionKey(target)]: value }))
    pushClaudeControl(target, { action: 'setModel', model: value })
    if (effortPickerOptions(target.provider, option).length > 1) {
      setModelPickerFocus('effort')
    } else if (modelPickerPermissionOptions.length > 0) {
      setTuiEffort('auto')
      setModelPickerFocus('permissions')
    } else {
      setTuiEffort('auto')
      setModelPickerOpen(false)
    }
  })

  const applyModelPickerEffort = useEffectEvent((value: string | undefined) => {
    if (value) setTuiEffort(value as TuiEffort)
    if (modelPickerPermissionOptions.length > 0) setModelPickerFocus('permissions')
    else setModelPickerOpen(false)
  })

  const applyModelPickerPermission = useEffectEvent((value: string | undefined) => {
    const target = modelPickerTarget ?? composerTargetSession ?? selectedSession
    if (!target || !value) return
    if (target.provider === 'claude' && CLAUDE_PERMISSION_MODE_ORDER.includes(value as TuiPermissionMode)) {
      setClaudeComposerPermissionMode(target, value as TuiPermissionMode)
    } else if (target.provider === 'codex' && (value === 'auto' || value === 'untrusted' || value === 'on-request' || value === 'never')) {
      setTuiCodexApprovalByKey((prev) => ({ ...prev, [sessionKey(target)]: value }))
    } else if (target.provider === 'copilot' && (value === 'off' || value === 'auto' || value === 'on')) {
      setTuiCopilotPermissionModeByKey((prev) => ({ ...prev, [sessionKey(target)]: value }))
      if (!target.isPending) {
        void runTuiSessionAction(target, {
          action: 'setPermissionMode',
          permissionMode: value,
        }).catch(() => { /* next send carries permissionMode */ })
      }
    }
    setModelPickerOpen(false)
  })

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false)
    setCommandPaletteQuery('')
    setCommandPaletteIndex(0)
  }, [])

  const filteredCommands = useMemo(() => {
    const bridgeFiltered = canUseChannelBridge
      ? COMMANDS
      : COMMANDS.filter((cmd) => cmd.id !== 'channel-bridge' && cmd.id !== 'channel-bridge-route')
    const availableCommands = canUseIdeBridge
      ? bridgeFiltered
      : bridgeFiltered.filter((cmd) => cmd.id !== 'ide-bridge' && cmd.id !== 'ide-bridge-route')
    const q = commandPaletteQuery.toLowerCase()
    if (!q) return availableCommands
    return availableCommands.filter((cmd) => cmd.label.toLowerCase().includes(q))
  }, [canUseChannelBridge, canUseIdeBridge, commandPaletteQuery])

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

  const refreshDiagnostics = useEffectEvent(async (sessionOverride?: Session) => {
    const target = sessionOverride ?? selectedSession
    if (!target) return
    setDiagnosticsLoading(true)
    setDiagnosticsError(null)
    try {
      const data = await readTuiSessionDiagnostics(target)
      setDiagnosticsSections(data.sections ?? [])
    } catch (err) {
      setDiagnosticsError(err instanceof Error ? err.message : 'Failed to load diagnostics')
    } finally {
      setDiagnosticsLoading(false)
    }
  })

  const openDiagnostics = useEffectEvent((sessionOverride?: Session) => {
    setDiagnosticsOpen(true)
    setDiagnosticsMcpIndex(0)
    void refreshDiagnostics(sessionOverride)
  })

  const closeDiagnostics = useCallback(() => {
    setDiagnosticsOpen(false)
    setDiagnosticsError(null)
    setDiagnosticsNotice(null)
    setDiagnosticsBusy(null)
  }, [])

  const runDiagnosticsAction = useEffectEvent(async (action: string, extra: Record<string, unknown>, busyKey: string) => {
    if (!selectedSession || selectedSession.provider !== 'claude') return null
    setDiagnosticsBusy(busyKey)
    setDiagnosticsError(null)
    setDiagnosticsNotice(null)
    try {
      const result = await runTuiSessionAction(selectedSession, { action, ...extra })
      if (action === 'resolveSettings') {
        const sources = typeof result.sourceCount === 'number'
          ? result.sourceCount
          : Array.isArray(result.sources) ? result.sources.length : null
        const effective = typeof result.effectiveKeyCount === 'number'
          ? result.effectiveKeyCount
          : Array.isArray(result.effectiveKeys) ? result.effectiveKeys.length : null
        setDiagnosticsNotice(`Settings resolved${sources == null ? '' : ` · ${sources} source${sources === 1 ? '' : 's'}`}${effective == null ? '' : ` · ${effective} effective key${effective === 1 ? '' : 's'}`}`)
      } else if (action === 'reloadSkills') {
        setDiagnosticsNotice('Skills reloaded')
      } else if (action === 'reloadPlugins') {
        setDiagnosticsNotice('Plugins reloaded')
      } else if (action === 'setMcpPermissionModeOverride') {
        const mode = extra.mode == null ? 'cleared' : `set to ${String(extra.mode)}`
        setDiagnosticsNotice(`MCP policy ${mode}`)
      } else if (action === 'setMcpServers') {
        const dynamicServers = Array.isArray(result.dynamicServers) ? result.dynamicServers.length : 0
        const authRequired = Array.isArray(result.authRequired)
          ? result.authRequired.filter((name): name is string => typeof name === 'string')
          : []
        const errors = result.errors && typeof result.errors === 'object' && !Array.isArray(result.errors)
          ? Object.keys(result.errors)
          : []
        setDiagnosticsNotice(
          authRequired.length > 0
            ? `Dynamic MCP updated · authentication required: ${authRequired.join(', ')}`
            : errors.length > 0
              ? `Dynamic MCP updated · connection failed: ${errors.join(', ')}`
              : `Dynamic MCP updated · ${dynamicServers} server${dynamicServers === 1 ? '' : 's'}`,
        )
      } else if (action === 'listHookEvents') {
        const events = Array.isArray(result.events) ? result.events as Array<Record<string, unknown>> : []
        const items = events.map((event) => `${String(event.timestamp ?? '')} · ${String(event.summary ?? event.event ?? 'Hook')}`)
        setDiagnosticsSections((sections) => sections.map((section) => section.id === 'hooks'
          ? { ...section, items: items.length > 0 ? items : ['None'] }
          : section))
        setDiagnosticsNotice(`Hook timeline · ${events.length} match${events.length === 1 ? '' : 'es'}`)
      }
      if (action !== 'listHookEvents') await refreshDiagnostics()
      return result
    } catch (err) {
      setDiagnosticsError(err instanceof Error ? err.message : 'Action failed')
      return null
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
    const current = tuiPermissionModeByKeyRef.current
    const next = current[targetKey] === nextMode ? current : { ...current, [targetKey]: nextMode }
    tuiPermissionModeByKeyRef.current = next
    setTuiPermissionModeByKey(next)
    pushClaudeControl(target, { action: 'setPermissionMode', permissionMode: nextMode })
  })

  const cycleClaudeComposerPermissionMode = useEffectEvent((target: Session | null | undefined) => {
    if (!target || target.provider !== 'claude') return
    const current = tuiPermissionModeByKeyRef.current[sessionKey(target)] ?? 'default'
    const currentIndex = CLAUDE_PERMISSION_MODE_ORDER.indexOf(current)
    const next = CLAUDE_PERMISSION_MODE_ORDER[(currentIndex + 1) % CLAUDE_PERMISSION_MODE_ORDER.length]!
    showToggleOutcome('Claude permission mode:', next)
    setClaudeComposerPermissionMode(target, next)
  })

  const cancelComposerSend = useEffectEvent(() => {
    const target = composerTargetSession
    // Turns are decoupled from the client connection (they survive disconnect),
    // so aborting the local fetch alone leaves the agent running on the server —
    // it would finish in the background and reappear on the next poll. Interrupt
    // the server-side turn too, matching the native CLI's Esc/Ctrl+C behavior.
    if (target && !target.isPending) {
      void interruptTuiSessionTurn({
        sessionId: target.sessionId,
        provider: target.provider,
        turnRequestId: activeComposerTurnRequestIdRef.current ?? undefined,
      }).then((stillQueued) => {
        if (stillQueued) {
          const survivorUuids = new Set(stillQueued)
          const restoreEntries = steeredComposerSendsRef.current
            .filter((entry) => entry.state === 'queued' && !survivorUuids.has(entry.messageUuid))
          const restoreTexts = restoreEntries.map((entry) => entry.text)
          if (restoreTexts.length > 0) {
            const restoredMessageUuids = new Set(restoreEntries.map((entry) => entry.messageUuid))
            const restoredLiveUuids = new Set(restoreEntries.map((entry) => entry.liveMessageUuid))
            steeredComposerSendsRef.current = steeredComposerSendsRef.current
              .filter((entry) => !restoredMessageUuids.has(entry.messageUuid))
            setLiveTranscriptMessages((prev) => prev.filter((message) => !restoredLiveUuids.has(message.uuid)))
            const currentDraft = composerTextareaRef.current?.plainText ?? composerDraft
            const restored = [currentDraft.trim(), ...restoreTexts].filter(Boolean).join('\n\n')
            composerTextareaRef.current?.setText(restored)
            setComposerDraft(restored)
          }
          if (stillQueued.length > 0) {
            toast.warning(`Interrupted · ${stillQueued.length} queued message${stillQueued.length === 1 ? '' : 's'} will still run`)
          } else if (restoreTexts.length > 0) {
            toast.info(`Interrupted · restored ${restoreTexts.length} cancelled queued message${restoreTexts.length === 1 ? '' : 's'}`)
          }
        }
      }).catch(() => { /* best effort */ })
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
    // Reattached turns have no local stream — the server interrupt above is
    // the whole cancel. Drop the flag and the poll's sidebar mark now; the
    // registry poll reconciles if the interrupt turns out to be a no-op.
    reattachedRunningKeyRef.current = null
    reattachedRunningRef.current = false
    setReattachedRunning(false)
    if (targetKey) {
      const reattachMark = reattachMarksRef.current.get(targetKey)
      if (reattachMark) {
        reattachMarksRef.current.delete(targetKey)
        clearSessionRunning(reattachMark)
      }
    }
    setInterruptPressActive(false)
    if (interruptPressTimeoutRef.current) {
      clearTimeout(interruptPressTimeoutRef.current)
      interruptPressTimeoutRef.current = null
    }
    setPendingPermissions([])
    setPermissionOptionIndex(0)
    // The user interrupted to change course — auto-firing queued follow-ups
    // would be a surprise-send. Pop their text back into the composer instead
    // (after any text typed since), so they can edit and re-send.
    const interruptQueue = selectComposerQueueTarget(queuedComposerSendsRef.current, targetKey)
    if (interruptQueue.length > 0) {
      commitQueuedComposerSends(clearComposerQueueTarget(queuedComposerSendsRef.current, targetKey))
      const currentDraft = composerTextareaRef.current?.plainText ?? composerDraft
      const restoredPayload = restoreComposerDraftPayload(
        { text: currentDraft, attachments: composerMentionAttachmentsRef.current },
        interruptQueue,
      )
      const restored = restoredPayload.text
      const restoredParts = [
        ...interruptQueue.flatMap((entry) => entry.promptParts),
        ...composerPromptPartsRef.current,
      ]
      composerTextareaRef.current?.setText(restored)
      setComposerDraft(restored)
      composerMentionAttachmentsRef.current = restoredPayload.attachments
      composerPromptPartsRef.current = restoredParts
      setComposerMentionAttachments(restoredPayload.attachments)
      setComposerPromptParts(restoredParts)
      restoreComposerPromptPartExtmarks(restoredParts, restored)
    }
    if (reconcileInterrupt) {
      // Keep committed partial cards (liveTranscriptMessages) + baseline for the
      // reconcile, but drop the transient streaming previews right away.
      setComposerSendState('idle')
      setAwaitingPersistedTurn(true)
      setLiveStatus(null)
      setComposerLiveText('')
      setComposerLiveReasoning('')
      setComposerThinkingTokens(0)
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
    if (liveTextFlushTimerRef.current != null) {
      clearTimeout(liveTextFlushTimerRef.current)
      liveTextFlushTimerRef.current = null
    }
    pendingLiveTextRef.current = ''
    pendingLiveReasoningRef.current = ''
    liveTextTargetSessionRef.current = null
    setComposerSendState('idle')
    setComposerLiveText('')
    setComposerLiveReasoning('')
    setComposerThinkingTokens(0)
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
      showNotice('info', backgrounded ? 'Claude task moved to background' : 'No foreground Claude task to background', 3500)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to background Claude task')
    } finally {
      setBackgroundingTasks(false)
    }
  })

  // Cancel a running Claude SDK background task via query.stopTask(). Routed at
  // the live warm pool entry (a fresh control query wouldn't know the task), so
  // it only works while the session is warm — the backend reports stopped:false
  // otherwise.
  const stopComposerTask = useEffectEvent(async (taskId: string) => {
    const target = composerTargetSession
    if (!target || target.provider !== 'claude' || target.isPending) return
    try {
      const result = await runTuiSessionAction(target, { action: 'stopTask', taskId, provider: 'claude' })
      const stopped = result.stopped === true
      showNotice(stopped ? 'info' : 'error', stopped ? `Stopped task #${taskId}` : 'No running task to stop (session not warm)', 3500)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to stop task')
    }
  })

  const respondToTuiPermission = useEffectEvent(async (permission: PendingPermission, response: PermissionResponse) => {
    const target = composerTargetSession
    if (!target || permissionActionLoading) return
    setPermissionActionLoading(permission.id)
    try {
      if (response === 'once' && permission.elicitation?.mode === 'url' && permission.url) {
        await openExternalUrl(permission.url)
      }
      await runTuiSessionAction(
        { ...target, sessionId: permission.sessionId ?? target.sessionId },
        { action: 'respondPermission', permissionId: permission.id, response, provider: target.provider },
      )
      if (permission.provider === 'codex' && permission.questions?.length) {
        setLiveTranscriptMessages((prev) => completeCodexQuestionLiveMessage(prev, permission, null))
      }
      setPendingPermissions((prev) => prev.filter((entry) => entry.id !== permission.id))
      setPermissionOptionIndex(0)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to respond to permission')
    } finally {
      setPermissionActionLoading(null)
    }
  })

  // Respond to an ExitPlanMode plan-approval. Approving allows the tool (the SDK
  // exits plan mode for this turn) and switches the composer + warm query to the
  // chosen mode so subsequent turns aren't back in plan mode. Reject keeps planning.
  const respondToTuiPlan = useEffectEvent(async (permission: PendingPermission, decision: 'acceptEdits' | 'default' | 'reject') => {
    if (decision === 'reject') {
      await respondToTuiPermission(permission, 'reject')
      return
    }
    const target = composerTargetSession
    if (target) setClaudeComposerPermissionMode(target, decision)
    await respondToTuiPermission(permission, 'once')
  })

  // Toggle an AskUserQuestion option for the focused question. Single-select
  // replaces; multi-select adds/removes.
  const toggleTuiQuestionOption = useEffectEvent((qi: number, multiSelect: boolean, label: string) => {
    if (!multiSelect) {
      setQuestionFreeformAnswers((prev) => prev[qi] ? { ...prev, [qi]: '' } : prev)
    }
    setQuestionSelections((prev) => {
      const current = prev[qi] ?? []
      const next = multiSelect
        ? (current.includes(label) ? current.filter((l) => l !== label) : [...current, label])
        : [label]
      return { ...prev, [qi]: next }
    })
  })

  // Submit the AskUserQuestion answers back into the running turn (allows the
  // tool with the user's selections merged into its input).
  const submitTuiQuestion = useEffectEvent(async (permission: PendingPermission) => {
    const target = composerTargetSession
    if (!target || permissionActionLoading) return
    const questions = permission.questions ?? []
    const answers: PendingQuestionAnswers = {}
    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i]!
      const selected = questionSelections[i] ?? []
      const freeform = questionFreeformAnswers[i]?.trim()
      const values = question.multiSelect && freeform
        ? [...selected, freeform]
        : freeform
        ? [freeform]
        : selected
      if (values.length === 0) {
        if (question.required === false) continue
        // Jump focus to the first unanswered question instead of submitting.
        setQuestionFocusIndex(i)
        setQuestionOptionIndex(0)
        return
      }
      answers[question.id ?? question.question] = values
    }
    setPermissionActionLoading(permission.id)
    try {
      await runTuiSessionAction(
        { ...target, sessionId: permission.sessionId ?? target.sessionId },
        { action: 'respondQuestion', permissionId: permission.id, answers, provider: target.provider },
      )
      setLiveTranscriptMessages((prev) => completeCodexQuestionLiveMessage(prev, permission, answers))
      setPendingPermissions((prev) => prev.filter((entry) => entry.id !== permission.id))
      setQuestionSelections({})
      setQuestionFreeformAnswers({})
      setQuestionFreeformEditing(false)
      setQuestionFocusIndex(0)
      setQuestionOptionIndex(0)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to submit answer')
    } finally {
      setPermissionActionLoading(null)
    }
  })

  // Desktop-notify that a background turn is blocked on a prompt the user
  // can't see (mirrors the slow-send OSC notification; BMP-sanitized).
  const notifyAttention = useEffectEvent((title: string, sessionId: string, sessionProvider: AgentProvider) => {
    const key = sessionKey({ sessionId, provider: sessionProvider })
    const session = sessionsByKeyRef.current.get(key)
    const sessionTitle = session ? formatSessionTitle(session) : sessionId.slice(-8)
    if (NATIVE_OSC_ENABLED && renderer.capabilities?.notifications !== false) {
      try {
        renderer.triggerNotification(
          toBmpSafe(title),
          toBmpSafe(`agent-viewer · needs input · ${sessionTitle}`),
        )
      } catch {
        // terminal doesn't support OSC notifications — silently ignore
      }
    }
  })

  // A turn finished on a session the user wasn't viewing — record it in the
  // attention inbox (one entry per session, newest first) and notify.
  const recordAttentionTurnDone = useEffectEvent((ref: RunningSessionRef) => {
    const key = sessionKey({ sessionId: ref.sessionId, provider: ref.provider })
    const session = sessionsByKeyRef.current.get(key)
    const title = session ? formatSessionTitle(session) : ref.sessionId.slice(-8)
    setAttentionDone((prev) => [
      { key: `done:${key}:${Date.now()}`, sessionId: ref.sessionId, provider: ref.provider, sessionKey: key, title, createdAt: Date.now() },
      ...prev.filter((item) => item.sessionKey !== key),
    ].slice(0, ATTENTION_DONE_LIMIT))
    if (NATIVE_OSC_ENABLED && renderer.capabilities?.notifications !== false) {
      try {
        renderer.triggerNotification(
          toBmpSafe('Turn finished'),
          toBmpSafe(`agent-viewer · ${title}`),
        )
      } catch {
        // terminal doesn't support OSC notifications — silently ignore
      }
    }
  })

  // Answer a plain tool permission straight from the inbox. Questions and plan
  // approvals need their full pickers — those route through openAttentionSession.
  const respondToAttentionItem = useEffectEvent(async (item: AttentionItem, response: PermissionResponse) => {
    const permission = item.permission
    if (!permission || attentionRespondingId) return
    setAttentionRespondingId(permission.id)
    try {
      await runTuiSessionAction(
        { sessionId: item.sessionId, provider: item.provider } as Session,
        { action: 'respondPermission', permissionId: permission.id, response, provider: item.provider },
      )
      setPendingPermissions((prev) => prev.filter((p) => p.id !== permission.id))
      setBackgroundPrompts((prev) => prev.filter((p) => p.id !== permission.id))
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to respond to permission')
    } finally {
      setAttentionRespondingId(null)
    }
  })

  const openAttentionSession = useEffectEvent((item: AttentionItem) => {
    setAttentionOpen(false)
    if (item.kind === 'turn-done') {
      setAttentionDone((prev) => prev.filter((done) => done.key !== item.key))
    }
    if (item.kind === 'viewer-note' && item.attentionId) {
      setViewerAttentionNotes((prev) => prev.filter((note) => note.id !== item.attentionId))
      void dismissTuiViewerAttention(item.attentionId)
    }
    if (!item.sessionId) return
    if (item.sessionKey === selectedSessionKeyRef.current) {
      setFocusedPane('messages')
      return
    }
    const session = sessionsByKeyRef.current.get(item.sessionKey)
      ?? ({ sessionId: item.sessionId, provider: item.provider } as Session)
    selectTabSession(session)
    setFocusedPane('messages')
  })

  const dismissAttentionItem = useEffectEvent((item: AttentionItem) => {
    if (item.kind === 'turn-done') {
      setAttentionDone((prev) => prev.filter((done) => done.key !== item.key))
    } else if (item.kind === 'viewer-note' && item.attentionId) {
      setViewerAttentionNotes((prev) => prev.filter((note) => note.id !== item.attentionId))
      void dismissTuiViewerAttention(item.attentionId)
    }
  })

  // ⌃N: jump straight to whatever needs a human next — prefer prompts over
  // completions, and another session over the one already on screen.
  const jumpToNextAttention = useEffectEvent(() => {
    const needing = attentionItems.filter(attentionItemNeedsInput)
    const pool = needing.length > 0 ? needing : attentionItems
    if (pool.length === 0) {
      showNotice('info', 'Nothing needs attention', 2500)
      return
    }
    const target = pool.find((item) => item.sessionKey !== selectedSessionKeyRef.current) ?? pool[0]!
    openAttentionSession(target)
  })

  const reuseLastPrompt = useEffectEvent(() => {
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

  // Digits 1-9 jump straight to a fleet cell on the visible page.
  const jumpToFleetEntry = useEffectEvent((index: number) => {
    const entry = visibleFleetEntries[index]
    if (!entry || entry.key === selectedSessionKeyRef.current) return
    const session = sessionsByKeyRef.current.get(entry.key)
      ?? ({ sessionId: entry.sessionId, provider: entry.provider } as Session)
    selectTabSession(session)
    setFocusedPane('messages')
  })

  // Resolve whether the selected session lives in an agent worktree — drives
  // the composer badge and the merge/discard affordances.
  const selectedSessionCwdForWorktree = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? null
  useEffect(() => {
    if (!selectedSessionCwdForWorktree || !selectedSessionCwdForWorktree.includes(WORKTREE_TASK_CWD_SEGMENT)) {
      setSelectedWorktreeTask(null)
      return
    }
    if (selectedWorktreeTaskCacheRef.current.has(selectedSessionCwdForWorktree)) {
      setSelectedWorktreeTask(selectedWorktreeTaskCacheRef.current.get(selectedSessionCwdForWorktree) ?? null)
      return
    }
    let cancelled = false
    void findTuiWorktreeTask(selectedSessionCwdForWorktree)
      .then((task) => {
        selectedWorktreeTaskCacheRef.current.set(selectedSessionCwdForWorktree, task)
        if (!cancelled) setSelectedWorktreeTask(task)
      })
      .catch(() => {
        selectedWorktreeTaskCacheRef.current.set(selectedSessionCwdForWorktree, null)
        if (!cancelled) setSelectedWorktreeTask(null)
      })
    return () => { cancelled = true }
  }, [selectedSessionCwdForWorktree])

  // Name → isolated worktree + branch + fresh session cwd'd into it, composer
  // focused for the first prompt. The task then runs without touching the main
  // checkout until the user merges it back.
  const submitWorktreeTask = useEffectEvent(async () => {
    const name = worktreeDraft.trim()
    // Ref-guarded: Enter can arrive via both the input's onSubmit and the
    // keyboard branch in the same tick, before worktreeBusy state lands.
    if (!name || worktreeSubmitInFlightRef.current) return
    worktreeSubmitInFlightRef.current = true
    const baseCwd = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
    setWorktreeBusy(true)
    try {
      const task = await createTuiWorktreeTask(baseCwd, name)
      const targetProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
      const result = await createTuiSession({ provider: targetProvider, cwd: task.path, title: name })
      const draft: Session = {
        sessionId: result.sessionId,
        provider: result.provider,
        cwd: result.cwd,
        createdAt: Date.now(),
        lastModified: Date.now(),
        summary: name,
        isPending: result.isPending,
      }
      setOpenTabSessions((prev) => prev.some((s) => sessionKey(s) === sessionKey(draft)) ? prev : [...prev, draft])
      setSelectedSessionKey(sessionKey(draft))
      setComposerPreferredTargetKey(sessionKey(draft))
      await prepareCreatedSessionForComposer(draft)
      setWorktreeModalOpen(false)
      setWorktreeDraft('')
      setComposerActive(true)
      showNotice('info', `Worktree task on ${task.branch} — the session runs in an isolated checkout.`, 5000)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to create worktree task')
    } finally {
      worktreeSubmitInFlightRef.current = false
      setWorktreeBusy(false)
    }
  })

  // Adopt the task's work: commit whatever the agent left uncommitted, then
  // squash-merge into the main checkout, leaving the result STAGED for review.
  const mergeSelectedWorktreeTask = useEffectEvent(async () => {
    const task = selectedWorktreeTask
    if (!task || worktreeBusy) return
    setWorktreeBusy(true)
    try {
      const result = await mergeTuiWorktreeTask(task)
      showNotice(
        'info',
        result.staged
          ? `Merged ${task.branch} — changes are staged in the main checkout`
          : `${task.branch} has no changes to merge`,
        5000,
      )
      const refreshedTask = await findTuiWorktreeTask(task.path).catch(() => null)
      selectedWorktreeTaskCacheRef.current.set(task.path, refreshedTask)
      setSelectedWorktreeTask(refreshedTask)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Merge failed — resolve in the main checkout')
    } finally {
      setWorktreeBusy(false)
    }
  })

  const discardSelectedWorktreeTask = useEffectEvent(async () => {
    const task = selectedWorktreeTask
    if (!task || worktreeBusy) return
    setWorktreeBusy(true)
    try {
      await removeTuiWorktreeTask(task, { force: true })
      selectedWorktreeTaskCacheRef.current.set(task.path, null)
      setSelectedWorktreeTask(null)
      showNotice('info', `Discarded worktree and branch ${task.branch}`, 5000)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to remove worktree')
    } finally {
      setWorktreeBusy(false)
    }
  })

  const openCoordinationBoard = useEffectEvent(() => {
    // The popover loads and polls its own data; null run id = latest.
    setCoordBoardRunId(null)
    setCoordBoardOpen(true)
  })

  const selectCoordPlaybook = useEffectEvent((name: string | null, available = coordPlaybooks) => {
    setCoordPlaybookName(name)
    setCoordPlaybookArgsDraft('')
    if (!name) return
    const selected = available.find((entry) => entry.name === name)
    if (!selected) return
    if (selected.maxAgents) setCoordMaxAgents(Math.min(6, Math.max(2, selected.maxAgents)))
    if (selected.gateCommand !== undefined) setCoordGateDraft(selected.gateCommand)
    if (selected.requirePlanApproval !== undefined) setCoordRequirePlanApproval(selected.requirePlanApproval)
    if (selected.autonomy) setCoordAutonomy(selected.autonomy)
    if (selected.requireReview !== undefined) setCoordRequireReview(selected.requireReview)
    if (selected.budget?.maxTokens !== undefined) setCoordMaxTokens(String(selected.budget.maxTokens))
    if (selected.budget?.maxDurationMinutes !== undefined) setCoordMaxDurationMinutes(String(selected.budget.maxDurationMinutes))
  })

  const loadCoordPlaybooks = useEffectEvent(async (cwd: string, preferredName?: string) => {
    try {
      const listing = await listTuiRunPlaybooks(cwd)
      setCoordPlaybooks(listing.playbooks)
      if (preferredName && listing.playbooks.some((entry) => entry.name === preferredName)) {
        selectCoordPlaybook(preferredName, listing.playbooks)
      } else if (coordPlaybookName && !listing.playbooks.some((entry) => entry.name === coordPlaybookName)) {
        selectCoordPlaybook(null, listing.playbooks)
      }
      if (listing.invalid.length > 0) setCoordError(`${listing.invalid.length} invalid playbook file${listing.invalid.length === 1 ? '' : 's'} — open Manage to inspect them`)
    } catch (err) {
      setCoordError(err instanceof Error ? err.message : 'Failed to load playbooks')
    }
  })

  const handleCoordPlaybooksChanged = useEffectEvent((playbooks: PlaybookSummary[], preferredName?: string) => {
    setCoordPlaybooks(playbooks)
    if (preferredName && playbooks.some((entry) => entry.name === preferredName)) {
      selectCoordPlaybook(preferredName, playbooks)
    } else if (coordPlaybookName && !playbooks.some((entry) => entry.name === coordPlaybookName)) {
      selectCoordPlaybook(null, playbooks)
    }
  })

  const openNewWorkflowModal = useEffectEvent(() => {
    const baseCwd = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
    setCoordDraft(composerDraft.trim() || selectedSession?.firstPrompt || '')
    setCoordAcceptanceDraft('')
    setCoordNonGoalsDraft('')
    setCoordManualQaDraft('')
    setCoordEscalationDraft('')
    setCoordMaxTokens('')
    setCoordMaxDurationMinutes('')
    setCoordError(null)
    setCoordPlaybookName(null)
    setCoordPlaybookArgsDraft('')
    setPlaybookManagerOpen(false)
    setCoordProviderOverride(null)
    setCoordTeammateProviderOverride(null)
    setCoordProviderPoolIndex(0)
    setCoordModalFocus('prompt')
    setCoordModalOpen(true)
    void loadCoordPlaybooks(baseCwd)
  })

  const openNewSessionModal = useEffectEvent(() => {
    const defaultProvider: AgentProvider = provider === 'all'
      ? (selectedSession?.provider ?? 'claude')
      : provider
    setNewSessionProvider(NEW_SESSION_PROVIDERS.includes(defaultProvider) ? defaultProvider : 'claude')
    setNewSessionCwd(selectedSession?.cwd ?? process.cwd())
    setNewSessionBusy(false)
    setFolderPickerForNewSession(false)
    setNewSessionModalOpen(true)
  })

  const cycleNewSessionProvider = useEffectEvent((direction: 1 | -1) => {
    setNewSessionProvider((current) => {
      const index = Math.max(0, NEW_SESSION_PROVIDERS.indexOf(current))
      const next = (index + direction + NEW_SESSION_PROVIDERS.length) % NEW_SESSION_PROVIDERS.length
      return NEW_SESSION_PROVIDERS[next]!
    })
  })

  const openNewSessionFolderPicker = useEffectEvent(() => {
    setFolderPickerForNewSession(true)
    setFileViewerOpen(true)
  })

  const handleNewSessionFolderSelected = useEffectEvent((path: string) => {
    setNewSessionCwd(path)
    setFileViewerOpen(false)
    setFolderPickerForNewSession(false)
  })

  const prepareCreatedSessionForComposer = useEffectEvent(async (draft: Session) => {
    const key = sessionKey(draft)
    composerPreparingTargetKeyRef.current = key
    setComposerPreparingTargetKey(key)
    try {
      await runComposerSessionPreparation({
        refreshSessions: () => refreshSessions(provider, true, false),
        prewarmRuntime: () => prewarmTuiSession(draft, {
          model: tuiModelOverride[key] || undefined,
          effort: tuiEffort === 'auto' ? undefined : tuiEffort,
          isPending: draft.isPending === true,
        }),
        loadDetail: () => draft.isPending
          ? Promise.resolve()
          : refreshSelectedSessionDetail(draft, true),
        // Provider commands, agents, modes, and permission controls can depend
        // on the warmed runtime (notably Claude), so load them after prewarm.
        loadAffordances: () => fetchComposerAffordances(draft, key),
      })
    } finally {
      if (composerPreparingTargetKeyRef.current === key) {
        composerPreparingTargetKeyRef.current = null
        setComposerPreparingTargetKey(null)
      }
    }
  })

  const submitNewSession = useEffectEvent(() => {
    if (newSessionBusy) return
    const targetProvider = newSessionProvider
    const cwd = newSessionCwd.trim() || process.cwd()
    setNewSessionBusy(true)
    void (async () => {
      try {
        const result = await createTuiSession({ provider: targetProvider, cwd })
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
        setComposerPreferredTargetKey(sessionKey(draft))
        await prepareCreatedSessionForComposer(draft)
        setNewSessionModalOpen(false)
        setComposerActive(true)
        showNotice('info', result.isPending
          ? `New ${formatProviderLabel(result.provider)} session ready — first message will create it.`
          : 'New session created.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create session')
      } finally {
        setNewSessionBusy(false)
      }
    })()
  })

  const copyCoordinationJoinCommand = useEffectEvent((runId: string) => {
    const attachUrl = process.env.AGENT_VIEWER_ATTACH?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:3000'
    const command = `agent-viewer coord worker --join ${runId} --name <name> --provider codex --attach ${attachUrl}`
    if (NATIVE_OSC_ENABLED && renderer.capabilities?.osc52 !== false) {
      renderer.copyToClipboardOSC52(command)
      showNotice('info', 'External CLI join command copied', 4000)
    } else {
      showNotice('info', command, 8000)
    }
  })

  // Jump from an Agent Operations row straight into that agent's transcript.
  // External MCP participants carry a synthetic `external:` session id with no
  // transcript behind it — refuse those with an honest notice instead of
  // letting the reader fall back to an unrelated session. Sessions the
  // sidebar has not indexed yet (other provider, or not materialised) are
  // pinned as open tabs BEFORE selecting, so resolveSelectedSession can never
  // fall through to sessions[0] and open the wrong agent's transcript.
  const openCoordinationAgentSession = useEffectEvent((agent: ProtocolAgent) => {
    const target = resolveCoordinationTranscriptTarget(agent, sessionsByKeyRef.current, Date.now())
    if (target.kind === 'unreadable') {
      showNotice('info', target.reason, 5000)
      return
    }
    if (!target.indexed) {
      setOpenTabSessions((prev) => prev.some((tab) => sessionKey(tab) === target.sessionKey)
        ? prev
        : [...prev, target.session])
    }
    selectTabSession(target.session)
    setFocusedPane('messages')
  })

  const handleCoordContentChange = useEffectEvent(() => {
    setCoordDraft(coordTextareaRef.current?.plainText ?? '')
    if (coordError) setCoordError(null)
  })

  const submitCoordinatedRun = useEffectEvent(async () => {
    // The textarea is the source of truth — onContentChange can lag onSubmit.
    const prompt = (coordTextareaRef.current?.plainText ?? coordDraft).trim()
    const selectedPlaybook = coordPlaybookName
      ? coordPlaybooks.find((entry) => entry.name === coordPlaybookName)
      : null
    const playbookArgsText = coordPlaybookArgsDraft.trim()
    if ((!prompt && !selectedPlaybook) || (selectedPlaybook?.expectsArgs && !playbookArgsText) || coordStartInFlightRef.current) return
    let playbookArgs: unknown = undefined
    if (playbookArgsText) {
      try { playbookArgs = JSON.parse(playbookArgsText) } catch { playbookArgs = playbookArgsText }
    }
    coordStartInFlightRef.current = true
    setCoordBusy(true)
    setCoordError(null)
    try {
      const suggestedProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
      const targetProvider = coordProviderOverride ?? suggestedProvider
      const teammateProviders = coordTeammateProviderOverride ?? [targetProvider]
      const baseCwd = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
      const result = await startTuiProtocolRun({
        prompt,
        baseCwd,
        playbookName: selectedPlaybook?.name,
        playbookArgs,
        provider: targetProvider,
        teammateProviders,
        maxAgents: coordMaxAgents,
        title: (prompt || selectedPlaybook?.name || 'Coordinated run').slice(0, 40),
        model: tuiModelOverride[selectedSessionKey ?? ''] || undefined,
        effort: tuiEffort === 'auto' ? undefined : tuiEffort,
        gateCommand: coordGateDraft.trim() || undefined,
        requirePlanApproval: coordRequirePlanApproval,
        autonomy: coordAutonomy,
        requireReview: coordRequireReview,
        acceptanceContract: {
          goal: prompt || selectedPlaybook?.name || 'Complete the coordinated workflow',
          userVisibleAcceptance: parseCoordContractLines(coordAcceptanceDraft),
          nonGoals: parseCoordContractLines(coordNonGoalsDraft),
          verificationCommands: [coordGateDraft.trim()].filter(Boolean),
          manualQa: parseCoordContractLines(coordManualQaDraft),
          escalationTriggers: parseCoordContractLines(coordEscalationDraft),
        },
        budget: coordMaxTokens.trim() || coordMaxDurationMinutes.trim() ? {
          maxTokens: coordMaxTokens.trim() ? Number(coordMaxTokens) : undefined,
          maxDurationMinutes: coordMaxDurationMinutes.trim() ? Number(coordMaxDurationMinutes) : undefined,
        } : undefined,
        useWorktrees: coordUseWorktrees,
      })
      const drafts: Session[] = result.sessions.map((session) => ({
        sessionId: session.sessionId,
        provider: session.provider,
        cwd: session.cwd,
        createdAt: Date.now(),
        lastModified: Date.now(),
        summary: session.summary,
        isPending: session.isPending,
      }))
      setOpenTabSessions((prev) => {
        const seen = new Set(prev.map((tab) => sessionKey(tab)))
        const next = [...prev]
        for (const draft of drafts) {
          if (!seen.has(sessionKey(draft))) next.push(draft)
        }
        return next
      })
      const first = drafts[0]
      if (first) setSelectedSessionKey(sessionKey(first))
      setCoordModalOpen(false)
      setCoordBoardRunId(result.snapshot.run.id)
      setCoordBoardOpen(true)
      setCoordDraft('')
      setCoordAcceptanceDraft('')
      setCoordNonGoalsDraft('')
      setCoordManualQaDraft('')
      setCoordEscalationDraft('')
      setCoordPlaybookName(null)
      setCoordPlaybookArgsDraft('')
      setCoordGateDraft('')
      setCoordMaxTokens('')
      setCoordMaxDurationMinutes('')
      setCoordProviderOverride(null)
      setCoordTeammateProviderOverride(null)
      setCoordProviderPoolIndex(0)
      setCoordModalFocus('prompt')
      // Watch the run in the background: the engineer gets notified on
      // completion or newly blocked teammates even with the board closed.
      coordWatchStateRef.current.set(result.snapshot.run.id, {
        status: result.snapshot.run.status,
        blockedAgents: new Set(),
      })
      setCoordWatchIds((prev) => [...prev, result.snapshot.run.id])
      await refreshSessions(provider, true, false)
      showNotice(
        'info',
        selectedPlaybook
          ? `Playbook ${selectedPlaybook.name} started — task board seeded without a planning turn`
          : 'Coordinated run started — lead is planning the task board',
        5000,
      )
    } catch (err) {
      setCoordError(err instanceof Error ? err.message : 'Failed to start coordinated run')
      showNotice('error', err instanceof Error ? err.message : 'Failed to start coordinated run')
    } finally {
      coordStartInFlightRef.current = false
      setCoordBusy(false)
    }
  })

  // Desktop-notify a team event (run finished, teammate blocked) — the whole
  // point of a team is walking away while it works.
  const notifyTeamEvent = useEffectEvent((title: string, body: string) => {
    if (NATIVE_OSC_ENABLED && renderer.capabilities?.notifications !== false) {
      try {
        renderer.triggerNotification(toBmpSafe(body), toBmpSafe(`agent-viewer · ${title}`))
      } catch {
        // terminal doesn't support OSC notifications — silently ignore
      }
    }
  })

  // Watch active runs started this session: notify on terminal status and on
  // newly blocked teammates, then drop finished runs from the watch list.
  useEffect(() => {
    if (coordWatchIds.length === 0) return
    let cancelled = false
    const tick = async () => {
      for (const runId of coordWatchIds) {
        const snapshot = await readTuiProtocolRun(runId).catch(() => null)
        if (cancelled) return
        const watch = coordWatchStateRef.current.get(runId)
        if (!snapshot || !watch) {
          coordWatchStateRef.current.delete(runId)
          setCoordWatchIds((prev) => prev.filter((id) => id !== runId))
          continue
        }
        for (const agent of snapshot.agents) {
          if (agent.status === 'blocked' && !watch.blockedAgents.has(agent.id)) {
            watch.blockedAgents.add(agent.id)
            showNotice('info', `Team: ${agent.name} is blocked${agent.taskId ? ` on ${agent.taskId}` : ''} — ^⇧A to intervene`, 6000)
            notifyTeamEvent('teammate blocked', `${agent.name} is blocked${agent.taskId ? ` on ${agent.taskId}` : ''}`)
          }
        }
        const status = snapshot.run.status
        if (status !== watch.status) {
          watch.status = status
          if (status === 'completed' || status === 'failed' || status === 'stopped') {
            const headline = snapshot.run.summary?.split('\n')[0] ?? ''
            showNotice(status === 'completed' ? 'info' : 'error', `Team run ${status}${headline ? `: ${headline}` : ''} — ^⇧A for the board`, 8000)
            notifyTeamEvent(`team run ${status}`, headline || snapshot.run.prompt.slice(0, 80))
            coordWatchStateRef.current.delete(runId)
            setCoordWatchIds((prev) => prev.filter((id) => id !== runId))
          }
        }
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [coordWatchIds])

  // Palette actions resolve the latest run on demand — the interactive board
  // (CoordinationPopover) has its own run-scoped stop/cleanup keys.
  const stopActiveCoordinatedRun = useEffectEvent(async () => {
    if (coordBusy) return
    setCoordBusy(true)
    try {
      const runs = await listTuiProtocolRuns(1)
      const runId = runs[0]?.id
      if (!runId) {
        showNotice('info', 'No coordinated run to stop', 3000)
        return
      }
      await stopTuiProtocolRun(runId)
      showNotice('info', 'Stopped coordinated run', 4000)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to stop coordinated run')
    } finally {
      setCoordBusy(false)
    }
  })

  const cleanupCompletedCoordinatedRunWorktrees = useEffectEvent(async () => {
    if (coordBusy) return
    setCoordBusy(true)
    try {
      const runs = await listTuiProtocolRuns(1)
      const runId = runs[0]?.id
      if (!runId) {
        showNotice('info', 'No coordinated run to clean up', 3000)
        return
      }
      const result = await cleanupTuiProtocolRunWorktrees(runId)
      const removed = result.results.filter((entry) => entry.status === 'removed').length
      const skipped = result.results.filter((entry) => entry.status === 'skipped').length
      const failed = result.results.filter((entry) => entry.status === 'failed').length
      showNotice('info', `Cleaned ${removed} worktree${removed === 1 ? '' : 's'}${skipped || failed ? ` · skipped ${skipped} · failed ${failed}` : ''}`, 5000)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to clean up worktrees')
    } finally {
      setCoordBusy(false)
    }
  })

  // Reset picker state whenever the active question prompt changes.
  useEffect(() => {
    const active = pendingPermissions[0]
    const qid = active?.questions && active.questions.length > 0 ? active.id : null
    if (questionPermissionIdRef.current !== qid) {
      questionPermissionIdRef.current = qid
      setQuestionSelections({})
      setQuestionFreeformAnswers({})
      setQuestionFreeformEditing(false)
      setQuestionFocusIndex(0)
      setQuestionOptionIndex(0)
    }
  }, [pendingPermissions])

  // Keep the ref in sync on every render so commitRename always reads the latest draft,
  // regardless of which version of the callback is held by onSubmit or the keyboard handler.
  useLayoutEffect(() => {
    renameDraftRef.current = renameDraft
  }, [renameDraft])

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
  const buildSidebarRow = useCallback((entry: typeof sidebarEntries[number], selected: boolean) => {
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

    if (entry.type === 'subagent') {
      const subagentEntry = entry.entry
      const accent = getProviderAccent(
        subagentEntry.kind === 'session'
          ? (subagentEntry.session.provider ?? 'claude')
          : (subagentEntry.summary.provider ?? entry.parentSession.provider ?? 'claude'),
      )
      const label = subagentEntry.kind === 'session'
        ? formatSessionTitle(subagentEntry.session) || subagentEntry.session.sessionId.slice(-8)
        : (subagentEntry.summary.taskDescription?.trim() || subagentEntry.summary.agentId.slice(-8))
      const summaryTokens = subagentEntry.kind === 'summary'
        ? subagentEntry.summary.usage.totalTokens
          ?? (subagentEntry.summary.usage.inputTokens + subagentEntry.summary.usage.outputTokens)
        : 0
      const detail = subagentEntry.kind === 'session'
        ? (() => {
            const activity = sidebarSessionActivity.get(sessionKey(subagentEntry.session))
            const marker = activity === 'needs-input' ? '⚠'
              : activity === 'running' ? '●'
              : activity === 'waiting' ? '◌'
              : isSessionRecentlyTouched(subagentEntry.session) ? '·'
              : null
            return joinMeta([
              showProviderInSessionRows ? formatProviderLabel(subagentEntry.session.provider) : null,
              `${timeAgo(subagentEntry.session.lastModified ?? subagentEntry.session.createdAt)}${marker ? ` ${marker}` : ''}`,
            ])
          })()
        : joinMeta([
            showProviderInSessionRows
              ? formatProviderLabel(subagentEntry.summary.provider ?? entry.parentSession.provider)
              : null,
            `${subagentEntry.summary.messageCount} msgs`,
            summaryTokens > 0 ? `${fmtTokens(summaryTokens)} tokens` : null,
          ])
      return (
        <box
          key={entry.key}
          id={`sidebar:${entry.key}`}
          flexDirection="column"
          paddingLeft={Math.min(entry.depth + 1, 5)}
          backgroundColor={selected ? theme.surface3 : theme.surface}
          onMouseDown={(event) => {
            if (event.button !== 0) return
            event.stopPropagation()
            selectSidebarSession(subagentEntry.kind === 'session' ? subagentEntry.session : entry.parentSession)
          }}
        >
          <text fg={selected ? accent : theme.muted} wrapMode="none">
            {fitText(`${selected ? '▎' : ' '} ${'↪'.repeat(Math.min(entry.depth, 3))} ${label}`, sidebarInnerWidth - 2)}
          </text>
          {detail && (
            <text fg={selected ? accent : theme.muted} wrapMode="none">
              {fitText(`${selected ? '▎' : ' '}   ${detail}`, sidebarInnerWidth - 2)}
            </text>
          )}
        </box>
      )
    }

    const sessionAccent = getProviderAccent(entry.session.provider ?? 'claude')
    const activityTime = entry.session.lastModified ?? entry.session.createdAt
    const ago = timeAgo(activityTime)
    const recentlyTouched = isSessionRecentlyTouched(entry.session)
    const activity = sidebarSessionActivity.get(sessionKey(entry.session))
    const activityGlyph = activity === 'needs-input' ? '⚠'
      : activity === 'running' ? '●'
      : activity === 'waiting' ? '◌'
      : recentlyTouched ? '·'
      : null
    const activityColor = activity === 'needs-input' ? theme.amber
      : activity === 'running' ? sessionAccent
      : activity === 'waiting' ? theme.cyan
      : theme.dim

    const metaLine = joinMeta([
      showProviderInSessionRows ? formatProviderLabel(entry.session.provider) : null,
      ago,
    ])

    return (
      <box
        key={entry.key}
        id={`sidebar:${entry.key}`}
        flexDirection="column"
        backgroundColor={selected ? theme.surface3 : theme.surface}
        marginBottom={density === 'comfortable' ? 1 : 0}
        onMouseDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          if (sessionKey(entry.session) === renameSessionKey) return
          selectSidebarSession(entry.session)
        }}
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
          <box paddingX={1} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface}>
            <text fg={sessionAccent} wrapMode="none">{selected ? '▎' : ' '}</text>
            {/* Selection glows in the provider accent — bar, title, and meta all
                lit in the session's identity color (accent = identity), matching
                the focused-pane frame convention. */}
            <text fg={selected ? sessionAccent : theme.muted} wrapMode="none">
              {fitText(formatSessionTitle(entry.session), sidebarInnerWidth - 3)}
            </text>
          </box>
        )}
        <box paddingX={1} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface}>
          <text fg={sessionAccent} wrapMode="none">{selected ? '▎' : ' '}</text>
          <text fg={selected ? sessionAccent : theme.dim} wrapMode="none">
            {fitText(metaLine, sidebarInnerWidth - 3 - (activityGlyph ? 2 : 0))}
          </text>
          {activityGlyph ? <text fg={activityColor} wrapMode="none">{` ${activityGlyph}`}</text> : null}
        </box>
      </box>
    )
  }, [theme, density, sidebarInnerWidth, renameSessionKey, renameDraft, commitRename, selectSidebarSession, showProviderInSessionRows, sidebarSessionActivity])

  const buildCoordinatorRow = useCallback((entry: CoordinatorSidebarEntry, selected: boolean) => {
    if (entry.type === 'run') {
      const title = (entry.run.prompt.split('\n')[0]?.trim() || entry.run.id).toUpperCase()
      const countLabel = `${entry.agentCount}`
      const dashes = '─'.repeat(Math.max(sidebarInnerWidth - 2 - title.length - countLabel.length - 3, 1))
      const tone = entry.run.status === 'failed' ? theme.red
        : entry.run.status === 'blocked' ? theme.amber
        : entry.run.status === 'running' || entry.run.status === 'synthesizing' ? theme.green
        : entry.run.status === 'planning' ? theme.cyan
        : theme.dim
      return (
        <box key={entry.key} id={`sidebar:${entry.key}`} paddingX={1} marginTop={1} backgroundColor={theme.surface2}>
          <text fg={tone} wrapMode="none">{fitText(`${title} ${dashes} ${countLabel}`, sidebarInnerWidth - 2)}</text>
        </box>
      )
    }

    const accent = getProviderAccent(entry.agent.provider)
    const glyph = entry.agent.role === 'lead' ? '◆' : entry.isLast ? '└─' : '├─'
    const statusColor = entry.agent.turnActive || entry.agent.status === 'working' ? theme.green
      : entry.agent.status === 'blocked' || entry.agent.status === 'failed' ? theme.amber
      : theme.dim
    const statusDot = entry.agent.turnActive || entry.agent.status === 'working' ? '●' : '○'
    const detailLine = joinMeta([formatProviderLabel(entry.agent.provider), entry.taskTitle ?? 'unassigned'])
    return (
      <box
        key={entry.key}
        id={`sidebar:${entry.key}`}
        flexDirection="column"
        backgroundColor={selected ? theme.surface3 : theme.surface}
        marginBottom={density === 'comfortable' ? 1 : 0}
        onMouseDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          setCoordinatorSelectedKey(entry.key)
        }}
      >
        <box paddingX={1} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface}>
          <text fg={selected ? accent : theme.dim} wrapMode="none">{selected ? '▎' : ' '}</text>
          <text fg={selected ? accent : theme.muted} wrapMode="none">
            {fitText(`${glyph} ${entry.agent.name} · ${entry.agent.role}`, sidebarInnerWidth - 3)}
          </text>
        </box>
        <box paddingX={1} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface}>
          <text fg={selected ? accent : theme.dim} wrapMode="none">{selected ? '▎' : ' '}</text>
          <text fg={statusColor} wrapMode="none">{`${statusDot} `}</text>
          <text fg={selected ? theme.text : theme.dim} wrapMode="none">
            {fitText(detailLine, sidebarInnerWidth - 5)}
          </text>
        </box>
      </box>
    )
  }, [theme, density, sidebarInnerWidth])

  // Per-row element cache. Moving the selection highlight only changes TWO rows
  // (the de-selected and newly-selected), but the memo re-runs on every
  // selectedIndex change. Rebuilding all N rows — each doing getProviderAccent /
  // timeAgo / fitText / formatSessionTitle — was O(sessions) per scrub step;
  // fast scrubbing through a large list backed the render queue up and got
  // progressively slower. Reuse the cached element for any row whose inputs are
  // unchanged so only the two flipped rows actually rebuild.
  const sidebarRowCacheRef = useRef(new Map<string, {
    entry: unknown
    selected: boolean
    build: typeof buildSidebarRow
    element: React.ReactNode
  }>())
  const sidebarRowElements = useMemo(() => {
    const cache = sidebarRowCacheRef.current
    const live = new Set<string>()
    const rows = sidebarEntries.map((entry) => {
      live.add(entry.key)
      const entrySession = sidebarEntrySession(entry)
      const selectedSession = selectedIndex >= 0 ? sessions[selectedIndex] : null
      const selected = Boolean(
        entrySession
        && selectedSession
        && sessionKey(entrySession) === sessionKey(selectedSession),
      )
      const prev = cache.get(entry.key)
      // `entry` identity changes only when the session list polls (new array),
      // and `build` carries theme/density/width/rename state via its deps — so a
      // matching (entry, selected, build) triple means the element is identical.
      if (prev && prev.entry === entry && prev.selected === selected && prev.build === buildSidebarRow) {
        return prev.element
      }
      const element = buildSidebarRow(entry, selected)
      cache.set(entry.key, { entry, selected, build: buildSidebarRow, element })
      return element
    })
    for (const key of cache.keys()) if (!live.has(key)) cache.delete(key)
    return rows
  }, [sidebarEntries, selectedIndex, sessions, buildSidebarRow])

  // Coordinator tab is small (a handful of active runs at most) so it skips
  // sidebarRowElements' scrub-optimized cache — a plain map is plenty here.
  const coordinatorRowElements = useMemo(
    () => coordinatorEntries.map((entry) => buildCoordinatorRow(entry, entry.type === 'agent' && entry.key === coordinatorSelectedKey)),
    [coordinatorEntries, coordinatorSelectedKey, buildCoordinatorRow],
  )

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
    liveTextFlushTimerRef.current = null
    const text = pendingLiveTextRef.current
    const session = liveTextTargetSessionRef.current
    if (!session) return
    setComposerLiveText(text)
    setComposerLiveReasoning(pendingLiveReasoningRef.current)
  }, [])

  const sendComposerMessage = useCallback(async (
    draftOverride?: string,
    attachmentsOverride?: SendAttachment[],
    isRetry?: boolean,
    promptPartsOverride?: ComposerPromptPart[],
    retryTurnRequestId?: string,
  ) => {
    const visibleText = draftOverride ?? composerDraft
    const submission = attachmentsOverride
      ? {
          visibleText,
          messageText: visibleText.trim(),
          attachments: attachmentsOverride,
          promptParts: promptPartsOverride ?? [],
        }
      : prepareComposerSubmission(visibleText, composerMentionAttachments, composerPromptParts)
    const trimmed = submission.messageText
    if ((!trimmed && submission.attachments.length === 0) || !composerTargetSession) return
    const submissionTargetKey = sessionKey(composerTargetSession)
    if (!isRetry && !isComposerTargetReady({
      preparingTargetKey: composerPreparingTargetKeyRef.current,
      targetSession: composerTargetSession,
      keyOf: sessionKey,
    })) {
      showNotice('info', 'Session is still loading — send will be available when it is ready')
      return
    }

    const crossSessionCommand = !isRetry && submission.attachments.length === 0
      ? parseCrossSessionComposerCommand(trimmed)
      : null
    if (crossSessionCommand) {
      composerTextareaRef.current?.setText('')
      setComposerDraft('')
      setComposerMentionAttachments([])
      setComposerPromptParts([])
      composerTextareaRef.current?.extmarks.clear()
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      try {
        if (crossSessionCommand.kind === 'list') {
          const targets = await listTuiAddressableSessions(composerTargetSession.sessionId)
          const summary = targets.length === 0
            ? 'No other running or recently active sessions are reachable'
            : targets.map((target) => `${target.name} (${target.provider}${target.running ? ', running' : ''})`).join(' · ')
          showNotice('info', summary, 12_000)
          return
        }
        if (!crossSessionCommand.target || !crossSessionCommand.text) {
          showNotice('error', 'Usage: /message <session-name> <message>')
          return
        }
        const fromName = composerTargetSession.customTitle?.trim()
          || composerTargetSession.summary?.trim()
          || `session-${composerTargetSession.sessionId.slice(0, 6)}`
        const result = await sendTuiCrossSessionMessage({
          fromSessionId: composerTargetSession.sessionId,
          fromName,
          toName: crossSessionCommand.target,
          text: crossSessionCommand.text,
        })
        if (!result.delivered) {
          showNotice('error', result.error || 'The cross-session message was not delivered')
          return
        }
        showNotice('info', result.mode === 'steered'
          ? `Delivered to ${result.targetName ?? crossSessionCommand.target}`
          : `Started a turn for ${result.targetName ?? crossSessionCommand.target}`)
      } catch (error) {
        showNotice('error', error instanceof Error ? error.message : 'Cross-session messaging failed')
      }
      return
    }

    // Global Channel Bridge binding: divert the send to the live `claude` CLI
    // session instead of the active provider. The durable outbox retains failed
    // sends for reconnect replay; replies and permission prompts surface in the
    // bridge popover (⇧C). Never diverts an auto-retry and requires actual text.
    if (!isRetry && canUseChannelBridge && selectedSessionTarget && routeComposerToBridgeRef.current && trimmed) {
      composerTextareaRef.current?.setText('')
      setComposerDraft('')
      setComposerMentionAttachments([])
      setComposerPromptParts([])
      composerTextareaRef.current?.extmarks.clear()
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      try {
        const timestamp = new Date().toISOString()
        const config = readBridgeConfigFromEnv()
        const chatId = lastBridgeChatIdRef.current ?? createChannelBridgeMessageId()
        lastBridgeChatIdRef.current = chatId
        const result = await sendDurableChannelMessage(channelBridgeFileOutboxStorage, config, {
          targetSessionId: selectedSessionTarget.sessionId,
          text: trimmed,
          chatId,
        })
        lastBridgeChatIdRef.current = result.response?.chat_id ?? chatId
        setBridgeTranscriptEntries((prev) => [...prev, { kind: 'sent', text: trimmed, timestamp }])
        showNotice('info', result.queued
          ? 'Queued for the live CLI bridge to reconnect'
          : 'Accepted by the live CLI bridge')
      } catch (err) {
        showNotice('error', err instanceof Error ? err.message : 'Failed to reach the channel bridge')
      }
      return
    }

    // Global IDE Bridge binding: push the composer line as an @file mention into
    // the connected `claude` session instead of sending a provider turn. Accepts
    // "path" or "path:start-end". Tool calls / diffs surface in the IDE popover (⇧I).
    if (!isRetry && canUseIdeBridge && routeComposerToIdeRef.current && trimmed) {
      composerTextareaRef.current?.setText('')
      setComposerDraft('')
      setComposerMentionAttachments([])
      setComposerPromptParts([])
      composerTextareaRef.current?.extmarks.clear()
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      try {
        const match = trimmed.match(/^(.*?):(\d+)(?:-(\d+))?$/)
        const filePath = match ? match[1] : trimmed
        const lineStart = match ? Number(match[2]) : undefined
        const lineEnd = match ? (match[3] ? Number(match[3]) : lineStart) : undefined
        const result = await sendIdeAtMention(readIdeBridgeConfigFromEnv(), filePath, lineStart, lineEnd)
        showNotice(result.delivered ? 'info' : 'error', result.delivered ? 'Pushed @mention to the IDE session' : 'No `claude` session is connected to the IDE host yet')
      } catch (err) {
        showNotice('error', err instanceof Error ? err.message : 'Failed to reach the IDE host')
      }
      return
    }

    const sendAttachments = submission.attachments
    // Native CLIs queue a follow-up prompt while the active turn streams.
    // Mirror that here: when sending, stash this draft and flush it after. A
    // reattached turn (running server-side, no owned stream) counts as sending
    // — starting a fresh turn now would run two concurrently. A transient
    // auto-retry bypasses the queue — the prior (failed) turn already settled,
    // composerSendState just hasn't been cleared yet across the backoff.
    if (!isRetry && (composerSendState === 'sending' || reattachedRunningRef.current)) {
      composerTextareaRef.current?.setText('')
      setComposerDraft('')
      setComposerMentionAttachments([])
      setComposerPromptParts([])
      composerTextareaRef.current?.extmarks.clear()
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      // Native steering first: deliver the message INTO the running turn the
      // way the provider's own CLI does (Claude Code, Codex, Copilot, Pi, and
      // opencode all accept typed input mid-turn). Attachments can't ride a
      // steer; and if
      // the turn ends while the request is in flight the backend reports
      // delivered:false — both fall back to the client-side queue, which
      // sends as a fresh turn on idle.
      // Slash commands and `!` shell input never steer: steering would inject
      // them as literal prompt text mid-turn, whereas the native CLIs queue
      // them and execute them natively once the turn ends — the queue below
      // flushes into the send path, which does exactly that.
      const steerTarget = composerTargetSession
      if (trimmed && sendAttachments.length === 0 && steerTarget && !isNativeComposerCommandText(trimmed)) {
        try {
          const result = await deliverComposerSteer(
            (payload) => runTuiSessionAction(steerTarget, payload),
            {
              message: trimmed,
              provider: steerTarget.provider,
              turnRequestId: activeComposerTurnRequestIdRef.current ?? undefined,
            },
          )
          if (result.delivered === true) {
            setSteeredSendNotice(trimmed)
            // Echo the steered message into the live transcript immediately —
            // it's part of the running turn now, exactly like typing in the
            // native CLI. The persisted reconcile replaces this echo when the
            // turn lands.
            steeredEchoCounterRef.current += 1
            const liveMessageUuid = `live-user-steer-${steeredEchoCounterRef.current}`
            if (typeof result.messageUuid === 'string') {
              steeredComposerSendsRef.current = [
                ...steeredComposerSendsRef.current,
                { text: trimmed, messageUuid: result.messageUuid, liveMessageUuid },
              ]
            }
            setLiveTranscriptMessages((prev) => [
              ...prev,
              makeLiveUserMessage(steerTarget, trimmed, liveMessageUuid),
            ])
            return
          }
        } catch {
          // Steering is best-effort; the queue below is the reliable path.
        }
      }
      commitQueuedComposerSends([...queuedComposerSendsRef.current, {
        id: createComposerQueueItemId(submissionTargetKey),
        targetKey: submissionTargetKey,
        text: submission.visibleText,
        attachments: sendAttachments,
        promptParts: submission.promptParts,
      }])
      return
    }

    if (!isRetry) composerRetryCountRef.current = 0
    composerTurnProducedOutputRef.current = false

    // Atomically consume the submitted snapshot before starting I/O. The user
    // can immediately compose a distinct follow-up while the provider works;
    // a second Enter can never accidentally queue the just-submitted prompt.
    if (!isRetry) {
      composerTextareaRef.current?.setText('')
      composerTextareaRef.current?.extmarks.clear()
      setComposerDraft('')
      if (composerDraftStorageKeyRef.current) scheduleWriteComposerDraft(composerDraftStorageKeyRef.current, '')
      setComposerMention(null)
      setComposerMentionResults([])
      setComposerMentionDismissedStart(null)
      composerMentionAttachmentsRef.current = []
      composerPromptPartsRef.current = []
      setComposerMentionAttachments([])
      setComposerPromptParts([])
      setComposerSlashIndex(0)
      setComposerSlashDismissed(false)
    }

    const targetSession = composerTargetSession
    const controller = new AbortController()
    const sendStartedAt = Date.now()
    const sendPerfStartedAt = performance.now()
    // Stable across automatic transport retries so Codex queue/add can
    // de-duplicate a prompt whose acknowledgement was lost in transit.
    const turnRequestId = retryTurnRequestId
      ?? globalThis.crypto?.randomUUID?.()
      ?? `${sendStartedAt}-${Math.random().toString(36).slice(2)}`
    let resolveTurnCleanup: () => void = () => {}
    const turnCleanupPromise = new Promise<void>((resolve) => {
      resolveTurnCleanup = resolve
    })
    activeComposerSendCleanupRef.current = turnCleanupPromise
    composerAbortRef.current = controller
    activeComposerTurnRequestIdRef.current = turnRequestId
    setComposerSendState('sending')
    setSteeredSendNotice(null)
    steeredComposerSendsRef.current = []
    setComposerSendStartedAt(sendStartedAt)
    setComposerWaitingSeed(`${targetSession.provider ?? 'claude'}:${targetSession.sessionId}:${sendStartedAt}:${trimmed}`)
    setComposerError(null)
    flushLiveText() // flush any stale pending text
    pendingLiveTextRef.current = ''
    pendingLiveReasoningRef.current = ''
    liveTextTargetSessionRef.current = targetSession
    if (liveTextFlushTimerRef.current != null) {
      clearTimeout(liveTextFlushTimerRef.current)
      liveTextFlushTimerRef.current = null
    }
    setComposerLiveText('')
    setComposerLiveReasoning('')
    setComposerThinkingTokens(0)
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
    // This send loop owns the turn's stream — the registry poll must not treat
    // the session as reattached while the stream is alive.
    ownedTurnKeyRef.current = targetKey
    const baselineDetail = sessionDetailCacheRef.current.get(targetKey)
      ?? (selectedSessionKeyRef.current === targetKey ? sessionDetail : null)
    const baselineSummary = summarizeDurableSessionMessages(baselineDetail?.rawMessages ?? [])
    liveTranscriptBaselineRef.current.set(targetKey, {
      ...baselineSummary,
      startedAt: sendStartedAt,
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
    const claudeLiveTextByIndex = new Map<number, string>()
    const providerLiveTextByKey = new Map<string, string>()
    let copilotFinalMessageSeen = false
    let commandResultWithoutTranscript = false

    try {
      const overrideModel = tuiModelOverride[sessionKey(targetSession)]
      const res = await streamTuiSessionTurn(
        targetSession,
        {
          message: trimmed,
          provider: targetSession.provider,
          taskBudgetTokens: taskBudgetTokens ?? undefined,
          enableWorkflow: targetSession.provider === 'claude' && composerEnableWorkflow ? true : undefined,
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
            : targetSession.provider === 'copilot'
              ? composerCopilotPermissionMode
              : undefined,
          approvalPolicy: targetSession.provider === 'codex' && composerCodexApproval !== 'auto'
            ? composerCodexApproval
            : undefined,
          // Claude/Copilot only emit interactive tool-approval prompts when the
          // client opts in. OpenCode/Codex surface them automatically.
          // bypass/plan handle all tool decisions via permissionMode — no bridge.
          manualPermissions: targetSession.provider === 'copilot'
            || (targetSession.provider === 'claude' && composerPermissionMode !== 'bypassPermissions' && composerPermissionMode !== 'plan')
            ? true : undefined,
          nativeCommands: targetSession.provider === 'copilot' ? true : undefined,
          detachOnClientAbort: true,
          turnRequestId,
        },
        controller.signal,
      )
      noteTuiComposerLatency(
        targetSession.provider ?? 'claude',
        'send-to-ack',
        performance.now() - sendPerfStartedAt,
      )

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }

      reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')
      const decoder = new TextDecoder()
      let sseBuffer = ''
      let firstOutputRecorded = false
      const noteFirstOutput = () => {
        if (firstOutputRecorded) return
        firstOutputRecorded = true
        noteTuiComposerLatency(
          targetSession.provider ?? 'claude',
          'first-output',
          performance.now() - sendPerfStartedAt,
        )
      }

      const activeSubagentIdRef = { current: '' }

      const handleFrame = (frame: SseFrame) => {
        // Liveness pulse only — receiving it already reset the stall race.
        if (frame.event === 'heartbeat') return
        // Transport-only receipt consumed by cross-session senders.
        if (frame.event === 'turn-accepted') return
        let parsed: unknown = null
        try {
          parsed = JSON.parse(frame.data)
        } catch {
          parsed = null
        }
        if (frame.event === 'error') {
          const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
          const message = record?.error
          const apiErrorStatus = typeof record?.apiErrorStatus === 'number' ? record.apiErrorStatus : undefined
          throw new TransientAwareSendError(typeof message === 'string' ? message : 'Unknown agent error', apiErrorStatus)
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
          if (typeof message === 'string' && message.trim()) {
            noteFirstOutput()
            showNotice('info', message.trim())
          }
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
            if (ownedTurnKeyRef.current === oldKey) ownedTurnKeyRef.current = newKey
            commitQueuedComposerSends(rekeyComposerQueueTarget(queuedComposerSendsRef.current, oldKey, newKey))
            setLiveTranscriptMessages((prev) => prev.map((message) =>
              liveMessageSessionKey(message) === oldKey
                ? { ...message, sessionId: realId }
                : message
            ))
            const currentPermissionModes = tuiPermissionModeByKeyRef.current
            const pendingMode = currentPermissionModes[oldKey]
            if (pendingMode) {
              const next = { ...currentPermissionModes }
              delete next[oldKey]
              next[newKey] = pendingMode
              tuiPermissionModeByKeyRef.current = next
              setTuiPermissionModeByKey(next)
            }
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
          noteFirstOutput()
          const result = parsed as { message?: unknown; mode?: unknown; transcriptExpected?: unknown }
          if (!commandResultExpectsTranscript(result)) commandResultWithoutTranscript = true
          if (
            result.mode === 'interactive'
            || result.mode === 'plan'
            || result.mode === 'autopilot'
            || result.mode === 'shell'
          ) {
            setTuiCopilotMode(result.mode)
          }
          if (typeof result.message === 'string' && result.message.trim()) {
            showNotice('info', result.message.trim())
          }
          return
        }
        if (!parsed) return
        const parsedRecord = parsed as Record<string, unknown>

        const pendingPermission = extractPendingPermission(parsed)
        if (pendingPermission) {
          noteFirstOutput()
          const codexQuestionMessage = codexQuestionLiveMessage(pendingPermission, targetSession)
          if (codexQuestionMessage) {
            composerTurnProducedOutputRef.current = true
            setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, codexQuestionMessage))
          }
          setPermissionOptionIndex(0)
          setPendingPermissions((prev) => [...prev.filter((entry) => entry.id !== pendingPermission.id), pendingPermission])
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
        const commandLifecycle = parseClaudeCommandLifecycle(parsedRecord)
        if (commandLifecycle) {
          const { commandUuid, state } = commandLifecycle
          const tracked = steeredComposerSendsRef.current.find((entry) => entry.messageUuid === commandUuid)
          if (tracked) {
            if (state === 'cancelled' || state === 'discarded') {
              steeredComposerSendsRef.current = steeredComposerSendsRef.current.filter((entry) => entry.messageUuid !== commandUuid)
              setLiveTranscriptMessages((prev) => prev.filter((message) => message.uuid !== tracked.liveMessageUuid))
            } else {
              steeredComposerSendsRef.current = steeredComposerSendsRef.current.map((entry) =>
                entry.messageUuid === commandUuid ? { ...entry, state } : entry)
            }
          }
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
        if (parsedRecord.type === 'system' && parsedRecord.subtype === 'thinking_tokens') {
          if (typeof parsedRecord.estimated_tokens === 'number') {
            setComposerThinkingTokens(parsedRecord.estimated_tokens)
          }
        }
        // A model refusal fell back to another model — evict the refused partial
        // from the live overlay so it doesn't linger (the banner arrives via the
        // normal threaded path).
        if (parsedRecord.type === 'system' && parsedRecord.subtype === 'model_refusal_fallback') {
          const uuids = Array.isArray(parsedRecord.retracted_message_uuids)
            ? parsedRecord.retracted_message_uuids.filter((u): u is string => typeof u === 'string')
            : []
          if (uuids.length > 0) {
            const retracted = new Set(uuids)
            setLiveTranscriptMessages((prev) => prev.filter((m) => !retracted.has(m.uuid)))
          }
          setComposerLiveText('')
          setComposerLiveReasoning('')
        }
        // Pi surfaces auto-retry / auto-compaction as non-fatal progress so the
        // turn doesn't look hung while it recovers (mirrors native Pi).
        if (parsedRecord.type === 'pi_status') {
          if (parsedRecord.status === 'retry_start') setLiveStatus('retrying')
          else if (parsedRecord.status === 'compaction_start' || parsedRecord.status === 'summarization_retry_start') setLiveStatus('compacting')
          else if (parsedRecord.status === 'retry_end' || parsedRecord.status === 'compaction_end' || parsedRecord.status === 'summarization_retry_end') setLiveStatus(null)
          else if (parsedRecord.status === 'title_changed' && typeof parsedRecord.name === 'string') {
            const name = parsedRecord.name
            setSessionDetail((prev) => prev ? { ...prev, info: prev.info ? { ...prev.info, customTitle: name } : prev.info } : prev)
          }
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
          noteFirstOutput()
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
            // content_block_stop only means the call finished streaming — the
            // tool itself runs after this, so the card stays running until its
            // tool_result arrives below.
          }
          liveToolInputJsonRef.current.delete(stopIndex)
          liveToolIndexesRef.current.delete(stopIndex)
        }

        // Real tool output for a live Claude card: fills in exit code, line
        // counts, diffs and errors while the turn is still running.
        const claudeToolResults = extractClaudeStreamToolResults(parsed)
        if (claudeToolResults.length > 0) {
          setLiveTranscriptMessages((prev) => claudeToolResults.reduce(applyLiveToolResult, prev))
          setLiveToolActivities((prev) => prev.map((activity) => claudeToolResults.some((r) => r.tool_use_id === activity.key)
            ? { ...activity, status: 'done' }
            : activity))
        }

        const openCodeToolThread = extractOpenCodeLiveToolThread(parsed, targetSession)
        if (openCodeToolThread) {
          noteFirstOutput()
          composerTurnProducedOutputRef.current = true
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, openCodeToolThread))
        }

        const openCodeSubagent = extractOpenCodeLiveSubagent(parsed)
        if (openCodeSubagent) {
          noteFirstOutput()
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
            noteFirstOutput()
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
            noteFirstOutput()
            copilotFinalMessageSeen = true
            const finalText = extractStreamingAssistantText(parsed)
            if (finalText) replyAccumulator = finalText
            pendingLiveTextRef.current = ''
            setComposerLiveText('')
            setLiveTranscriptMessages((prev) => upsertThreadedMessage(
              prev.filter((message) => (
                liveMessageSessionKey(message) !== targetKey
                || !isLiveAssistantTextMessage(message)
              )),
              threaded,
            ))
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
          noteFirstOutput()
          setLiveStatus(null)
          pendingLiveReasoningRef.current = `${pendingLiveReasoningRef.current}${reasoningDelta}`
          liveTextTargetSessionRef.current = targetSession
          if (liveTextFlushTimerRef.current == null) {
            liveTextFlushTimerRef.current = setTimeout(flushLiveText, LIVE_TEXT_FLUSH_MS)
          }
        }

        const delta = extractStreamingAssistantText(parsed)
        if (!delta) return
        noteFirstOutput()
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
        if (targetSession.provider === 'claude') {
          const textBlockIndex = streamEventIndex(parsed, 'content_block_delta')
          if (textBlockIndex != null) {
            const blockText = `${claudeLiveTextByIndex.get(textBlockIndex) ?? ''}${delta}`
            claudeLiveTextByIndex.set(textBlockIndex, blockText)
            setLiveTranscriptMessages((prev) => upsertThreadedMessage(
              prev,
              makeLiveAssistantTextMessage(
                targetSession,
                blockText,
                `${CLAUDE_LIVE_ASSISTANT_UUID_PREFIX}${textBlockIndex}`,
              ),
            ))
          }
        } else if (targetSession.provider === 'codex') {
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
        } else {
          const liveMessageKey = liveAssistantTextKey(parsedRecord, targetSession.provider)
          const liveMessageText = replace
            ? delta
            : `${providerLiveTextByKey.get(liveMessageKey) ?? ''}${delta}`
          providerLiveTextByKey.set(liveMessageKey, liveMessageText)
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(
            prev,
            makeLiveAssistantTextMessage(targetSession, liveMessageText, liveMessageKey),
          ))
        }
        pendingLiveTextRef.current = replace ? delta : `${pendingLiveTextRef.current}${delta}`
        liveTextTargetSessionRef.current = targetSession
        // One flush path for every provider: coalesce through a render-loop-
        // independent timer (see LIVE_TEXT_FLUSH_MS — must NOT be
        // requestAnimationFrame). opencode used to flush synchronously here, but
        // that was only a workaround for the OpenTUI RAF freeze the timer now
        // solves generically — so the provider split is gone.
        if (liveTextFlushTimerRef.current == null) {
          liveTextFlushTimerRef.current = setTimeout(flushLiveText, LIVE_TEXT_FLUSH_MS)
        }
      }

      // Stall watchdog: only Claude emits server heartbeats, so only Claude can
      // be confidently judged dead-vs-slow. Race each read against a timeout; on
      // a stall, stop owning the stream and fall through to the completion path
      // (awaitingPersistedTurn + a detail refresh) so the still-running turn keeps
      // rendering from the persisted log instead of a frozen "sending" spinner.
      const stallGuard = targetSession.provider === 'claude'
      let streamStalled = false
      while (true) {
        let readResult: ReadableStreamReadResult<Uint8Array>
        if (stallGuard) {
          const readPromise = reader.read()
          readPromise.catch(() => {}) // abandoned on stall; swallow its rejection
          let stallTimer: ReturnType<typeof setTimeout> | undefined
          const stallPromise = new Promise<typeof STREAM_STALL_SENTINEL>((resolve) => {
            stallTimer = setTimeout(() => resolve(STREAM_STALL_SENTINEL), CLAUDE_STREAM_STALL_MS)
          })
          const raced = await Promise.race([readPromise, stallPromise])
          if (stallTimer) clearTimeout(stallTimer)
          if (raced === STREAM_STALL_SENTINEL) { streamStalled = true; break }
          readResult = raced
        } else {
          readResult = await reader.read()
        }
        const { done, value } = readResult
        if (done) break
        sseBuffer += decoder.decode(value, { stream: true })
        const { frames, remaining } = extractSseFrames(sseBuffer)
        sseBuffer = remaining
        for (const frame of frames) {
          handleFrame(frame)
        }
      }

      if (streamStalled) {
        showNotice('info', 'Live stream stalled — turn still running; syncing transcript.')
      }

      if (sseBuffer.trim()) {
        const { frames } = extractSseFrames(`${sseBuffer}\n\n`)
        for (const frame of frames) {
          handleFrame(frame)
        }
      }

      if (targetSession.provider === 'copilot' && !copilotFinalMessageSeen && replyAccumulator.trim()) {
        setLiveTranscriptMessages((prev) => upsertThreadedMessage(
          prev.filter((message) => (
            liveMessageSessionKey(message) !== targetKey
            || !isLiveAssistantTextMessage(message)
          )),
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
      appendComposerSentHistory(submission.visibleText)
      setHistoryIndex(-1)
      setDraftBeforeHistory({ text: '', attachments: [], promptParts: [] })
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      setComposerSendState('idle')
      setInterruptPressActive(false)
      if (interruptPressTimeoutRef.current) {
        clearTimeout(interruptPressTimeoutRef.current)
        interruptPressTimeoutRef.current = null
      }
      setComposerError(null)
      if (commandResultWithoutTranscript) {
        liveTranscriptBaselineRef.current.delete(targetKey)
        setLiveTranscriptMessages((prev) => prev.filter((message) => liveMessageSessionKey(message) !== targetKey))
        liveToolIndexesRef.current.clear()
        liveToolInputJsonRef.current.clear()
        setAwaitingPersistedTurn(false)
      } else {
        setAwaitingPersistedTurn(true)
      }
      setFollowTail(true)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      setSelectedSessionKey(sessionKey(targetSession))
      void refreshSessions(provider, true, false)
      void refreshSelectedSessionDetail(targetSession, true)

      if (liveTextFlushTimerRef.current != null) {
        clearTimeout(liveTextFlushTimerRef.current)
        liveTextFlushTimerRef.current = null
      }
      pendingLiveTextRef.current = ''
      liveTextTargetSessionRef.current = null

      const elapsedMs = Date.now() - sendStartedAt
      if (elapsedMs >= NOTIFY_AFTER_MS) {
        const firstLine = replyAccumulator.split('\n').find((line) => line.trim().length > 0) ?? ''
        const preview = firstLine.length > NOTIFY_PREVIEW_CHARS
          ? `${firstLine.slice(0, NOTIFY_PREVIEW_CHARS - 1)}…`
          : firstLine || 'Reply ready'
        // Native OSC FFI: off on Windows, and only when the terminal advertises
        // notification support (capabilities is null when unknown — try anyway).
        // BMP-sanitize the model-generated preview/title before the boundary.
        if (NATIVE_OSC_ENABLED && renderer.capabilities?.notifications !== false) {
          try {
            renderer.triggerNotification(
              toBmpSafe(preview),
              toBmpSafe(`agent-viewer · ${formatSessionTitle(targetSession)}`),
            )
          } catch {
            // terminal doesn't support OSC notifications — silently ignore
          }
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
          if (liveTextFlushTimerRef.current != null) {
            clearTimeout(liveTextFlushTimerRef.current)
            liveTextFlushTimerRef.current = null
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
        if (liveTextFlushTimerRef.current != null) {
          clearTimeout(liveTextFlushTimerRef.current)
          liveTextFlushTimerRef.current = null
        }
        pendingLiveTextRef.current = ''
        liveTextTargetSessionRef.current = null
        return
      }
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
      const apiErrorStatus = err instanceof TransientAwareSendError ? err.apiErrorStatus : undefined
      // Visible auto-retry: ride out a transient API/network blip when the turn
      // produced no output yet (mirrors the web composer + Pi's native retry).
      // Keep the turn 'sending' with a 'retrying' status across the backoff,
      // then re-fire the same draft. The finally below preserves liveStatus
      // while a retry timer is armed (see the guarded setLiveStatus there).
      if (isTransientSendError(errorMessage, apiErrorStatus)
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
          void sendComposerMessage(retryDraft, retryAttachments, true, submission.promptParts, turnRequestId)
        }, transientRetryBackoffMs(attempt))
        return
      }
      // The stream died but the turn survived in the running registry — hand
      // off to the reattach poll instead of surfacing a send error (the web
      // composer's stall recovery, in-process). Keep the live echo + baseline:
      // the detail poll reconciles them once persisted rows land. Queued sends
      // stay armed; the queue flush is gated on reattachedRunning.
      let turnStillRunning = false
      if (!targetSession.isPending) {
        try {
          turnStillRunning = (await listTuiRunningSessions()).some((entry) =>
            entry.sessionId === targetSession.sessionId
            && entry.provider === (targetSession.provider ?? 'claude'))
        } catch { /* registry probe is best-effort */ }
      }
      if (turnStillRunning) {
        setComposerSendState('idle')
        setComposerError(null)
        setLiveStatus(null)
        setLiveToolActivities([])
        if (selectedSessionKeyRef.current === targetKey) {
          reattachedRunningKeyRef.current = targetKey
          reattachedRunningRef.current = true
          setReattachedRunning(true)
        }
        showNotice('info', 'Send stream lost — reattached to the running turn', 3500)
        return
      }
      const failedDraft = submission.visibleText
      setComposerSendState('error')
      setComposerError(err instanceof Error ? err.message : 'Failed to send message')
      setComposerLiveText('')
      setLiveStatus(null)
      setLiveToolActivities([])
      setAwaitingPersistedTurn(false)
      // Don't auto-fire queued follow-ups after a failed turn. Rebuild one
      // editable snapshot from the failed send, every queued follow-up, and the
      // newest draft typed while the turn ran—attachments and prompt parts too.
      const failedQueue = selectComposerQueueTarget(queuedComposerSendsRef.current, targetKey)
      commitQueuedComposerSends(clearComposerQueueTarget(queuedComposerSendsRef.current, targetKey))
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
      const restoredPayload = restoreComposerDraftPayload(
        {
          text: composerTextareaRef.current?.plainText ?? '',
          attachments: composerMentionAttachmentsRef.current,
        },
        failedQueue,
        { text: failedDraft, attachments: sendAttachments },
      )
      const restoredParts = [
        ...submission.promptParts,
        ...failedQueue.flatMap((entry) => entry.promptParts),
        ...composerPromptPartsRef.current,
      ]
      const restoredDraft = restoredPayload.text
      composerTextareaRef.current?.setText(restoredDraft)
      setComposerDraft(restoredDraft)
      composerMentionAttachmentsRef.current = restoredPayload.attachments
      composerPromptPartsRef.current = restoredParts
      setComposerMentionAttachments(restoredPayload.attachments)
      setComposerPromptParts(restoredParts)
      restoreComposerPromptPartExtmarks(restoredParts, restoredDraft)
    } finally {
      void reader?.cancel()
      composerAbortRef.current = null
      if (activeComposerTurnRequestIdRef.current === turnRequestId) {
        activeComposerTurnRequestIdRef.current = null
      }
      if (liveTextFlushTimerRef.current != null) {
        clearTimeout(liveTextFlushTimerRef.current)
        liveTextFlushTimerRef.current = null
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
      // Single stream at a time, so an unconditional clear is safe (targetKey
      // may be stale after a pending→real session-id rename).
      ownedTurnKeyRef.current = null
      if (activeComposerSendCleanupRef.current === turnCleanupPromise) {
        activeComposerSendCleanupRef.current = null
      }
      resolveTurnCleanup()
    }
  }, [
    canUseChannelBridge,
    canUseIdeBridge,
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
    composerEnableWorkflow,
    tuiEffort,
    tuiCopilotMode,
    composerCopilotPermissionMode,
    composerCodexApproval,
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
    if (activeQueuedComposerSends.length === 0) return
    if (!runningRegistryReady) return
    if (composerSendState !== 'idle') return
    // A turn we reattached to is still running server-side — flushing now
    // would start a second concurrent turn. The registry poll clears the flag
    // when the turn ends.
    if (reattachedRunning || composerTargetTurnKnownRunning) return
    const next = activeQueuedComposerSends[0]!
    const remaining = removeComposerQueueItem(queuedComposerSendsRef.current, next.id)
    // Persist dequeue before provider I/O so a process crash cannot replay a
    // prompt that may already have reached a tool-capable agent.
    commitQueuedComposerSends(remaining)
    void sendComposerMessage(next.text, next.attachments, false, next.promptParts)
  }, [activeQueuedComposerSends, composerSendState, composerTargetTurnKnownRunning, reattachedRunning, runningRegistryReady, sendComposerMessage])

  // Reattach to turns this composer doesn't own a stream for. In-process the
  // running registry is a cheap synchronous read; remotely attached it's the
  // daemon's /api/sessions/running (same shape). Reconcile sidebar running
  // marks for every live session, flag the selected session as reattached
  // when its turn runs unowned, and re-surface any pending Claude prompts the
  // turn is blocked on (the stream that delivered them is gone after a stream
  // death; answering still resolves them server-side by id).
  type RunningRegistryEntry = Awaited<ReturnType<typeof listTuiRunningSessions>>[number]
  const registryPollInFlightRef = useRef(false)
  const runningRegistryByKeyRef = useRef(new Map<string, RunningRegistryEntry>())
  const reconcileSelectedRunningRegistry = useCallback((
    runningByKey: Map<string, RunningRegistryEntry>,
    ownedKey: string | null,
  ) => {
    const selectedKey = selectedSessionKeyRef.current
    const selectedEntry = selectedKey ? runningByKey.get(selectedKey) : undefined
    const reattached = Boolean(selectedEntry) && selectedKey !== ownedKey && !awaitingPersistedTurnRef.current
    reattachedRunningKeyRef.current = reattached && selectedKey ? selectedKey : null
    setReattachedRunning((prev) => (prev === reattached ? prev : reattached))

    if (!selectedKey || selectedKey === ownedKey) return
    if (selectedEntry) {
      // While idle for this session, the registry is authoritative for every
      // provider's still-answerable approvals/questions, not only Claude's.
      const permissionPayloads = selectedEntry.pendingPermissions.length > 0
        ? selectedEntry.pendingPermissions
        : selectedEntry.pendingPrompts.map((data) => ({
            type: 'claude_permission',
            event: { type: 'permission.requested', data },
          }))
      const prompts = extractPendingPermissions(permissionPayloads, selectedEntry)
      setPendingPermissions((prev) => {
        const others = prev.filter((p) => !(p.provider === selectedEntry.provider && p.sessionId === selectedEntry.sessionId))
        const next = [...others, ...prompts]
        return next.map((p) => p.id).join('|') === prev.map((p) => p.id).join('|') ? prev : next
      })
    } else if (!selectedEntry) {
      // No turn running for the selected session — drop any reattached prompt
      // left behind by a turn that ended or timed out unanswered.
      const selectedSessionForKey = sessionsByKeyRef.current.get(selectedKey)
      if (selectedSessionForKey) {
        setPendingPermissions((prev) => {
          const selectedProvider = selectedSessionForKey.provider ?? 'claude'
          const next = prev.filter((p) => !(p.provider === selectedProvider && p.sessionId === selectedSessionForKey.sessionId))
          return next.length === prev.length ? prev : next
        })
      }
    }
  }, [])
  useEffect(() => {
    const poll = async () => {
      if (registryPollInFlightRef.current) return
      registryPollInFlightRef.current = true
      let activity: Awaited<ReturnType<typeof readTuiRuntimeActivity>>
      try {
        activity = await readTuiRuntimeActivity()
      } catch {
        return // registry probe is best-effort
      } finally {
        registryPollInFlightRef.current = false
      }
      const entries = activity.running
      setRunningRegistryReady(true)
      setWaitingSessions(activity.waiting)
      setViewerAttentionNotes(activity.attention)
      const runningByKey = new Map(entries.map((entry) => [
        sessionKey({ sessionId: entry.sessionId, provider: entry.provider }),
        entry,
      ]))
      runningRegistryByKeyRef.current = runningByKey
      const ownedKey = composerAbortRef.current ? ownedTurnKeyRef.current : null
      const waitingKeys = new Set(activity.waiting.map((entry) => sessionKey(entry)))

      // Sidebar liveness for turns nobody owns (started before a session
      // switch, or surviving a dead stream).
      for (const [key, entry] of runningByKey) {
        if (key === ownedKey || reattachMarksRef.current.has(key)) continue
        const ref: RunningSessionRef = { sessionId: entry.sessionId, provider: entry.provider }
        reattachMarksRef.current.set(key, ref)
        markSessionRunning(ref)
      }
      for (const [key, ref] of reattachMarksRef.current) {
        if (runningByKey.has(key)) continue
        reattachMarksRef.current.delete(key)
        clearSessionRunning(ref)
        // An unowned turn just finished — surface it in the attention inbox
        // unless the user is already looking at that session.
        if (key !== selectedSessionKeyRef.current && !waitingKeys.has(key)) recordAttentionTurnDone(ref)
      }

      const selectedKey = selectedSessionKeyRef.current

      // Prompts blocking running turns on OTHER sessions feed the attention
      // inbox (the selected session's prompts reconcile into
      // pendingPermissions below). Notify once per prompt — these are exactly
      // the "an agent is waiting on you and you can't see it" moments.
      const background: PendingPermission[] = []
      for (const [key, entry] of runningByKey) {
        if (key === ownedKey || key === selectedKey) continue
        const permissionPayloads = entry.pendingPermissions.length > 0
          ? entry.pendingPermissions
          : entry.pendingPrompts.map((data) => ({
              type: 'claude_permission',
              event: { type: 'permission.requested', data },
            }))
        background.push(...extractPendingPermissions(permissionPayloads, entry))
      }
      setBackgroundPrompts((prev) => {
        const nextIds = background.map((p) => p.id).join('|')
        return nextIds === prev.map((p) => p.id).join('|') ? prev : background
      })
      const liveIds = new Set(background.map((p) => p.id))
      for (const id of attentionNotifiedRef.current) {
        if (!liveIds.has(id)) attentionNotifiedRef.current.delete(id)
      }
      for (const prompt of background) {
        if (attentionNotifiedRef.current.has(prompt.id)) continue
        attentionNotifiedRef.current.add(prompt.id)
        notifyAttention(prompt.title, prompt.sessionId ?? '', prompt.provider ?? 'claude')
      }

      reconcileSelectedRunningRegistry(runningByKey, ownedKey)
    }
    void poll()
    const timer = setInterval(() => { void poll() }, REATTACH_POLL_MS)
    return () => clearInterval(timer)
  }, [markSessionRunning, clearSessionRunning, reconcileSelectedRunningRegistry])

  useEffect(() => {
    reconcileSelectedRunningRegistry(
      runningRegistryByKeyRef.current,
      composerAbortRef.current ? ownedTurnKeyRef.current : null,
    )
  }, [reconcileSelectedRunningRegistry, selectedSessionKey])

  // Pull the most-recently queued message back into the composer to edit it
  // (cancels that one send). Any current draft is preserved by prepending it,
  // mirroring the interrupt-restore ordering. Attachments restore too.
  const popNewestQueuedComposerSend = useEffectEvent(() => {
    const targetKey = composerTargetSessionIdentity
    const queue = selectComposerQueueTarget(queuedComposerSendsRef.current, targetKey)
    if (queue.length === 0) return
    const item = queue[queue.length - 1]!
    commitQueuedComposerSends(removeComposerQueueItem(queuedComposerSendsRef.current, item.id))
    const currentDraft = (composerTextareaRef.current?.plainText ?? composerDraft).trim()
    const restored = [currentDraft, item.text].filter(Boolean).join('\n\n')
    const restoredAttachments = mergeComposerAttachments(composerMentionAttachmentsRef.current, item.attachments)
    const restoredParts = [...item.promptParts, ...composerPromptPartsRef.current]
    composerTextareaRef.current?.setText(restored)
    setComposerDraft(restored)
    composerMentionAttachmentsRef.current = restoredAttachments
    composerPromptPartsRef.current = restoredParts
    setComposerMentionAttachments(restoredAttachments)
    setComposerPromptParts(restoredParts)
    restoreComposerPromptPartExtmarks(restoredParts, restored)
    setComposerActive(true)
  })

  // Cancel every queued message at once without firing any of them.
  const clearQueuedComposerSends = useEffectEvent(() => {
    const targetKey = composerTargetSessionIdentity
    if (!targetKey || !queuedComposerSendsRef.current.some((entry) => entry.targetKey === targetKey)) return
    commitQueuedComposerSends(clearComposerQueueTarget(queuedComposerSendsRef.current, targetKey))
  })

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
          configuredTranscriptWidth,
          configuredTabsEnabled,
          configuredSidebarSort,
          configuredSidebarWidth,
          configuredShowToolCalls,
          configuredVelocityScroll,
          configuredSplitPanes,
        ] = await Promise.all([
          readTuiTheme(),
          readTuiProvider(),
          readTuiRailVisible(),
          readTuiFocusMode(),
          readTuiDensity(),
          readTuiDiffLayout(),
          readTuiTranscriptView(),
          readTuiTranscriptWidth(),
          readTuiTabsEnabled(),
          readTuiSidebarSort(),
          readTuiSidebarWidth(),
          readTuiShowToolCalls(),
          readTuiVelocityScroll(),
          readTuiSplitPanes(),
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
        setTranscriptWidth(configuredTranscriptWidth)
        setTabsEnabled(configuredTabsEnabled)
        setSidebarSort(configuredSidebarSort)
        setSidebarWidthPreference(configuredSidebarWidth)
        setShowToolCalls(configuredShowToolCalls)
        setVelocityScrollEnabled(configuredVelocityScroll)
        setSplitPaneCount(configuredSplitPanes)
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

    // Debounce the actual open so rapid scrubbing through the sidebar doesn't
    // load + reformat a transcript for every session passed through. The
    // cleanup clears the pending timer when the selection changes again, so
    // only the session we land on (and hold for DETAIL_OPEN_DELAY_MS) renders.
    // The previously-shown transcript stays visible during the wait — no flash.
    const target = selectedSessionTarget
    const timer = setTimeout(() => {
      // Display is owned by refreshSelectedSessionDetail's cache-first branch,
      // which is single-flight-gated: if a load is already running (still
      // scrubbing) it defers without rendering this session, so intermediates
      // never open. The previously-shown transcript stays put until we settle.
      void refreshSelectedSessionDetail(target, true)
    }, DETAIL_OPEN_DELAY_MS)
    return () => clearTimeout(timer)
  }, [bootstrapped, refreshSelectedSessionDetail, selectedSession?.isPending, selectedSessionIdentity, selectedSessionTarget])

  // Neighbour prefetch: once a session settles (committedSessionKey catches up
  // to the selection), warm the detail cache for the sessions around it in
  // sidebar order — nearest first, alternating below/above — so scrubbing one
  // step in either direction opens instantly instead of paying the first-visit
  // worker read. Keyed on the SETTLED key so it never fires mid-scrub, and
  // each step re-checks that no real open is (or is about to be) running —
  // the threading worker is serial, so a prefetch posted ahead of a real open
  // would delay it.
  useEffect(() => {
    if (!bootstrapped || !committedSessionKey) return undefined
    let cancelled = false
    const run = async () => {
      const sessionEntries = sidebarEntriesRef.current.flatMap((entry) => {
        const session = sidebarEntrySession(entry)
        return session ? [session] : []
      })
      const idx = sessionEntries.findIndex((session) => sessionKey(session) === committedSessionKey)
      if (idx < 0) return
      const neighbors: Session[] = []
      for (let distance = 1; distance <= NEIGHBOR_PREFETCH_RADIUS; distance++) {
        const below = sessionEntries[idx + distance]
        if (below && !below.isPending) neighbors.push(below)
        const above = sessionEntries[idx - distance]
        if (above && !above.isPending) neighbors.push(above)
      }
      for (const neighbor of neighbors) {
        if (cancelled) return
        // Yield to real work: an open in flight (or queued), or the user has
        // already scrubbed off the settled session.
        if (foregroundLoadInFlightRef.current || pendingForegroundLoadRef.current) return
        if (selectedSessionKeyRef.current !== committedSessionKey) return
        await prefetchSessionDetail(neighbor)
      }
    }
    const timer = setTimeout(() => { void run() }, NEIGHBOR_PREFETCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [bootstrapped, committedSessionKey, prefetchSessionDetail])

  // Clear stale live todos on session switch
  useEffect(() => {
    setComposerLiveTodos([])
  }, [selectedSessionIdentity])

  // Drafts follow the effective send target, not merely the primary reader.
  // A pane-targeted composer must never inherit or clear another session's
  // draft just because that session remains selected behind the overlay.
  useEffect(() => {
    if (!composerTargetSessionIdentity) return
    const key = composerTargetSessionIdentity
    const previousKey = composerDraftStorageKeyRef.current
    if (previousKey && previousKey !== key) {
      const outgoingDraft = composerTextareaRef.current?.plainText ?? composerDraftRef.current
      scheduleWriteComposerDraft(previousKey, outgoingDraft)
      // Attachments and structured prompt parts are not persisted, so clear
      // them rather than leaking them into a different session's composer.
      setComposerMentionAttachments([])
      setComposerPromptParts([])
      composerTextareaRef.current?.extmarks.clear()
    }
    composerDraftStorageKeyRef.current = key
    const saved = readComposerDraft(key)
    if (saved !== composerDraftRef.current) {
      composerDraftRef.current = saved
      setComposerDraft(saved)
      composerTextareaRef.current?.setText(saved)
    }
  }, [composerTargetSessionIdentity])

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
      sessionKey: committedSessionKey,
      loaded: committedSessionKey == null,
      state: null,
    })

    if (!committedSessionKey) {
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      try {
        const state = await readTuiSessionReaderState(committedSessionKey)
        if (cancelled) return
        setRestoredReaderState({
          sessionKey: committedSessionKey,
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
          sessionKey: committedSessionKey,
          loaded: true,
          state: null,
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [committedSessionKey])

  useEffect(() => {
    // Skip building the `allowed` Set when both sets are empty — the common
    // case on a freshly loaded session — otherwise every poll rebuilds an
    // O(n) Set from the transcript for nothing. We also build the allowed
    // Set at most once and share it between both state updates.
    const allowed = new Set(transcriptCards.map((card) => card.key))
    setExpandedCardKeys((current) => {
      if (current.size === 0) return current
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
    const currentLength = transcriptCards.length
    const currentLastKey = transcriptCards.at(-1)?.key ?? null
    const previous = previousTranscriptRef.current
    const sameSession = previous.sessionKey === committedSessionKey

    if (currentLength === 0) {
      setTranscriptCursorKey(null)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      previousTranscriptRef.current = { sessionKey: committedSessionKey, length: 0, lastKey: null }
      return
    }

    if (!sameSession) {
      if (restoredReaderState.sessionKey !== committedSessionKey || !restoredReaderState.loaded) return
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
      previousTranscriptRef.current = { sessionKey: committedSessionKey, length: currentLength, lastKey: currentLastKey }
      return
    }

    if (followTail) {
      setTranscriptCursorKey(visibleTranscriptCards[visibleTranscriptCards.length - 1].key)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      previousTranscriptRef.current = { sessionKey: committedSessionKey, length: currentLength, lastKey: currentLastKey }
      return
    }

    // Detached readers need append accounting, but do not allocate a second
    // full key array. The scan is limited to this paused-reader path; the
    // common tail-following live stream above remains O(1).
    const previousLastIndex = previous.lastKey
      ? transcriptCards.findIndex((card) => card.key === previous.lastKey)
      : -1
    const appendedCount = previousLastIndex >= 0
      ? currentLength - previousLastIndex - 1
      : 0

    if (appendedCount > 0) {
      setPendingNewCount(appendedCount)
      setUnreadBoundaryKey((current) => {
        if (current && transcriptCards.some((card) => card.key === current)) return current
        return transcriptCards[previousLastIndex + 1]?.key ?? null
      })
    }

    setTranscriptCursorKey((current) => {
      if (current && transcriptCards.some((card) => card.key === current)) return current
      return visibleTranscriptCards[Math.max(cursorIndex, 0)]?.key ?? visibleTranscriptCards[0].key
    })
    previousTranscriptRef.current = { sessionKey: committedSessionKey, length: currentLength, lastKey: currentLastKey }
    // cursorIndex is intentionally omitted from deps: the effect reconciles
    // cursor/pending state when transcriptCards changes, and the cursorIndex
    // fallback only fires when the current cursor key is missing from the new
    // card list. Re-running on every j/k keystroke would do O(n) indexOf +
    // includes work over the full transcript for a no-op setter result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    followTail,
    restoredReaderState,
    committedSessionKey,
    transcriptCards,
    visibleTranscriptCards,
    transcriptIndexByKey,
  ])

  // Load bookmarks for the session whose transcript is actually displayed.
  // Keyed on the committed (debounced) session, not the live selection, so
  // scrubbing doesn't fire a fetch — and a stale resolve doesn't churn
  // bookmarkKeys (a transcriptChildren dep) while an older transcript shows.
  useEffect(() => {
    const target = transcriptSession
    if (!target) { setBookmarkKeys(new Set()); return }
    let cancelled = false
    void readTuiSessionBookmarkIds({ sessionId: target.sessionId, provider: target.provider } as Session)
      .then((ids) => { if (!cancelled) setBookmarkKeys(new Set(ids)) })
      .catch(() => { if (!cancelled) setBookmarkKeys(new Set()) })
    return () => { cancelled = true }
  }, [committedSessionKey])

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

  // A pending prefix must not survive into the composer: overlay and composer
  // key handlers run before the chord branch, so a chord left dangling there
  // would swallow the next reader keystroke long after the user moved on.
  useEffect(() => {
    if (composerActive && splitChordPending) setSplitChordPending(false)
  }, [composerActive, splitChordPending])

  // Focus can outlive the pane that held it: closing a pane, a narrower
  // terminal, or a closed tab all shrink visibleSplitPaneCount. Opening the
  // composer also hands the keys back — the composer branch runs first, so a
  // pane left "focused" would only be a lie in the frame.
  useEffect(() => {
    if (splitFocusIndex === null) return
    if (composerActive || splitFocusIndex >= visibleSplitPaneCount) setSplitFocusIndex(null)
  }, [composerActive, splitFocusIndex, visibleSplitPaneCount])

  // Track the reader box's real height. Reads after every commit (cheap
  // property read) and only setStates when it actually changed, so a resize
  // settles in one extra frame and idle renders don't loop.
  useLayoutEffect(() => {
    const measured = readerBoxRef.current?.height ?? 0
    if (measured > 0 && measured !== measuredReaderBoxHeight) setMeasuredReaderBoxHeight(measured)
  })

  // A closed composer drops its pane target, so the next send goes to the
  // reader's session unless the user aims it again.
  useEffect(() => {
    if (!composerActive && composerPaneTargetKey !== null) setComposerPaneTargetKey(null)
  }, [composerActive, composerPaneTargetKey])

  useEffect(() => {
    if (
      composerPreferredTargetKey !== null
      && (
        selectedSessionKey !== composerPreferredTargetKey
        || (
          !composerActive
          && composerPreparingTargetKey !== composerPreferredTargetKey
          && !newSessionModalOpen
          && !worktreeModalOpen
        )
      )
    ) {
      setComposerPreferredTargetKey(null)
    }
  }, [composerActive, composerPreferredTargetKey, composerPreparingTargetKey, newSessionModalOpen, selectedSessionKey, worktreeModalOpen])

  // Reconcile split-pane pins against the open tabs. This is the ONLY writer of
  // splitPinnedKeys besides the explicit \ and | commands, and it holds three
  // rules:
  //   · a pin whose tab was closed is dropped
  //   · navigating INTO a pinned session hands that pane the session the reader
  //     just left, so the set of visible transcripts stays put instead of every
  //     pane reshuffling around the new active tab
  //   · short lists fill from the remaining tabs in tab order
  const previousSelectedSessionKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const previousSelected = previousSelectedSessionKeyRef.current
    if (previousSelected !== selectedSessionKey) previousSelectedSessionKeyRef.current = selectedSessionKey
    if (splitPaneCount === 0) {
      setSplitPinnedKeys((current) => (current.length === 0 ? current : []))
      return
    }
    setSplitPinnedKeys((current) => {
      const candidateKeys = openTabSessions
        .map((tab) => sessionKey(tab))
        .filter((tabKey) => tabKey !== selectedSessionKey)
      const next: string[] = []
      for (const pinnedKey of current) {
        if (next.includes(pinnedKey)) continue
        if (candidateKeys.includes(pinnedKey)) {
          next.push(pinnedKey)
        } else if (
          pinnedKey === selectedSessionKey
          && previousSelected
          && candidateKeys.includes(previousSelected)
          && !current.includes(previousSelected)
          && !next.includes(previousSelected)
        ) {
          next.push(previousSelected)
        }
      }
      for (const candidateKey of candidateKeys) {
        if (next.length >= splitPaneCount) break
        if (!next.includes(candidateKey)) next.push(candidateKey)
      }
      const trimmed = next.slice(0, splitPaneCount)
      const unchanged = trimmed.length === current.length
        && trimmed.every((pinnedKey, i) => pinnedKey === current[i])
      return unchanged ? current : trimmed
    })
  }, [openTabSessions, selectedSessionKey, splitPaneCount])

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

  const activeAgentToolCursorKey = groupedToolView
    && transcriptCursorKey
    && resolvedExpandedKeys.has(transcriptCursorKey)
    ? agentToolCursorByGroupKey[transcriptCursorKey] ?? null
    : null
  useEffect(() => {
    const scrollTargetKey = transcriptCursorScrollTargetKey(
      transcriptCursorKey,
      activeAgentToolCursorKey,
      followTail,
    )
    if (!scrollTargetKey) return
    const timer = setTimeout(() => {
      const scrollbox = transcriptScrollRef.current
      scrollbox?.scrollChildIntoView(`card:${scrollTargetKey}`)
      const scrollTop = scrollbox?.scrollTop
      if (typeof scrollTop === 'number') {
        pausedTranscriptScrollTopRef.current = scrollTop
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [activeAgentToolCursorKey, followTail, transcriptCursorKey])

  // ── Reader window management ───────────────────────────────────────────────
  // Reset the detached window whenever the displayed session changes or the
  // reader re-engages the tail — the derived tail window takes over.
  useEffect(() => {
    setReaderWindowStart(null)
    readerScrollFixupRef.current = null
  }, [committedSessionKey])
  useEffect(() => {
    if (followTail) setReaderWindowStart(null)
  }, [followTail])

  // Keyboard recenter: when the cursor (absolute index) leaves the comfortable
  // middle of the mounted window — within READER_WINDOW_MARGIN of an edge that
  // has more cards beyond it, or outside the window entirely (search jump,
  // bookmark jump, g) — recenter the window on the cursor. The fixup scrolls
  // the cursor card into view once the new window has mounted and laid out.
  // Gated on the cursor actually MOVING: wheel-scrolling slides the window
  // away from a stationary cursor, and recentering on it then would yank the
  // window straight back — a slide/recenter livelock against the scroll poll.
  const recenterCursorKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const cursorMoved = transcriptCursorKey !== recenterCursorKeyRef.current
    recenterCursorKeyRef.current = transcriptCursorKey
    if (!cursorMoved) return
    if (effectiveFocus !== 'messages' || followTail) return
    if (totalTranscriptCards <= READER_CARD_WINDOW) return
    if (cursorIndex < 0) return
    const nearStart = transcriptRenderStart > 0
      && cursorIndex < transcriptRenderStart + READER_WINDOW_MARGIN
    const nearEnd = transcriptRenderEnd < totalTranscriptCards
      && cursorIndex >= transcriptRenderEnd - READER_WINDOW_MARGIN
    if (!nearStart && !nearEnd) return
    const nextStart = clamp(
      cursorIndex - Math.floor(READER_CARD_WINDOW / 2),
      0,
      totalTranscriptCards - READER_CARD_WINDOW,
    )
    if (nextStart === transcriptRenderStart) return
    const cursorCard = visibleTranscriptCards[cursorIndex]
    if (cursorCard) readerScrollFixupRef.current = { kind: 'cursor', cardKey: cursorCard.key }
    setReaderWindowStart(nextStart)
  }, [cursorIndex, transcriptCursorKey, effectiveFocus, followTail, totalTranscriptCards, transcriptRenderStart, transcriptRenderEnd, visibleTranscriptCards])

  // Mouse-scroll slide: the scrollbox emits no scroll events, so while a
  // window is active poll scrollTop and slide when the viewport nears an edge
  // of the mounted content. The anchor card (first card retained by both
  // windows) pins the visual position across the slide.
  useEffect(() => {
    if (effectiveFocus !== 'messages' || isScrubbing) return undefined
    if (totalTranscriptCards <= READER_CARD_WINDOW) return undefined
    const interval = setInterval(() => {
      if (readerScrollFixupRef.current) return
      const sb = transcriptScrollRef.current
      if (!sb) return
      // Content not laid out yet (fresh mount) or shorter than the viewport —
      // scrollTop reads 0 and would spuriously trigger a top-edge slide.
      if (sb.scrollHeight <= sb.viewport.height) return
      const scrollTop = sb.scrollTop
      const beginSlide = (nextStart: number, anchorIndex: number): boolean => {
        const anchorCard = visibleTranscriptCards[anchorIndex]
        if (!anchorCard) return false
        const el = sb.content.findDescendantById(`card:${anchorCard.key}`)
        if (!el) return false
        const prevContentOffset = el.y - sb.content.y
        readerScrollFixupRef.current = {
          kind: 'anchor',
          anchorKey: anchorCard.key,
          prevContentOffset,
          viewportOffset: prevContentOffset - scrollTop,
        }
        setReaderWindowStart(nextStart)
        return true
      }
      if (scrollTop <= READER_EDGE_ROWS && transcriptRenderStart > 0) {
        // Anchor on the old window's first card — retained, near the viewport.
        const slid = beginSlide(
          Math.max(0, transcriptRenderStart - READER_WINDOW_SLIDE),
          transcriptRenderStart,
        )
        // Scrolling far up off the tail means reading history; the tail-pinned
        // derivation (and its scroll-to-bottom effects) must let go.
        if (slid && followTail) setFollowTail(false)
        return
      }
      const maxScroll = Math.max(0, sb.scrollHeight - sb.viewport.height)
      if (maxScroll - scrollTop <= READER_EDGE_ROWS && transcriptRenderEnd < totalTranscriptCards) {
        const nextStart = Math.min(
          transcriptRenderStart + READER_WINDOW_SLIDE,
          totalTranscriptCards - READER_CARD_WINDOW,
        )
        // Anchor on the new window's first card — the first card both windows share.
        beginSlide(nextStart, nextStart)
      }
    }, READER_SCROLL_POLL_MS)
    return () => clearInterval(interval)
  }, [effectiveFocus, isScrubbing, followTail, totalTranscriptCards, transcriptRenderStart, transcriptRenderEnd, visibleTranscriptCards])

  // Fixup executor: runs after the commit that changed the window. Yoga layout
  // happens on the next render frame, not at commit, so retry on a short timer
  // until layout has visibly run (the anchor's content offset moved / the
  // cursor card has a height), then correct the scroll position.
  useEffect(() => {
    const fixup = readerScrollFixupRef.current
    if (!fixup) return undefined
    readerScrollFixupRef.current = null
    let cancelled = false
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const attempt = () => {
      if (cancelled) return
      const sb = transcriptScrollRef.current
      if (!sb) return
      tries += 1
      if (fixup.kind === 'cursor') {
        const el = sb.content.findDescendantById(`card:${fixup.cardKey}`)
        if ((!el || el.height <= 0) && tries < READER_FIXUP_MAX_TRIES) {
          timer = setTimeout(attempt, READER_FIXUP_RETRY_MS)
          return
        }
        if (el) {
          sb.scrollChildIntoView(`card:${fixup.cardKey}`)
          pausedTranscriptScrollTopRef.current = sb.scrollTop
        }
        return
      }
      const el = sb.content.findDescendantById(`card:${fixup.anchorKey}`)
      if (!el) return // anchor unmounted (session switched mid-slide) — drop
      const contentOffset = el.y - sb.content.y
      if (contentOffset === fixup.prevContentOffset && tries < READER_FIXUP_MAX_TRIES) {
        timer = setTimeout(attempt, READER_FIXUP_RETRY_MS)
        return
      }
      sb.scrollTo(Math.max(0, contentOffset - fixup.viewportOffset))
      pausedTranscriptScrollTopRef.current = sb.scrollTop
    }
    timer = setTimeout(attempt, READER_FIXUP_RETRY_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [transcriptRenderStart, transcriptRenderEnd])

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

  // When switching to a filtered/grouped transcript mode the cursor may be on a
  // hidden technical card. Snap it to the last visible card so navigation stays coherent.
  useEffect(() => {
    if (transcriptView !== 'continue' && transcriptView !== 'stream' && transcriptView !== 'agents') return
    if (visibleTranscriptCards.length === 0) return
    const isVisible = transcriptCursorKey
      ? visibleTranscriptCards.some((c) => c.key === transcriptCursorKey)
      : false
    if (!isVisible) {
      setTranscriptCursorKey(visibleTranscriptCards[visibleTranscriptCards.length - 1].key)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptView])

  // Status bar: grouped keybindings rendered as colored inline segments —
  // keys pop in the accent color, labels stay muted, groups split by a dim
  // divider so the bar scans at a glance instead of reading as one dim wall.
  const footerSegments = useMemo<InlineTextSegment[]>(() => {
    const groups: Array<Array<[string, string]>> = composerActive
      ? [[
          ['Esc', 'transcript'],
          ['⇧⏎', 'newline'],
          ['⌃O', 'expand'],
          ...(composerSendState === 'sending'
            ? [['⌃C', 'cancel'], ['↵', 'queue']] as Array<[string, string]>
            : [['↵', 'send']] as Array<[string, string]>),
        ]]
      : [
          [['j/k', 'move'], ['⌃u/d', 'page'], ['tab', 'focus'], ['←/→', 'tabs'], ['w', 'close']],
          [['/', 'search'], ['n/N', 'hits'], ['u', 'unread'], ['f', 'live']],
          [['m', 'mark'], ['[ ]', 'jump'], ['⇧B', 'all'], ['b', effectiveFocus === 'sessions' ? 'tabs' : 'bookmark']],
          [['()', 'convo'], ['{}', 'tech'], ['e', 'fold'], ['v', transcriptView], ['s', `diff:${diffLayout}`], ['d', density], ['⇧W', transcriptWidth], ['i', 'think'], ['X', showToolCalls ? 'hide tools' : 'tools']],
          [['h', 'rail'], ['⇧T', 'tasks'], ['z', 'focus'], [
            RUNNING_INSIDE_TMUX ? '?' : '⌃B',
            RUNNING_INSIDE_TMUX
              ? `split palette · tmux captures ⌃B`
              : visibleSplitPaneCount > 0 ? `split ${visibleSplitPaneCount}` : 'split',
          ], ['V', velocityScrollEnabled ? 'vel off' : 'vel on']],
          [['⌃O', 'composer'], ['p', 'provider'], ['y', 'copy'], ['Q', 'reply'], ['r', 'refresh']],
          [['?', 'help'], ['q', 'quit']],
        ]
    const segs: InlineTextSegment[] = []
    // A pending prefix takes over the bar: the chord is modal, so the only keys
    // that matter right now are its own.
    if (splitChordPending) {
      return [
        { text: '⌃B', fg: theme.amber },
        { text: '  % split   x close   o focus   ; flip   1-2 pane   n next session   z toggle   esc cancel', fg: theme.muted },
      ]
    }
    // A focused pane owns the keys, so the bar advertises its keys, not the
    // reader's — otherwise it lists bindings that are inert right now.
    if (splitFocusIndex !== null) {
      return [
        { text: `split pane ${splitFocusIndex + 1}`, fg: theme.amber },
        {
          text: `  j/k card   e fold   y copy   b mark   Q reply   c send   ⌃G git   D diag   ↵ open   ${RUNNING_INSIDE_TMUX ? '? palette' : '⌃B o next'}   esc reader`,
          fg: theme.muted,
        },
      ]
    }
    // Attention badge leads the bar whenever an agent is blocked on a human —
    // it must be visible regardless of which pane or mode has focus.
    if (attentionNeedsInputCount > 0) {
      segs.push({ text: `⚠ ${attentionNeedsInputCount}`, fg: theme.amber })
      segs.push({ text: ' ! inbox · ⌃N next', fg: theme.muted })
      segs.push({ text: ' │ ', fg: theme.dim })
    }
    groups.forEach((group, gi) => {
      if (gi > 0) segs.push({ text: ' │ ', fg: theme.dim })
      group.forEach((binding, bi) => {
        if (bi > 0) segs.push({ text: '  ', fg: theme.dim })
        segs.push({ text: binding[0], fg: theme.cyan })
        segs.push({ text: ` ${binding[1]}`, fg: theme.muted })
      })
    })
    if (ATTACHED_DAEMON_HOST) {
      segs.push({ text: ' │ ', fg: theme.dim })
      segs.push({ text: `⇌ ${ATTACHED_DAEMON_HOST}`, fg: theme.cyan })
    }
    return segs
  }, [attentionNeedsInputCount, composerActive, composerSendState, diffLayout, transcriptView, density, transcriptWidth, showToolCalls, velocityScrollEnabled, visibleSplitPaneCount, splitChordPending, splitFocusIndex, effectiveFocus, theme])

  const turnRunningForComposer = composerSendState === 'sending' || reattachedRunning
  const composerStatusMessage = composerError
    ? composerError
    : activeQueuedComposerSends.length > 0 && !composerQueueDurable
      ? 'Queue persistence failed · keep this TUI open or edit the message back into the composer.'
    : awaitingPersistedTurn
      ? 'Syncing transcript…'
      : activeQueuedComposerSends.length > 0 && turnRunningForComposer
        ? (activeQueuedComposerSends.length === 1
          ? `Queued · sends after current turn: "${activeQueuedComposerSends[0]!.text.slice(0, 60)}${activeQueuedComposerSends[0]!.text.length > 60 ? '…' : ''}"`
          : `${activeQueuedComposerSends.length} queued · send in order after current turn`)
        : steeredSendNotice && turnRunningForComposer
          ? `Steered · delivered to the running turn: "${steeredSendNotice.slice(0, 60)}${steeredSendNotice.length > 60 ? '…' : ''}"`
          : composerSendState === 'sending'
          ? activeRunningToolCount > 0
            ? `Using ${activeRunningToolCount} tool${activeRunningToolCount === 1 ? '' : 's'}.`
            : composerLiveText
              ? 'Streaming assistant response.'
              : null
          // Plain reattached state renders as its own banner row (counted in
          // composerStatusBlockHeight), not through this message slot.
          : null
  // An explicit pane target outranks the auto-targeting note: the user aimed
  // this composer at a split pane and must be able to see that before sending.
  const composerTargetMessage = composerPaneTargetKey && composerTargetSession
    ? `Sending to split pane: ${formatSessionTitle(composerTargetSession)}`
    : composerAutoTargetingRunning && composerTargetSession
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

  // Adapter over the toast store, kept as the single feedback entry point (also
  // handed to popovers via their `onNotice` prop). info/error tones map to the
  // matching toast kinds; the store handles stacking and per-toast auto-dismiss.
  const showNotice = useCallback((tone: NoticeTone, text: string, durationMs?: number) => {
    const options = durationMs != null ? { durationMs } : undefined
    if (tone === 'error') toast.error(text, options)
    else toast.info(text, options)
  }, [])

  const showToggleOutcome = useEffectEvent((label: string, outcome: string | boolean) => {
    const state = typeof outcome === 'boolean' ? (outcome ? 'enabled' : 'disabled') : outcome
    showNotice('info', `${label} ${state}`)
  })

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

  const toggleComposerHidden = useEffectEvent(() => {
    setComposerHidden((hidden) => {
      const next = !hidden
      if (next) setComposerActive(false)
      showToggleOutcome('Composer', next ? 'hidden' : 'shown')
      return next
    })
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
    // dragging to select, without needing to press y. Native OSC FFI: off on
    // Windows (same opentui.dll segfault surface as notifications), and only
    // when the terminal advertises OSC 52 support. Clipboard text is copied
    // verbatim — not BMP-sanitized — so selections keep their exact contents.
    if (NATIVE_OSC_ENABLED && renderer.capabilities?.osc52 !== false) {
      renderer.copyToClipboardOSC52(text)
    }
  })

  usePaste((event) => {
    if (questionFreeformEditing) {
      const activePermission = pendingPermissions[0]
      const questions = activePermission?.questions ?? []
      const qi = Math.min(questionFocusIndex, questions.length - 1)
      const question = questions[qi]
      if (question?.allowFreeform) {
        event.preventDefault()
        event.stopPropagation()
        const text = Buffer.from(event.bytes).toString('utf8')
        setQuestionFreeformAnswers((prev) => ({ ...prev, [qi]: `${prev[qi] ?? ''}${text}` }))
        if (!question.multiSelect) setQuestionSelections((prev) => ({ ...prev, [qi]: [] }))
        return
      }
    }
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

  const copySelectedMessage = useEffectEvent(async (cardOverride?: TuiTranscriptCard) => {
    const terminalSelection = terminalSelectionRef.current
    if (
      terminalSelection
      && Date.now() - terminalSelection.capturedAt <= TERMINAL_SELECTION_COPY_WINDOW_MS
      && terminalSelection.text.trim()
    ) {
      try {
        await writeClipboard(terminalSelection.text, renderer)
        terminalSelectionRef.current = null
        showNotice('info', 'Copied terminal selection to clipboard')
      } catch (err) {
        showNotice('error', err instanceof Error ? err.message : 'Failed to copy selection')
      }
      return
    }

    const card = cardOverride ?? (cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null)
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
      await writeClipboard(text, renderer)
      showNotice('info', 'Copied selected message to clipboard')
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to copy to clipboard')
    }
  })

  const replySelectedMessage = useEffectEvent((cardOverride?: TuiTranscriptCard) => {
    const card = cardOverride ?? (cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null)
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
    if (!canUseChannelBridge) {
      showNotice('error', 'Select a Claude session to use the channel bridge')
      return
    }
    setChannelBridgeOpen(true)
  })

  const toggleComposerBridgeRoute = useEffectEvent(() => {
    if (!canUseChannelBridge) {
      showNotice('error', 'Select a Claude session to route the composer through the channel bridge')
      return
    }
    setRouteComposerToBridge((on) => {
      const next = !on
      showNotice('info', next ? 'Composer now routes to the live CLI bridge' : 'Composer back to the active provider')
      return next
    })
  })

  const openIdeBridge = useEffectEvent(() => {
    if (!canUseIdeBridge) {
      showNotice('error', 'Select a Claude session to use the IDE bridge')
      return
    }
    setIdeBridgeOpen(true)
  })

  const toggleComposerIdeRoute = useEffectEvent(() => {
    if (!canUseIdeBridge) {
      showNotice('error', 'Select a Claude session to route the composer through the IDE bridge')
      return
    }
    setRouteComposerToIde((on) => {
      const next = !on
      showNotice('info', next ? 'Composer now pushes @mentions to the IDE session' : 'Composer back to the active provider')
      return next
    })
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
      await writeClipboard(cmd, renderer)
      showNotice('info', `Copied: ${cmd}`)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to copy')
    }
  })

  // Split panes are driven by a tmux-style prefix chord (⌃B then a command key),
  // so the reader's single-key namespace stays free. applySplitPaneCount is the
  // one writer of the count — it persists and narrates every change.
  const applySplitPaneCount = useEffectEvent((next: number, label?: string) => {
    setSplitPaneCount(next)
    void writeTuiSplitPanes(next).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store split view setting')
    })
    if (next === 0) {
      showNotice('info', label ?? 'Split transcript view off')
      return
    }
    // Narrate the requested NEXT layout. Reading splitPaneWidth here would use
    // the previous render, which made the first successful split falsely claim
    // that even wide terminals were too narrow.
    const nextLayout = calculateSplitPaneLayout({
      readerAreaWidth,
      requestedCount: next,
      availableCount: Math.min(next, splitCandidateSessions.length),
      maxPanes: SPLIT_PANE_MAX,
      minPaneWidth: SPLIT_PANE_MIN_WIDTH,
      minReaderWidth: MIN_READER_WIDTH,
    })
    if (nextLayout.visibleCount < next) {
      showNotice('info', `Split panes: ${nextLayout.visibleCount}/${next} visible (widen the terminal or hide the rail with h)`)
      return
    }
    showNotice('info', label ?? (
      RUNNING_INSIDE_TMUX
        ? `Split panes: ${next} · use ? palette (tmux captures ⌃B)`
        : `Split panes: ${next} · ⌃B o next pane · ⌃B x close`
    ))
  })

  const addSplitPane = useEffectEvent(() => {
    if (splitCandidateSessions.length === 0) {
      showNotice('error', 'Open another tab to split the transcript view')
      return
    }
    const maxPanes = Math.min(SPLIT_PANE_MAX, splitCandidateSessions.length)
    if (splitPaneCount >= maxPanes) {
      showNotice('info', `Already showing ${splitPaneCount} split pane${splitPaneCount === 1 ? '' : 's'} (max ${maxPanes})`)
      return
    }
    applySplitPaneCount(splitPaneCount + 1)
  })

  const closeSplitPane = useEffectEvent(() => {
    if (splitPaneCount === 0) {
      showNotice('info', 'No split panes open')
      return
    }
    const nextCount = splitPaneCount - 1
    const closeIndex = splitFocusIndex ?? Math.max(splitPaneCount - 1, 0)
    setSplitPinnedKeys((current) => removeSplitPaneKey(current, closeIndex))
    if (splitFocusIndex !== null) {
      const nextFocus = nextCount > 0 ? Math.min(closeIndex, nextCount - 1) : null
      setSplitFocusIndex(nextFocus)
      if (nextFocus !== null) lastFocusedSplitPaneRef.current = nextFocus
    }
    applySplitPaneCount(nextCount)
  })

  // ⌃B z is the quick on/off: it restores the pane count you last had open
  // rather than always coming back with a single pane.
  const lastSplitPaneCountRef = useRef(1)
  const toggleSplitPanes = useEffectEvent(() => {
    if (splitPaneCount > 0) {
      lastSplitPaneCountRef.current = splitPaneCount
      applySplitPaneCount(0)
      return
    }
    if (splitCandidateSessions.length === 0) {
      showNotice('error', 'Open another tab to split the transcript view')
      return
    }
    const maxPanes = Math.min(SPLIT_PANE_MAX, splitCandidateSessions.length)
    applySplitPaneCount(Math.min(lastSplitPaneCountRef.current, maxPanes))
  })

  // ── Split pane focus ───────────────────────────────────────────────────────
  // Focus is a third keyboard owner alongside the sidebar and the reader. It is
  // an index rather than a session key so a pane keeps focus when its pinned
  // session changes under it (⌃B n).
  const lastFocusedSplitPaneRef = useRef(0)
  const focusSplitPane = useEffectEvent((paneIndex: number) => {
    if (paneIndex < 0 || paneIndex >= visibleSplitPaneCount) return
    lastFocusedSplitPaneRef.current = paneIndex
    setSplitFocusIndex(paneIndex)
    // The reader keeps its own cursor, but the sidebar must not look focused
    // while a pane owns the keys.
    setFocusedPane('messages')
  })

  const focusReaderFromSplit = useEffectEvent(() => {
    setSplitFocusIndex(null)
  })

  // ⌃B o / ⌃B ←→ walk reader → pane 1 → pane 2 → reader, so repeated presses
  // always come back around instead of dead-ending in the last pane.
  const cycleSplitFocus = useEffectEvent((direction: 1 | -1) => {
    if (visibleSplitPaneCount === 0) {
      showNotice('error', 'No split panes open (⌃B % to split)')
      return
    }
    const stops = visibleSplitPaneCount + 1
    const current = splitFocusIndex === null ? 0 : splitFocusIndex + 1
    const next = (current + direction + stops) % stops
    if (next === 0) focusReaderFromSplit()
    else focusSplitPane(next - 1)
  })

  // ⌃B ; — flip between the reader and the pane you were last in.
  const toggleSplitFocus = useEffectEvent(() => {
    if (splitFocusIndex !== null) {
      focusReaderFromSplit()
      return
    }
    if (visibleSplitPaneCount === 0) {
      showNotice('error', 'No split panes open (⌃B % to split)')
      return
    }
    focusSplitPane(Math.min(lastFocusedSplitPaneRef.current, visibleSplitPaneCount - 1))
  })

  // Aim the composer at a pane's session. The override is explicit (not implied
  // by focus) so a send can never be misdirected by where the cursor happens to
  // be; it clears when the composer closes.
  const composeToSplitPaneSession = useEffectEvent((target: Session) => {
    setComposerPaneTargetKey(sessionKey(target))
    setComposerActive(true)
    showNotice('info', `Composer → ${formatSessionTitle(target)}`)
  })

  // Session-scoped overlays, opened for a pane. Git is cwd-scoped and
  // diagnostics takes a target, so both are honest here; analytics renders the
  // reader's loaded detail, so it says so rather than showing another session's
  // numbers under this pane's title.
  const openSplitPaneOverlay = useEffectEvent((kind: 'git' | 'diagnostics' | 'analytics', target: Session | null) => {
    if (!target) return
    if (kind === 'git') { setGitOpen(true); return }
    if (kind === 'diagnostics') { openDiagnostics(target); return }
    showNotice('info', 'Analytics follows the reader — press ↵ to open this pane first')
  })

  // Promote the focused pane's session to the active tab. The pin reconciler
  // then hands that pane the session the reader just left, so the pair swaps
  // rather than both showing the same transcript.
  const openFocusedSplitPane = useEffectEvent(() => {
    if (splitFocusIndex === null) return
    const target = splitPaneSessions[splitFocusIndex]
    if (!target) return
    selectTabSession(target)
    focusReaderFromSplit()
  })

  // Advance the FOCUSED pane (or the first, from the reader) to the next tab no
  // pane is already showing. Only that pane moves — the others keep their
  // pinned sessions, so cycling reads as "flip through the rest" instead of
  // scrambling every pane.
  const cycleSplitPaneSession = useEffectEvent(() => {
    if (splitPaneCount === 0) {
      showNotice('error', 'Split transcript view is off (⌃B % to split)')
      return
    }
    const candidateKeys = splitCandidateSessions.map((tab) => sessionKey(tab))
    if (candidateKeys.length <= splitPaneCount) {
      showNotice('info', 'No other open tab to swap into the split pane')
      return
    }
    const target = splitFocusIndex ?? 0
    setSplitPinnedKeys((current) => {
      if (target >= current.length) return current
      const heldByOtherPanes = new Set(current.filter((_, i) => i !== target))
      const from = candidateKeys.indexOf(current[target]!)
      for (let step = 1; step <= candidateKeys.length; step += 1) {
        const nextKey = candidateKeys[(from + step) % candidateKeys.length]!
        if (nextKey !== current[target] && !heldByOtherPanes.has(nextKey)) {
          const next = [...current]
          next[target] = nextKey
          return next
        }
      }
      return current
    })
  })

  const executeCommandPalette = useEffectEvent((id: string) => {
    closeCommandPalette()
    switch (id) {
      case 'new':
        openNewSessionModal()
        break
      case 'reuse':
        reuseLastPrompt()
        break
      case 'provider':
        setProviderMenuIndex(Math.max(PROVIDERS.indexOf(provider), 0))
        setProviderMenuOpen(true)
        break
      case 'attention':
        setAttentionOpen(true)
        break
      case 'messaging':
        setCrossSessionMessagingOpen(true)
        break
      case 'next-attention':
        jumpToNextAttention()
        break
      case 'session-search':
        setFocusedPane('sessions')
        setSessionSearchMode(true)
        break
      case 'worktree-new':
        setWorktreeDraft('')
        setWorktreeModalOpen(true)
        break
      case 'worktree-merge':
        if (selectedWorktreeTask) setWorktreeConfirm('merge')
        else showNotice('info', 'Selected session is not a worktree task', 3500)
        break
      case 'worktree-discard':
        if (selectedWorktreeTask) setWorktreeConfirm('discard')
        else showNotice('info', 'Selected session is not a worktree task', 3500)
        break
      case 'coord-start':
        openNewWorkflowModal()
        break
      case 'coord-board':
        void openCoordinationBoard()
        break
      case 'coord-cleanup':
        void cleanupCompletedCoordinatedRunWorktrees()
        break
      case 'coord-stop':
        void stopActiveCoordinatedRun()
        break
      case 'fleet': {
        const next = !fleetStripEnabled
        setFleetStripEnabled(next)
        showToggleOutcome('Fleet strip', next)
        break
      }
      case 'checkpoints':
        if (gitRepoCwd) setCheckpointOpen(true)
        else showNotice('info', 'Selected session has no working directory', 3000)
        break
      case 'theme': {
        openThemeMenu()
        break
      }
      case 'density': {
        const next = cycleDensityValue(density)
        setDensity(next)
        showToggleOutcome('Density:', next)
        void writeTuiDensity(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store density'))
        break
      }
      case 'diff-layout': {
        const next: TuiDiffLayout = diffLayout === 'stack' ? 'split' : 'stack'
        setDiffLayout(next)
        showToggleOutcome('Diff layout:', next)
        void writeTuiDiffLayout(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store diff layout'))
        break
      }
      case 'rail': {
        const nextVisible = !railVisible
        setRailVisible(nextVisible)
        showToggleOutcome('Session rail', nextVisible)
        if (!nextVisible && focusedPane === 'sessions') setFocusedPane('messages')
        void writeTuiRailVisible(nextVisible).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store rail'))
        break
      }
      case 'focus': {
        const next = !focusMode
        setFocusMode(next)
        showToggleOutcome('Focus mode', next)
        if (next) setFocusedPane('messages')
        void writeTuiFocusMode(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store focus mode'))
        break
      }
      case 'tools': {
        setShowToolCalls((v) => {
          const next = !v
          showToggleOutcome('Tool calls', next ? 'shown' : 'hidden')
          void writeTuiShowToolCalls(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tool visibility'))
          return next
        })
        break
      }
      case 'velocity-scroll': {
        setVelocityScrollEnabled((v) => {
          const next = !v
          showToggleOutcome('Velocity scroll', next)
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
            const next = composerAgentOptions[(index + 1) % composerAgentOptions.length]?.value ?? current
            showToggleOutcome('OpenCode mode:', next)
            return next
          })
          break
        }
        if (target?.provider === 'copilot') {
          const order = ['interactive', 'plan', 'autopilot', 'shell'] as const
          setTuiCopilotMode((current) => {
            const next = order[(order.indexOf(current) + 1) % order.length]!
            showToggleOutcome('Copilot mode:', next)
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
        openTranscriptViewMenu()
        break
      }
      case 'width': {
        const next: TuiTranscriptWidth = transcriptWidth === 'centered' ? 'full' : 'centered'
        setTranscriptWidth(next)
        showToggleOutcome('Transcript width:', next)
        void writeTuiTranscriptWidth(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store transcript width'))
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
        showToggleOutcome('Tab bar', next)
        void writeTuiTabsEnabled(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tab setting'))
        break
      }
      case 'split-add':
        addSplitPane()
        break
      case 'split-close':
        closeSplitPane()
        break
      case 'split-toggle':
        toggleSplitPanes()
        break
      case 'split-focus':
        cycleSplitFocus(1)
        break
      case 'split-focus-back':
        focusReaderFromSplit()
        break
      case 'split-cycle':
        cycleSplitPaneSession()
        break
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
        setComposerHidden(false)
        setComposerActive(true)
        break
      case 'composer-window':
        openComposerWindow()
        break
      case 'composer-toggle':
        toggleComposerHidden()
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
        setThinkingMode((current) => {
          const next = !current
          showToggleOutcome('Thinking mode', next)
          return next
        })
        break
      case 'workflow':
        setComposerEnableWorkflow((current) => {
          const next = !current
          showToggleOutcome('Workflow tool (next send)', next)
          return next
        })
        break
      case 'git':
        setGitOpen(true)
        break
      case 'pull-requests':
        setPullRequestOpen(true)
        break
      case 'files':
        setFileViewerOpen(true)
        break
      case 'editor':
        setEditorInitialPath(null)
        setEditorOpen(true)
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
      case 'channel-bridge':
        openChannelBridge()
        break
      case 'channel-bridge-route':
        toggleComposerBridgeRoute()
        break
      case 'ide-bridge':
        openIdeBridge()
        break
      case 'ide-bridge-route':
        toggleComposerIdeRoute()
        break
      case 'sort':
        toggleSidebarSort()
        showToggleOutcome('Sidebar sort:', sidebarSort === 'project' ? 'time' : 'project')
        break
      case 'sidebar-view':
        setSidebarView((current) => {
          const next = current === 'sessions' ? 'coordinator' : 'sessions'
          showToggleOutcome('Sidebar view:', next)
          return next
        })
        break
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
    // Legacy terminal input collapses Ctrl+Shift+letter to the same single
    // control byte as Ctrl+letter. Kitty/CSI-u and xterm modifyOtherKeys retain
    // Shift, so only apply the ambiguous fallback to genuine one-byte input.
    const isCtrlShift = (char: string): boolean => isCtrl(char)
      && (key.shift || (key.source === 'raw' && key.raw.length === 1))
    const isKeyRepeat = key.eventType === 'repeat' || key.repeated === true
    const isModelEffortShortcut = (key.name === 'm' && (key.option || key.meta)) || sequence === 'µ'
    const handled = (action: () => void): void => {
      key.preventDefault()
      key.stopPropagation()
      action()
    }
    const selectedTranscriptCard = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
    // cardDisplayData is window-relative (preview cap while browsing, sliding
    // window while reading); shift the absolute cursor index into window space.
    const selectedTranscriptCardDisplay = cursorIndex >= transcriptRenderStart && cursorIndex < transcriptRenderEnd
      ? cardDisplayData[cursorIndex - transcriptRenderStart] ?? null
      : null
    const selectedAgentToolCards = groupedToolView
      && selectedTranscriptCard
      && resolvedExpandedKeys.has(selectedTranscriptCard.key)
      ? agentToolCardsFor(selectedTranscriptCard)
      : []
    const selectedAgentToolKey = selectedTranscriptCard
      ? agentToolCursorByGroupKey[selectedTranscriptCard.key] ?? null
      : null
    const selectedAgentToolCard = selectedAgentToolKey
      ? selectedAgentToolCards.find((toolCard) => toolCard.key === selectedAgentToolKey) ?? null
      : null
    const selectedAgentToolExpanded = selectedAgentToolCard
      ? agentToolCardIsExpanded(selectedAgentToolCard, expandedCardKeys, collapsedCardKeys)
      : false
    const selectedInteractiveTranscriptCard = selectedAgentToolCard ?? selectedTranscriptCard
    const selectedInteractiveTranscriptCardDisplay = selectedAgentToolCard
      ? nestedAgentToolDisplay(
          selectedAgentToolCard,
          selectedAgentToolCard.provider,
          selectedAgentToolExpanded,
          densityState.bodyLines,
          Boolean(syntaxStyle),
          thinkingMode,
        )
      : selectedTranscriptCardDisplay

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

    if (worktreeConfirm) {
      if (key.name === 'return' || key.name === 'y') {
        handled(() => {
          const action = worktreeConfirm
          setWorktreeConfirm(null)
          if (action === 'merge') void mergeSelectedWorktreeTask()
          else void discardSelectedWorktreeTask()
        })
        return
      }
      if (key.name === 'escape' || key.name === 'n') {
        handled(() => setWorktreeConfirm(null))
        return
      }
      handled(() => {})
      return
    }

    if (worktreeModalOpen) {
      if (key.name === 'escape') {
        handled(() => {
          setWorktreeModalOpen(false)
          setWorktreeDraft('')
        })
      } else if (key.name === 'return') {
        handled(() => { void submitWorktreeTask() })
      }
      // Other keys fall through to the focused name input.
      return
    }

    if (playbookManagerOpen) {
      if (playbookManagerKeyHandlerRef.current?.(key) !== false) handled(() => {})
      return
    }

    if (coordModalOpen) {
      if (key.name === 'escape') {
        handled(() => {
          setCoordModalOpen(false)
          setCoordDraft('')
          setCoordAcceptanceDraft('')
          setCoordNonGoalsDraft('')
          setCoordManualQaDraft('')
          setCoordEscalationDraft('')
          setCoordPlaybookName(null)
          setCoordPlaybookArgsDraft('')
          setCoordGateDraft('')
          setCoordMaxTokens('')
          setCoordMaxDurationMinutes('')
          setCoordProviderOverride(null)
          setCoordTeammateProviderOverride(null)
          setCoordProviderPoolIndex(0)
          setCoordModalFocus('prompt')
          setCoordError(null)
        })
      } else if (key.name === 'tab') {
        handled(() => setCoordModalFocus((current) => moveCoordModalFocus(current, key.shift ? -1 : 1)))
      } else if (isCtrl('t')) {
        handled(() => setCoordMaxAgents((current) => (current >= 6 ? 2 : current + 1)))
      } else if (isCtrl('p')) {
        handled(() => setCoordRequirePlanApproval((current) => {
          const next = !current
          showToggleOutcome('Plan approval', next)
          return next
        }))
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'playbook') {
        const direction = key.name === 'left' || key.name === 'up' ? -1 : 1
        handled(() => {
          const options = [null, ...coordPlaybooks.map((entry) => entry.name)]
          const index = Math.max(0, options.indexOf(coordPlaybookName))
          selectCoordPlaybook(options[(index + direction + options.length) % options.length] ?? null)
        })
      } else if ((key.name === 'return' || key.name === 'm') && coordModalFocus === 'playbook') {
        handled(() => setPlaybookManagerOpen(true))
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'provider') {
        const direction = key.name === 'left' || key.name === 'up' ? -1 : 1
        handled(() => {
          const suggested = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
          setCoordProviderOverride((current) => cycleCoordProvider(current ?? suggested, direction))
        })
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'pool') {
        const direction = key.name === 'left' || key.name === 'up' ? -1 : 1
        handled(() => setCoordProviderPoolIndex((current) => (current + direction + COORD_RUN_PROVIDERS.length) % COORD_RUN_PROVIDERS.length))
      } else if ((key.name === 'return' || key.name === 'space' || key.sequence === ' ') && coordModalFocus === 'pool') {
        handled(() => {
          const selectedProvider = COORD_RUN_PROVIDERS[coordProviderPoolIndex]!
          const suggested = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
          const leadProvider = coordProviderOverride ?? suggested
          setCoordTeammateProviderOverride((current) => {
            const pool = current ?? [leadProvider]
            if (!pool.includes(selectedProvider)) return [...pool, selectedProvider]
            const next = pool.filter((entry) => entry !== selectedProvider)
            return next.length > 0 ? next : [leadProvider]
          })
        })
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'agents') {
        const direction = key.name === 'left' || key.name === 'down' ? -1 : 1
        handled(() => setCoordMaxAgents((current) => Math.min(6, Math.max(2, current + direction))))
      } else if ((key.name === 'return' || key.name === 'space' || key.sequence === ' ') && coordModalFocus === 'worktrees') {
        handled(() => setCoordUseWorktrees((current) => {
          const next = !current
          showToggleOutcome('Coordinator worktrees', next)
          return next
        }))
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'autonomy') {
        const direction = key.name === 'left' || key.name === 'up' ? -1 : 1
        handled(() => setCoordAutonomy((current) => cycleCoordAutonomy(current, direction)))
      } else if ((key.name === 'return' || key.name === 'space' || key.sequence === ' ') && coordModalFocus === 'plans') {
        handled(() => setCoordRequirePlanApproval((current) => {
          const next = !current
          showToggleOutcome('Plan approval', next)
          return next
        }))
      } else if ((key.name === 'return' || key.name === 'space' || key.sequence === ' ') && coordModalFocus === 'review') {
        handled(() => setCoordRequireReview((current) => {
          const next = !current
          showToggleOutcome('Judgment review', next)
          return next
        }))
      } else if (key.name === 'return' && coordModalFocus === 'launch') {
        handled(() => { void submitCoordinatedRun() })
      } else if (key.name === 'return' && coordModalFocus === 'playbookArgs') {
        handled(() => setCoordModalFocus('provider'))
      } else if (key.name === 'return' && coordModalFocus !== 'prompt') {
        handled(() => setCoordModalFocus((current) => moveCoordModalFocus(current, 1)))
      }
      // Everything else falls through to the focused editor/input.
      return
    }

    if (coordBoardOpen) {
      handled(() => { coordBoardKeyHandlerRef.current?.(key) })
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

    if (editorOpen) {
      const consumed = editorKeyHandlerRef.current?.(key) ?? true
      if (consumed) handled(() => {})
      return
    }

    if (gitOpen) {
      // p hops to the PR review popover — the reliable path on terminals whose
      // legacy encoding folds Ctrl+Shift+G into Ctrl+G (e.g. Windows).
      if (key.name === 'p' && !key.ctrl && !key.shift) {
        handled(() => {
          setGitOpen(false)
          setPullRequestOpen(true)
        })
        return
      }
      handled(() => { gitKeyHandlerRef.current?.(key) })
      return
    }

    if (pullRequestOpen) {
      const consumed = pullRequestKeyHandlerRef.current?.(key) ?? true
      if (consumed) handled(() => {})
      return
    }

    if (fileViewerOpen) {
      handled(() => { fileViewerKeyHandlerRef.current?.(key) })
      return
    }

    if (newSessionModalOpen) {
      handled(() => { newSessionKeyHandlerRef.current?.(key) })
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

    if (ideBridgeOpen) {
      handled(() => { ideBridgeKeyHandlerRef.current?.(key) })
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

    if (attentionOpen) {
      handled(() => { attentionKeyHandlerRef.current?.(key) })
      return
    }

    if (crossSessionMessagingOpen) {
      const consumed = crossSessionMessagingKeyHandlerRef.current?.(key) ?? true
      if (consumed) handled(() => {})
      return
    }

    if (checkpointOpen) {
      handled(() => { checkpointKeyHandlerRef.current?.(key) })
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
        if (mcpRows.length === 0 && key.name !== 'p' && key.name !== 's' && key.name !== 'g') return
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
        if (key.name === 'o' && mcpRows[diagnosticsMcpIndex]) {
          const item = mcpRows[diagnosticsMcpIndex]
          const name = item.split(' · ')[0]?.trim() ?? ''
          if (name) {
            const policyKey = `${selectedSession.sessionId}:${name}`
            const previous: 'default' | 'auto' | undefined = diagnosticsMcpPermissionModes[policyKey]
            const mode: 'default' | 'auto' | null = previous == null
              ? 'default'
              : previous === 'default' ? 'auto' : null
            setDiagnosticsMcpPermissionModes((current) => {
              const next = { ...current }
              if (mode === null) delete next[policyKey]
              else next[policyKey] = mode
              return next
            })
            void runDiagnosticsAction(
              'setMcpPermissionModeOverride',
              { serverName: name, mode },
              `mcp:permission:${name}`,
            ).then((result) => {
              if (!result) {
                setDiagnosticsMcpPermissionModes((current) => {
                  const next = { ...current }
                  if (previous) next[policyKey] = previous
                  else delete next[policyKey]
                  return next
                })
              }
            })
          }
          return
        }
        if (key.name === 'd' && mcpRows[diagnosticsMcpIndex]?.endsWith(' · dynamic')) {
          const name = mcpRows[diagnosticsMcpIndex]!.split(' · ')[0]?.trim() ?? ''
          if (name) void runDiagnosticsAction('setMcpServers', { operation: 'remove', serverName: name }, `mcp:remove:${name}`)
          return
        }
        if (key.name === 'a') {
          const source = composerDraftRef.current.trim()
          if (!source) {
            setDiagnosticsError('Put a JSON object of MCP servers in the composer first')
            return
          }
          try {
            const servers = JSON.parse(source) as unknown
            void runDiagnosticsAction('setMcpServers', { servers }, 'mcp:set')
          } catch (err) {
            setDiagnosticsError(err instanceof Error ? err.message : 'Invalid MCP JSON')
          }
          return
        }
        if (key.name === 'f') {
          void runDiagnosticsAction('listHookEvents', { query: composerDraftRef.current.trim(), limit: 100 }, 'hooks:search')
          return
        }
        if (key.name === 'p') {
          void runDiagnosticsAction('reloadPlugins', {}, 'reload-plugins')
          return
        }
        if (key.name === 's') {
          void runDiagnosticsAction('reloadSkills', {}, 'reload-skills')
          return
        }
        if (key.name === 'g') {
          void runDiagnosticsAction('resolveSettings', {}, 'resolve-settings')
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
      if (
        key.name === 'tab'
        || (modelPickerFocus !== 'model' && (key.name === 'left' || key.name === 'right'))
      ) {
        handled(() => setModelPickerFocus((current) => {
          const order: ModelPickerFocus[] = ['model', 'effort', 'permissions']
          const direction = key.shift || key.name === 'left' ? -1 : 1
          return order[(order.indexOf(current) + direction + order.length) % order.length]!
        }))
        return
      }
      if (modelPickerFocus === 'model' && (key.name === 'up' || key.name === 'down')) {
        handled(() => {
          setModelPickerIndex((current) => {
            const lastIndex = filteredModelPickerOptions.length - 1
            if (lastIndex < 0) return 0
            return key.name === 'up'
              ? Math.max(current - 1, 0)
              : Math.min(current + 1, lastIndex)
          })
        })
        return
      }
      if ((modelPickerFocus !== 'model' && key.name === 'q') || isCtrl('c')) {
        handled(requestExit)
      }
      return
    }

    if (themeMenuOpen) {
      if (key.name === 'left' || key.name === 'right') {
        handled(() => {
          const currentGroupIndex = THEME_GROUPS.findIndex((g) => g.key === themeMenuGroup)
          const nextGroupIndex = key.name === 'left'
            ? Math.max(currentGroupIndex - 1, 0)
            : Math.min(currentGroupIndex + 1, THEME_GROUPS.length - 1)
          const newGroup = THEME_GROUPS[nextGroupIndex].key
          setThemeMenuGroup(newGroup)
          const groupThemes = filterThemeModes(THEME_GROUPS[nextGroupIndex].themes, themeMenuQuery)
          const origin = themeMenuOriginRef.current
          const target = (origin && groupThemes.includes(origin)) ? origin : groupThemes[0]
          if (target) {
            setThemeMenuIndex(THEMES.indexOf(target))
            setThemeMode(target)
          }
        })
        return
      }
      if (key.name === 'up' || key.name === 'down') {
        handled(() => {
          const groupThemes = filterThemeModes(
            THEME_GROUPS.find((g) => g.key === themeMenuGroup)?.themes ?? DARK_MODES,
            themeMenuQuery,
          )
          if (groupThemes.length === 0) return
          const currentTheme = THEMES[themeMenuIndex]
          const currentLocalIndex = currentTheme ? groupThemes.indexOf(currentTheme) : -1
          const nextLocalIndex = key.name === 'up'
            ? Math.max((currentLocalIndex < 0 ? 0 : currentLocalIndex) - 1, 0)
            : Math.min((currentLocalIndex < 0 ? -1 : currentLocalIndex) + 1, groupThemes.length - 1)
          const target = groupThemes[nextLocalIndex]
          if (target) {
            setThemeMenuIndex(THEMES.indexOf(target))
            setThemeMode(target)
          }
        })
        return
      }
      if (key.name === 'return') {
        handled(() => {
          const groupThemes = filterThemeModes(
            THEME_GROUPS.find((g) => g.key === themeMenuGroup)?.themes ?? DARK_MODES,
            themeMenuQuery,
          )
          const currentTheme = THEMES[themeMenuIndex]
          const target = currentTheme && groupThemes.includes(currentTheme) ? currentTheme : groupThemes[0]
          if (target) chooseTheme(target)
        })
        return
      }
      if (key.name === 'escape') {
        handled(closeThemeMenu)
        return
      }
      if (isCtrl('c')) {
        handled(requestExit)
      }
      return
    }

    if (transcriptViewMenuOpen) {
      if (key.name === 'escape' || (sequence === 'v' && !key.ctrl && !key.meta)) {
        handled(closeTranscriptViewMenu)
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
    // AskUserQuestion picker: navigate options, toggle, and submit. Takes over
    // the pending-approval keys when the active prompt carries questions.
    if (pendingPermissions.length > 0 && !permissionActionLoading && (pendingPermissions[0]!.questions?.length ?? 0) > 0) {
      const activePermission = pendingPermissions[0]!
      const questions = activePermission.questions ?? []
      const qi = Math.min(questionFocusIndex, questions.length - 1)
      const question = questions[qi]!
      const freeformIndex = question.allowFreeform ? question.options.length : -1
      const optionCount = question.options.length + (question.allowFreeform ? 1 : 0)
      const optIndex = Math.min(questionOptionIndex, optionCount - 1)
      if (questionFreeformEditing) {
        if (key.name === 'return') {
          handled(() => setQuestionFreeformEditing(false))
          return
        }
        if (key.name === 'escape') {
          handled(() => setQuestionFreeformEditing(false))
          return
        }
        if (key.name === 'backspace' || key.name === 'delete') {
          handled(() => setQuestionFreeformAnswers((prev) => ({
            ...prev,
            [qi]: (prev[qi] ?? '').slice(0, -1),
          })))
          return
        }
        if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          handled(() => {
            setQuestionFreeformAnswers((prev) => ({ ...prev, [qi]: `${prev[qi] ?? ''}${key.sequence}` }))
            if (!question.multiSelect) setQuestionSelections((prev) => ({ ...prev, [qi]: [] }))
          })
          return
        }
        return
      }
      if (key.name === 'up' || key.name === 'k') {
        handled(() => setQuestionOptionIndex((i) => Math.max(0, Math.min(i, optionCount - 1) - 1)))
        return
      }
      if (key.name === 'down' || key.name === 'j') {
        handled(() => setQuestionOptionIndex((i) => Math.min(optionCount - 1, Math.min(i, optionCount - 1) + 1)))
        return
      }
      if ((key.name === 'left' || key.name === 'right' || key.name === 'tab') && questions.length > 1) {
        const delta = key.name === 'left' ? -1 : 1
        handled(() => {
          setQuestionFocusIndex((i) => (i + delta + questions.length) % questions.length)
          setQuestionOptionIndex(0)
        })
        return
      }
      if (sequence === ' ') {
        if (optIndex === freeformIndex) {
          handled(() => setQuestionFreeformEditing(true))
        } else {
          const opt = question.options[optIndex]
          if (opt) handled(() => toggleTuiQuestionOption(qi, question.multiSelect === true, opt.value ?? opt.label))
        }
        return
      }
      const qDigit = Number.parseInt(sequence, 10)
      if (!Number.isNaN(qDigit) && qDigit >= 1 && qDigit <= optionCount) {
        handled(() => {
          setQuestionOptionIndex(qDigit - 1)
          if (qDigit - 1 === freeformIndex) {
            setQuestionFreeformEditing(true)
          } else {
            const opt = question.options[qDigit - 1]
            if (opt) toggleTuiQuestionOption(qi, question.multiSelect === true, opt.value ?? opt.label)
          }
        })
        return
      }
      if (key.name === 'return') {
        // Single-select advances to the next unanswered question; otherwise
        // submit (submit also jumps to any still-unanswered question).
        handled(() => {
          if (optIndex === freeformIndex) setQuestionFreeformEditing(true)
          else void submitTuiQuestion(activePermission)
        })
        return
      }
      // Esc skips the whole prompt (declines the tool), matching the web SKIP.
      if (key.name === 'escape') {
        handled(() => { void respondToTuiPermission(activePermission, 'reject') })
        return
      }
      return
    }

    // ExitPlanMode plan-approval: keep planning / approve (ask) / approve (auto).
    if (pendingPermissions.length > 0 && !permissionActionLoading && pendingPermissions[0]!.toolName === 'ExitPlanMode') {
      const activePermission = pendingPermissions[0]!
      const planOptions = ['reject', 'default', 'acceptEdits'] as const
      const idx = Math.min(permissionOptionIndex, planOptions.length - 1)
      if (key.name === 'left') {
        handled(() => setPermissionOptionIndex((i) => Math.max(0, i - 1)))
        return
      }
      if (key.name === 'right' || key.name === 'tab') {
        handled(() => setPermissionOptionIndex((i) => Math.min(planOptions.length - 1, i + 1)))
        return
      }
      if (key.name === 'return') {
        handled(() => { void respondToTuiPlan(activePermission, planOptions[idx]!) })
        return
      }
      if (key.name === 'escape') {
        handled(() => { void respondToTuiPlan(activePermission, 'reject') })
        return
      }
      const planDigit = Number.parseInt(sequence, 10)
      if (!Number.isNaN(planDigit) && planDigit >= 1 && planDigit <= planOptions.length) {
        handled(() => { void respondToTuiPlan(activePermission, planOptions[planDigit - 1]!) })
        return
      }
      return
    }

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
          // While a turn is running (owned stream or reattached), Esc hides the
          // composer so the user can read the transcript without cancelling.
          // Use Ctrl+C to interrupt.
          if (composerSendState === 'sending' || reattachedRunning) {
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
      // presses within 5 s to prevent accidental interrupts. Also covers
      // reattached turns, where the interrupt is fired without a local stream.
      if (isCtrl('c') && (composerSendState === 'sending' || reattachedRunning)) {
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
      // Queue management: ⌃Y pops the newest queued message back into the
      // composer to edit (cancelling that send); ⌃Y with shift clears the queue.
      if (isCtrl('y') && activeQueuedComposerSends.length > 0) {
        handled(() => {
          if (key.shift) clearQueuedComposerSends()
          else popNewestQueuedComposerSend()
        })
        return
      }
      // Toggle the Channel Bridge composer routing right from the composer —
      // same key as the bridge popover's ^R, so the binding is consistent
      // whether or not the panel is open.
      if (isCtrl('r') && canUseChannelBridge) {
        handled(toggleComposerBridgeRoute)
        return
      }
      // Opt this turn into the Workflow tool (settings.enableWorkflows) —
      // Claude-only, mirrors the ⌃R bridge toggle right above.
      if (isCtrl('w') && composerTargetSession?.provider === 'claude') {
        handled(() => {
          setComposerEnableWorkflow((current) => {
            const next = !current
            showToggleOutcome('Workflow tool (next send)', next)
            return next
          })
        })
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

    // ── tmux-style split chord ────────────────────────────────────────────────
    // Must sit at the very top of the non-composer path: the pending-chord
    // branch swallows the command key, and anything above it (notably the
    // q/Esc quit handler) would otherwise steal `x`, `o` or a cancelling Esc.
    if (splitChordPending) {
      handled(() => {
        setSplitChordPending(false)
        if (key.name === 'escape' || isCtrl('c') || isCtrl('g')) {
          showNotice('info', 'Split chord cancelled')
          return
        }
        // % and " are tmux's split keys; v/s are the vim-shaped aliases.
        if (sequence === '%' || sequence === '"' || sequence === 'v' || sequence === 's') {
          addSplitPane()
          return
        }
        if (sequence === 'x') { closeSplitPane(); return }
        if (sequence === 'z') { toggleSplitPanes(); return }
        // Focus movement, tmux-shaped: o/→/tab walk forward, ← walks back,
        // ; flips reader↔last pane, digits jump straight to a pane.
        if (sequence === 'o' || key.name === 'right' || key.name === 'tab') { cycleSplitFocus(1); return }
        if (key.name === 'left') { cycleSplitFocus(-1); return }
        if (sequence === ';') { toggleSplitFocus(); return }
        if (/^[1-9]$/.test(sequence)) { focusSplitPane(Number(sequence) - 1); return }
        if (sequence === 'n') { cycleSplitPaneSession(); return }
        if (sequence === '?') {
          showNotice('info', '⌃B: % split · x close · o focus next · ; flip · 1-2 pane · n next session · z toggle')
          return
        }
        showNotice('info', `⌃B ${sequence || key.name} is not a split chord — % split · x close · o focus · n next session · z toggle`)
      })
      return
    }

    if (isCtrl('b')) {
      handled(() => setSplitChordPending(true))
      return
    }

    // ── Focused split pane owns the keys ──────────────────────────────────────
    // A focused pane is a reader, not an editor: it scrolls, it opens, it hands
    // focus back. Everything else is swallowed rather than falling through to
    // the primary reader — a j that scrolled the pane must not also move the
    // reader's cursor behind it.
    if (splitFocusIndex !== null) {
      const paneHandle = splitPaneHandlesRef.current.get(splitFocusIndex)
      const paneSession = paneHandle?.getSession() ?? null
      const pageRows = Math.max(Math.floor(transcriptViewportRows * 0.8), 1)
      if (key.name === 'escape') { handled(focusReaderFromSplit); return }
      // Card navigation, not raw scrolling: the pane has a cursor, so j/k move
      // between messages exactly like the reader.
      if (sequence === 'j' || key.name === 'down') { handled(() => paneHandle?.moveCursor(1)); return }
      if (sequence === 'k' || key.name === 'up') { handled(() => paneHandle?.moveCursor(-1)); return }
      if (isCtrl('d')) { handled(() => paneHandle?.moveCursor(pageRows)); return }
      if (isCtrl('u')) { handled(() => paneHandle?.moveCursor(-pageRows)); return }
      if (sequence === 'G') { handled(() => paneHandle?.cursorToEdge('last')); return }
      if (sequence === 'g') { handled(() => paneHandle?.cursorToEdge('first')); return }
      if (sequence === 'e') { handled(() => paneHandle?.toggleExpandedAtCursor()); return }
      if (sequence === 'f') { handled(() => paneHandle?.cursorToEdge('last')); return }
      // Card actions reuse the reader's implementations with the pane's own
      // card, so clipboard/bookmark/reply behave identically in both readers.
      if (sequence === 'y') {
        handled(() => { void copySelectedMessage(paneHandle?.getCursorCard() ?? undefined) })
        return
      }
      if (sequence === 'b') {
        handled(() => {
          void (async () => {
            try {
              const added = await paneHandle?.toggleBookmarkAtCursor()
              showNotice('info', added ? 'Bookmarked message' : 'Removed bookmark')
            } catch (err) {
              showNotice('error', err instanceof Error ? err.message : 'Failed to update bookmark')
            }
          })()
        })
        return
      }
      if (isShifted('q')) {
        handled(() => {
          if (paneSession) composeToSplitPaneSession(paneSession)
          replySelectedMessage(paneHandle?.getCursorCard() ?? undefined)
        })
        return
      }
      // Composer aimed at THIS pane's agent — the point of a live split view.
      if (sequence === 'c') {
        handled(() => { if (paneSession) composeToSplitPaneSession(paneSession) })
        return
      }
      if (sequence === 'i') {
        handled(() => setThinkingMode((current) => {
          const next = !current
          showToggleOutcome('Thinking mode', next)
          return next
        }))
        return
      }
      if (key.name === 'return') { handled(openFocusedSplitPane); return }
      if (key.name === 'tab') { handled(() => cycleSplitFocus(1)); return }
      // Session-scoped overlays follow focus, so ⌃G/D/⌃A inspect the pane you
      // are looking at rather than the reader's session.
      if (isCtrl('g')) { handled(() => openSplitPaneOverlay('git', paneSession)); return }
      if (sequence === 'D') { handled(() => openSplitPaneOverlay('diagnostics', paneSession)); return }
      if (isCtrlShift('a')) { handled(openCoordinationBoard); return }
      if (isCtrl('a')) { handled(() => openSplitPaneOverlay('analytics', paneSession)); return }
      // ⌃C means "stop what I'm watching" when the pane's agent is mid-turn —
      // the same key that quits an idle app must not kill the whole TUI when
      // the obvious intent is to interrupt this run.
      if (isCtrl('c')) {
        handled(() => {
          if (paneSession && splitPaneRunningKeys.has(sessionKey(paneSession)) && !paneSession.isPending) {
            void interruptTuiSessionTurn({ sessionId: paneSession.sessionId, provider: paneSession.provider })
              .then(() => showNotice('info', `Interrupted ${formatSessionTitle(paneSession)}`))
              .catch((err) => showNotice('error', err instanceof Error ? err.message : 'Failed to interrupt'))
            return
          }
          requestExit()
        })
        return
      }
      // Quit and the help palette stay reachable; the rest is inert while a
      // pane holds focus, so no reader state changes invisibly behind it.
      if (key.name === 'q' && !key.shift) { handled(requestExit); return }
      if (sequence === '?') {
        handled(() => {
          setCommandPaletteIndex(0)
          setCommandPaletteQuery('')
          setCommandPaletteOpen(true)
        })
        return
      }
      handled(() => {})
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

    if (isCtrlShift('g')) {
      handled(() => setPullRequestOpen(true))
      return
    }

    // Global git status popover
    if (isCtrl('g')) {
      handled(() => setGitOpen(true))
      return
    }

    // Yazi-inspired project file browser
    if (isCtrl('f')) {
      handled(() => setFileViewerOpen(true))
      return
    }

    // LazyVim-inspired project editor. The editor owns text input while open;
    // the root handler only intercepts shortcuts the editor reports consumed.
    if (isCtrl('e')) {
      handled(() => {
        setEditorInitialPath(null)
        setEditorOpen(true)
      })
      return
    }

    // Agent Operations. On legacy terminals raw ^A is the portable fallback.
    if (isCtrlShift('a')) {
      handled(openCoordinationBoard)
      return
    }

    // New coordinated workflow, reachable from anywhere — mirrors plain N
    // (new single-agent session) without requiring a trip through the board.
    if (isCtrlShift('n')) {
      handled(openNewWorkflowModal)
      return
    }

    // Global analytics popover. On legacy terminals ^A is reserved for the
    // coordinator fallback above; analytics remains available in the palette.
    if (isCtrl('a')) {
      handled(() => setAnalyticsOpen(true))
      return
    }

    // Global attention inbox — everything blocked on a human, across sessions
    if (sequence === '!') {
      handled(() => setAttentionOpen(true))
      return
    }

    // Cross-session messaging popover — discovery + direct handoff composer.
    if (isShifted('M') || sequence === 'M') {
      handled(() => setCrossSessionMessagingOpen(true))
      return
    }

    // Jump to the next session that needs a human (prompt first, then done)
    if (isCtrl('n')) {
      handled(jumpToNextAttention)
      return
    }

    // Fleet strip: ⇧A toggles, digits 1-9 jump to a cell, and shifted
    // brackets page through overflow without changing the one-row budget.
    if (isShifted('A')) {
      handled(() => {
        const next = !fleetStripEnabled
        setFleetStripEnabled(next)
        showToggleOutcome('Fleet strip', next)
      })
      return
    }
    const fleetDigit = /^[1-9]$/.test(sequence)
      ? sequence
      : /^[1-9]$/.test(key.name) ? key.name : null
    if (fleetStripVisible && fleetDigit && !key.ctrl && !key.meta && !key.option) {
      handled(() => jumpToFleetEntry(Number(fleetDigit) - 1))
      return
    }
    if (
      fleetStripVisible
      && fleetPageCount > 1
      && (sequence === '{' || sequence === '}' || isShifted('[') || isShifted(']'))
    ) {
      handled(() => setFleetPage((current) => {
        const delta = sequence === '{' || isShifted('[') ? -1 : 1
        return (current + delta + fleetPageCount) % fleetPageCount
      }))
      return
    }

    // Global handoff brief popover
    if (isShifted('H')) {
      handled(openHandoffBrief)
      return
    }

    // Worktree task orchestration: ⇧F forks the repo state into an isolated
    // worktree task; merge/discard live in the command palette.
    if (isShifted('F')) {
      handled(() => {
        setWorktreeDraft('')
        setWorktreeModalOpen(true)
      })
      return
    }

    // Checkpoints & review: turn snapshots, per-hunk review, commit, PR
    if (isShifted('U')) {
      handled(() => {
        if (gitRepoCwd) setCheckpointOpen(true)
        else showNotice('info', 'Selected session has no working directory', 3000)
      })
      return
    }

    // Global prompt library — saved prompts usable across providers
    if (isShifted('P')) {
      handled(openPromptLibrary)
      return
    }

    // Global live CLI channel bridge — push composer messages into a side-by-side `claude` session
    if (isShifted('C') && canUseChannelBridge) {
      handled(openChannelBridge)
      return
    }

    // Global IDE bridge — host a Claude Code IDE endpoint a `claude` session connects to
    if (isShifted('I') && canUseIdeBridge) {
      handled(openIdeBridge)
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

    // Show/hide composer
    if (isShifted('E')) {
      handled(toggleComposerHidden)
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

    if (effectiveFocus === 'sessions' && key.name === 'a' && !key.ctrl && !key.shift && !key.meta) {
      handled(() => {
        setSidebarView((current) => {
          const next = current === 'sessions' ? 'coordinator' : 'sessions'
          showToggleOutcome('Sidebar view:', next)
          return next
        })
      })
      return
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'coordinator' && (key.name === 'j' || key.name === 'down')) {
      handled(() => moveCoordinatorSelection(1))
      return
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'coordinator' && (key.name === 'k' || key.name === 'up')) {
      handled(() => moveCoordinatorSelection(-1))
      return
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'coordinator' && key.name === 'g' && !key.shift) {
      handled(() => jumpCoordinatorSelection('first'))
      return
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'coordinator' && isShifted('G')) {
      handled(() => jumpCoordinatorSelection('last'))
      return
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'coordinator' && key.name === 'return') {
      handled(() => openSelectedCoordinatorAgent())
      return
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && (key.name === 'j' || key.name === 'down')) {
      handled(() => {
        moveSelection(1)
      })
      return
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && (key.name === 'k' || key.name === 'up')) {
      handled(() => {
        moveSelection(-1)
      })
      return
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && key.name === 'g' && !key.shift) {
      handled(() => {
        const first = sidebarEntries.map(sidebarEntrySession).find((session): session is Session => Boolean(session))
        if (first) setSelectedSessionKey(sessionKey(first))
      })
      return
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && isShifted('G')) {
      handled(() => {
        const last = [...sidebarEntries].reverse().map(sidebarEntrySession).find((session): session is Session => Boolean(session))
        if (last) setSelectedSessionKey(sessionKey(last))
      })
      return
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && isShifted('S')) {
      handled(() => {
        toggleSidebarSort()
        showToggleOutcome('Sidebar sort:', sidebarSort === 'project' ? 'time' : 'project')
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

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && key.name === 'return') {
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

    // Unshifted only — Shift+j/k (and Shift+↑/↓) are reserved for the diff
    // card's row range-select block below; without the !key.shift guard these
    // card-cursor moves would swallow the shifted keys first (same precedence
    // trap as the resume-marker `m`).
    if (effectiveFocus === 'messages' && (key.name === 'j' || key.name === 'down') && !key.shift) {
      handled(() => {
        if (!moveAgentToolCursor(1)) moveCursor(velocityScrollStep(1))
      })
      return
    }

    if (effectiveFocus === 'messages' && (key.name === 'k' || key.name === 'up') && !key.shift) {
      handled(() => {
        if (!moveAgentToolCursor(-1)) moveCursor(-velocityScrollStep(-1))
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

    if (effectiveFocus === 'messages' && key.name === 'return') {
      handled(() => {
        toggleExpansion('parent')
      })
      return
    }

    if (effectiveFocus === 'messages' && key.name === 'e') {
      handled(() => {
        toggleExpansion('selected')
      })
      return
    }

    if (effectiveFocus === 'sessions' && transcriptView === 'agents' && key.name === 'e') {
      handled(() => {
        toggleExpansion('parent')
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

    // Resume-marker jump yields to the diff card's own `m` (toggle hunk
    // headers) when the cursor is on an interactive diff — this global handler
    // sits above the diff key block, so without the guard it would swallow `m`
    // before the diff block (below) ever sees it, leaving the documented
    // per-card shortcut dead.
    if (
      effectiveFocus === 'messages'
      && key.name === 'm'
      && !(selectedInteractiveTranscriptCard?.category === 'diff' && selectedInteractiveTranscriptCardDisplay?.diffView)
    ) {
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
      && selectedInteractiveTranscriptCard?.category === 'diff'
      && selectedInteractiveTranscriptCardDisplay?.diffView
      && key.shift
      && (key.name === 'j' || key.name === 'down' || key.name === 'k' || key.name === 'up')
    ) {
      const selectedDiffView = selectedInteractiveTranscriptCardDisplay.diffView
      if (!selectedDiffView) return
      handled(() => {
        const cardKey = selectedInteractiveTranscriptCard.key
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

    if (effectiveFocus === 'messages' && selectedInteractiveTranscriptCard?.category === 'diff' && selectedInteractiveTranscriptCardDisplay?.diffView) {
      const selectedDiffView = selectedInteractiveTranscriptCardDisplay.diffView
      if (!selectedDiffView) return
      const cardKey = selectedInteractiveTranscriptCard.key
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
      if (key.sequence === 'A') {
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
            selectedInteractiveTranscriptCard,
            note,
            currentSelectionSpan?.label ?? transcriptDiffSelectionLineLabel(note.range),
            cardDiffText(
              selectedInteractiveTranscriptCard,
              selectedAgentToolCard ? selectedAgentToolExpanded : resolvedExpandedKeys.has(selectedInteractiveTranscriptCard.key),
            ),
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
      const selectedCard = selectedInteractiveTranscriptCard
      if (selectedCard?.category === 'diff') {
        handled(() => {
          const next: TuiDiffLayout = diffLayout === 'stack' ? 'split' : 'stack'
          setDiffLayout(next)
          showToggleOutcome('Diff layout:', next)
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
        setComposerHidden(false)
        setComposerActive(true)
      })
      return
    }

    if (sequence === 'N' && !composerActive && normalizedSearchQuery.length === 0) {
      handled(() => openNewSessionModal())
      return
    }

    if (sequence === 'R' && !composerActive) {
      handled(reuseLastPrompt)
      return
    }

    if (sequence === 'i') {
      handled(() => {
        setThinkingMode((current) => {
          const next = !current
          showToggleOutcome('Thinking mode', next)
          return next
        })
      })
      return
    }

    if (sequence === 'X') {
      handled(() => {
        setShowToolCalls((v) => {
          const next = !v
          showToggleOutcome('Tool calls', next ? 'shown' : 'hidden')
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
          showToggleOutcome('Velocity scroll', next)
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
        showToggleOutcome('Tab bar', next)
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
        showToggleOutcome('Session rail', nextVisible)
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
        showToggleOutcome('Focus mode', next)
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
        showToggleOutcome('Density:', next)
        void writeTuiDensity(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store density')
        })
      })
      return
    }

    if (isShifted('W')) {
      handled(() => {
        const next: TuiTranscriptWidth = transcriptWidth === 'centered' ? 'full' : 'centered'
        setTranscriptWidth(next)
        showToggleOutcome('Transcript width:', next)
        void writeTuiTranscriptWidth(next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to store transcript width')
        })
      })
      return
    }

    if (sequence === 'v' && !key.ctrl && !key.meta) {
      handled(openTranscriptViewMenu)
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
  const readerMode = followTail ? null : pendingNewCount > 0 ? 'new content' : 'reading'
  const headerStatusRight = useMemo(
    () => {
      // Solid dot = live; hollow = a fetch is in flight (syncing/refreshing).
      const statusGlyph = statusLabel === 'live' ? '●' : '◌'
      // Primary group: the live/reader state that actually changes as you work.
      const livePart = joinMeta([
        `${statusGlyph} ${statusLabel.toUpperCase()}`,
        visibleTranscriptCards.length === 0 ? '0/0' : `${Math.max(cursorIndex, 0) + 1}/${visibleTranscriptCards.length}`,
        readerMode?.toUpperCase() ?? null,
        pendingNewCount > 0 ? `+${pendingNewCount} NEW` : null,
      ])
      // Secondary group: display config, split off with the same ` │ ` divider
      // the footer uses so it stops competing with live status. Density/width
      // are intentionally omitted — the footer already shows their live values
      // (d/⇧W), so repeating them here was pure duplication.
      const settingsPart = joinMeta([
        themeMode.toUpperCase(),
        !railVisible ? 'h show rail' : null,
      ])
      return fitText(
        settingsPart ? `${livePart} │ ${settingsPart}` : livePart,
        Math.max(Math.floor(width * 0.45), 20),
      )
    },
    [statusLabel, visibleTranscriptCards.length, cursorIndex, readerMode, themeMode, pendingNewCount, railVisible, width],
  )
  const readerContextMeta = useMemo(
    () => fitText(
      joinMeta([
        currentProjectName(selectedSession),
        readerModel,
      ]),
      Math.min(Math.max(Math.floor(rightPaneWidth * 0.28), 18), 42),
    ),
    [selectedSession, readerModel, rightPaneWidth],
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
  const composerWindowMetaSegments = useMemo<InlineTextSegment[]>(() => {
    const segments: InlineTextSegment[] = []
    composerKnobSegments.forEach((segment, index) => {
      if (index > 0) segments.push({ text: ' · ', fg: theme.dim })
      segments.push(segment)
    })
    if (composerLocationSegments.length > 0) {
      if (segments.length > 0) segments.push({ text: ' · ', fg: theme.dim })
      segments.push(...composerLocationSegments)
    }
    return segments
  }, [composerKnobSegments, composerLocationSegments, theme.dim])
  const composerWindowDraftSegments = useMemo<InlineTextSegment[]>(() => {
    const segments: InlineTextSegment[] = [
      { text: `${composerWindowVisualLineCount} line${composerWindowVisualLineCount === 1 ? '' : 's'}`, fg: theme.dim },
      { text: ` · ${composerDraft.length} chars`, fg: theme.dim },
    ]
    if (composerAttachmentLabel) {
      segments.push({ text: ' · ', fg: theme.dim })
      segments.push({ text: composerAttachmentLabel, fg: theme.cyan })
    }
    return segments
  }, [composerAttachmentLabel, composerDraft.length, composerWindowVisualLineCount, theme.cyan, theme.dim])
  const composerBaseTextareaStyle = {
    backgroundColor: theme.surface,
    textColor: theme.text,
    focusedBackgroundColor: theme.surface,
    focusedTextColor: theme.text,
    placeholderColor: theme.dim,
  }
  const composerDockTextareaStyle = {
    ...composerBaseTextareaStyle,
    backgroundColor: theme.surface2,
    focusedBackgroundColor: theme.surface3,
    flexGrow: 1,
  }
  // The textarea paints its own background over whatever the parent draws, so
  // chat mode's highlighted bar needs the textarea itself tinted to match —
  // otherwise the bar only shows through the "› " prefix and padding slivers.
  const composerChatTextareaStyle = {
    ...composerBaseTextareaStyle,
    backgroundColor: theme.surface3,
    focusedBackgroundColor: theme.surface3,
    flexGrow: 1,
  }
  const composerDockHeaderStatus = routeComposerToBridge
    ? 'BRIDGE'
    : routeComposerToIde
    ? 'IDE'
    : composerSendState === 'sending'
    ? 'SENDING'
    : reattachedRunning
    ? 'REATTACHED'
    : composerActive
    ? 'FOCUSED'
    : 'READY'
  const composerDockTitleLeft = '◆ COMPOSER'
  const composerDockTitleWidth = Math.max(composerDockTextareaWidth - 2, 12)
  const composerDockTitleGap = composerDockTitleWidth - composerDockTitleLeft.length - composerDockHeaderStatus.length
  const composerDockRouted = routeComposerToBridge || routeComposerToIde
  const composerDockEmphasized = composerDockRouted || composerActive
  const composerDockTitleRule = composerDockRouted ? '━' : '─'
  const composerDockBorderTitle = composerDockTitleGap > 0
    ? `${composerDockTitleLeft}${composerDockTitleRule.repeat(composerDockTitleGap)}${composerDockHeaderStatus}`
    : fitText(`${composerDockTitleLeft} · ${composerDockHeaderStatus}`, composerDockTitleWidth)
  const composerWindowHeaderStatus = composerSendState === 'sending'
    ? 'SENDING'
    : reattachedRunning
    ? 'REATTACHED'
    : 'EXPANDED'
  const composerWindowTitleLeft = '◆ COMPOSER'
  const composerWindowTitleWidth = Math.max(composerWindowWidth - 4, 12)
  const composerWindowTitleGap = composerWindowTitleWidth - composerWindowTitleLeft.length - composerWindowHeaderStatus.length
  const composerWindowBorderTitle = composerWindowTitleGap > 0
    ? `${composerWindowTitleLeft}${'━'.repeat(composerWindowTitleGap)}${composerWindowHeaderStatus}`
    : fitText(`${composerWindowTitleLeft} · ${composerWindowHeaderStatus}`, composerWindowTitleWidth)
  const sendingHintBase = interruptPressActive
    ? composerConfig.footerHintSending.replace('⌃C cancel', '⌃C again to interrupt')
    : composerTargetSession?.provider === 'claude' && activeRunningToolCount > 0
    ? `${composerConfig.footerHintSending} · ⌃B background`
    : composerConfig.footerHintSending
  const composerWorkflowFooterHint = composerTargetSession?.provider === 'claude' ? ' · ⌃W workflow' : ''
  const composerDockFooterHint = canUseChannelBridge && routeComposerToBridge
    ? '● → live CLI bridge · ⌃R off · ⇧C panel'
    : canUseIdeBridge && routeComposerToIde
    ? '● → IDE @mentions · ⇧I panel'
    : composerSendState === 'sending' || reattachedRunning
    ? sendingHintBase
    : canUseChannelBridge
    ? `${composerIdleFooterHint}${composerWorkflowFooterHint} · ⌃R bridge · ⌃O expand`
    : `${composerIdleFooterHint}${composerWorkflowFooterHint} · ⌃O expand`
  const composerDockSendingHintSegments = composerSendState === 'sending' || reattachedRunning
    ? composerSendingHintSegments(composerDockFooterHint, theme)
    : null
  // Size the hint box to exactly fit its text, capped by available width minus
  // 24 chars reserved for the stats side. Avoids the old proportional cap (62
  // chars) that truncated the full idle hint (~72 chars on most terminals).
  const composerDockFooterHintWidth = Math.max(
    18,
    Math.min(composerDockFooterHint.length + 1, composerDockTextareaWidth - 24),
  )
  const composerDockFooterStatsWidth = Math.max(composerDockTextareaWidth - composerDockFooterHintWidth - 1, 8)
  const composerWindowFooterHint = composerSendState === 'sending' || reattachedRunning
    ? `${sendingHintBase} · ⌃O dock`
    : `⏎ send · ⌥M settings · ⇧⏎ newline${composerWorkflowFooterHint} · ⌃O dock · Esc close`
  const composerWindowSendingHintSegments = composerSendState === 'sending' || reattachedRunning
    ? composerSendingHintSegments(composerWindowFooterHint, theme)
    : null
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
    options?: { height?: number; width?: number; variant?: 'chat' },
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
      style={options?.variant === 'chat'
        ? composerChatTextareaStyle
        : options?.height ? composerBaseTextareaStyle : composerDockTextareaStyle}
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
  // Always-visible queued-send list (no modal): shows what will fire after the
  // current turn, in order, with the ⌃Y edit / ⇧⌃Y clear hint.
  const renderComposerQueuePanel = (panelWidth: number, rowWidth: number) => {
    if (!composerActive || activeQueuedComposerSends.length === 0) return null
    const visible = Math.min(activeQueuedComposerSends.length, 4)
    const hiddenCount = activeQueuedComposerSends.length - visible
    return (
      <box
        width={panelWidth}
        height={visible + (hiddenCount > 0 ? 2 : 1) + 2}
        paddingX={1}
        backgroundColor={theme.surface2}
        border
        borderStyle="single"
        borderColor={composerQueueDurable ? (theme.amber ?? theme.border2) : theme.red}
        flexDirection="column"
      >
        <text fg={composerQueueDurable ? (theme.amber ?? composerAccentColor) : theme.red} wrapMode="none">
          {fitText(`${composerQueueDurable ? '' : 'memory only · '}queued (${activeQueuedComposerSends.length}) · sends in order after this turn · ⌃Y edit newest · ⇧⌃Y clear`, rowWidth)}
        </text>
        {activeQueuedComposerSends.slice(0, visible).map((entry, index) => {
          const compact = compactComposerEntryText(entry.text)
          const attachmentLabel = attachmentCountLabel(entry.attachments)
          const suffix = attachmentLabel ? `  ${attachmentLabel}` : ''
          return (
            <box key={entry.id} flexDirection="row" height={1} width={rowWidth}>
              <text fg={theme.dim} wrapMode="none">{`${index + 1}. `}</text>
              <text fg={theme.text} wrapMode="none">{fitText(compact, Math.max(rowWidth - 6 - suffix.length, 8))}</text>
              <text fg={theme.dim} wrapMode="none">{suffix}</text>
            </box>
          )
        })}
        {hiddenCount > 0 ? (
          <text fg={theme.dim} wrapMode="none">{fitText(`  +${hiddenCount} more queued`, rowWidth)}</text>
        ) : null}
      </box>
    )
  }

  return (
    <box width={width} height={height} flexDirection="column" backgroundColor={theme.bg}>
      <box flexGrow={1} padding={1} gap={1} height={mainContentHeight} flexDirection="row" backgroundColor={theme.bg}>
        {showRail ? (
          <box
            width={sidebarWidth}
            border={sidebarView === 'sessions' ? ['top', 'left', 'right', 'bottom'] : true}
            borderStyle="single"
            borderColor={effectiveFocus === 'sessions' ? theme.cyan : theme.border}
            backgroundColor={theme.surface}
            flexDirection="column"
            title={sidebarView === 'coordinator' ? coordinatorSidebarHeader : undefined}
            titleColor={theme.cyan}
          >
            {sidebarView === 'sessions' ? (
              <box
                height={1}
                paddingX={1}
                flexDirection="row"
                backgroundColor={theme.surface2}
                overflow="hidden"
                onMouseDown={(event) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  toggleSidebarSort()
                  showToggleOutcome('Sidebar sort:', sidebarSort === 'project' ? 'time' : 'project')
                }}
              >
                <text width={sidebarHeaderWidth} fg={theme.cyan} bg={theme.surface2} wrapMode="none">
                  {sidebarHeaderBaseText}
                </text>
                <box
                  id="sidebar-provider-badge"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: sidebarHeaderPrefixWidth + 1,
                    width: sidebarProviderBadgeText.length,
                    minWidth: sidebarProviderBadgeText.length,
                    maxWidth: sidebarProviderBadgeText.length,
                    height: 1,
                    overflow: 'hidden',
                  }}
                  backgroundColor={sidebarProviderAccent}
                >
                  <text
                    width={sidebarProviderBadgeText.length}
                    minWidth={sidebarProviderBadgeText.length}
                    maxWidth={sidebarProviderBadgeText.length}
                    fg={theme.bg}
                    attributes={TextAttributes.BOLD}
                    wrapMode="none"
                  >
                    {sidebarProviderBadgeText}
                  </text>
                </box>
              </box>
            ) : null}
            <box flexGrow={1} paddingX={1}>
              {sidebarView === 'coordinator' ? (
                coordinatorEntries.length === 0 ? (
                  <text fg={theme.dim}>{fitText('No coordinator runs — ⌃⇧N to start one', sidebarInnerWidth)}</text>
                ) : (
                  <scrollbox
                    style={{ height: sidebarRowBudget }}
                    backgroundColor={theme.surface}
                    scrollY
                    viewportCulling
                    scrollbarOptions={sidebarScrollbarOptions}
                  >
                    {coordinatorRowElements}
                  </scrollbox>
                )
              ) : loadingSessions && sessions.length === 0 ? (
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

        <box width={readerAreaWidth} flexDirection="column">
          {showTabs ? (
            <box
              paddingX={1}
              backgroundColor={theme.surface2}
            >
              <tab-select
                ref={tabSelectRef}
                options={tabOptions}
                width={readerAreaWidth - 2}
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
                onMouseDown={(event) => {
                  if (event.button !== 0) return
                  const instance = tabSelectRef.current
                  if (!instance) return
                  const scrollOffset = (instance as unknown as { scrollOffset: number }).scrollOffset ?? 0
                  const localX = event.x - instance.x
                  const index = scrollOffset + Math.floor(localX / tabWidth)
                  const tab = visibleTabSessions[index]
                  if (tab) selectTabSession(tab)
                }}
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

          <box flexDirection="row" flexGrow={1}>
          <box
            ref={readerBoxRef}
            flexGrow={1}
            border
            borderStyle="single"
            // Focused pane lights its frame in its own title color (transcript →
            // provider accent, like the sidebar → cyan) so it's obvious which
            // side has focus instead of the frame staying uniformly dim.
            borderColor={effectiveFocus === 'messages' && splitFocusIndex === null
              ? providerAccent
              : isChatLikeView
                ? theme.surface
                : theme.border}
            backgroundColor={theme.surface}
            flexDirection="column"
            title={isChatLikeView ? undefined : headerStatusRight}
            titleColor={providerAccent}
          >
          {!focusMode && transcriptView !== 'stream' ? (
            <box paddingX={2} paddingTop={1} flexDirection="row" alignItems="center">
              <text fg={providerAccent} wrapMode="none">{'● '}</text>
              <box flexGrow={1} overflow="hidden">
                <text fg={theme.text} wrapMode="none">
                  {fitText(readerTitle, Math.max(rightPaneWidth - readerContextMeta.length - 10, 12))}
                </text>
              </box>
              <box width={readerContextMeta.length} overflow="hidden">
                <text fg={theme.dim} wrapMode="none">{readerContextMeta}</text>
              </box>
            </box>
          ) : null}

          {!focusMode && transcriptView !== 'stream' && contextUsage ? (
            <box paddingX={1}>
              <text wrapMode="none">
                {renderInlineTextSegments(
                  contextBarSegments(contextUsage.totalTokens, contextUsage.maxTokens, contextUsage.percentage, theme),
                  rightPaneWidth - 4,
                  theme.dim,
                )}
              </text>
            </box>
          ) : !focusMode && transcriptView !== 'stream' && selectedSession?.provider === 'claude' && contextUsageStatus === 'loading' ? (
            <box paddingX={1}>
              <text fg={theme.dim}>{fitText('Loading context usage…', rightPaneWidth - 4)}</text>
            </box>
          ) : !focusMode && transcriptView !== 'stream' && selectedSession?.provider === 'claude' && contextUsageStatus === 'unavailable' ? (
            <box paddingX={1}>
              <text fg={theme.dim}>{fitText('Context usage unavailable', rightPaneWidth - 4)}</text>
            </box>
          ) : null}

          {fleetStripVisible ? (
            <box paddingX={1} flexDirection="row" overflow="hidden">
              <text wrapMode="none">
                {renderInlineTextSegments(fleetStripSegments, rightPaneWidth - 4, theme.dim)}
              </text>
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
                focused={effectiveFocus === 'messages' && splitFocusIndex === null}
                // Match the card surface, not theme.bg: cards render on `surface`,
                // so when bg is darker than surface (e.g. SENTRY #150f23 vs
                // #1f1633) the cardGap rows between cards revealed bg as dark
                // bands in comfortable/balanced (dense has cardGap 0, no gaps).
                // Surfacing the viewport makes the gaps blend; borders still
                // delineate cards, and cursor/selected cards keep surface2/3.
                backgroundColor={theme.surface}
                stickyScroll={followTail}
                stickyStart="bottom"
                scrollY
                scrollAcceleration={MESSAGE_SCROLL_ACCEL}
                viewportCulling
                scrollbarOptions={transcriptScrollbarOptions}
                >
                <box height={TRANSCRIPT_TOP_MARGIN} />
                <TuiErrorBoundary>
                  {isScrubbing ? (
                    <box paddingX={1}>
                      <text fg={theme.dim} wrapMode="none">…</text>
                    </box>
                  ) : transcriptChildren}
                </TuiErrorBoundary>

                {composerSendState === 'sending' && composerLiveText && !liveAssistantTextCardVisible ? (
                  isChatLikeView ? (
                    <box
                      key="live-stream-text"
                      marginBottom={densityState.cardGap}
                      paddingLeft={densityState.bodyIndent}
                    >
                      <text fg={theme.text} width={Math.max(rightPaneWidth - densityState.bodyIndent - 4, 16)} wrapMode="word">
                        {`● ${composerLiveText}`}
                      </text>
                    </box>
                  ) : (
                    <box key="live-stream-text" flexDirection="column" marginBottom={densityState.cardGap}>
                      <box border borderStyle="single" borderColor={providerAccent} backgroundColor={theme.surface}>
                        <box flexDirection="column" width={rightPaneWidth - 4}>
                          <box paddingX={1} paddingTop={1}>
                            <text fg={providerAccent}>
                              {fitText('● assistant  streaming', rightPaneWidth - 6)}
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
                  )
                ) : null}

                {streamTurnFooterText ? (
                  <box key="stream-turn-footer" paddingX={1} marginBottom={densityState.cardGap}>
                    <text fg={theme.dim} width={Math.max(rightPaneWidth - 5, 12)} wrapMode="none" selectable>
                      {streamLandmarkText(
                        { kind: 'turn', text: streamTurnFooterText },
                        Math.max(rightPaneWidth - 5, 12),
                      )}
                    </text>
                  </box>
                ) : null}

              </scrollbox>
            )}
            {streamActionFooterRows > 0 ? (
              <box height={streamActionFooterRows} paddingLeft={1}>
                <text fg={theme.dim} wrapMode="none">
                  {effectiveFocus === 'messages'
                    ? fitText('b bookmark   Q quote/reply   y copy', Math.max(rightPaneWidth - 6, 12))
                    : ' '}
                </text>
              </box>
            ) : null}
          </box>

          {followTail && visibleTranscriptCards.length > 0
            && (transcriptView !== 'chat' || turnRunningForComposer) ? (
            <box paddingX={2} paddingBottom={1}>
              <IdleTicker seed={selectedSessionKey ?? ''} theme={theme} />
            </box>
          ) : null}

          {!composerWindowOpen && !composerHidden && transcriptView === 'chat' ? (
            // Chat mode: the composer is the reader box's own trailing child —
            // a full-width highlighted bar in the same style as a user message
            // row, inside the same border as the transcript, so it reads as
            // the next line of the conversation rather than a docked control.
            <box width="100%" height={composerDockHeight} flexDirection="column" paddingX={1}>
              <box
                width="100%"
                paddingX={1}
                backgroundColor={theme.surface3}
                flexDirection="row"
                onMouseDown={(event) => {
                  if (event.button !== 0) return
                  if (!composerActive) setComposerActive(true)
                  composerTextareaRef.current?.focus()
                }}
              >
                <text fg={composerAccentColor} wrapMode="none">{'› '}</text>
                <box flexGrow={1}>
                  {renderComposerTextarea(submitComposerFromDock, {
                    height: composerDockTextareaHeight,
                    width: Math.max(rightPaneWidth - 6, 1),
                    variant: 'chat',
                  })}
                </box>
              </box>
              <box height={1} paddingX={1} flexDirection="row" alignItems="center">
                <box width={Math.max(Math.floor((rightPaneWidth - 4) * 0.55), 12)} overflow="hidden">
                  <text fg={composerSlashHint ? composerAccentColor : theme.dim} wrapMode="none">
                    {composerSlashHint
                      ? fitText(composerSlashHint, Math.max(Math.floor((rightPaneWidth - 4) * 0.55), 12))
                      : renderInlineTextSegments(composerDockStatsSegments, Math.max(Math.floor((rightPaneWidth - 4) * 0.55), 12), theme.dim)}
                  </text>
                </box>
                <box flexGrow={1} />
                <box overflow="hidden">
                  <text fg={composerActive && composerSendState !== 'sending' ? composerAccentColor : theme.dim} wrapMode="none">
                    {composerDockSendingHintSegments
                      ? renderInlineTextSegments(composerDockSendingHintSegments, Math.max(Math.floor((rightPaneWidth - 4) * 0.45) - 1, 12), theme.dim)
                      : fitText(composerDockFooterHint, Math.max(Math.floor((rightPaneWidth - 4) * 0.45) - 1, 12))}
                  </text>
                </box>
              </box>
            </box>
          ) : null}
          </box>

        {/* Split panes live in the reader's row, under the shared tab strip, so
            every frame in this area lines up top and bottom. */}
        {splitPaneSessions.map((splitSession, splitIndex) => (
          <box
            key={`split:${sessionKey(splitSession)}`}
            width={splitPaneWidth}
            flexDirection="column"
            overflow="hidden"
            marginLeft={1}
          >
            <SplitTranscriptPane
              session={splitSession}
              paneIndex={splitIndex}
              focused={splitFocusIndex === splitIndex}
              registerHandle={registerSplitPaneHandle}
              theme={theme}
              densityState={densityState}
              density={density}
              showToolCalls={showToolCalls}
              syntaxStyle={syntaxStyle}
              thinkingMode={thinkingMode}
              diffLayout={diffLayout}
              imessageStyle={imessageStyle}
              transcriptWidth={transcriptWidth}
              transcriptView={transcriptView}
              width={splitPaneWidth}
              height={splitPaneBoxHeight}
              liveMessages={splitPaneLiveMessages.get(sessionKey(splitSession)) ?? SPLIT_PANE_EMPTY_LIVE}
              running={splitPaneRunningKeys.has(sessionKey(splitSession))}
              // Streaming text belongs to whichever session the composer is
              // sending to; show it in the pane when that's this pane.
              liveText={
                composerSendState === 'sending'
                && composerLiveText
                && composerTargetSession
                && sessionKey(composerTargetSession) === sessionKey(splitSession)
                && !(splitPaneLiveMessages.get(sessionKey(splitSession)) ?? []).some(isLiveAssistantTextMessage)
                  ? composerLiveText
                  : null
              }
              onActivate={focusSplitPane}
            />
          </box>
        ))}
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
              const overlayHeight = Math.min(24, Math.max(height - 2, 14))
              const contentWidth = Math.max(overlayWidth - 5, 38)
              const headerWidth = Math.max(overlayWidth - 4, 40)
              const modelWidth = Math.max(Math.floor(contentWidth * 0.58), 22)
              const effortWidth = Math.max(contentWidth - modelWidth - 1, 15)
              const detailHeight = overlayHeight >= 18 ? 2 : 1
              const settingsContentHeight = Math.max(overlayHeight - detailHeight - 5, 8)
              const effortListHeight = Math.max(Math.min(Math.floor((settingsContentHeight - 2) * 0.45), 6), 3)
              const permissionListHeight = Math.max(settingsContentHeight - effortListHeight - 2, 3)
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
                  <box height={2} paddingX={1} flexDirection="column">
                    <text fg={ot.text} wrapMode="none">
                      {fitText(
                        `${String(modelPickerTarget?.provider ?? 'session').toUpperCase()} · MODEL · EFFORT · ${modelPickerPermissionLabel}`,
                        headerWidth,
                      )}
                    </text>
                    <text fg={ot.dim} wrapMode="none">
                      {fitText('type to filter · ↑/↓ choose · tab/←/→ switch · enter apply · esc close', headerWidth)}
                    </text>
                  </box>
                  <box height={settingsContentHeight} paddingX={1} flexDirection="row" gap={1}>
                    <box width={modelWidth} flexDirection="column">
                      <text fg={modelPickerFocus === 'model' ? ot.cyan : ot.dim} wrapMode="none">
                        {`${modelPickerFocus === 'model' ? '▸' : ' '} MODEL · ${filteredModelPickerOptions.length}/${modelPickerOptions.length}`}
                      </text>
                      {modelPickerLoading ? (
                        <text fg={ot.dim} wrapMode="none">Loading provider models…</text>
                      ) : modelPickerError ? (
                        <text fg={ot.red} wrapMode="word">{modelPickerError}</text>
                      ) : modelPickerOptions.length === 0 ? (
                        <text fg={ot.dim} wrapMode="none">No models available</text>
                      ) : (
                        <>
                          <box height={1} flexDirection="row">
                            <text fg={modelPickerFocus === 'model' ? ot.cyan : ot.dim}>/ </text>
                            <input
                              style={{ flexGrow: 1 }}
                              focused={modelPickerFocus === 'model'}
                              value={modelPickerQuery}
                              placeholder="Search name or model ID..."
                              maxLength={80}
                              onInput={(value) => {
                                setModelPickerQuery(value)
                                setModelPickerIndex(0)
                              }}
                              onSubmit={() => applyModelPickerOption()}
                            />
                          </box>
                          {filteredModelPickerOptions.length === 0 ? (
                            <text fg={ot.dim} wrapMode="none">No matching models</text>
                          ) : (
                            <select
                              style={{ height: Math.max(settingsContentHeight - 2, 5) }}
                              focused={false}
                              options={filteredModelPickerOptions}
                              selectedIndex={modelPickerIndex}
                              selectedBackgroundColor={modelPickerFocus === 'model' ? ot.surface3 : ot.surface}
                              selectedTextColor={modelPickerFocus === 'model' ? ot.text : ot.muted}
                              textColor={ot.muted}
                              descriptionColor={ot.dim}
                              selectedDescriptionColor={ot.cyan}
                              backgroundColor={ot.surface}
                              focusedBackgroundColor={ot.surface}
                              showScrollIndicator={false}
                              itemSpacing={0}
                              onChange={(index) => setModelPickerIndex(index)}
                              onSelect={(_, option) => {
                                if (option) applyModelPickerOption(option as ModelPickerOption)
                              }}
                            />
                          )}
                        </>
                      )}
                    </box>
                    <box width={effortWidth} flexDirection="column">
                      <text fg={modelPickerFocus === 'effort' ? ot.cyan : ot.dim} wrapMode="none">
                        {modelPickerFocus === 'effort' ? '▸ EFFORT' : '  EFFORT'}
                      </text>
                      <select
                        style={{ height: effortListHeight }}
                        focused={modelPickerFocus === 'effort'}
                        options={compactModelPickerEffortOptions}
                        selectedIndex={modelPickerEffortIndex}
                        selectedBackgroundColor={modelPickerFocus === 'effort' ? ot.surface3 : ot.surface}
                        selectedTextColor={modelPickerFocus === 'effort' ? ot.text : ot.muted}
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
                          applyModelPickerEffort(typeof value === 'string' ? value : undefined)
                        }}
                      />
                      <text fg={modelPickerFocus === 'permissions' ? ot.cyan : ot.dim} wrapMode="none">
                        {modelPickerFocus === 'permissions' ? `▸ ${modelPickerPermissionLabel}` : `  ${modelPickerPermissionLabel}`}
                      </text>
                      <select
                        style={{ height: permissionListHeight }}
                        focused={modelPickerFocus === 'permissions'}
                        options={compactModelPickerPermissionOptions}
                        selectedIndex={modelPickerPermissionIndex}
                        selectedBackgroundColor={modelPickerFocus === 'permissions' ? ot.surface3 : ot.surface}
                        selectedTextColor={modelPickerFocus === 'permissions' ? ot.text : ot.muted}
                        textColor={ot.muted}
                        descriptionColor={ot.dim}
                        selectedDescriptionColor={ot.cyan}
                        backgroundColor={ot.surface}
                        focusedBackgroundColor={ot.surface}
                        showScrollIndicator={false}
                        itemSpacing={0}
                        onChange={(index) => setModelPickerPermissionIndex(index)}
                        onSelect={(_, option) => {
                          const value = option?.value
                          applyModelPickerPermission(typeof value === 'string' ? value : undefined)
                        }}
                      />
                    </box>
                  </box>
                  <box height={detailHeight} paddingX={1} flexDirection="column" backgroundColor={ot.surface2}>
                    <text fg={ot.cyan} wrapMode="none">
                      {fitText(`${modelPickerFocusedLabel} · ${modelPickerFocusedOption?.name ?? '—'}`, headerWidth)}
                    </text>
                    {detailHeight > 1 ? (
                      <text fg={ot.dim} wrapMode="none">
                        {fitText(modelPickerFocusedDescription || 'No additional details', headerWidth)}
                      </text>
                    ) : null}
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
          const menuHeight = Math.max(15, Math.min(height - 4, 33))
          const allGroupThemes = THEME_GROUPS.find((g) => g.key === themeMenuGroup)?.themes ?? DARK_MODES
          const groupThemes = filterThemeModes(allGroupThemes, themeMenuQuery)
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
                {THEME_GROUPS.map((group, i) => (
                  <React.Fragment key={group.key}>
                    {i > 0 ? <text fg={overlayTheme.dim} wrapMode="none">  |  </text> : null}
                    <text fg={themeMenuGroup === group.key ? overlayTheme.cyan : overlayTheme.muted} wrapMode="none">{group.label}</text>
                  </React.Fragment>
                ))}
                <text fg={overlayTheme.dim} wrapMode="none">   ← →</text>
              </box>
              <box height={1} paddingX={2} paddingBottom={1} flexDirection="row">
                <text fg={overlayTheme.cyan} wrapMode="none">/ </text>
                <input
                  style={{ flexGrow: 1 }}
                  focused
                  value={themeMenuQuery}
                  placeholder="Search themes..."
                  maxLength={60}
                  onInput={(value) => {
                    setThemeMenuQuery(value)
                    const nextGroupThemes = filterThemeModes(allGroupThemes, value)
                    const target = nextGroupThemes[0]
                    if (target) {
                      setThemeMenuIndex(THEMES.indexOf(target))
                      setThemeMode(target)
                    }
                  }}
                  onSubmit={() => {
                    const target = groupThemes[localIndex] ?? groupThemes[0]
                    if (target) chooseTheme(target)
                  }}
                />
              </box>
              <box flexGrow={1} paddingX={1} paddingBottom={1}>
                {groupThemes.length === 0 ? (
                  <text fg={overlayTheme.dim} wrapMode="none">No matching themes</text>
                ) : (
                  <select
                    style={{ height: menuHeight - 8 }}
                    focused={false}
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
                )}
              </box>
            </box>
          )
        })() : null}

        {transcriptViewMenuOpen ? (() => {
          const menuWidth = Math.min(Math.max(width - 8, 28), 46)
          const menuHeight = 10
          const originView = transcriptViewMenuOriginRef.current
          const viewOptions = TRANSCRIPT_VIEWS.map((view) => ({
            name: TRANSCRIPT_VIEW_LABELS[view] + (view === originView ? ' ✓' : ''),
            description: TRANSCRIPT_VIEW_DESCRIPTIONS[view],
            value: view,
          }))
          return (
            <box
              position="absolute"
              top={focusMode ? 1 : 3}
              right={2}
              width={menuWidth}
              height={menuHeight}
              border
              borderStyle="single"
              borderColor={theme.border2}
              backgroundColor={theme.surface}
              zIndex={20}
              flexDirection="column"
            >
              <box paddingX={2} paddingBottom={1} flexDirection="row">
                <text fg={theme.cyan} wrapMode="none">TRANSCRIPT VIEW</text>
                <text fg={theme.dim} wrapMode="none">  v / esc close</text>
              </box>
              <box flexGrow={1} paddingX={1} paddingBottom={1}>
                <select
                  style={{ height: menuHeight - 4 }}
                  focused
                  options={viewOptions}
                  selectedIndex={transcriptViewMenuIndex}
                  selectedBackgroundColor={theme.surface3}
                  selectedTextColor={theme.text}
                  textColor={theme.muted}
                  descriptionColor={theme.dim}
                  selectedDescriptionColor={theme.cyan}
                  backgroundColor={theme.surface}
                  focusedBackgroundColor={theme.surface}
                  showScrollIndicator={false}
                  showDescription={false}
                  itemSpacing={0}
                  onChange={(index) => {
                    const next = TRANSCRIPT_VIEWS[index]
                    if (next) {
                      setTranscriptViewMenuIndex(index)
                      setTranscriptView(next)
                    }
                  }}
                  onSelect={(_, option) => {
                    const next = option?.value as TuiTranscriptView | undefined
                    if (next) chooseTranscriptView(next)
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
              <box paddingX={1} paddingTop={1} paddingBottom={1} backgroundColor={theme.surface2}>
                <text wrapMode="none">
                  {renderInlineTextSegments([
                    { text: '> ', fg: theme.dim },
                    { text: commandPaletteQuery || 'type to filter', fg: commandPaletteQuery ? theme.text : theme.dim },
                    { text: '█', fg: theme.cyan },
                    { text: '  j/k move · ⏎ run · esc close', fg: theme.dim },
                    { text: positionHint, fg: theme.muted },
                  ], paletteW - 4, theme.dim)}
                </text>
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
                    <box key={`palette-row:${i}`} paddingX={1} backgroundColor={theme.surface2} flexDirection="row">
                      <text fg={theme.cyan} wrapMode="none">{'┄ '}</text>
                      <text fg={theme.cyan} wrapMode="none">{row.label.toUpperCase()}</text>
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
                    <text fg={theme.cyan} wrapMode="none">{isSelected ? '▎' : ' '}</text>
                    <box flexGrow={1}>
                      <text fg={isSelected ? theme.text : theme.muted} wrapMode="none">
                        {fitText(row.cmd.label, labelW - 1)}
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
                  const firstSession = sidebarEntries
                    .map(sidebarEntrySession)
                    .find((session): session is Session => Boolean(session))
                  if (firstSession) {
                    setSelectedSessionKey(sessionKey(firstSession))
                  }
                  setSessionSearchMode(false)
                }}
              />
            </box>
          </box>
        </box>
      ) : null}

      {pendingPermissions.length > 0 && (pendingPermissions[0]!.questions?.length ?? 0) > 0 ? (() => {
        const permission = pendingPermissions[0]!
        const questions = permission.questions ?? []
        const innerWidth = Math.max(width - 8, 20)
        const focusIndex = Math.min(questionFocusIndex, questions.length - 1)
        return (
          <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
            <box borderStyle="single" borderColor={theme.violet ?? theme.amber} backgroundColor={theme.surface} flexDirection="column" paddingX={1}>
              <text fg={theme.violet ?? theme.amber} wrapMode="none">
                {fitText(questions.length === 1
                  ? `● ${formatProviderLabel(permission.provider ?? 'claude')} asks`
                  : `● ${formatProviderLabel(permission.provider ?? 'claude')} asks · ${questions.length} questions`, innerWidth)}
              </text>
              {questions.map((q, qi) => {
                const focused = qi === focusIndex
                const selected = questionSelections[qi] ?? []
                return (
                  <box key={`q:${qi}`} flexDirection="column" marginTop={qi === 0 ? 0 : 1}>
                    <text fg={focused ? theme.text : theme.dim} wrapMode="none">
                      {fitText(`${questions.length > 1 ? `${focused ? '▶ ' : '  '}` : ''}${q.header ? `[${q.header}] ` : ''}${q.question}${q.multiSelect ? ' (multi)' : ''}`, innerWidth)}
                    </text>
                    {q.options.map((opt, oi) => {
                      const isSelected = selected.includes(opt.value ?? opt.label)
                      const isCursor = focused && oi === Math.min(questionOptionIndex, q.options.length - 1)
                      const marker = isSelected ? (q.multiSelect ? '☑' : '●') : (q.multiSelect ? '☐' : '○')
                      const color = isCursor ? (theme.violet ?? theme.cyan) : isSelected ? theme.green : theme.dim
                      return (
                        <text key={`q:${qi}:o:${oi}`} fg={color} wrapMode="none">
                          {fitText(`  ${isCursor ? '▶' : ' '} ${marker} [${oi + 1}] ${opt.label}`, innerWidth)}
                        </text>
                      )
                    })}
                    {q.allowFreeform ? (() => {
                      const oi = q.options.length
                      const value = questionFreeformAnswers[qi] ?? ''
                      const displayValue = q.secret && value ? '•'.repeat(Math.min(value.length, 24)) : value
                      const isCursor = focused && oi === Math.min(questionOptionIndex, q.options.length)
                      const isEditing = focused && isCursor && questionFreeformEditing
                      return (
                        <text key={`q:${qi}:other`} fg={isEditing ? theme.green : isCursor ? (theme.violet ?? theme.cyan) : value ? theme.green : theme.dim} wrapMode="none">
                          {fitText(`  ${isCursor ? '▶' : ' '} ${value ? '●' : '○'} [${oi + 1}] Other${displayValue ? `: ${displayValue}` : ''}${isEditing ? ' █' : ''}`, innerWidth)}
                        </text>
                      )
                    })() : null}
                  </box>
                )
              })}
              <text fg={theme.dim} wrapMode="none">
                {permissionActionLoading
                  ? 'submitting…'
                  : questionFreeformEditing
                  ? fitText('type custom answer · enter finish · esc cancel editing', innerWidth)
                  : fitText(`↑/↓ option${questions.length > 1 ? ' · ←/→ question' : ''} · space/number select · enter submit · esc skip`, innerWidth)}
              </text>
            </box>
          </box>
        )
      })() : pendingPermissions.length > 0 && pendingPermissions[0]!.toolName === 'ExitPlanMode' ? (() => {
        const permission = pendingPermissions[0]!
        const innerWidth = Math.max(width - 8, 20)
        const planLines = permission.plan ? permission.plan.split('\n').slice(0, 16) : []
        const planOptions = [
          { decision: 'reject' as const, label: 'keep planning' },
          { decision: 'default' as const, label: 'approve · ask per tool' },
          { decision: 'acceptEdits' as const, label: 'approve · auto-accept edits' },
        ]
        const idx = Math.min(permissionOptionIndex, planOptions.length - 1)
        return (
          <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
            <box borderStyle="single" borderColor={theme.green} backgroundColor={theme.surface} flexDirection="column" paddingX={1}>
              <text fg={theme.green} wrapMode="none">{fitText('● Claude finished planning', innerWidth)}</text>
              {planLines.map((planLine, index) => (
                <text key={`plan:${index}`} fg={theme.text} wrapMode="none">{fitText(planLine || ' ', innerWidth)}</text>
              ))}
              {permission.plan && permission.plan.split('\n').length > planLines.length ? (
                <text fg={theme.dim} wrapMode="none">{fitText('  … (plan truncated)', innerWidth)}</text>
              ) : null}
              {permission.allowedPrompts && permission.allowedPrompts.length > 0 ? (
                <text fg={theme.dim} wrapMode="none">{fitText(`allows: ${permission.allowedPrompts.join(' · ')}`, innerWidth)}</text>
              ) : null}
              <box flexDirection="row" gap={2} marginTop={1} height={1}>
                {planOptions.map((option, index) => {
                  const selected = index === idx
                  const color = option.decision === 'reject' ? theme.amber : theme.green
                  return (
                    <text key={option.decision} fg={selected ? color : theme.dim} wrapMode="none">
                      {`${selected ? '▶' : ' '} [${index + 1}] ${option.label}`}
                    </text>
                  )
                })}
              </box>
              <text fg={theme.dim} wrapMode="none">
                {fitText(permissionActionLoading ? 'responding…' : '←/→ select · enter confirm · 1/2/3 quick · esc keep planning', innerWidth)}
              </text>
            </box>
          </box>
        )
      })() : pendingPermissions.length > 0 ? (() => {
        const permission = pendingPermissions[0]!
        const options = permissionOptionsFor(permission)
        const selectedIndex = Math.min(permissionOptionIndex, options.length - 1)
        const innerWidth = Math.max(width - 8, 20)
        const diffLines = permission.diff ? permission.diff.split('\n').slice(0, 12) : []
        return (
          <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
            <box borderStyle="single" borderColor={theme.amber} backgroundColor={theme.surface} flexDirection="column" paddingX={1}>
              <text fg={theme.amber} wrapMode="none">{fitText(`● ${permission.title}`, innerWidth)}</text>
              {permission.reason ? (
                <text fg={theme.dim} wrapMode="word">{permission.reason}</text>
              ) : null}
              {permission.command ? (
                permission.command.split('\n').slice(0, 12).map((line, index) => (
                  <text key={`perm-cmd:${index}`} fg={theme.text} wrapMode="none">
                    {fitText(index === 0 ? `$ ${line}` : line, innerWidth)}
                  </text>
                ))
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
                {fitText(permissionActionLoading ? 'responding…' : '←/→ select · enter confirm · 1/2/3 quick', innerWidth)}
              </text>
            </box>
          </box>
        )
      })() : null}

      {(liveStatus === 'retrying' || liveStatus === 'compacting') && composerSendState === 'sending' ? (
        <box backgroundColor={theme.surface2} paddingX={1} paddingTop={1} flexDirection="row">
          <text fg={theme.amber} wrapMode="none">{'▌ '}</text>
          <text fg={theme.amber} wrapMode="none">
            {fitText(
              liveStatus === 'retrying'
                ? '● Retrying after a transient error…'
                : '● Compacting conversation to free up context…',
              Math.max(width - 6, 16),
            )}
          </text>
        </box>
      ) : null}

      {composerSendState === 'sending' && composerLiveReasoning.trim() && transcriptView !== 'stream' ? (
        <LivePreviewCard
          title={`✻ THINKING · ${String(composerProvider ?? 'agent').toUpperCase()} · ${tuiEffort.toUpperCase()}${composerThinkingTokens > 0 ? ` · ~${composerThinkingTokens >= 1000 ? `${(composerThinkingTokens / 1000).toFixed(1)}k` : composerThinkingTokens} tok` : ''}`}
          lines={liveReasoningPreviewLines}
          accentColor={theme.violet}
          bodyColor={theme.muted}
          theme={theme}
        />
      ) : null}

      {composerSendState === 'sending' && !composerLiveText && !composerLiveReasoning.trim() && activeRunningToolCount === 0 ? (
        <box
          backgroundColor={isChatLikeView ? theme.surface : theme.surface2}
          paddingLeft={isChatLikeView ? densityState.bodyIndent : 1}
          paddingTop={isChatLikeView ? 0 : 1}
          flexDirection="row"
        >
          <text fg={theme.cyan} wrapMode="none">{isChatLikeView ? '● ' : '▌ '}</text>
          <box flexGrow={1}>
            <ComposerWaitingStatus
              startedAt={composerSendStartedAt}
              seed={composerWaitingStatusSeed}
              suffix={composerWaitingSuffix}
              theme={theme}
              width={Math.max(width - 6, 16)}
            />
          </box>
        </box>
      ) : null}

      {composerSendState !== 'sending' && reattachedRunning && !awaitingPersistedTurn ? (
        <box backgroundColor={theme.surface2} paddingX={1} paddingTop={1} flexDirection="row">
          <text fg={theme.cyan} wrapMode="none">{'▌ '}</text>
          <text fg={theme.muted} wrapMode="none">
            {fitText('● Turn running · reattached — output syncs as it persists · ⌃C interrupt', Math.max(width - 6, 16))}
          </text>
        </box>
      ) : null}

      {liveToolActivities.length > 0 && activeRunningToolCount > 0 ? (
        <box
          backgroundColor={isChatLikeView ? theme.surface : theme.surface2}
          paddingLeft={isChatLikeView ? densityState.bodyIndent : 1}
          paddingTop={isChatLikeView ? 0 : 1}
          flexDirection="row"
        >
          <text fg={theme.green} wrapMode="none">{isChatLikeView ? '● ' : '▌ '}</text>
          <text wrapMode="none">
            {renderInlineTextSegments([
              { text: 'tools  ', fg: theme.dim },
              ...liveToolActivities.flatMap((a, i): InlineTextSegment[] => [
                ...(i > 0 ? [{ text: '  ', fg: theme.dim }] : []),
                { text: a.label, fg: a.status === 'running' ? theme.text : theme.muted },
                { text: a.status === 'running' ? ' ●' : ' ✓', fg: a.status === 'running' ? theme.green : theme.dim },
              ]),
            ], Math.max(width - 6, 16), theme.dim)}
          </text>
        </box>
      ) : null}

      {(() => {
        const subagentEntries = Object.entries(liveSubagentText).filter(([, text]) => text.trim().length > 0)
        if (subagentEntries.length === 0) return null
        const [, latest] = subagentEntries[subagentEntries.length - 1]
        const tail = latest.replace(/\s+/g, ' ').trim().slice(-80)
        return (
          <box backgroundColor={theme.surface2} paddingX={1} paddingTop={1} flexDirection="row">
            <text fg={theme.pink} wrapMode="none">{'▌ '}</text>
            <text fg={theme.dim} wrapMode="none">
              {fitText(`↪ subagent · ${tail}`, Math.max(width - 6, 16))}
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
        composerSendState === 'sending' && composerLiveText && !composerError ? (
          isChatLikeView || liveAssistantTextCardVisible ? null : (
            <LivePreviewCard
              title={`● ASSISTANT · ${String(composerProvider ?? 'agent').toUpperCase()} · STREAMING`}
              lines={liveAssistantPreviewLines}
              accentColor={composerAccentColor}
              bodyColor={theme.text}
              theme={theme}
            />
          )
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

      {!composerWindowOpen && !composerHidden ? renderComposerMentionPanel(width, Math.max(width - 4, 20)) : null}

      {!composerWindowOpen && !composerHidden && !composerHistoryOpen && !composerStashOpen ? renderComposerSlashPanel(width, Math.max(width - 4, 20)) : null}

      {!composerWindowOpen && !composerHidden ? renderComposerHistoryPanel(width, Math.max(width - 4, 20)) : null}
      {!composerWindowOpen && !composerHidden ? renderComposerStashPanel(width, Math.max(width - 4, 20)) : null}
      {!composerWindowOpen && !composerHidden && !composerHistoryOpen && !composerStashOpen ? renderComposerQueuePanel(width, Math.max(width - 4, 20)) : null}

      {!composerWindowOpen && !composerHidden && transcriptView !== 'chat' ? (
        <box
          paddingX={1}
          backgroundColor={isChatLikeView ? theme.surface : theme.surface2}
          border
          borderStyle={composerDockRouted ? 'heavy' : isChatLikeView ? 'single' : 'rounded'}
          borderColor={composerDockEmphasized
            ? composerAccentColor
            : isChatLikeView
              ? theme.border2
              : theme.border}
          title={isChatLikeView ? undefined : composerDockBorderTitle}
          titleColor={composerDockEmphasized ? composerAccentColor : theme.dim}
          titleAlignment="left"
          height={composerDockHeight}
          flexDirection="column"
          onMouseDown={(event) => {
            if (event.button !== 0) return
            if (!composerActive) setComposerActive(true)
            composerTextareaRef.current?.focus()
          }}
        >
          {renderComposerTextarea(submitComposerFromDock, {
            height: composerDockTextareaHeight,
            width: composerDockTextareaWidth,
          })}
          <box height={1} flexDirection="row" alignItems="center" backgroundColor={theme.surface3}>
            <box width={composerDockFooterStatsWidth} overflow="hidden">
              <text fg={composerSlashHint ? composerAccentColor : theme.dim} wrapMode="none">
                {composerSlashHint
                  ? fitText(composerSlashHint, composerDockFooterStatsWidth)
                  : renderInlineTextSegments(composerDockStatsSegments, composerDockFooterStatsWidth, theme.dim)}
              </text>
            </box>
            <box flexGrow={1} />
            <box width={composerDockFooterHintWidth} overflow="hidden">
              <text fg={composerActive && composerSendState !== 'sending' ? composerAccentColor : theme.dim} wrapMode="none">
                {composerDockSendingHintSegments
                  ? renderInlineTextSegments(composerDockSendingHintSegments, composerDockFooterHintWidth, theme.dim)
                  : fitText(composerDockFooterHint, composerDockFooterHintWidth)}
              </text>
            </box>
          </box>
        </box>
      ) : null}

      {!searchMode ? (
        <box backgroundColor={theme.surface2} paddingX={1}>
          <text wrapMode="none">{renderInlineTextSegments(footerSegments, Math.max(width - 2, 20), theme.dim)}</text>
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

      {pullRequestOpen ? (
        <box position="absolute" top={0} left={0} width={width} height={height} backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)} zIndex={49} />
      ) : null}

      {pullRequestOpen ? (
        <PullRequestPopover
          cwd={gitRepoCwd}
          theme={theme}
          width={width}
          height={height}
          onClose={() => setPullRequestOpen(false)}
          onKeyHandlerReady={(handler) => { pullRequestKeyHandlerRef.current = handler }}
          onAskAgent={(prompt) => {
            insertComposerTextAtCursor(prompt)
            setComposerActive(true)
            showNotice('info', 'PR question added to composer')
          }}
          onSendDiffNoteToComposer={(prompt) => {
            appendDiffCommentPromptToComposer(prompt)
            showNotice('info', 'PR diff comment added to composer')
          }}
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

      {editorOpen ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.5)}
          zIndex={49}
        />
      ) : null}

      {editorOpen ? (
        <EditorPopover
          cwd={gitRepoCwd}
          initialPath={editorInitialPath}
          theme={theme}
          width={width}
          height={height}
          syntaxStyle={handoffBriefSyntaxStyle}
          onClose={() => {
            setEditorOpen(false)
            setEditorInitialPath(null)
          }}
          onKeyHandlerReady={(handler) => { editorKeyHandlerRef.current = handler }}
          onNotice={(kind, text) => showNotice(kind, text)}
        />
      ) : null}

      {fileViewerOpen ? (
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

      {fileViewerOpen ? (
        <FileViewerPopover
          cwd={folderPickerForNewSession ? (newSessionCwd || gitRepoCwd) : gitRepoCwd}
          theme={theme}
          width={width}
          height={height}
          syntaxStyle={handoffBriefSyntaxStyle}
          velocityScrollEnabled={velocityScrollEnabled}
          onClose={() => {
            setFileViewerOpen(false)
            setFolderPickerForNewSession(false)
          }}
          onKeyHandlerReady={(handler) => { fileViewerKeyHandlerRef.current = handler }}
          readRemoteFile={selectedSession?.provider === 'claude' && !selectedSession.isPending
            ? async (path) => {
                const result = await runTuiSessionAction(selectedSession, { action: 'readFile', path, maxBytes: 512 * 1024, encoding: 'utf-8' })
                const file = result.file && typeof result.file === 'object' ? result.file as Record<string, unknown> : null
                return file && typeof file.contents === 'string'
                  ? { contents: file.contents, truncated: file.truncated === true }
                  : null
              }
            : undefined}
          onToggleVelocityScroll={() => {
            setVelocityScrollEnabled((current) => {
              const next = !current
              showToggleOutcome('Velocity scroll', next)
              void writeTuiVelocityScroll(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store velocity scroll'))
              return next
            })
          }}
          onSelectDirectory={folderPickerForNewSession ? handleNewSessionFolderSelected : undefined}
          onEditPath={folderPickerForNewSession ? undefined : (path) => {
            setFileViewerOpen(false)
            setEditorInitialPath(path)
            setEditorOpen(true)
          }}
          onInsertPath={folderPickerForNewSession ? undefined : (path) => {
            insertComposerTextAtCursor(`@${path} `)
            setComposerActive(true)
            showNotice('info', 'File added to composer')
          }}
        />
      ) : null}

      {newSessionModalOpen && !folderPickerForNewSession ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={51}
        />
      ) : null}

      {newSessionModalOpen && !folderPickerForNewSession ? (
        <NewSessionModal
          theme={theme}
          width={width}
          height={height}
          provider={newSessionProvider}
          cwd={newSessionCwd}
          busy={newSessionBusy}
          onCycleProvider={cycleNewSessionProvider}
          onBrowseFolder={openNewSessionFolderPicker}
          onCreate={submitNewSession}
          onClose={() => setNewSessionModalOpen(false)}
          onKeyHandlerReady={(handler) => { newSessionKeyHandlerRef.current = handler }}
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

      {attentionOpen ? (
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

      {attentionOpen ? (
        <AttentionInboxPopover
          items={attentionItems}
          theme={theme}
          width={width}
          height={height}
          respondingId={attentionRespondingId}
          onRespond={(item, response) => { void respondToAttentionItem(item, response) }}
          onOpenSession={openAttentionSession}
          onDismiss={dismissAttentionItem}
          onClose={() => setAttentionOpen(false)}
          onKeyHandlerReady={(handler) => { attentionKeyHandlerRef.current = handler }}
        />
      ) : null}

      {crossSessionMessagingOpen ? (
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

      {crossSessionMessagingOpen ? (
        <CrossSessionMessagingPopover
          currentSession={composerTargetSession ?? selectedSession}
          theme={theme}
          width={width}
          height={height}
          onClose={() => setCrossSessionMessagingOpen(false)}
          onNotice={showNotice}
          onKeyHandlerReady={(handler) => { crossSessionMessagingKeyHandlerRef.current = handler }}
        />
      ) : null}

      {checkpointOpen ? (
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

      {checkpointOpen && gitRepoCwd ? (
        <CheckpointPopover
          cwd={gitRepoCwd}
          theme={theme}
          accentColor={composerAccentColor}
          width={width}
          height={height}
          onClose={() => setCheckpointOpen(false)}
          onNotice={showNotice}
          onKeyHandlerReady={(handler) => { checkpointKeyHandlerRef.current = handler }}
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
              await writeClipboard(text, renderer)
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

      {canUseChannelBridge && selectedSessionTarget && channelBridgeOpen ? (
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

      {canUseChannelBridge && selectedSessionTarget && channelBridgeOpen ? (
        <ChannelBridgePopover
          theme={theme}
          accentColor={composerAccentColor}
          width={width}
          height={height}
          routeComposer={routeComposerToBridge}
          targetSessionId={selectedSessionTarget.sessionId}
          onToggleRoute={toggleComposerBridgeRoute}
          onClose={() => setChannelBridgeOpen(false)}
          onNotice={showNotice}
          onKeyHandlerReady={(handler) => { channelBridgeKeyHandlerRef.current = handler }}
        />
      ) : null}

      {canUseIdeBridge && ideBridgeOpen ? (
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

      {canUseIdeBridge && ideBridgeOpen ? (
        <IdeBridgePopover
          theme={theme}
          accentColor={composerAccentColor}
          width={width}
          height={height}
          routeComposer={routeComposerToIde}
          onToggleRoute={toggleComposerIdeRoute}
          onClose={() => setIdeBridgeOpen(false)}
          onNotice={showNotice}
          onKeyHandlerReady={(handler) => { ideBridgeKeyHandlerRef.current = handler }}
          onSendComment={(text) => insertComposerPromptText(text)}
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
          onStopTask={
            composerTargetSession?.provider === 'claude'
              ? (taskId) => { void stopComposerTask(taskId) }
              : undefined
          }
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
          borderStyle="heavy"
          borderColor={composerAccentColor}
          backgroundColor={theme.surface2}
          zIndex={60}
          flexDirection="column"
          title={composerWindowBorderTitle}
          titleColor={composerAccentColor}
          titleAlignment="left"
          onMouseDown={(event) => {
            if (event.button !== 0) return
            composerTextareaRef.current?.focus()
          }}
        >
          <box
            height={composerWindowHeaderHeight}
            paddingX={1}
            border={['bottom']}
            borderStyle="single"
            borderColor={theme.border}
            backgroundColor={theme.surface2}
            flexDirection="row"
            alignItems="center"
          >
            <text fg={theme.dim} wrapMode="none">
              {renderInlineTextSegments(composerWindowMetaSegments, composerWindowContentWidth, theme.dim)}
            </text>
          </box>

          <box
            height={composerWindowEditorHeight}
            paddingX={1}
            paddingY={1}
            flexDirection="column"
            overflow="hidden"
            backgroundColor={theme.surface}
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
          {!composerHistoryOpen && !composerStashOpen ? renderComposerQueuePanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12)) : null}

          <box
            height={composerWindowFooterHeight}
            paddingX={1}
            border={['top']}
            borderStyle="single"
            borderColor={theme.border}
            backgroundColor={theme.surface2}
            flexDirection="row"
            alignItems="center"
          >
            <box width={composerWindowFooterStatsWidth} overflow="hidden">
              <text fg={composerSlashHint ? composerAccentColor : theme.dim} wrapMode="none">
                {composerSlashHint
                  ? fitText(composerSlashHint, composerWindowFooterStatsWidth)
                  : renderInlineTextSegments(composerWindowDraftSegments, composerWindowFooterStatsWidth, theme.dim)}
              </text>
            </box>
            <box flexGrow={1} />
            <box width={composerWindowFooterHintWidth} overflow="hidden">
              <text fg={theme.dim} wrapMode="none">
                {composerWindowSendingHintSegments
                  ? renderInlineTextSegments(composerWindowSendingHintSegments, composerWindowFooterHintWidth, theme.dim)
                  : fitText(composerWindowFooterHint, composerWindowFooterHintWidth)}
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
            {diagnosticsNotice ? (
              <box paddingX={1}>
                <text fg={theme.green} wrapMode="none">{fitText(diagnosticsNotice, overlayWidth - 4)}</text>
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
                      const serverName = item.split(' · ')[0]?.trim() ?? ''
                      const policy = diagnosticsMcpPermissionModes[`${selectedSession?.sessionId ?? ''}:${serverName}`]
                      return (
                        <box key={idx} flexShrink={0} height={1}>
                          <text
                            fg={selected ? theme.cyan : (status === 'disabled' ? theme.dim : theme.text)}
                            wrapMode="none"
                          >
                            {fitText(`  ${selected ? '▶' : ' '} ${item} · ${policy ? `applied ${policy}` : 'policy —'}`, overlayWidth - 4)}
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
                    ? `${mcpRows.length > 0 ? '↑↓ MCP · r reconnect · t toggle · o policy · d remove · ' : ''}a set MCP JSON · f filter hooks · p/s/g reload · Esc close`
                    : 'Esc close',
                  overlayWidth - 4,
                )}
              </text>
            </box>
          </box>
        )
      })() : null}

      <ToastOverlay toasts={toasts} theme={theme} width={width} height={height} />

      {worktreeModalOpen || worktreeConfirm || coordModalOpen || coordBoardOpen ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={69}
        />
      ) : null}

      {worktreeModalOpen ? (() => {
        const overlayWidth = Math.min(Math.max(width - 6, 40), 64)
        const overlayHeight = 9
        return (
          <box
            position="absolute"
            top={Math.max(1, Math.floor((height - overlayHeight) / 2))}
            left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
            width={overlayWidth}
            height={overlayHeight}
            border
            borderStyle="single"
            borderColor={theme.amber}
            backgroundColor={theme.surface}
            zIndex={70}
            flexDirection="column"
            title=" New worktree task "
            titleColor={theme.amber}
            titleAlignment="left"
          >
            <box paddingX={1} paddingTop={1}>
              <text fg={theme.dim} wrapMode="none">
                {fitText('Name the task — it gets its own branch + checkout.', overlayWidth - 4)}
              </text>
            </box>
            <box paddingX={1} marginTop={1} backgroundColor={theme.surface3}>
              <input
                focused
                value={worktreeDraft}
                maxLength={60}
                onInput={(value: string) => setWorktreeDraft(value)}
                onSubmit={() => { void submitWorktreeTask() }}
              />
            </box>
            <box paddingX={1} marginTop={1}>
              <text fg={worktreeBusy ? theme.amber : theme.dim} wrapMode="none">
                {fitText(worktreeBusy ? 'Creating worktree…' : '⏎ create · Esc cancel', overlayWidth - 4)}
              </text>
            </box>
          </box>
        )
      })() : null}

      {worktreeConfirm && selectedWorktreeTask ? (() => {
        const overlayWidth = Math.min(Math.max(width - 6, 40), 66)
        const overlayHeight = 8
        const isMerge = worktreeConfirm === 'merge'
        const body = isMerge
          ? `Squash-merge ${selectedWorktreeTask.branch} into the main checkout (staged, not committed)?`
          : `Delete the worktree and branch ${selectedWorktreeTask.branch}? Uncommitted work is lost.`
        return (
          <box
            position="absolute"
            top={Math.max(1, Math.floor((height - overlayHeight) / 2))}
            left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
            width={overlayWidth}
            height={overlayHeight}
            border
            borderStyle="single"
            borderColor={isMerge ? theme.green : theme.red}
            backgroundColor={theme.surface}
            zIndex={70}
            flexDirection="column"
          >
            <box paddingX={1} paddingTop={1}>
              <text fg={theme.text}>{isMerge ? 'MERGE WORKTREE TASK?' : 'DISCARD WORKTREE TASK?'}</text>
            </box>
            <box paddingX={1} marginTop={1}>
              <text fg={theme.dim} wrapMode="word" width={overlayWidth - 4}>{body}</text>
            </box>
            <box paddingX={1} marginTop={1}>
              <text fg={isMerge ? theme.green : theme.red} wrapMode="none">
                {fitText('Enter/Y confirm  ·  Esc/N cancel', overlayWidth - 4)}
              </text>
            </box>
          </box>
        )
      })() : null}

      {coordModalOpen ? (() => {
        const overlayWidth = Math.max(20, Math.min(Math.max(width - 2, 20), Math.max(92, Math.min(160, Math.floor(width * 0.96)))))
        const overlayHeight = Math.max(24, Math.min(Math.max(height - 2, 24), 44))
        const contentWidth = Math.max(overlayWidth - 4, 16)
        const compact = overlayHeight < 29
        const headerHeight = 3
        const footerHeight = 2
        const bodyHeight = Math.max(overlayHeight - headerHeight - footerHeight - (coordError ? 1 : 0) - 2, 12)
        const splitLayout = contentWidth >= 96 && bodyHeight >= 23
        const runtimePaneWidth = splitLayout ? Math.max(52, Math.floor(contentWidth * 0.58)) : contentWidth
        const sidePaneWidth = splitLayout ? Math.max(contentWidth - runtimePaneWidth - 1, 34) : contentWidth
        const briefHeight = splitLayout
          ? Math.max(14, Math.floor(bodyHeight * 0.48))
          : Math.max(compact ? 5 : 7, bodyHeight - 12 - (compact ? 4 : 5))
        const lowerHeight = Math.max(bodyHeight - briefHeight, 12)
        const runtimeHeight = splitLayout ? lowerHeight : 17
        const summaryHeight = splitLayout ? lowerHeight : (compact ? 4 : 5)
        const suggestedProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
        const targetProvider = coordProviderOverride ?? suggestedProvider
        const teammateProviders = coordTeammateProviderOverride ?? [targetProvider]
        const baseCwdLabel = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
        const workspaceLabel = basename(baseCwdLabel) || baseCwdLabel
        const selectedPlaybook = coordPlaybookName
          ? coordPlaybooks.find((entry) => entry.name === coordPlaybookName) ?? null
          : null
        const playbookArgsReady = !selectedPlaybook?.expectsArgs || coordPlaybookArgsDraft.trim().length > 0
        const launchReady = Boolean(coordDraft.trim() || selectedPlaybook) && playbookArgsReady
        const playbookArgsHint = selectedPlaybook?.argsHint?.trim()
        const playbookArgsPlaceholder = selectedPlaybook
          ? playbookArgsHint && playbookArgsHint.toLowerCase() !== 'none'
            ? playbookArgsHint
            : selectedPlaybook.expectsArgs ? 'Enter required JSON or text' : 'Add optional JSON or text'
          : 'Select a playbook first'
        const promptLineCount = coordDraft.length === 0 ? 1 : coordDraft.split('\n').length
        const briefPreview = coordDraft.trim().split('\n')[0]
          || (selectedPlaybook ? `Playbook: ${selectedPlaybook.name}` : 'Add a workflow brief to continue')
        const briefTextareaHeight = Math.max(3, briefHeight - (compact ? 7 : 8))
        const focusColor = (focus: CoordModalFocus) => coordModalFocus === focus ? theme.cyan : theme.border
        const focusBackground = (focus: CoordModalFocus) => coordModalFocus === focus ? theme.surface3 : theme.surface2
        return (
          <box
            position="absolute"
            top={Math.max(1, Math.floor((height - overlayHeight) / 2))}
            left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
            width={overlayWidth}
            height={overlayHeight}
            border
            borderStyle="heavy"
            borderColor={theme.cyan}
            backgroundColor={theme.surface2}
            zIndex={70}
            flexDirection="column"
            title="NEW WORKFLOW"
            titleColor={theme.cyan}
            titleAlignment="left"
          >
            <box
              height={headerHeight}
              paddingX={1}
              border={['bottom']}
              borderStyle="single"
              borderColor={theme.border}
              backgroundColor={theme.surface2}
              flexDirection="column"
              justifyContent="center"
            >
              <text fg={theme.text} wrapMode="none">LAUNCH A WORKFLOW</text>
              <text fg={theme.dim} wrapMode="none">{fitText('Define the outcome, configure the team, then review exactly what will launch.', contentWidth)}</text>
            </box>

            <box flexGrow={1} flexDirection="column" overflow="hidden">
            <box
              height={briefHeight}
              paddingX={1}
              flexDirection="column"
              overflow="hidden"
              backgroundColor={theme.surface}
              border={['bottom']}
              borderStyle="single"
              borderColor={theme.border}
            >
              <box height={1} flexDirection="row">
                <text fg={theme.cyan} wrapMode="none">01  WORKFLOW BRIEF</text>
                <box flexGrow={1} />
                <text fg={theme.dim} wrapMode="none">{`${coordDraft.length} chars`}</text>
              </box>
              <textarea
                ref={coordTextareaRef}
                focused={coordModalFocus === 'prompt'}
                width={contentWidth}
                height={briefTextareaHeight}
                placeholder="Describe the outcome, constraints, paths in scope, and acceptance checks."
                initialValue={coordDraft}
                keyBindings={composerKeyBindings}
                onContentChange={handleCoordContentChange}
                onSubmit={() => { void submitCoordinatedRun() }}
                style={composerBaseTextareaStyle}
              />
              <text fg={theme.violet} wrapMode="none">CONTRACT  ·  one line or semicolon separated</text>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('acceptance')}>
                <box width={20} flexShrink={0}><text fg={coordModalFocus === 'acceptance' ? theme.text : theme.dim} wrapMode="none">Acceptance checks</text></box>
                <box flexGrow={1} backgroundColor={coordModalFocus === 'acceptance' ? theme.surface3 : theme.surface2}>
                  <input width="100%" focused={coordModalFocus === 'acceptance'} value={coordAcceptanceDraft} placeholder="checks the team must satisfy" maxLength={300} onInput={(value: string) => setCoordAcceptanceDraft(value)} />
                </box>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('nonGoals')}>
                <box width={20} flexShrink={0}><text fg={coordModalFocus === 'nonGoals' ? theme.text : theme.dim} wrapMode="none">Non-goals</text></box>
                <box flexGrow={1} backgroundColor={coordModalFocus === 'nonGoals' ? theme.surface3 : theme.surface2}>
                  <input width="100%" focused={coordModalFocus === 'nonGoals'} value={coordNonGoalsDraft} placeholder="areas to leave unchanged" maxLength={240} onInput={(value: string) => setCoordNonGoalsDraft(value)} />
                </box>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('manualQa')}>
                <box width={20} flexShrink={0}><text fg={coordModalFocus === 'manualQa' ? theme.text : theme.dim} wrapMode="none">Manual QA</text></box>
                <box flexGrow={1} backgroundColor={coordModalFocus === 'manualQa' ? theme.surface3 : theme.surface2}>
                  <input width="100%" focused={coordModalFocus === 'manualQa'} value={coordManualQaDraft} placeholder="manual checks before completion" maxLength={240} onInput={(value: string) => setCoordManualQaDraft(value)} />
                </box>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('escalation')}>
                <box width={20} flexShrink={0}><text fg={coordModalFocus === 'escalation' ? theme.text : theme.dim} wrapMode="none">Escalation</text></box>
                <box flexGrow={1} backgroundColor={coordModalFocus === 'escalation' ? theme.surface3 : theme.surface2}>
                  <input width="100%" focused={coordModalFocus === 'escalation'} value={coordEscalationDraft} placeholder="security, data loss, API risk" maxLength={240} onInput={(value: string) => setCoordEscalationDraft(value)} />
                </box>
              </box>
            </box>

            <box height={splitLayout ? lowerHeight : undefined} flexGrow={splitLayout ? 0 : 1} flexDirection={splitLayout ? 'row' : 'column'} overflow="hidden">
            <box
              height={runtimeHeight}
              width={splitLayout ? runtimePaneWidth : undefined}
              paddingX={1}
              backgroundColor={theme.surface}
              flexDirection="column"
              overflow="hidden"
              border={splitLayout ? ['right'] : ['bottom']}
              borderStyle="single"
              borderColor={theme.border}
            >
              <text fg={theme.cyan} wrapMode="none">02  RUNTIME AND CONTROLS</text>
              <box flexShrink={0} flexDirection="column">
              <text fg={theme.violet} wrapMode="none">WORKFLOW</text>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('playbook')}>
                <text fg={coordModalFocus === 'playbook' ? theme.text : theme.dim} wrapMode="none">{'Playbook      '}</text>
                <text fg={selectedPlaybook ? theme.violet : theme.dim} wrapMode="none">{`‹ ${selectedPlaybook?.name ?? 'none'} ›`}</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'playbook' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'playbook' ? '←/→ select · Enter/M manage' : selectedPlaybook ? `${selectedPlaybook.phaseCount} phases · ${selectedPlaybook.taskCount} tasks` : `${coordPlaybooks.length} available`}</text>
              </box>
              <box height={2} flexDirection="column" backgroundColor={focusBackground('playbookArgs')}>
                <box height={1} flexDirection="row">
                  <text fg={coordModalFocus === 'playbookArgs' ? theme.text : theme.dim} wrapMode="none">Arguments</text>
                  <text fg={selectedPlaybook?.expectsArgs ? theme.amber : selectedPlaybook ? theme.cyan : theme.dim} wrapMode="none">
                    {selectedPlaybook ? `  ${selectedPlaybook.expectsArgs ? 'required' : 'optional'}` : ''}
                  </text>
                  <box flexGrow={1} />
                  <text fg={coordModalFocus === 'playbookArgs' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'playbookArgs' && selectedPlaybook ? 'type JSON or plain text · Enter next' : ''}</text>
                </box>
                <box height={1} flexDirection="row">
                  <text fg={coordModalFocus === 'playbookArgs' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'playbookArgs' ? '› ' : '  '}</text>
                  <box flexGrow={1} backgroundColor={coordModalFocus === 'playbookArgs' ? theme.surface3 : theme.surface2}>
                  {coordModalFocus === 'playbookArgs'
                    ? <input
                        width="100%"
                        focused
                        value={coordPlaybookArgsDraft}
                        placeholder={playbookArgsPlaceholder}
                        maxLength={500}
                        onInput={(value: string) => setCoordPlaybookArgsDraft(value)}
                        onSubmit={() => setCoordModalFocus('provider')}
                      />
                    : <text fg={coordPlaybookArgsDraft ? theme.text : theme.dim} wrapMode="none">{fitText(coordPlaybookArgsDraft || playbookArgsPlaceholder, Math.max(12, runtimePaneWidth - 4))}</text>}
                  </box>
                </box>
              </box>
              <text fg={theme.violet} wrapMode="none">TEAM</text>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('provider')}>
                <text fg={coordModalFocus === 'provider' ? theme.text : theme.dim} wrapMode="none">{'Lead provider  '}</text>
                <text fg={getProviderAccent(targetProvider)} wrapMode="none">{`‹ ${targetProvider.toUpperCase()} ›`}</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'provider' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'provider' ? '←/→ choose' : 'coordinates the team'}</text>
              </box>
              <box height={2} flexDirection="column" backgroundColor={focusBackground('pool')} overflow="hidden">
                <box height={1} flexDirection="row">
                  <text fg={coordModalFocus === 'pool' ? theme.text : theme.dim} wrapMode="none">Teammate provider pool</text>
                  <box flexGrow={1} />
                  <text fg={coordModalFocus === 'pool' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'pool' ? '←/→ · Space' : 'round-robin'}</text>
                </box>
                <box height={1} flexDirection="row" overflow="hidden">
                  {COORD_RUN_PROVIDERS.map((providerName, index) => {
                    const selected = teammateProviders.includes(providerName)
                    const cursor = coordModalFocus === 'pool' && coordProviderPoolIndex === index
                    return (
                      <text
                        key={providerName}
                        fg={cursor ? theme.surface : selected ? getProviderAccent(providerName) : theme.dim}
                        bg={cursor ? theme.cyan : undefined}
                        wrapMode="none"
                      >
                        {`${cursor ? '›' : ' '}${selected ? '[x]' : '[ ]'}${providerName.toUpperCase()}${cursor ? '‹' : ' '} `}
                      </text>
                    )
                  })}
                </box>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('agents')}>
                <text fg={coordModalFocus === 'agents' ? theme.text : theme.dim} wrapMode="none">{'Agent limit   '}</text>
                <text fg={theme.cyan} wrapMode="none">{`−  ${coordMaxAgents} total  +`}</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'agents' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'agents' ? '←/→ adjust' : 'includes the lead'}</text>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground(coordModalFocus === 'durationBudget' ? 'durationBudget' : 'tokenBudget')}>
                <text fg={coordModalFocus === 'tokenBudget' ? theme.text : theme.dim} wrapMode="none">Tokens </text>
                {coordModalFocus === 'tokenBudget'
                  ? <input width={Math.max(10, Math.floor(runtimePaneWidth * 0.2))} focused value={coordMaxTokens} placeholder="optional" maxLength={12} onInput={(value: string) => setCoordMaxTokens(value.replace(/[^0-9]/g, ''))} />
                  : <text fg={coordMaxTokens ? theme.text : theme.dim} wrapMode="none">{coordMaxTokens || '—'}</text>}
                <text fg={theme.dim} wrapMode="none">  ·  Minutes </text>
                {coordModalFocus === 'durationBudget'
                  ? <input width={Math.max(8, Math.floor(runtimePaneWidth * 0.16))} focused value={coordMaxDurationMinutes} placeholder="optional" maxLength={8} onInput={(value: string) => setCoordMaxDurationMinutes(value.replace(/[^0-9]/g, ''))} />
                  : <text fg={coordMaxDurationMinutes ? theme.text : theme.dim} wrapMode="none">{coordMaxDurationMinutes || '—'}</text>}
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'tokenBudget' || coordModalFocus === 'durationBudget' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'tokenBudget' || coordModalFocus === 'durationBudget' ? 'Enter next' : 'optional'}</text>
              </box>
              <text fg={theme.violet} wrapMode="none">EXECUTION</text>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('worktrees')}>
                <text fg={coordUseWorktrees ? theme.green : theme.amber} wrapMode="none">{coordUseWorktrees ? '[x]' : '[ ]'}</text>
                <text fg={coordModalFocus === 'worktrees' ? theme.text : theme.dim} wrapMode="none">{' Use separate teammate checkouts'}</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'worktrees' ? theme.cyan : theme.dim} wrapMode="none">{coordUseWorktrees ? 'isolated' : 'shared checkout'}</text>
              </box>
              <box height={2} flexDirection="column" backgroundColor={focusBackground('gate')}>
                <box height={1} flexDirection="row">
                  <text fg={coordModalFocus === 'gate' ? theme.text : theme.dim} wrapMode="none">Completion gate</text>
                  <text fg={theme.dim} wrapMode="none">  optional</text>
                  <box flexGrow={1} />
                  <text fg={coordModalFocus === 'gate' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'gate' ? 'shell command · Enter next' : ''}</text>
                </box>
                <box height={1} flexDirection="row">
                  <text fg={coordModalFocus === 'gate' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'gate' ? '› ' : '  '}</text>
                  <box flexGrow={1} backgroundColor={coordModalFocus === 'gate' ? theme.surface3 : theme.surface2}>
                    {coordModalFocus === 'gate'
                      ? <input
                          width="100%"
                          focused
                          value={coordGateDraft}
                          placeholder="Example: npx tsc --noEmit"
                          maxLength={200}
                          onInput={(value: string) => setCoordGateDraft(value)}
                          onSubmit={() => setCoordModalFocus('autonomy')}
                        />
                      : <text fg={coordGateDraft ? theme.text : theme.dim} wrapMode="none">{fitText(coordGateDraft || 'Example: npx tsc --noEmit', Math.max(12, runtimePaneWidth - 4))}</text>}
                  </box>
                </box>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('plans')}>
                <text fg={coordRequirePlanApproval ? theme.amber : theme.dim} wrapMode="none">{coordRequirePlanApproval ? '[x]' : '[ ]'}</text>
                <text fg={coordModalFocus === 'plans' ? theme.text : theme.dim} wrapMode="none">{' Review the lead plan before implementation'}</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'plans' ? theme.cyan : theme.dim} wrapMode="none">{coordRequirePlanApproval ? 'required' : 'automatic'}</text>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('autonomy')}>
                <text fg={coordModalFocus === 'autonomy' ? theme.text : theme.dim} wrapMode="none">Autonomy      </text>
                <text fg={coordAutonomy === 'high' ? theme.amber : theme.cyan} wrapMode="none">{`‹ ${coordAutonomy.toUpperCase()} ›`}</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'autonomy' ? theme.cyan : theme.dim} wrapMode="none">{coordModalFocus === 'autonomy' ? '←/→ choose' : 'decision threshold'}</text>
              </box>
              <box height={1} flexDirection="row" backgroundColor={focusBackground('review')}>
                <text fg={coordRequireReview ? theme.amber : theme.dim} wrapMode="none">{coordRequireReview ? '[x]' : '[ ]'}</text>
                <text fg={coordModalFocus === 'review' ? theme.text : theme.dim} wrapMode="none"> Judgment review before synthesis</text>
                <box flexGrow={1} />
                <text fg={coordModalFocus === 'review' ? theme.cyan : theme.dim} wrapMode="none">{coordRequireReview ? 'required' : 'automatic'}</text>
              </box>
              </box>
            </box>

            <box height={summaryHeight} width={splitLayout ? sidePaneWidth : undefined} flexGrow={splitLayout ? 1 : 0} paddingX={1} backgroundColor={theme.surface} flexDirection="column">
              <text fg={theme.cyan} wrapMode="none">03  LAUNCH SUMMARY</text>
              {splitLayout ? (
                <>
                  {lowerHeight >= 18 ? <text fg={theme.violet} wrapMode="none">CONTEXT</text> : null}
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Workspace</text><box flexGrow={1} /><text fg={theme.text}>{fitText(workspaceLabel, Math.max(sidePaneWidth - 16, 12))}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Playbook</text><box flexGrow={1} /><text fg={selectedPlaybook ? theme.violet : theme.dim}>{fitText(selectedPlaybook?.name ?? 'Lead plans board', Math.max(sidePaneWidth - 16, 12))}</text></box>
                  {lowerHeight >= 18 ? <text fg={theme.violet} wrapMode="none">TEAM</text> : null}
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Lead</text><box flexGrow={1} /><text fg={getProviderAccent(targetProvider)}>{targetProvider.toUpperCase()}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Teammate pool</text><box flexGrow={1} /><text fg={theme.violet}>{fitText(teammateProviders.map((entry) => entry.toUpperCase()).join(' + '), Math.max(sidePaneWidth - 20, 12))}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Agent limit</text><box flexGrow={1} /><text fg={theme.cyan}>{`${coordMaxAgents} total`}</text></box>
                  {lowerHeight >= 18 ? <text fg={theme.violet} wrapMode="none">EXECUTION</text> : null}
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Checkout mode</text><box flexGrow={1} /><text fg={coordUseWorktrees ? theme.green : theme.amber}>{coordUseWorktrees ? 'Isolated checkouts' : 'Shared checkout'}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Plan review</text><box flexGrow={1} /><text fg={coordRequirePlanApproval ? theme.amber : theme.green}>{coordRequirePlanApproval ? 'Required' : 'Automatic'}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Autonomy</text><box flexGrow={1} /><text fg={coordAutonomy === 'high' ? theme.amber : theme.cyan}>{coordAutonomy.toUpperCase()}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Judgment review</text><box flexGrow={1} /><text fg={coordRequireReview ? theme.amber : theme.green}>{coordRequireReview ? 'Required' : 'Automatic'}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Acceptance checks</text><box flexGrow={1} /><text fg={coordAcceptanceDraft.trim() ? theme.cyan : theme.dim}>{coordAcceptanceDraft.trim() ? `${parseCoordContractLines(coordAcceptanceDraft).length} configured` : 'Not configured'}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Budgets</text><box flexGrow={1} /><text fg={coordMaxTokens || coordMaxDurationMinutes ? theme.amber : theme.dim}>{coordMaxTokens || coordMaxDurationMinutes ? `${coordMaxTokens || '—'} tokens · ${coordMaxDurationMinutes || '—'} min` : 'Unbounded'}</text></box>
                  <box height={1} flexDirection="row"><text fg={theme.dim}>Completion gate</text><box flexGrow={1} /><text fg={coordGateDraft.trim() ? theme.amber : theme.dim}>{fitText(coordGateDraft.trim() || 'Not configured', Math.max(sidePaneWidth - 23, 12))}</text></box>
                  <box height={2} marginTop={1} flexDirection="column"><text fg={theme.dim}>BRIEF PREVIEW</text><text fg={theme.text}>{fitText(briefPreview, sidePaneWidth - 2)}</text></box>
                </>
              ) : (
                <>
                  <text fg={theme.dim} wrapMode="none">
                    {renderInlineTextSegments([
                      { text: `workspace ${workspaceLabel}`, fg: theme.text },
                      { text: '  ·  ', fg: theme.dim },
                      { text: selectedPlaybook?.name ?? 'lead-planned', fg: selectedPlaybook ? theme.violet : theme.dim },
                      { text: '  ·  ', fg: theme.dim },
                      { text: targetProvider.toUpperCase(), fg: getProviderAccent(targetProvider) },
                      { text: '  ·  ', fg: theme.dim },
                      { text: `pool ${teammateProviders.map((entry) => entry.toUpperCase()).join('+')}`, fg: theme.violet },
                      { text: '  ·  ', fg: theme.dim },
                      { text: `${coordMaxAgents} agents`, fg: theme.cyan },
                      { text: '  ·  ', fg: theme.dim },
                      { text: coordUseWorktrees ? 'isolated' : 'shared checkout', fg: coordUseWorktrees ? theme.green : theme.amber },
                      { text: '  ·  ', fg: theme.dim },
                      { text: `${parseCoordContractLines(coordAcceptanceDraft).length} acceptance checks`, fg: coordAcceptanceDraft.trim() ? theme.cyan : theme.dim },
                    ], sidePaneWidth - 2, theme.dim)}
                  </text>
                  {!compact ? <text fg={theme.dim} wrapMode="none">{fitText(`Brief: ${briefPreview}`, sidePaneWidth - 2)}</text> : null}
                </>
              )}
              <box height={1} flexDirection="row" backgroundColor={focusBackground('launch')}>
                <text fg={launchReady ? (coordModalFocus === 'launch' ? theme.surface : theme.green) : theme.dim} bg={launchReady && coordModalFocus === 'launch' ? theme.green : undefined} wrapMode="none">
                  {coordBusy ? ' ◇ LAUNCHING WORKFLOW… ' : ' ▶ LAUNCH WORKFLOW '}
                </text>
                <box flexGrow={1} />
                {!splitLayout ? <text fg={theme.dim} wrapMode="none">{launchReady ? 'lead · task board · live activity' : selectedPlaybook?.expectsArgs && !playbookArgsReady ? 'playbook args required' : 'brief or playbook required'}</text> : null}
              </box>
            </box>
            </box>
            </box>

            {coordError ? (
              <box paddingX={1} height={1} overflow="hidden">
                <text fg={theme.red} wrapMode="none">{fitText(coordError, contentWidth)}</text>
              </box>
            ) : null}

            <box
              height={footerHeight}
              paddingX={1}
              border={['top']}
              borderStyle="single"
              borderColor={theme.border}
              backgroundColor={theme.surface2}
              flexDirection="row"
              alignItems="center"
            >
              <text fg={coordBusy ? theme.amber : theme.dim} wrapMode="none">
                {coordBusy
                  ? 'Starting lead…'
                  : `${promptLineCount} line${promptLineCount === 1 ? '' : 's'} · ${coordDraft.length} chars`}
              </text>
              <box flexGrow={1} />
              <text fg={theme.dim} wrapMode="none">
                {fitText('Tab/Shift+Tab focus · arrows adjust · Enter activate · Ctrl+T agents · Ctrl+P plan · Esc close', Math.max(contentWidth - 24, 20))}
              </text>
            </box>
          </box>
        )
      })() : null}

      {playbookManagerOpen ? (
        <PlaybookManagerPopover
          theme={theme}
          width={width}
          height={height}
          cwd={selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()}
          onClose={() => {
            setPlaybookManagerOpen(false)
            setCoordModalFocus('playbook')
          }}
          onChanged={handleCoordPlaybooksChanged}
          onNotice={showNotice}
          onKeyHandlerReady={(handler) => { playbookManagerKeyHandlerRef.current = handler }}
        />
      ) : null}

      {coordBoardOpen ? (
        <CoordinationPopover
          theme={theme}
          width={width}
          height={height}
          initialRunId={coordBoardRunId}
          onOpenSession={openCoordinationAgentSession}
          onNewRun={() => {
            const baseCwd = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
            setCoordDraft('')
            setCoordError(null)
            setCoordPlaybookName(null)
            setCoordPlaybookArgsDraft('')
            setCoordProviderOverride(null)
            setCoordTeammateProviderOverride(null)
            setCoordProviderPoolIndex(0)
            setCoordModalFocus('prompt')
            setCoordModalOpen(true)
            void loadCoordPlaybooks(baseCwd)
          }}
          onClose={() => setCoordBoardOpen(false)}
          onNotice={showNotice}
          onCopyJoinCommand={copyCoordinationJoinCommand}
          onSendDiffNoteToComposer={(prompt) => {
            appendDiffCommentPromptToComposer(prompt)
            showNotice('info', 'Agent diff comment added to composer')
          }}
          onKeyHandlerReady={(handler) => { coordBoardKeyHandlerRef.current = handler }}
        />
      ) : null}

      <PiActivityPopover theme={theme} width={width} height={height} />

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
