// A transcript view is data. Every view the `v` menu lists used to be a
// bundle of choices decided by `transcriptView === '…'` checks spread across
// the reader, the card and the composer; this record is those choices, one
// field each, and the built-in views are presets of it. A custom view is a
// built-in base plus the fields the user changed (stored as that diff, so a
// preset that improves carries its views along).
//
// No React and no Node imports: lib/tuiState.ts validates stored views with it.
import type { TuiDensity, TuiTranscriptView } from './theme'

export type ViewFlow = 'cards' | 'stream'
export type ViewCursor = 'card' | 'none'
export type ViewComposer = 'docked' | 'inline'
export type ViewCardFilter = 'all' | 'prose' | 'no-system' | 'prompts'
export type ViewToolGrouping = 'none' | 'agents' | 'stream'
export type ViewAgentCards = 'none' | 'operational' | 'all'
export type ViewFoldDefault = 'default' | 'expand-all'
export type ViewTurnBoundaries = 'rules' | 'summary-only' | 'gaps' | 'none'
export type ViewMessageLayout = 'markers' | 'continuous'
export type ViewPromptMarker = '❯' | '›' | '>' | '▸' | '$'
/** `tone` picks the glyph from the reply's first line (● result, × error, ▲ system, • text) and lights the cursor card ❯. */
export type ViewReplyMarker = 'tone' | '•' | '●' | '◦' | '·' | '▹'
export type ViewMarkerColor = 'role' | 'plain' | 'cyan'
export type ViewPromptBand = 'stream' | 'continuous' | 'surface' | 'soft' | 'faint'
export type ViewThinking = 'tone' | 'muted-italic' | 'amber-italic'
export type ViewToolRows = 'default' | 'dim' | 'shell-bold' | 'dollar-shell'
export type ViewTextWidth = 'measure' | 'full'
export type ViewTranscriptWidth = 'readable' | 'centered' | 'full'
export type ViewDiffLayout = 'stack' | 'split'
export type ViewTabStyle = 'chrome' | 'underline' | 'pills' | 'boxed' | 'minimal'
export type ViewTabWidth = 'fill' | 'fit' | 'compact' | 'wide'

export type ViewSpec = {
  // Layout
  flow: ViewFlow
  cursor: ViewCursor
  readerHeader: boolean
  composer: ViewComposer
  idleTicker: boolean
  liveReasoning: boolean
  completedTurnHint: boolean
  appTabs: boolean
  contextSidebar: boolean
  /** A prompt navigation bar above the transcript, tracking the turn on screen (in place of the floating sticky prompt). */
  promptNavigation: boolean
  /** The scrollbar's prompt markers jump to their card when clicked. */
  scrollMarkerJump: boolean
  // Content
  cardFilter: ViewCardFilter
  toolGrouping: ViewToolGrouping
  agentCards: ViewAgentCards
  foldDefault: ViewFoldDefault
  dimAutoFolded: boolean
  turnBoundaries: ViewTurnBoundaries
  turnFooter: boolean
  showThinking: boolean
  showSubagents: boolean
  /** Day separators and time-gap rules. */
  timeMarkers: boolean
  // Style
  messageLayout: ViewMessageLayout
  promptMarker: ViewPromptMarker
  replyMarker: ViewReplyMarker
  markerColor: ViewMarkerColor
  promptBand: ViewPromptBand
  promptRule: boolean
  userBold: boolean
  thinking: ViewThinking
  toolRows: ViewToolRows
  promptTimestamps: boolean
  replyTimestamps: boolean
  diffPreview: boolean
  textWidth: ViewTextWidth
  // Tabs: how the session tab strip draws.
  tabStyle: ViewTabStyle
  tabWidth: ViewTabWidth
  tabClose: 'active' | 'all' | 'never'
  tabNumbers: boolean
  tabIcons: 'status' | 'provider' | 'none'
  tabSeparators: boolean
  tabTitle: 'title' | 'folder' | 'folder-title'
  // Panels: null keeps whatever the app has. Pins hold while the view is
  // shown; "on entering" values are applied when the view is chosen.
  sessionRail: boolean | null
  sidebarView: 'sessions' | 'coordinator' | null
  tabs: boolean | null
  tabOrientation: 'horizontal' | 'vertical' | null
  focusMode: boolean | null
  borders: boolean | null
  fleetStrip: boolean | null
  taskPanel: 'open' | 'closed' | null
  /** 'closed', or a side-panel surface kind (built-in or a plugin's) to open. */
  sidePanel: string | null
  sidePanelPlacement: 'right' | 'bottom' | null
  // Overrides: null keeps the global setting.
  density: TuiDensity | null
  transcriptWidth: ViewTranscriptWidth | null
  showToolCalls: boolean | null
  diffLayout: ViewDiffLayout | null
  lightweight: boolean | null
  stickyHeaders: boolean | null
}

