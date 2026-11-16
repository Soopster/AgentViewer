// Feature plugin contract. A manifest is metadata only: no UI, SDK, worker or
// backend import may appear in a manifest module, because both roots import
// every manifest at boot to list commands and restore layouts. Executable view
// code is reached only through a renderer's lazy loader list, on activation.
//
// Providers have their own, separate contract (lib/extensions/providers/). A
// feature plugin consumes the core's provider facade through declared services
// and never imports a provider runtime or SDK.

export const PLUGIN_API_VERSION = 1

export type PluginRenderer = 'web' | 'tui'

/**
 * Where a surface may be presented. 'panel' is the side panel (TUI surface
 * panel, Web right panel): a surface offering it is also a side-panel kind,
 * so its stable id automatically joins the hosts' panel registry.
 */
export type PluginPlacement = 'overlay' | 'window' | 'panel'

export type PluginSurfaceSpec = {
  /** Globally unique and stable: it is a window id in saved layouts. */
  readonly id: string
  /** Title with its leading glyph, as window chrome shows it. */
  readonly title: string
  /**
   * What a window keeps showing while the selection moves on: a session, a
   * repository, a file (`PluginTarget.path`; one window per file), or nothing.
   */
  readonly pin: 'session' | 'cwd' | 'path' | null
  /** The surface's state is a singleton, so it exists once in any form. */
  readonly single: boolean
  /**
   * 'window': routed after the global keys. 'capture': every key but ⌃B.
   * 'field': the view's own text field (a browser's address bar) takes typing
   * as a panel or window; Escape and the ⌃B prefix stay the host's.
   */
  readonly keys: 'window' | 'capture' | 'field'
  readonly placements: readonly PluginPlacement[]
  /** Optional launcher order for panel contributions; unranked panels follow. */
  readonly panelOrder?: number
  /** Palette label for opening the surface as a window. */
  readonly windowLabel: string
  /** Short name with its glyph for a tab, window and the side-panel launcher; defaults to `title`. */
  readonly windowTitle?: string
  /** One line on the side-panel launcher card; defaults to the plugin's description. */
  readonly summary?: string
  /** The letter the side-panel launcher honours for this surface while it is shown. */
  readonly shortcut?: string
  /** More than one window of this surface may be open at once (two shells, two localhost ports). */
  readonly multiWindow?: boolean
  /** Services the view needs; activation fails when a host lacks one. */
  readonly services: readonly PluginServiceId[]
  /** Services the view uses when the host has them, and does without otherwise. */
  readonly optionalServices?: readonly PluginServiceId[]
  /** As an overlay it draws from the top row, so the host's navigation bars drop beneath it. */
  readonly fullScreen?: boolean
  /** As an overlay it is modal: the host dims everything painted beneath it. */
  readonly scrim?: boolean
}

/**
 * Where a widget may sit. 'corner': floating over the app's top-right (TUI) or
 * bottom-right (Web) corner, stacked with the others there. 'top-bar': a
 * reserved one-row strip above the TUI workspace, hidden in fullscreen.
 */
export type PluginWidgetSlot = 'corner' | 'top-bar' | 'top-center' | 'viewport'

export type PluginKeyChord = { readonly name: string; readonly ctrl?: boolean; readonly shift?: boolean; readonly meta?: boolean }

type PluginCommandCommon = {
  /** Repeating an overlay command closes its already-open surface. */
  readonly toggle?: boolean
  /** Stable: palettes, saved shortcuts and smokes address it. */
  readonly id: string
  readonly label: string
  readonly category: 'Session' | 'View' | 'Transcript' | 'Coordination'
  /** Explicit command owner for app-wide views with no selected-session target. */
  readonly providers?: readonly import('../types').AgentProvider[]
  readonly scope?: 'application' | 'session' | 'repository'
  /** What the command must have before it can run: a selected session, or a repository to work in. */
  readonly requires: 'session' | 'repository' | null
  readonly renderers: readonly PluginRenderer[]
  /** A local composer slash command, dispatched to this command before any provider send.
   * Names omit `/`; the owning plugin reads arguments from the captured draft.
   */
  readonly composerSlash?: { readonly name: string; readonly description: string; readonly argumentHint?: string }
  /** TUI binding, matched by the host's key router at global precedence. */
  readonly tuiKey?: PluginKeyChord
  /** Display form of the TUI binding. */
  readonly tuiKeyLabel?: string
  /**
   * TUI: a ⌃K chord letter for this command, joined to the host's chord table
   * (dispatcher, status hint, overlay). `short` is the hint's word; `hint:
   * false` lists it only in the overlay. Two contributions of one key fail at
   * load, and the user's keys.json still rebinds it.
   */
  readonly tuiChord?: { readonly key: string; readonly short: string; readonly label?: string; readonly hint?: false }
  /** Navigation shortcuts leave typed characters with an active composer. */
  readonly tuiKeyContext?: 'navigation'
  /** Web: a labelled button in the session toolbar. */
  readonly webToolbarLabel?: string
  /** Web dashboard destination, declared by this plugin's dashboards metadata. */
  readonly webDashboard?: string
  /** Web reader-side contribution to open or toggle. */
  readonly webReader?: string
  readonly webReaderAction?: 'open' | 'toggle'
  readonly webViewMenuLabel?: string
  /** Also offered in a session's context menu when the session has a working directory (a repository-scoped command about that session's folder). Session-scoped commands are always offered there. */
  readonly sessionMenu?: boolean
  /** A composer action button which dispatches this command through the host. */
  readonly webComposerLabel?: string
  readonly webComposerGlyph?: string
  readonly keywords?: readonly string[]
}

