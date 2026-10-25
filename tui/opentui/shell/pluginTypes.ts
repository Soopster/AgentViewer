import type { ReactNode } from 'react'
import type { SyntaxStyle } from '@opentui/core'
import type { TuiSessionDetail } from '../../../lib/tui/service'
import type { PluginPlacement, PluginTarget } from '../../../lib/plugins/types'
import type { SelectionAskInput } from '../../../lib/selectionAsk'
import type { TuiThemePalette } from '../../theme'

export type TuiPluginKeyEvent = { name: string; ctrl: boolean; shift: boolean; meta?: boolean; option?: boolean; sequence: string; eventType?: 'press' | 'repeat' | 'release'; repeated?: boolean; raw?: string }

/**
 * How a view holds the keyboard as a panel or window. false: it does not.
 * true: its own text input has it; keys go to the view ahead of the global
 * shortcuts (only ⌃W/⌃N/⌃P/⌃T escape). 'input': a focused native <input> has
 * it; keys reach that input, Escape goes to the view, and in a window this
 * is ahead of the ⌃B prefix. 'terminal': a program (a shell) has it; every
 * key and paste goes to the view, ahead of the ⌃B prefix.
 */
export type TuiPluginCapture = boolean | 'input' | 'terminal'

/** Declared service values, resolved by the host for this view's target. */
export type TuiPluginServices = {
  'session-transcript'?: {
    readonly detail: TuiSessionDetail | null
    readonly status: 'loading' | 'ready' | 'error' | 'gone'
  }
  repository?: {
    readonly cwd: string
    /** Scopes turn lists to one session; null means every turn in the repository. */
    readonly sessionId: string | null
    /** What the host calls this repository view, when it is not the reader's. */
    readonly label?: string
  }
  composer?: {
    /** Append a review note to the composer the user is writing in. */
    readonly appendDiffNote: (prompt: string) => void
    /** Hand lines to an agent with what to do with them. */
    readonly askAboutSelection?: (request: SelectionAskInput) => void
    /** Insert text at the composer's cursor and give it the keyboard. */
    readonly insertText?: (text: string) => void
    /** Append a prompt to the composer and hand it the keyboard, saying so with `notice`. */
    readonly appendPrompt?: (prompt: string, notice: string) => void
  }
  clipboard?: {
    readonly write: (text: string) => Promise<void>
    readonly read?: () => Promise<string>
  }
  notices?: {
    readonly show: (kind: 'info' | 'error', text: string, durationMs?: number) => void
  }
  'file-history'?: {
    readonly open: (path: string) => void
  }
  'open-file'?: {
    readonly open: (path: string, line?: number | null) => void
  }
  'directory-picker'?: {
    /** Called with the chosen directory; the host closes the view. */
    readonly choose: (path: string) => void
  }
  'scroll-preferences'?: {
    readonly velocity: boolean
    readonly toggleVelocity: () => void
  }
  'browser-location'?: {
    /** URLs opened from any browser view, newest first. */
    readonly recent: readonly string[]
    readonly opened: (url: string) => void
  }
  'window-selection'?: {
    /** What this window showed before it last remounted (a move to another layout row). */
    readonly initial: string | null
    readonly changed: (id: string | null) => void
  }
}

/** Services a host hands over as values; the transcript and repository it resolves itself. */
export type TuiProvidedPluginServices = Omit<TuiPluginServices, 'session-transcript' | 'repository'>

/** A key handler returns false for a key it did not use, so the host may route it on. */
export type TuiPluginKeyHandler = (key: TuiPluginKeyEvent) => boolean | void

/** Everything a TUI plugin view receives. Never the root's state or setters. */
export type TuiPluginViewProps = {
  readonly pluginId: string
  readonly surfaceId: string
  /** Stable across placements: overlay → window → tab keep one instance. */
  readonly instanceId: string
  readonly placement: PluginPlacement
  readonly target: PluginTarget
  readonly services: TuiPluginServices
  readonly theme: TuiThemePalette
  /** Code highlighting styles, bound to this renderer's scene. */
  readonly syntaxStyle: SyntaxStyle | null
  readonly width: number
  readonly height: number
  readonly focused: boolean
  /** The layer an overlay draws at; its scrim is one below. */
  readonly zIndex: number
  /** Scoped state for this instance; survives placement moves, not closing. */
  readonly useState: <T>(name: string, initial: T) => [T, (next: T | ((previous: T) => T)) => void]
  /** Undo work (timers, subscriptions) when the instance is disposed. */
  readonly onDispose: (cleanup: () => void) => () => void
  readonly registerKeys: (handler: TuiPluginKeyHandler | null) => void
  /**
   * Whether the view's own input has the keyboard (TuiPluginCapture): true
   * routes keys to it ahead of the global shortcuts in a panel or window
   * (only ⌃W/⌃N/⌃P/⌃T escape); 'input' and 'terminal' are a shell pane's.
   */
  readonly setCapture: (capture: TuiPluginCapture) => void
  /** Run another plugin's or the host's command by id; false when nothing claimed it. */
  readonly runCommand: (commandId: string) => boolean
  readonly close: () => void
  /** Present in an overlay that may break out into a window. */
  readonly detach?: () => void
}

export type TuiPluginView = (props: TuiPluginViewProps) => ReactNode