export type ViewSpecKey = keyof ViewSpec

/** What a card needs of a view. Identity is stable per spec (see `viewCardStyle`). */
export type ViewCardStyle = Pick<ViewSpec, 'messageLayout' | 'promptMarker' | 'replyMarker' | 'markerColor' | 'promptBand' | 'promptRule'
  | 'userBold' | 'thinking' | 'toolRows' | 'promptTimestamps' | 'replyTimestamps' | 'diffPreview' | 'textWidth'> & {
  /** Turn rules drawn between messages (false drops `turn` landmarks; `break` gaps stay). */
  turnRules: boolean
}

// ── built-in presets ───────────────────────────────────────────────────────

const CARDS: ViewSpec = {
  flow: 'cards', cursor: 'card', readerHeader: true, composer: 'docked', idleTicker: true, liveReasoning: true,
  completedTurnHint: false, appTabs: false, contextSidebar: false, promptNavigation: false, scrollMarkerJump: false,
  cardFilter: 'all', toolGrouping: 'none', agentCards: 'none', foldDefault: 'default', dimAutoFolded: false,
  turnBoundaries: 'rules', turnFooter: false, showThinking: true, showSubagents: true, timeMarkers: true,
  messageLayout: 'markers', promptMarker: '❯', replyMarker: 'tone', markerColor: 'role', promptBand: 'stream', promptRule: true,
  userBold: true, thinking: 'tone', toolRows: 'default', promptTimestamps: false, replyTimestamps: false, diffPreview: true, textWidth: 'measure',
  tabStyle: 'chrome', tabWidth: 'fill', tabClose: 'active', tabNumbers: false, tabIcons: 'status', tabSeparators: true, tabTitle: 'title',
  sessionRail: null, sidebarView: null, tabs: null, tabOrientation: null, focusMode: null, borders: null,
  fleetStrip: null, taskPanel: null, sidePanel: null, sidePanelPlacement: null,
  density: null, transcriptWidth: null, showToolCalls: null, diffLayout: null, lightweight: null, stickyHeaders: null,
}
const STREAM: ViewSpec = {
  ...CARDS, flow: 'stream', cardFilter: 'no-system', toolGrouping: 'stream', agentCards: 'operational',
  readerHeader: false, idleTicker: false, liveReasoning: false, completedTurnHint: true,
}
const SCROLLBACK: ViewSpec = { ...STREAM, cursor: 'none', turnBoundaries: 'summary-only' }
const SCROLLBACK_CLI: ViewSpec = { ...SCROLLBACK, turnBoundaries: 'gaps', promptRule: false, userBold: false }

export const BUILTIN_VIEW_SPECS: Readonly<Record<TuiTranscriptView, ViewSpec>> = {
  conversation: { ...CARDS, dimAutoFolded: true },
  full: { ...CARDS, foldDefault: 'expand-all' },
  continue: { ...CARDS, cardFilter: 'prose' },
  agents: { ...CARDS, composer: 'inline', idleTicker: false, toolGrouping: 'agents', agentCards: 'all', dimAutoFolded: true },
  chat: { ...STREAM, composer: 'inline', readerHeader: true, idleTicker: false, liveReasoning: true, completedTurnHint: false },
  stream: STREAM,
  transcript: {
    ...STREAM, agentCards: 'none', readerHeader: true, idleTicker: true, liveReasoning: true, completedTurnHint: false,
    turnBoundaries: 'none', turnFooter: true, messageLayout: 'continuous', promptBand: 'continuous', userBold: false,
  },
  scrollback: SCROLLBACK,
  codex: { ...SCROLLBACK_CLI, promptMarker: '›', replyMarker: '•', promptBand: 'surface' },
  'claude-code': { ...SCROLLBACK_CLI, promptMarker: '❯', replyMarker: '•', markerColor: 'plain', promptBand: 'soft', toolRows: 'dim' },
  copilot: {
    ...SCROLLBACK_CLI, promptMarker: '❯', replyMarker: '●', markerColor: 'cyan', promptBand: 'faint', thinking: 'muted-italic',
    toolRows: 'shell-bold', promptTimestamps: true, textWidth: 'full', appTabs: true,
  },
  opencode: {
    ...SCROLLBACK, turnBoundaries: 'gaps', messageLayout: 'continuous', promptBand: 'continuous', userBold: false,
    thinking: 'amber-italic', toolRows: 'dollar-shell', textWidth: 'full', turnFooter: true, contextSidebar: true,
  },
  engineering: { ...STREAM, completedTurnHint: false, promptNavigation: true, scrollMarkerJump: true },
}

