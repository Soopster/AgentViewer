import type { ThreadedMessage } from '../threading'
import type { CodexPlanStep, OpenCodeTodo } from '../taskRegistry'
import type { SessionIdentity } from '../sessionIdentity'

/** Normalized streaming context, independent of either renderer. */
export type PluginLiveTranscript = {
  readonly messages: readonly ThreadedMessage[]
  readonly todos?: readonly OpenCodeTodo[]
  readonly plan?: readonly CodexPlanStep[]
}
export type PluginTaskControl = {
  readonly jumpTo: (eventUuid: string) => void
  readonly readOutput?: (session: SessionIdentity, taskId: string, signal?: AbortSignal) => Promise<{ available: boolean; output: string; totalBytes: number; truncated: boolean }>
  readonly stop?: (session: SessionIdentity, taskId: string, signal?: AbortSignal) => void | Promise<void>
}