export type PluginCommandServiceId = 'notifications' | 'transcript' | 'composer' | 'notices' | 'composer-accessories' | 'bridge-routing' | 'schedules' | 'commands'

export type PluginCommandSpec = PluginCommandCommon & (
  | {
    readonly opens: string
    readonly handler?: never
    /** An overlay (default) or side-panel tab, reusing an open one. */
    readonly placement?: 'overlay' | 'panel'
  }
  | {
    /** A handler in the renderer's lazy command module; no surface is opened. */
    readonly handler: string
    readonly opens?: never
    readonly placement?: never
    readonly scope: 'application' | 'session' | 'repository'
    readonly services: readonly PluginCommandServiceId[]
  }
)

export type PluginScheduleSpec = {
  /** Stable within the plugin; the schedule's id is `<plugin>:<id>`. */
  readonly id: string
  readonly name: string
  readonly trigger: import('../schedules/types').ScheduleTrigger
  readonly action: import('../schedules/types').ScheduleAction
  readonly prompt: string
}

export type PluginManifest = {
  readonly apiVersion: typeof PLUGIN_API_VERSION
  readonly id: string
  readonly title: string
  /** One sentence for the plugin manager. */
  readonly description: string
  /** The plugin manager's heading for this plugin (lib/plugins/managerCategories.ts); unset falls back to the built-in map. */
  readonly group?: string
  readonly renderers: readonly PluginRenderer[]
  readonly surfaces: readonly PluginSurfaceSpec[]
  readonly commands: readonly PluginCommandSpec[]
  /** Optional reader-side surfaces, sized by the host. */
  readonly reader?: readonly { readonly id: string; readonly surface: string; readonly width: number; readonly order?: number }[]
  /** Web dashboard pages and navigation entries, rendered by the generic shell. */
  readonly dashboards?: readonly {
    readonly id: string
    readonly title: string
    readonly glyph: string
    /** A host icon name (the Web's dashboard icon table); the glyph stands in when the host has none. */
    readonly icon?: string
    readonly launcherLabel?: string
    readonly command: string
    readonly surface: string
    readonly order?: number
  }[]
  /** Inline composer UI, loaded separately from surface views and commands. */
  readonly composer?: readonly {
    readonly id: string
    readonly title: string
    /** Omitted accessories keep their existing position above the input. */
    readonly placement?: 'input' | 'footer'
    readonly order?: number
    readonly maxRows: number
    readonly services: readonly 'composer'[]
  }[]
  /**
   * Persistent UI the plugin keeps on screen while enabled (a status chip, a
   * corner badge). Unlike a surface it is not opened by a command: the shell's
   * slot host loads it at boot, so a widget module must stay small.
   */
  readonly widgets?: readonly { readonly id: string; readonly slot: PluginWidgetSlot; readonly order?: number }[]
  /**
   * Terminal transcript views this plugin offers: a built-in `base` plus the
   * fields to change (tui/viewSpec.ts). Shown read-only beside the user's own.
   */
  readonly transcriptViews?: readonly PluginTranscriptViewSpec[]
  /**
   * Transcript blocks recognised in message text by a pattern, drawn as cards on
   * every renderer. Data only, so a mod can ship them (lib/blockRegistry.ts).
   */
  readonly blocks?: readonly PluginBlockSpec[]
  /**
   * Key hints the terminal's status bar adds while the focused pane matches
   * `context`. They are the first thing the bar drops when it is narrow, never
   * ahead of the host's own keys. A hint advertises a key the plugin already
   * handles (a `tuiKey`, a chord, a surface's own keys); it binds nothing.
   */
  readonly hints?: readonly PluginHintSpec[]
  /** Themes this plugin contributes while enabled: bare CSS-variable declarations, never code. */
  readonly themes?: readonly PluginThemeSpec[]
  /** Operations for agents, called through the agent-viewer MCP bridge (lib/plugins/pluginTools.ts). The handlers are the behavior module's `tools`. */
  readonly tools?: readonly import('./pluginTools').PluginToolSpec[]
  /** Headless server contributions, loaded on the shared send path, never by listing views. */
  readonly behavior?: { readonly hooks: readonly ('beforeTurn' | 'afterTurn' | 'beforeSteer' | 'permission' | 'toolCard' | 'transcriptCard' | 'runtimeEvent')[]; readonly order?: number; readonly permissionMode?: 'policy' | 'automation' }
  /**
   * Standing schedules this plugin offers. They are listed in Schedules but never run
   * until the user turns them on: a plugin must not start recurring model spend by itself.
   */
  readonly schedules?: readonly PluginScheduleSpec[]
  /** App-lifetime observers, independent of whether any surface is open. */
  readonly application?: {
    readonly events: readonly 'sessionActivity'[]
    readonly services: readonly ('notifications' | 'activity')[]
  }
  /** Version of the plugin's scoped state; a mismatch restores defaults. */
  readonly stateVersion: number
}