/** Built-ins a custom view may start from. ENGINEERING has its own frame and state scope. */
export const VIEW_SPEC_BASES: readonly TuiTranscriptView[] = [
  'conversation', 'full', 'continue', 'agents', 'chat', 'stream', 'transcript', 'scrollback', 'codex', 'claude-code', 'copilot', 'opencode',
]

// ── the field registry the studio renders ──────────────────────────────────

export type ViewSpecSection = 'Layout' | 'Content' | 'Style' | 'Tabs' | 'Panels' | 'Pins'
export const VIEW_SPEC_SECTIONS: readonly ViewSpecSection[] = ['Layout', 'Content', 'Style', 'Tabs', 'Panels', 'Pins']

export type ViewSpecFieldOption = { value: ViewSpec[ViewSpecKey]; label: string }
export type ViewSpecField = {
  key: ViewSpecKey
  section: ViewSpecSection
  label: string
  help: string
  options: readonly ViewSpecFieldOption[]
}

const ON_OFF = [{ value: true, label: 'on' }, { value: false, label: 'off' }] as const
const INHERIT = { value: null, label: 'global' } as const
const KEEP = { value: null, label: 'leave as is' } as const

export const VIEW_SPEC_FIELDS: readonly ViewSpecField[] = [
  // Layout
  { key: 'flow', section: 'Layout', label: 'Message flow', help: 'Boxed cards, or one borderless chronological stream.',
    options: [{ value: 'cards', label: 'cards' }, { value: 'stream', label: 'stream' }] },
  { key: 'cursor', section: 'Layout', label: 'Cursor', help: 'A card cursor, or none: j/k scroll by line and e expands everything.',
    options: [{ value: 'card', label: 'card' }, { value: 'none', label: 'none (scroll)' }] },
  { key: 'readerHeader', section: 'Layout', label: 'Reader header', help: 'The view label, title and context row above the transcript.', options: ON_OFF },
  { key: 'composer', section: 'Layout', label: 'Composer', help: 'Docked under the windows, or inline at the end of the transcript.',
    options: [{ value: 'docked', label: 'docked' }, { value: 'inline', label: 'inline' }] },
  { key: 'idleTicker', section: 'Layout', label: 'Idle ticker', help: 'The "on standby" line under an idle transcript.', options: ON_OFF },
  { key: 'liveReasoning', section: 'Layout', label: 'Live reasoning', help: 'A preview of the model\'s reasoning above the composer while it thinks.', options: ON_OFF },
  { key: 'completedTurnHint', section: 'Layout', label: 'Turn-done hint', help: 'A summary line once a turn has finished.', options: ON_OFF },
  { key: 'promptNavigation', section: 'Layout', label: 'Prompt navigation', help: 'A bar above the transcript naming the turn on screen, with the prompts before and after it (in place of the sticky prompt).', options: ON_OFF },
  { key: 'scrollMarkerJump', section: 'Layout', label: 'Clickable markers', help: 'Click a prompt marker on the scrollbar to jump to it.', options: ON_OFF },
  { key: 'appTabs', section: 'Layout', label: 'App tabs', help: 'A Current / Sessions tab row above the transcript.', options: ON_OFF },
  { key: 'contextSidebar', section: 'Layout', label: 'Context sidebar', help: 'Reserve a column for session context beside a single window.', options: ON_OFF },
  // Content
  { key: 'cardFilter', section: 'Content', label: 'Show', help: 'Every card, prose only, or everything but system rows.',
    options: [{ value: 'all', label: 'everything' }, { value: 'no-system', label: 'no system rows' }, { value: 'prose', label: 'prose only' }, { value: 'prompts', label: 'my prompts only' }] },
  { key: 'toolGrouping', section: 'Content', label: 'Tool grouping', help: 'Merge runs of tool calls into one row.',
    options: [{ value: 'none', label: 'none' }, { value: 'stream', label: 'activity' }, { value: 'agents', label: 'agent groups' }] },
  { key: 'agentCards', section: 'Content', label: 'Agent cards', help: 'Draw tool activity (or every card) in the agent card language.',
    options: [{ value: 'none', label: 'none' }, { value: 'operational', label: 'tools only' }, { value: 'all', label: 'every card' }] },
  { key: 'foldDefault', section: 'Content', label: 'Folding', help: 'Tools and diffs start folded, or every card starts expanded.',
    options: [{ value: 'default', label: 'tools folded' }, { value: 'expand-all', label: 'expand all' }] },
  { key: 'dimAutoFolded', section: 'Content', label: 'Dim folded tools', help: 'Folded technical cards drawn in the quiet style.', options: ON_OFF },
  { key: 'turnBoundaries', section: 'Content', label: 'Turn boundaries', help: 'What separates one turn from the next.',
    options: [{ value: 'rules', label: 'rules' }, { value: 'summary-only', label: 'summary rules' }, { value: 'gaps', label: 'blank gaps' }, { value: 'none', label: 'none' }] },
  { key: 'showThinking', section: 'Content', label: 'Thinking', help: 'Show or hide the model\'s reasoning blocks.', options: [{ value: true, label: 'shown' }, { value: false, label: 'hidden' }] },
  { key: 'showSubagents', section: 'Content', label: 'Subagent messages', help: 'Show or hide what spawned subagents said.', options: [{ value: true, label: 'shown' }, { value: false, label: 'hidden' }] },
  { key: 'timeMarkers', section: 'Content', label: 'Dates and gaps', help: 'Day separators and "2h later" rules between messages.', options: ON_OFF },
  { key: 'turnFooter', section: 'Content', label: 'Turn footer', help: 'Who answered and how long it took, under a turn\'s last reply.', options: ON_OFF },
  // Style
  { key: 'messageLayout', section: 'Style', label: 'Message layout', help: 'A marker gutter per message, or continuous prose with one rule per prompt.',
    options: [{ value: 'markers', label: 'markers' }, { value: 'continuous', label: 'continuous' }] },
  { key: 'promptMarker', section: 'Style', label: 'Prompt marker', help: 'The glyph before each of your prompts.',
    options: [{ value: '❯', label: '❯' }, { value: '›', label: '›' }, { value: '>', label: '>' }, { value: '▸', label: '▸' }, { value: '$', label: '$' }] },
  { key: 'replyMarker', section: 'Style', label: 'Reply marker', help: 'The glyph before a reply: by tone (● result, × error, ▲ system, • text; the cursor card ❯), or one fixed glyph.',
    options: [{ value: 'tone', label: 'by tone' }, { value: '•', label: '•' }, { value: '●', label: '●' }, { value: '◦', label: '◦' }, { value: '·', label: '·' }, { value: '▹', label: '▹' }] },
  { key: 'markerColor', section: 'Style', label: 'Marker colour', help: 'Accent prompts, plain prompts, or cyan replies.',
    options: [{ value: 'role', label: 'accent' }, { value: 'plain', label: 'plain' }, { value: 'cyan', label: 'cyan' }] },
  { key: 'promptBand', section: 'Style', label: 'Prompt band', help: 'The background behind your prompts.',
    options: [{ value: 'stream', label: 'tinted' }, { value: 'continuous', label: 'padded panel' }, { value: 'surface', label: 'surface' }, { value: 'soft', label: 'soft' }, { value: 'faint', label: 'faint' }] },
  { key: 'promptRule', section: 'Style', label: 'Prompt rule', help: 'A heavy rule left of prompts, with replies indented to match.', options: ON_OFF },
  { key: 'userBold', section: 'Style', label: 'Bold prompts', help: 'Draw your prompts in bold.', options: ON_OFF },
  { key: 'thinking', section: 'Style', label: 'Thinking', help: 'How reasoning lines are drawn.',
    options: [{ value: 'tone', label: 'tone colour' }, { value: 'muted-italic', label: 'muted italic' }, { value: 'amber-italic', label: 'amber italic' }] },
  { key: 'toolRows', section: 'Style', label: 'Tool rows', help: 'How a folded tool call reads.',
    options: [{ value: 'default', label: 'default' }, { value: 'dim', label: 'muted' }, { value: 'shell-bold', label: 'bold name' }, { value: 'dollar-shell', label: '$ Shell' }] },
  { key: 'promptTimestamps', section: 'Style', label: 'Prompt times', help: 'HH:MM at the end of each prompt.', options: ON_OFF },
  { key: 'replyTimestamps', section: 'Style', label: 'Reply times', help: 'HH:MM at the end of each reply\'s first line.', options: ON_OFF },
  { key: 'diffPreview', section: 'Style', label: 'Diff previews', help: 'A few changed lines under a folded edit, or its heading alone.', options: ON_OFF },
  { key: 'textWidth', section: 'Style', label: 'Prose width', help: 'Keep prose to a readable measure, or use the full width.',
    options: [{ value: 'measure', label: 'measure' }, { value: 'full', label: 'full' }] },
  // Tabs
  { key: 'tabs', section: 'Tabs', label: 'Session tabs', help: 'Pin the session tab strip on or off.',
    options: [INHERIT, { value: true, label: 'on' }, { value: false, label: 'off' }] },
  { key: 'tabOrientation', section: 'Tabs', label: 'Tab layout', help: 'Pin tabs along the top or down the side.',
    options: [INHERIT, { value: 'horizontal', label: 'top' }, { value: 'vertical', label: 'side' }] },
  { key: 'tabStyle', section: 'Tabs', label: 'Tab style', help: 'Chrome raises the active tab into the window; underline marks it on the border; pills fill it; boxed outlines every tab; minimal is text alone.',
    options: [{ value: 'chrome', label: 'chrome' }, { value: 'underline', label: 'underline' }, { value: 'pills', label: 'pills' }, { value: 'boxed', label: 'boxed' }, { value: 'minimal', label: 'minimal' }] },
  { key: 'tabWidth', section: 'Tabs', label: 'Tab width', help: 'Share the strip, fit the longest title, keep tabs narrow, or let them run wide.',
    options: [{ value: 'fill', label: 'fill' }, { value: 'fit', label: 'fit titles' }, { value: 'compact', label: 'compact' }, { value: 'wide', label: 'wide' }] },
  { key: 'tabClose', section: 'Tabs', label: 'Close buttons', help: 'A × on the active tab, on every tab, or on none (middle-click still closes).',
    options: [{ value: 'active', label: 'active tab' }, { value: 'all', label: 'every tab' }, { value: 'never', label: 'never' }] },
  { key: 'tabNumbers', section: 'Tabs', label: 'Numbered tabs', help: 'A position number before each title.', options: ON_OFF },
  { key: 'tabIcons', section: 'Tabs', label: 'Tab icons', help: 'Status glyphs (waiting, finished, team), the provider\'s initial with them, or none.',
    options: [{ value: 'status', label: 'status' }, { value: 'provider', label: 'provider + status' }, { value: 'none', label: 'none' }] },
  { key: 'tabSeparators', section: 'Tabs', label: 'Separators', help: 'A thin rule between inactive tabs.', options: ON_OFF },
  { key: 'tabTitle', section: 'Tabs', label: 'Tab title', help: 'The session title, its folder, or both.',
    options: [{ value: 'title', label: 'title' }, { value: 'folder', label: 'folder' }, { value: 'folder-title', label: 'folder · title' }] },
  // Panels
  { key: 'sessionRail', section: 'Panels', label: 'Session rail', help: 'Pin the sessions rail shown or hidden while this view is on.',
    options: [INHERIT, { value: true, label: 'shown' }, { value: false, label: 'hidden' }] },
  { key: 'sidebarView', section: 'Panels', label: 'Rail opens on', help: 'Switch the rail to Sessions or Coordinator when entering the view.',
    options: [KEEP, { value: 'sessions', label: 'sessions' }, { value: 'coordinator', label: 'coordinator' }] },
  { key: 'focusMode', section: 'Panels', label: 'Focus mode', help: 'Pin focus mode: rail and header chrome hidden.',
    options: [INHERIT, { value: true, label: 'on' }, { value: false, label: 'off' }] },
  { key: 'borders', section: 'Panels', label: 'Borders', help: 'Pin window borders drawn or hidden.',
    options: [INHERIT, { value: true, label: 'drawn' }, { value: false, label: 'hidden' }] },
  { key: 'fleetStrip', section: 'Panels', label: 'Fleet strip', help: 'Pin the running-sessions strip above the transcript.',
    options: [INHERIT, { value: true, label: 'shown' }, { value: false, label: 'hidden' }] },
  { key: 'taskPanel', section: 'Panels', label: 'Task panel', help: 'Open or close the task panel when entering the view.',
    options: [KEEP, { value: 'open', label: 'open' }, { value: 'closed', label: 'closed' }] },
  { key: 'sidePanel', section: 'Panels', label: 'Side panel', help: 'Open the side panel on a surface (plugins included), or close it, when entering the view.',
    options: [KEEP, { value: 'closed', label: 'closed' }] },
  { key: 'sidePanelPlacement', section: 'Panels', label: 'Side panel at', help: 'Pin the side panel beside the reader or under it.',
    options: [INHERIT, { value: 'right', label: 'beside' }, { value: 'bottom', label: 'under' }] },
  // Overrides
  { key: 'density', section: 'Pins', label: 'Density', help: 'Pin a density for this view; global follows d.',
    options: [INHERIT, { value: 'comfortable', label: 'comfortable' }, { value: 'balanced', label: 'balanced' }, { value: 'dense', label: 'dense' }] },
  { key: 'transcriptWidth', section: 'Pins', label: 'Transcript width', help: 'Pin readable, centred or full width for this view.',
    options: [INHERIT, { value: 'readable', label: 'readable' }, { value: 'centered', label: 'centred' }, { value: 'full', label: 'full' }] },
  { key: 'showToolCalls', section: 'Pins', label: 'Tool calls', help: 'Pin tool calls shown or hidden (global follows X).',
    options: [INHERIT, { value: true, label: 'shown' }, { value: false, label: 'hidden' }] },
  { key: 'diffLayout', section: 'Pins', label: 'Diff layout', help: 'Pin stacked or side-by-side diffs.',
    options: [INHERIT, { value: 'stack', label: 'stacked' }, { value: 'split', label: 'split' }] },
  { key: 'lightweight', section: 'Pins', label: 'Lightweight', help: 'Pin lightweight windows: folded cards, last page mounted.',
    options: [INHERIT, { value: true, label: 'on' }, { value: false, label: 'off' }] },
  { key: 'stickyHeaders', section: 'Pins', label: 'Sticky prompt', help: 'Pin the prompt header that stays under the top edge.',
    options: [INHERIT, { value: true, label: 'on' }, { value: false, label: 'off' }] },
]

