'use client'
import type { SendAttachment } from '../../lib/types'
import type { TranscriptFilter } from './types'

export const SENT_HISTORY_MAX = 200
const SENT_HISTORY_STORAGE_KEY = 'agent-viewer:composer-sent-history'
export function readLocalStorageValue(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
export function writeLocalStorageValue(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Best-effort preference persistence (privacy mode/quota can reject it).
  }
}
export function readPersistedSentHistory(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = readLocalStorageValue(SENT_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is string => typeof e === 'string').slice(-SENT_HISTORY_MAX)
  } catch {
    return []
  }
}
export function writePersistedSentHistory(entries: string[]): void {
  if (typeof window === 'undefined') return
  try {
    writeLocalStorageValue(SENT_HISTORY_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // best-effort; quota or privacy mode
  }
}
export const TRANSCRIPT_FILTERS: Array<{ key: TranscriptFilter; label: string} > = [
  { key: 'all', label: 'All' },
  { key: 'user', label: 'User' },
  { key: 'assistant', label: 'Agent' },
  { key: 'tools', label: 'Tools' },
  { key: 'errors', label: 'Errors' },
  { key: 'thinking', label: 'Thinking' },
  { key: 'media', label: 'Media' },
  { key: 'system', label: 'System' },
]
export const TRANSCRIPT_FILTER_LABELS = new Map(TRANSCRIPT_FILTERS.map((filter) => [filter.key, filter.label]))
export const ESTIMATED_TIMELINE_ROW_HEIGHT = 220
// Bumped from 1200 → 2400 so more rows are mounted ahead of the visible
// window when the user scrubs the scrollbar quickly. With variable-height
// tool cards, this gives ResizeObserver more time to settle each row before
// it enters view, which keeps the visible layout stable during fast scrolls.
export const TIMELINE_OVERSCAN_PX = 2400
// High-frequency scroll paths only commit scrollTop to React state once the
// drift from the last committed value exceeds this. The virtual window is
// computed from committed state but overscans TIMELINE_OVERSCAN_PX on both
// sides, so a sub-threshold stale window still covers the viewport — this
// turns a fling from one full MessageView render per frame into one per
// ~600px scrolled. Exact positions are re-committed at scroll idle.
export const TIMELINE_SCROLL_COMMIT_PX = 600
// Above this scroll velocity, rows ENTERING the virtual window mount as
// lightweight placeholders instead of full message cards — full cards
// (markdown, syntax highlighting, diffs) can't mount fast enough to keep up
// with a fling or scrollbar drag, which left blank space until the gesture
// ended. Rows already mounted keep their content. Hysteresis: enter fast,
// exit slow; the scroll-idle timer always hydrates as a backstop.
export const FAST_SCROLL_ENTER_PX_PER_S = 3000
export const FAST_SCROLL_EXIT_PX_PER_S = 1200
// Milliseconds of inactivity after the last scroll event before we consider
// the user "done scrolling" and start applying scrollTop anchor adjustments
// again for direct scrollbar/touch scrubbing.
export const SCROLL_IDLE_MS = 140
// Trailing-edge debounce for persisting the composer draft to localStorage.
export const COMPOSER_DRAFT_SAVE_DEBOUNCE_MS = 400
// Wheel and trackpad scrolling benefits from keeping the visible row anchored
// while overscanned rows settle. The window outlives the wheel event long
// enough to cover ResizeObserver delivery and the following animation frame.
export const WHEEL_SCROLL_COMPENSATION_MS = 180
export const TIMELINE_CALIBRATION_MIN_SAMPLES = 3
export const TIMELINE_CALIBRATION_BUCKET_CONFIDENCE = 6
export const TIMELINE_CALIBRATION_MIN_RATIO = 0.22
export const TIMELINE_CALIBRATION_MAX_RATIO = 2
// Safety net: how long the composer will wait for a turn's persisted rows to
// land before force-revealing the polled timeline. The 2s message poll means
// the durable rows are normally present within a poll or two; this only fires
// when a write is lost/delayed so "Syncing transcript…" can never stick forever.
export const AWAITING_PERSISTED_TURN_TIMEOUT_MS = 15000
export const REATTACH_POLL_MS = 2500
// If the Claude send stream goes fully silent for this long — no data AND no
// heartbeat (the server pulses one every 15s) — the socket is presumed dead.
// We stop owning the stream and hand off to the persisted-window SSE + /running
// reattach poll, which keep rendering the still-running turn. Three missed
// heartbeats is a confident "dead, not slow" signal.
export const CLAUDE_STREAM_STALL_MS = 45000
// Unique marker so the read/stall race can tell a stall timeout from a real
// ReadableStream read result.
export const STREAM_STALL_SENTINEL = Symbol('claude-stream-stall')
export const PROGRAMMATIC_SCROLL_SUPPRESSION_MS = 120
export const COMPOSER_GIT_SUMMARY_POLL_MS = 5000
export const ESTIMATED_CHARS_PER_LINE = 92
export const TIMELINE_BOTTOM_GUTTER_PX = 72
export const TIMELINE_TARGET_TOP_GUTTER_PX = 72
export const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']
export const COMPOSER_DRAFT_STORAGE_PREFIX = 'agentViewer:composerDraft:v1:'
export const COMPOSER_QUEUE_LOCAL_INLINE_LIMIT = 256 * 1024
export const SEND_ATTACHMENT_TYPES = new Set<SendAttachment['type']>(['file', 'directory', 'selection', 'image', 'mention', 'skill', 'blob', 'agent', 'extension_context'])
