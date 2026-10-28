import type { ReactNode } from 'react'
import type { SyntaxStyle } from '@opentui/core'
import type { TuiSessionDetail } from '../../../lib/tui/service'
import type { PluginPlacement, PluginTarget } from '../../../lib/plugins/types'
import type { SelectionAskInput } from '../../../lib/selectionAsk'
import type { TuiThemeMode, TuiThemePalette } from '../../theme'
import type { TuiTranscriptCard } from '../../format'
import type { AgentProvider, ContextUsage, Session, SessionDiagnosticSection } from '../../../lib/types'
import type { ProtocolAgent, ProtocolRunSnapshot } from '../../../lib/agentProtocol'
import type { ThreadedMessage } from '../../../lib/threading'

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
  'subagent-transcript'?: { readonly label: string; readonly agentId: string; readonly load: (signal: AbortSignal) => Promise<import('../../../tui/format').TuiTranscriptCard[]> }
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
    /** Append a review note to the composer the user is writing in; `notice` replaces the host's confirmation. */
    readonly appendDiffNote: (prompt: string, notice?: string) => void
    /** Hand lines to an agent with what to do with them. */
    readonly askAboutSelection?: (request: SelectionAskInput) => void
    /** Insert text at the composer's cursor and give it the keyboard; `notice` replaces the host's confirmation. */
    readonly insertText?: (text: string, notice?: string) => void
    /** What the user has typed into the composer, read when asked. */
    readonly readDraft?: () => string
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
    /** Opens over the asking view, or as a window beside the layout when `where` says so. */
    readonly open: (path: string, where?: 'overlay' | 'window') => void
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
  /** Resolved by the host for the view's target. */
  session?: {
    readonly session: Session | null
  }
  /** Resolved by the host: empty unless the target is the session whose turn is streaming. */
  'live-transcript'?: {
    readonly messages: readonly ThreadedMessage[]
  }
  'task-control'?: {
    /** Bring a task's most recent card into view in the reader. */
    readonly jumpTo: (eventUuid: string) => void
    /** Read a shell/Monitor tail from a warm Claude Query. */
    readonly readOutput?: (session: Session, taskId: string) => Promise<{ available: boolean; output: string; totalBytes: number; truncated: boolean }>
    /** Stop a running background task in the viewed session. */
    readonly stop?: (session: Session, taskId: string) => void | Promise<void>
  }
  'session-diagnostics'?: {
    readonly read: (session: Session) => Promise<SessionDiagnosticSection[]>
    readonly run: (session: Session, action: string, extra: Record<string, unknown>) => Promise<Record<string, unknown>>
    /** Whether the session's runtime has the MCP, hook and reload controls. */
    readonly hasControls: (session: Session) => boolean
  }
  'channel-bridge'?: {
    readonly routed: boolean
    readonly toggleRoute: () => void
    readonly accentColor: string
  }
  'ide-bridge'?: {
    readonly routed: boolean
    readonly toggleRoute: () => void
    readonly accentColor: string
    /** Deliver a diff-review comment into the composer. */
    readonly sendComment: (text: string) => void
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
  /** What a coordination view asks the host to do; the runs themselves are the host's. */
  coordination?: {
    /** The run the control center opens on (a run just started); null for the latest. */
    readonly initialRunId: string | null
    /** An agent's transcript in the reader, or a notice saying why it has none. */
    readonly openAgentSession: (agent: ProtocolAgent) => void
    /** These agents' transcripts in panes beside the reader, in priority order. */
    readonly watchAgentSessions: (agents: ProtocolAgent[]) => void
    /** The run's lead in the reader with its teammates beside it. */
    readonly watchRun: (snapshot: ProtocolRunSnapshot) => void
    /** Open the host's new-run setup. */
    readonly newRun: () => void
    readonly copyJoinCommand: (runId: string) => void
  }
  'session-fleet'?: {
    readonly sessions: Session[]
    readonly activity: ReadonlyMap<string, 'needs-input' | 'running' | 'waiting'>
    readonly alerts: readonly TuiFleetAlert[]
    /** The selected session, and its loaded detail once that detail is the selected session's. */
    readonly selected: Session | null
    readonly selectedCards: TuiTranscriptCard[] | null
    readonly selectedContext: ContextUsage | null
    readonly selectedModel: string | null
    readonly selectedMessageCount: number | null
    /** Select a session without leaving the view. */
    readonly select: (session: Session) => void
    /** Select a session and give the reader the keyboard. */
    readonly open: (session: Session) => void
    /** Open what an alert is about; false when the alert is gone. */
    readonly openAlert: (alertKey: string) => boolean
  }
  themes?: {
    readonly mode: TuiThemeMode
    /** Whether `mode` is on the light side, as the theme menu groups it. */
    readonly light: boolean
    readonly choose: (mode: TuiThemeMode) => void
  }
}

/** Something blocked on a person, as the attention inbox lists it. */
export type TuiFleetAlert = {
  readonly key: string
  readonly sessionKey: string
  readonly provider: AgentProvider
  readonly sessionTitle: string
  readonly title: string
  readonly detail?: string
  readonly needsInput: boolean
  readonly createdAt: number
}

/** Services a host hands over as values; the transcript and repository it resolves itself. */
export type TuiProvidedPluginServices = Omit<TuiPluginServices, 'session-transcript' | 'repository' | 'session' | 'live-transcript'>

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
  /** The host's accent for titles and selection (the composer's provider colour). */
  readonly accent: string
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