// The side panel's surfaces come from the plugin catalog, which this module
// must not import (lib/tuiState.ts reads it); the host registers them.
let sidePanelSurfaces: readonly ViewSpecFieldOption[] = []
/** Called once by the TUI with every side-panel surface it can open (built-ins and plugins). */
export function registerViewSidePanelSurfaces(surfaces: readonly { kind: string; label: string }[]): void {
  sidePanelSurfaces = surfaces.map((surface) => ({ value: surface.kind, label: surface.label.toLowerCase() }))
  const field = VIEW_SPEC_FIELDS.find((candidate) => candidate.key === 'sidePanel')!
  ;(field as { options: readonly ViewSpecFieldOption[] }).options = [KEEP, { value: 'closed', label: 'closed' }, ...sidePanelSurfaces]
}

const FIELD_BY_KEY = new Map(VIEW_SPEC_FIELDS.map((field) => [field.key, field]))
export function viewSpecField(key: ViewSpecKey): ViewSpecField | undefined { return FIELD_BY_KEY.get(key) }

/** The next (or previous) value of a field, wrapping. */
export function cycleViewSpecValue(spec: ViewSpec, key: ViewSpecKey, step: 1 | -1 = 1): ViewSpec[ViewSpecKey] {
  const options = FIELD_BY_KEY.get(key)?.options ?? []
  const index = options.findIndex((option) => option.value === spec[key])
  const next = options[(index + step + options.length) % options.length]
  return next ? next.value : spec[key]
}