/**
 * A contributed theme, data only. `css` (Web) is the declarations for its CSS
 * variables, which the host scopes to the theme's own selector; `tui` (terminal)
 * is its palette. A theme names the renderers it supports by which it carries.
 */
export type PluginThemeSpec = {
  readonly id: string
  readonly label: string
  readonly category: 'dark' | 'light'
  readonly icon?: string
  /** Web: declarations for the theme's CSS variables. */
  readonly css?: string
  /** Web, bundled plugins only: further rules for this theme (a body backdrop, a restyled message list). A mod's `rules` is ignored. */
  readonly rules?: string
  readonly tui?: PluginTuiTheme
}

/** The 19 colours of a terminal palette (tui/theme.ts TuiThemePalette). */
export type PluginTuiPalette = {
  readonly bg: string; readonly surface: string; readonly surface2: string; readonly surface3: string
  readonly diffAddBg: string; readonly diffRemoveBg: string; readonly diffMetaBg: string
  readonly border: string; readonly border2: string; readonly text: string; readonly muted: string; readonly dim: string
  readonly violet: string; readonly cyan: string; readonly green: string; readonly red: string; readonly amber: string; readonly pink: string
  readonly userBg: string
}

/** A terminal theme: a whole `palette`, or five `swatch`es every other colour is derived from. */
export type PluginTuiTheme = {
  readonly palette?: PluginTuiPalette
  readonly swatch?: { readonly bg: string; readonly text: string; readonly muted: string; readonly accent: string; readonly warm: string }
  /** Menu label; defaults to the theme's label in capitals. */
  readonly label?: string
  readonly description?: string
  /** `omz` lists it under the prompt-theme group instead of light or dark. */
  readonly menu?: 'omz'
}

export type PluginHintSpec = {
  /** `rail`: the session list has focus; `transcript`: the reader does; `composer`: the composer is active. */
  readonly context: 'rail' | 'transcript' | 'composer'
  /** At most 8 characters, shown as the key. */
  readonly key: string
  /** At most 24 characters. */
  readonly label: string
  /** Lower first; default 100. */
  readonly order?: number
}

export type PluginBlockSpec = {
  /** Names the block; the registered kind is `<plugin>.<kind>`. */
  readonly kind: string
  /** A JavaScript regular expression (at most 200 characters) matched against message text. */
  readonly pattern: string
  readonly flags?: string
  /** `{0}` is the whole match and `{1}`… the capture groups. */
  readonly title: string
  readonly lines?: readonly string[]
  readonly tone?: 'info' | 'success' | 'warning' | 'error'
}

export type PluginTranscriptViewSpec = {
  readonly id: string
  readonly name: string
  /** A built-in view id (not `engineering`). */
  readonly base: string
  /** ViewSpec fields to change; unknown fields and values are dropped when loaded. */
  readonly overrides: Readonly<Record<string, unknown>>
}

/**
 * Service capabilities a host may supply to a view. Distinct from the active
 * provider's SessionCapabilities: these describe the host, not the session.
 */
