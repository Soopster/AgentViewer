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
 * so its id must be one of the hosts' `RightPanelSurfaceKind`s.
 */
export type PluginPlacement = 'overlay' | 'window' | 'panel'

export type PluginSurfaceSpec = {
  /** Globally unique and stable: it is a window id in saved layouts. */
  readonly id: string
  /** Title with its leading glyph, as window chrome shows it. */
  readonly title: string
  /** What a window keeps showing while the selection moves on: a session, a repository, or nothing. */
  readonly pin: 'session' | 'cwd' | null
  /** The surface's state is a singleton, so it exists once in any form. */
  readonly single: boolean
  /** 'window': routed after the global keys. 'capture': every key but ⌃B. */
  readonly keys: 'window' | 'capture'
  readonly placements: readonly PluginPlacement[]
  /** Palette label for opening the surface as a window. */
  readonly windowLabel: string
  /** Services the view needs; activation fails when a host lacks one. */
  readonly services: readonly PluginServiceId[]
  /** Services the view uses when the host has them, and does without otherwise. */
  readonly optionalServices?: readonly PluginServiceId[]
  /** As an overlay it draws from the top row, so the host's navigation bars drop beneath it. */
  readonly fullScreen?: boolean
}

export type PluginKeyChord = { readonly name: string; readonly ctrl?: boolean; readonly shift?: boolean; readonly meta?: boolean }

export type PluginCommandSpec = {
  /** Stable: palettes, saved shortcuts and smokes address it. */
  readonly id: string
  readonly label: string
  readonly category: 'Session' | 'View'
  /** Opening this surface as an overlay is the command's action. */
  readonly opens: string
  /** What the command must have before it can run. */
  readonly requires: 'session' | null
  readonly renderers: readonly PluginRenderer[]
  /** TUI binding, matched by the host's key router at global precedence. */
  readonly tuiKey?: PluginKeyChord
  /** Display form of the TUI binding. */
  readonly tuiKeyLabel?: string
  /** Web: a labelled button in the session toolbar. */
  readonly webToolbarLabel?: string
  readonly keywords?: readonly string[]
}

export type PluginManifest = {
  readonly apiVersion: typeof PLUGIN_API_VERSION
  readonly id: string
  readonly title: string
  /** One sentence for the plugin manager. */
  readonly description: string
  readonly renderers: readonly PluginRenderer[]
  readonly surfaces: readonly PluginSurfaceSpec[]
  readonly commands: readonly PluginCommandSpec[]
  /** Version of the plugin's scoped state; a mismatch restores defaults. */
  readonly stateVersion: number
}

/**
 * Service capabilities a host may supply to a view. Distinct from the active
 * provider's SessionCapabilities: these describe the host, not the session.
 */
export type PluginServiceId =
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
}

/** A renderer's lazy entry: one view component per declared surface. */
export type PluginViewModule<View> = {
  readonly apiVersion: typeof PLUGIN_API_VERSION
  readonly pluginId: string
  readonly views: Readonly<Record<string, View>>
}