export function viewSpecValueLabel(spec: ViewSpec, key: ViewSpecKey): string {
  return FIELD_BY_KEY.get(key)?.options.find((option) => option.value === spec[key])?.label ?? String(spec[key])
}

// ── custom views ───────────────────────────────────────────────────────────

export type CustomViewOverrides = Partial<ViewSpec>
export type CustomView = {
  id: string
  name: string
  base: TuiTranscriptView
  overrides: CustomViewOverrides
  /** A studio draft editing the built-in `base` itself rather than a view of its own. */
  builtin?: true
}

/**
 * Edits to the built-in views, by view: the same diff form as a custom view.
 * An empty entry is the built-in as it ships; resetting deletes the entry.
 */
export type BuiltinViewOverrides = Partial<Record<TuiTranscriptView, CustomViewOverrides>>

export function normalizeBuiltinViewOverrides(raw: unknown): BuiltinViewOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: BuiltinViewOverrides = {}
  for (const [view, overrides] of Object.entries(raw as Record<string, unknown>)) {
    if (!VIEW_SPEC_BASES.includes(view as TuiTranscriptView)) continue
    const normalized = normalizeViewSpecOverrides(overrides)
    if (Object.keys(normalized).length) result[view as TuiTranscriptView] = normalized
  }
  return result
}

