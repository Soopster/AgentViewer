import type { ReactNode } from 'react'
import type { TuiSessionDetail } from '../../../lib/tui/service'
import type { PluginPlacement, PluginTarget } from '../../../lib/plugins/types'
import type { SelectionAskInput } from '../../../lib/selectionAsk'
import type { TuiThemePalette } from '../../theme'

export type TuiPluginKeyEvent = { name: string; ctrl: boolean; shift: boolean; meta?: boolean; sequence: string; eventType?: string; repeated?: boolean }

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
  }
  clipboard?: {
    readonly write: (text: string) => Promise<void>
  }
}

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
   * The view's own text input has the keyboard: in a panel or window the host
   * then routes keys to it ahead of the global shortcuts (only ⌃W/⌃N/⌃P/⌃T escape).
   */
  readonly setCapture: (capture: boolean) => void
  /** Run another plugin's or the host's command by id; false when nothing claimed it. */
  readonly runCommand: (commandId: string) => boolean
  readonly close: () => void
  /** Present in an overlay that may break out into a window. */
  readonly detach?: () => void
}

export type TuiPluginView = (props: TuiPluginViewProps) => ReactNode
