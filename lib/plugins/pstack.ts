import type { PstackState } from '../pstack/service'

/** pstack's bundled skills and the user's model roles. */
export type PluginPstackService = {
  readonly read: (cwd: string, signal?: AbortSignal) => Promise<PstackState>
  /** An empty line clears the role; refused if the line cannot be read. */
  readonly saveRole: (cwd: string, role: string, line: string) => Promise<PstackState>
}