/** The id a studio draft of a built-in carries; never stored as a custom view. */
export function builtinDraftId(view: TuiTranscriptView): string { return `builtin-${view}` }

export const CUSTOM_VIEW_NAME_MAX = 24

const LEGACY_MARKERS: Record<string, Pick<ViewSpec, 'promptMarker' | 'replyMarker'>> = {
  tone: { promptMarker: '❯', replyMarker: 'tone' }, codex: { promptMarker: '›', replyMarker: '•' },
  claude: { promptMarker: '❯', replyMarker: '•' }, copilot: { promptMarker: '❯', replyMarker: '●' },
}

/** Keeps only fields and values the registry knows; anything else in tui.json is dropped. */
export function normalizeViewSpecOverrides(raw: unknown): CustomViewOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    // Views saved before markers split into a prompt and a reply glyph.
    if (key === 'markers' && typeof value === 'string' && value in LEGACY_MARKERS) { Object.assign(result, LEGACY_MARKERS[value]); continue }
    const field = FIELD_BY_KEY.get(key as ViewSpecKey)
    // A side-panel surface may belong to a plugin not loaded in this process; it is checked when applied.
    if (key === 'sidePanel' && typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value)) result[key] = value
    else if (field && field.options.some((option) => option.value === value)) result[key] = value
  }
  return result as CustomViewOverrides
}

