export const SEARCH_MAX_CHARS = 80
export const SESSION_REFRESH_MS = 5000
export const DETAIL_REFRESH_MS = 2000
export const RECENT_SESSION_ACTIVITY_MS = 60 * 60000
// How recent a transcript write must be for its row to read as active when no
// turn this host knows about is running in it. Long enough to span the quiet
// stretch of a model thinking between writes, short enough to let go soon
// after the other process stops.
export const RECENT_WRITE_ACTIVE_MS = 2 * 60000
// Cadence for reconciling against the in-process running-turn registry (a
// cheap synchronous read — the TUI and its backend share one process).
export const REATTACH_POLL_MS = 1500
const COORDINATOR_FALLBACK_POLL_MS = 2000
const COORDINATOR_RECONCILE_MS = 30000
const COORDINATOR_PUSH_DEBOUNCE_MS = 25
// Remote attach (agent-viewer --attach <url>): backend calls route through a
// running web daemon; shown in the footer so the mode is always visible.
export const ATTACHED_DAEMON_HOST = (() => {
  const raw = process.env.AGENT_VIEWER_ATTACH?.trim()
  if (!raw) return null
  try {
    return new URL(raw).host
  } catch {
    return raw
  }
})()
// Most recent background turn completions kept in the attention inbox.
export const ATTENTION_DONE_LIMIT = 20
// Debounce before opening a selected session's transcript. Scrubbing quickly
// through the sidebar (mouse or keyboard) lands on many sessions in passing;
// without this every fly-by would load + reformat a full transcript only to be
// discarded a few ms later.
//
// Two delays, because the two cases cost wildly different amounts. A session
// whose detail is already cached and mtime-fresh opens with no read and no
// reformat at all — waiting on it buys nothing and is pure added latency, so
// it opens on the next tick. Everything else pays a worker round-trip, which
// is what the debounce protects; the neighbour warm and the single-flight
// coalescing in refreshSelectedSessionDetail keep that cheap enough that it
// needs far less than the 200ms this used to sit at.
export const DETAIL_OPEN_DELAY_MS = 70
export const DETAIL_OPEN_CACHED_DELAY_MS = 0
// Above this many threaded messages, never format cards synchronously on the
// render thread (the fallback in baseTranscriptCards) — formatTranscriptCard ×
// N is a multi-second freeze on big sessions. The worker formats instead and
// the transcript pops in when it lands (usually within one frame budget).
export const SYNC_FORMAT_CARD_LIMIT = 400
// Stable empty set for browse-mode preview rendering (all cards collapsed).
export const EMPTY_EXPANDED_KEYS: ReadonlySet<string> = new Set<string>()
export const NOOP_SELECT_AGENT_TOOL = (_groupKey: string, _toolKey: string) => { }
// Composer affordances (slash commands / agent options) cache. Refreshing
// these for a Claude session spawns a CLI subprocess, so cache generously —
// command lists change rarely (new files in .claude/commands etc.).
export const COMPOSER_AFFORDANCES_TTL_MS = 5 * 60000
export const COMPOSER_AFFORDANCES_CACHE_MAX = 64
export const COMPOSER_GIT_SUMMARY_POLL_MS = 5000
export const COMPOSER_GIT_SUMMARY_IDLE_POLL_MS = 30000
// Safety net: max time to wait for a completed turn's persisted rows before
// force-revealing the polled transcript, so the "Syncing…" state can't hang
// forever on a lost/delayed write. Generous vs the 2s detail poll.
export const AWAITING_PERSISTED_TURN_TIMEOUT_MS = 12000
// After a settle, warm the threading worker's caches for the sessions adjacent
// to the current one in sidebar order, so the *first* visit to a neighbour is
// served from those caches instead of paying a cold read + thread + format.
// The delay keeps the worker free for the settled session's own load first;
// prefetches run one at a time and yield to any real open. Raising the radius
// means raising the worker's THREADING_CACHE_LIMIT with it — see
// threadingWorker.ts.
export const NEIGHBOR_PREFETCH_DELAY_MS = 450
export const NEIGHBOR_PREFETCH_RADIUS = 2
export const EXIT_CLEANUP_TIMEOUT_MS = 1500
// Metadata refresh is intentionally slow because Claude control queries are
// expensive and can still cause main-thread pressure when they complete.
export const CLAUDE_METADATA_REFRESH_MS = 5 * 60000
export const DEFAULT_METADATA_REFRESH_MS = 60000
export const CLAUDE_BACKGROUND_METADATA_REFRESH_MS = 30 * 60000
export const DEFAULT_BACKGROUND_METADATA_REFRESH_MS = 5 * 60000
export const METADATA_REQUEST_TIMEOUT_MS = 4000
// Fire an OSC 9 / OSC 99 desktop notification when a composer send takes at
// least this long. Tuned high enough that quick replies don't bell the user.
export const NOTIFY_AFTER_MS = 8000
export const NOTIFY_PREVIEW_CHARS = 140
// OpenTUI's OSC escape writers — desktop notifications (OSC 9/99) and clipboard
// (OSC 52) — call straight into the native renderer (opentui.dll) over FFI. On
// Windows that native path is implicated in hard segfaults; critically, a fault
// in native code CANNOT be caught by a surrounding JS try/catch, so the existing
// "silently ignore" guard offers false reassurance — a faulting OSC write would
// take the whole process down. We disable the native OSC calls on Windows, and
// elsewhere gate them on the terminal actually advertising the capability.
export const IS_WINDOWS = typeof process !== 'undefined' && process.platform === 'win32'
export const NATIVE_OSC_ENABLED = !IS_WINDOWS
// toBmpSafe (astral-plane / variation-selector stripping for native OSC writers)
// now lives in ./bmp and is imported above — shared with the toast store.
// If the Claude send stream goes fully silent for this long — no data AND no
// heartbeat (the server pulses one every 15s) — the socket is presumed dead.
// We stop reading and let the persisted-detail poll surface the rest of the
// still-running turn instead of blocking on read() for minutes.
export const CLAUDE_STREAM_STALL_MS = 45000
export const STREAM_STALL_SENTINEL = Symbol('claude-stream-stall')
// Coalesce live streaming-text flushes to roughly one display frame. Uses a timer, NOT
// requestAnimationFrame: OpenTUI's RAF only fires on the renderer's frame loop,
// which goes idle during a pure-text streaming turn (deltas touch a ref and
// schedule a flush with no React commit to drive a frame), freezing the preview
// after the first token. A timer is render-loop-independent and each flush's
// setState drives a repaint.
export const LIVE_TEXT_FLUSH_MS = 16
export const MAX_CODE_BLOCK_RENDER_LINES = 240
export const MAX_MARKDOWN_SYNTAX_CHARS = 80000
