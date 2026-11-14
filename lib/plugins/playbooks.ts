import type { PlaybookSummary, RunPlaybook } from '../agentProtocol'

/** Repository storage operations; views own selection, editing and request lifetimes. */
export type PluginPlaybookService = {
  readonly list: (cwd: string, signal?: AbortSignal) => Promise<{ playbooks: PlaybookSummary[]; invalid: Array<{ file: string; error: string }> }>
  readonly read: (cwd: string, name: string, signal?: AbortSignal) => Promise<RunPlaybook>
  readonly write: (cwd: string, playbook: RunPlaybook, previousName?: string, signal?: AbortSignal) => Promise<{ playbook: RunPlaybook; path: string }>
  readonly remove: (cwd: string, name: string, signal?: AbortSignal) => Promise<void>
}
