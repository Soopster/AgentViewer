import { MacOSScrollAccel } from '@opentui/core'
import { sep } from 'node:path'
import { clamp } from './util'
import { type PopoverWindowKind, isPopoverWindowKind, POPOVER_WINDOWS } from '../popoverWindows'
import type { WindowSurfaceKind } from '../windowSurfaceNames'

// Reader-mode virtualization. The messages pane used to mount the FULL
// transcript, so opening a huge session paid an O(cards) Yoga layout once and
// every commit while reading stayed that size. Instead mount a sliding window
// of READER_CARD_WINDOW cards: keyboard navigation recenters the window when
// the cursor nears an edge, and a scroll poll slides it when the user
// wheels/drags near the top or bottom of the mounted content. Sessions at or
// under the window size behave exactly as before (full mount, no sliding).
// Keep the default at 120: scene layout still visits every mounted card,
// even when viewport culling skips painting it. Sliding preserves access to
// the full transcript without paying for 240 cards on every scroll frame.
// Env override is a test hook (lets a harness exercise sliding against a
// modest session) and an escape hatch for very tall terminals.
export const READER_CARD_WINDOW = Math.max(
  40,
  Number.parseInt(process.env.AGENT_VIEWER_READER_WINDOW ?? '', 10) || 120
)
// Cards the window shifts per slide. A slide's cost is the cards it mounts and
// destroys, not the root render: profiled on a sustained wheel scroll, a
// 120-card slide was ~31ms of React work of which the root was ~4ms, the new
// cards' renderables ~60% and freeing the old ones' text buffers ~17%. So a
// slide is kept small enough to fit one frame, and they are frequent instead —
// which is only acceptable because a slide is invisible (see the layout-pass
// fixup below) and starts long before the mounted content runs out.
export const READER_WINDOW_SLIDE = clamp(
  Number.parseInt(process.env.AGENT_VIEWER_READER_SLIDE ?? '', 10) || 8,
  1,
  Math.floor(READER_CARD_WINDOW / 2)
)
// A slide starts when fewer than this many viewport-heights of mounted rows
// remain ahead of the scroll direction. At the old 8 rows a fast wheel reached
// the end of the mounted content and stopped dead until the slide landed.
export const READER_SLIDE_AHEAD_VIEWPORTS = 3
// Cards a different session's first commit mounts before growing; enough to
// fill a tall terminal's viewport with collapsed cards. See TranscriptWindowBody.
export const READER_OPEN_WINDOW = Math.min(48, READER_CARD_WINDOW)
// Cards at the tail expanded in the first commit after leaving the collapsed
// preview: more than a tall viewport shows. See TranscriptWindowBody.
export const READER_EXPAND_FIRST = 16
export const READER_EXPAND_STEP = 40
// A window still growing toward its target mounts one step per this interval,
// so the steps interleave with painted frames instead of stacking up.
export const READER_GROW_INTERVAL_MS = 8
// Keyboard recenter margin: when the cursor gets within this many cards of a
// window edge (and more cards exist beyond it), recenter the window.
export const READER_WINDOW_MARGIN = Math.max(8, Math.floor(READER_CARD_WINDOW / 10))
// OpenTUI's scrollbox emits no scroll events. The window slide reads scrollTop
// from a renderer frame callback (a scroll always paints a frame, and an idle
// app paints none); the SCROLLBACK settle and the sticky header still poll.
// Within READER_EDGE_ROWS of the mounted content's edge a slide starts whatever
// the scroll direction: there is no further scroll to read a direction from.
export const READER_EDGE_ROWS = 8
export const READER_SCROLL_POLL_MS = 120
// A requested slide that never commits (its window turned out unchanged) must
// not block slide detection for good.
export const READER_SLIDE_REQUEST_TTL_MS = 500
// A restored window waits for the next Yoga layout pass on a short timer.
export const READER_FIXUP_RETRY_MS = 16
// A card box sits at most this deep under the scrollbox content: the content
// holds one wrapper box per card (landmarks + the `card:` box itself), and a
// user bubble adds one more level of alignment box.
export const READER_CARD_SEARCH_DEPTH = 3
export const DEFAULT_SIDEBAR_WIDTH = 32
export const SIDEBAR_RESIZE_STEP = 2
export const MIN_SIDEBAR_WIDTH = 28
const MIN_WINDOW_COLUMNS = 46
const MIN_WINDOW_ROWS = 9
// Compatibility names for the original frame's renderer and old presets.
export const MIN_READER_WIDTH = MIN_WINDOW_COLUMNS
export const TASK_PANEL_MIN_WIDTH = 24
export const TASK_PANEL_DEFAULT_WIDTH = 32
const TASK_PANEL_MAX_WIDTH = 60
export const TASK_PANEL_RESIZE_STEP = 4
export const SURFACE_PANEL_MIN_WIDTH = 34
export const SURFACE_PANEL_DEFAULT_WIDTH = 58
export const SURFACE_PANEL_MAX_WIDTH = 120
export const SURFACE_PANEL_RESIZE_STEP = 4
// Docked under the reader, the panel is sized in rows and leaves the reader this many.
export const SURFACE_PANEL_MIN_ROWS = 8
export const SURFACE_PANEL_DEFAULT_ROWS = 14
export const SURFACE_PANEL_READER_MIN_ROWS = 10
export const SURFACE_PANEL_ROW_STEP = 2
// Cached TuiSessionDetail bundles include the full transcript, blocks, and
// derived landmarks, so this cap bounds the resident footprint on long-running
// TUI sessions. 8 covers the settled session and the recents around it —
// paired with the foreground mtime guard it makes revisiting a recent session
// free (no worker re-read, no reformat) and lets the open skip its debounce
// entirely. Matches the spirit of
// THREADING_CACHE_LIMIT (10) in threadingWorkerClient.ts, which already holds
// threaded messages + cards for the same neighbourhood.
export const SESSION_CACHE_LIMIT = 8
// Sessions whose provider-recorded subagents have been read for the sidebar.
export const SUBAGENT_SUMMARY_CACHE_LIMIT = 64
export const WORKTREE_TASK_CWD_SEGMENT = `${sep}.agent-viewer-worktrees${sep}`
export const MESSAGE_SCROLL_ACCEL = new MacOSScrollAccel()
// Velocity scroll tuning — see velocityScrollStep(). A gap longer than the
// reset window between same-direction j/k/↑/↓ events means the key was
// released, so the streak (and thus the speed) starts over from base.
export const VELOCITY_SCROLL_RESET_MS = 160
export const VELOCITY_SCROLL_RAMP_MS = 700
export const VELOCITY_SCROLL_MAX_STEP = 8
export const TERMINAL_SELECTION_COPY_WINDOW_MS = 15000
// Two draft rows plus borders; multiline drafts grow the dock as needed.
export const COMPOSER_MIN_HEIGHT = 4
// The cursor says what Enter will do: a block sends a prompt, an underline runs
// a `!` shell command. Module-level so the textarea is not handed a new object
// (and the terminal a new cursor escape) on every render.
export const COMPOSER_PROMPT_CURSOR = { style: 'block', blinking: true } as const
export const COMPOSER_SHELL_CURSOR = { style: 'underline', blinking: true } as const
export const COMPOSER_MAX_HEIGHT = 12
// The embedded composer keeps one breathing row below the draft. Its height
// budget includes that row plus the top border. The composer has no bottom
// border of its own: the status/hint row is painted onto the reader frame's
// bottom border, so the two never stack.
export const CHAT_COMPOSER_CHROME_HEIGHT = 2
// Top border, one line of draft, and the breathing row.
export const CHAT_COMPOSER_MIN_HEIGHT = 3
// Top border + bottom border. The status/hint row costs no height of its own:
// outside fullscreen it is painted into the bottom border, the way a title is
// painted into the top one.
export const COMPOSER_DOCK_CHROME_HEIGHT = 2
export const COMPOSER_WINDOW_MAX_WIDTH = 88
export const COMPOSER_WINDOW_MAX_HEIGHT = 24
// ── Split transcript panes ───────────────────────────────────────────────────
// Each pane owns its session data, viewport and saved state. All panes render
// their cards through TranscriptWindowBody, including the selected transcript.
export const SPLIT_PANE_MIN_WIDTH = MIN_WINDOW_COLUMNS
// Lightweight windows: cards a window mounts from the tail, and loads per page walking back.
export const SPLIT_PANE_CARD_WINDOW = 80
// Row minimums for the stacked orientation. A pane needs its two border rows,
// a meta row, the reserved action row and a few body rows to say anything at
// all; below that the layout drops the pane rather than render a sliver.
export const SPLIT_PANE_MIN_ROWS = MIN_WINDOW_ROWS
export const SPLIT_TREE_LIMITS = { paneWidth: SPLIT_PANE_MIN_WIDTH, paneRows: SPLIT_PANE_MIN_ROWS, readerWidth: SPLIT_PANE_MIN_WIDTH, readerRows: SPLIT_PANE_MIN_ROWS }
export const ZOOM_TREE_LIMITS = { paneWidth: 0, paneRows: 0, readerWidth: 0, readerRows: 0 }
export const MIN_READER_ROWS = MIN_WINDOW_ROWS
export const SPLIT_PANE_MAX = 2
// Kinds that hold their own state per window, so a second one is useful.
// The pane index a floating window registers its handle and focus under: past
// any laid-out window, so no window index can collide with it.
export const FLOATING_PANE_INDEX = 64
// The window full screen draws (⇧Z). No window is laid out then, and every key
// goes to the focused window's handle, so full screen focuses this one.
export const FULLSCREEN_PANE_INDEX = 65
export const MULTI_INSTANCE_SURFACES: ReadonlySet<WindowSurfaceKind> = new Set(['terminal', 'browser', 'files'])
// Surface kinds that are also full-screen popovers (Git, Files, pull requests).
export const SURFACE_POPOVER_KINDS: ReadonlySet<WindowSurfaceKind> = new Set(['diff', 'files', 'pull-request'])
// A popover window kind whose windows pin a session or path: one per pin.
const isPinnedPopoverKind = (kind: WindowSurfaceKind): kind is PopoverWindowKind => isPopoverWindowKind(kind) && POPOVER_WINDOWS[kind].pin !== null
// Two presses this close in time and place are a double-click; OpenTUI reports presses only.
export const DOUBLE_CLICK_MS = 400
// Main + stack and the grid hold more: up to five panes beside the reader.
export const SPLIT_PANE_ARRANGED_MAX = 5