export function normalizeCustomViews(raw: unknown): CustomView[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const views: CustomView[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { id, name, base, overrides } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id) || seen.has(id)) continue
    if (!VIEW_SPEC_BASES.includes(base as TuiTranscriptView)) continue
    const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, CUSTOM_VIEW_NAME_MAX) : 'Custom view'
    seen.add(id)
    views.push({ id, name: label, base: base as TuiTranscriptView, overrides: normalizeViewSpecOverrides(overrides) })
  }
  return views
}

/** The fields of `spec` that differ from its base: what a custom view stores. */
export function viewSpecDiff(base: TuiTranscriptView, spec: ViewSpec): CustomViewOverrides {
  const preset = BUILTIN_VIEW_SPECS[base]
  const diff: Record<string, unknown> = {}
  for (const field of VIEW_SPEC_FIELDS) if (spec[field.key] !== preset[field.key]) diff[field.key] = spec[field.key]
  return diff as CustomViewOverrides
}

const customSpecCache = new WeakMap<CustomView, ViewSpec>()
export function customViewSpec(view: CustomView): ViewSpec {
  let spec = customSpecCache.get(view)
  if (!spec) {
    spec = { ...BUILTIN_VIEW_SPECS[view.base], ...view.overrides }
    customSpecCache.set(view, spec)
  }
  return spec
}

