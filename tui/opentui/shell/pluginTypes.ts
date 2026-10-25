import type { ReactNode } from 'react'
import type { TuiSessionDetail } from '../../../lib/tui/service'
import type { PluginPlacement, PluginTarget } from '../../../lib/plugins/types'
import type { TuiThemePalette } from '../../theme'

export type TuiPluginKeyEvent = { name: string; ctrl: boolean; shift: boolean; meta?: boolean; sequence: string }

/** Declared service values, resolved by the host for this view's target. */
export type TuiPluginServices = {
  'session-transcript'?: {
    readonly detail: TuiSessionDetail | null
    readonly status: 'loading' | 'ready' | 'error' | 'gone'
  }
}

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
  /** Scoped state for this instance; survives placement moves, not closing. */
  readonly useState: <T>(name: string, initial: T) => [T, (next: T | ((previous: T) => T)) => void]
  /** Undo work (timers, subscriptions) when the instance is disposed. */
  readonly onDispose: (cleanup: () => void) => () => void
  readonly registerKeys: (handler: ((key: TuiPluginKeyEvent) => void) | null) => void
  readonly close: () => void
  /** Present in an overlay that may break out into a window. */
  readonly detach?: () => void
}

export type TuiPluginView = (props: TuiPluginViewProps) => ReactNode