export type PluginServiceId =
  | 'instructions-manager'
  | 'project-memory'
  | 'skills-manager'
  | 'adaptive-ui'
  | 'plan-review'
  | 'proof'
  | 'notifications'
  | 'shell-overview'
  | 'run-launch'
  | 'playbooks'
  /** Read what every agent did over a day or week, with the host's attention inbox filed in. */
  | 'daily-summary'
  /** The repository's highlights, revision by revision. */
  | 'whats-new'
  /** Git state and bookmarks for a session's handoff brief. */
  | 'handoff'
  /** Every saved bookmark, and unsaving one. */
  | 'bookmarks'
  /** Recurring prompts: list, pause, run now, delete. */
  | 'schedules'
  /** A repository's Chief of Staff: read it, start it, hand it a request. */
  | 'chief-of-staff'
  /** Open a session in the reader, optionally at a message. */
  | 'session-navigation'
  /** What a session wrote, and which sessions wrote a file's current lines. */
  | 'provenance'
  /** The daemon's remote-access pairing state and actions. */
  | 'remote-access'
  /** The target session's transcript, read for the target, not the selection. */
  | 'session-transcript'
  /** The target repository: its working directory, and the session scoping its turns. */
  | 'repository'
  /** The composer the user is writing in, resolved by the host. */
  | 'composer'
  | 'clipboard'
  /** Open a file where the host edits files (the editor, in whatever form it is open). */
  | 'open-file'
  /** The host is asking the view to choose a directory for it (the new-session folder). */
  | 'directory-picker'
  /** The user's scrolling preferences, which the host stores. */
  | 'scroll-preferences'
  /** One-line messages in the host's notice area. */
  | 'notices'
  /** Open a file's history across agent turns. */
  | 'file-history'
  /** Turn checkpoints: list, diff, restore, and the working diff's hunks, commit and PR. */
  | 'checkpoints'
  /** A session's recorded edits, and faceted search over the session index. */
  | 'session-insights'
  /** The session tab strip: order, pins, and acting on a tab. */
  | 'session-tabs'
  /** Web: the pull request linked to the selected session, and linking one to it. */
  | 'session-pull-request'
  | 'subagent-transcript'
  /** The session the view was opened for: its identity, not its transcript. */
  | 'session'
  /** The selected session's in-flight turn, before it reaches the transcript. */
  | 'live-transcript'
  /** Jump to a task's card in the reader, and stop a background task. */
  | 'task-control'
  | 'reader-slot'
  /** Read a session's diagnostics and run its runtime controls (MCP, hooks, reloads). */
  | 'session-diagnostics'
  /** A standalone page's location and query navigation. */
  | 'page-location'
  /** Discover and message other provider sessions. */
  | 'messaging'
  /** The live CLI channel bridge: whether the composer routes to it, and the toggle. */
  | 'channel-bridge'
  /** The IDE bridge: whether the composer routes to it, the toggle, and diff comments. */
  | 'ide-bridge'
  /** Where a browser view is pointed, and what it opened, kept by the host with the layout. */
  | 'browser-location'
  /** Which item a window was showing, kept by the host so a remounted window comes back on it. */
  | 'window-selection'
  /** Act on Coordinator runs and their agents in the host: open a transcript, watch a team, start a run. */
  | 'coordination'
  /** Every session and its activity, the selected one's loaded detail, and moving the selection. */
  | 'session-fleet'
  /** The app theme, and choosing another. */
  | 'themes'

/**
 * An immutable reference to what a view is about, resolved once by the host
 * when the view opens. A plugin never constructs a session key itself.
 */
export type PluginTarget = {
  readonly sessionKey: string | null
  /** The repository a `pin: 'cwd'` surface was opened on. */
  readonly cwd: string | null
  /**
   * A file the view was opened on, and its 1-based line. Null line means no
   * particular line, which is not line 1: a file opened with no destination
   * restores its remembered place.
   */
  readonly path?: string | null
  readonly line?: number | null
  /** An agent turn the view opened on, named by the prompt that started it. */
  readonly turn?: { readonly sessionId: string; readonly text: string; readonly timestamp?: string } | null
  /**
   * Counts the host's requests to open this surface. A view that loads once per
   * open (rather than following the selection) treats a change as a new open.
   */
  readonly request?: number
}

/** A renderer's lazy entry: one view component per declared surface. */
export type PluginViewModule<View> = {
  readonly apiVersion: typeof PLUGIN_API_VERSION
  readonly pluginId: string
  readonly views: Readonly<Record<string, View>>
  /** Release module-owned caches and resources. Must be idempotent; runs on disable. */
  readonly deactivate?: () => void
}

/** A renderer's lazy widget entry: one component per declared widget. */
export type PluginWidgetModule<Widget> = {
  readonly apiVersion: typeof PLUGIN_API_VERSION
  readonly pluginId: string
  readonly widgets: Readonly<Record<string, Widget>>
  readonly deactivate?: () => void
}