const editedBuiltinCache = new WeakMap<CustomViewOverrides, ViewSpec>()
/** A built-in as the user left it: the preset plus their edits. */
export function builtinViewSpec(view: TuiTranscriptView, edits: BuiltinViewOverrides | null | undefined): ViewSpec {
  const overrides = edits?.[view]
  if (!overrides) return BUILTIN_VIEW_SPECS[view]
  let spec = editedBuiltinCache.get(overrides)
  if (!spec) {
    spec = { ...BUILTIN_VIEW_SPECS[view], ...overrides }
    editedBuiltinCache.set(overrides, spec)
  }
  return spec
}

/**
 * The spec on screen. A custom view starts from the built-in as it ships, not
 * as edited, so editing STREAM does not move views built on STREAM.
 */
export function resolveViewSpec(view: TuiTranscriptView, custom: CustomView | null, edits?: BuiltinViewOverrides | null): ViewSpec {
  return custom ? customViewSpec(custom) : builtinViewSpec(view, edits)
}

export function newCustomViewId(existing: readonly CustomView[]): string {
  const taken = new Set(existing.map((view) => view.id))
  for (let n = 1; ; n += 1) if (!taken.has(`view-${n}`)) return `view-${n}`
}

// ── derived ────────────────────────────────────────────────────────────────

const cardStyleCache = new WeakMap<ViewSpec, ViewCardStyle>()
/** The card's slice of a spec, one object per spec so memoized cards keep their props. */
export function viewCardStyle(spec: ViewSpec): ViewCardStyle {
  let style = cardStyleCache.get(spec)
  if (!style) {
    style = {
      messageLayout: spec.messageLayout, promptMarker: spec.promptMarker, replyMarker: spec.replyMarker, markerColor: spec.markerColor, promptBand: spec.promptBand,
      promptRule: spec.promptRule, userBold: spec.userBold, thinking: spec.thinking, toolRows: spec.toolRows,
      promptTimestamps: spec.promptTimestamps, replyTimestamps: spec.replyTimestamps, diffPreview: spec.diffPreview, textWidth: spec.textWidth,
      turnRules: spec.turnBoundaries === 'rules' || spec.turnBoundaries === 'summary-only',
    }
    cardStyleCache.set(spec, style)
  }
  return style
}

/** Turn landmarks: a rule only where it carries a summary, else a blank `break`. */
export function viewQuietTurns(spec: ViewSpec): boolean {
  return spec.turnBoundaries === 'summary-only' || spec.turnBoundaries === 'gaps'
}

const nestedStyleCache = new WeakMap<ViewCardStyle, ViewCardStyle>()
/**
 * A tool card drawn inside an agent group: the plain stream style, keeping only
 * whether the view is continuous (the provider looks belong to top-level rows).
 */
export function nestedViewCardStyle(parent: ViewCardStyle): ViewCardStyle {
  let style = nestedStyleCache.get(parent)
  if (!style) {
    const continuous = parent.messageLayout === 'continuous'
    style = {
      ...viewCardStyle(BUILTIN_VIEW_SPECS.stream), messageLayout: parent.messageLayout,
      promptBand: continuous ? 'continuous' : 'stream', userBold: !continuous, turnRules: !continuous,
    }
    nestedStyleCache.set(parent, style)
  }
  return style
}

// ── tabs ───────────────────────────────────────────────────────────────────

export type TabDisplay = Pick<ViewSpec, 'tabStyle' | 'tabWidth' | 'tabClose' | 'tabNumbers' | 'tabIcons' | 'tabSeparators' | 'tabTitle'>
const tabDisplayCache = new WeakMap<ViewSpec, TabDisplay>()
/** The strip's slice of a spec, one object per spec so memos keyed on it hold. */
export function viewTabDisplay(spec: ViewSpec): TabDisplay {
  let display = tabDisplayCache.get(spec)
  if (!display) {
    display = {
      tabStyle: spec.tabStyle, tabWidth: spec.tabWidth, tabClose: spec.tabClose, tabNumbers: spec.tabNumbers,
      tabIcons: spec.tabIcons, tabSeparators: spec.tabSeparators, tabTitle: spec.tabTitle,
    }
    tabDisplayCache.set(spec, display)
  }
  return display
}
export const DEFAULT_TAB_DISPLAY: TabDisplay = viewTabDisplay(BUILTIN_VIEW_SPECS.conversation)
