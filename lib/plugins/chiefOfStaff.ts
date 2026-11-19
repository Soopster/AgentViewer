import type { ChiefOfStaffState } from '../chiefOfStaff/service'
import type { CosRule } from '../chiefOfStaff/rules'

/** The repository's Chief of Staff: read it, start it, hand it a request. */
export type PluginChiefOfStaffService = {
  readonly read: (cwd: string, signal?: AbortSignal) => Promise<ChiefOfStaffState>
  readonly start: (params: { cwd: string; provider: string; request?: string }) => Promise<{ sessionId: string; provider: string; created: boolean }>
  /** Replaces the repository's routing rules; refused if any rule cannot be read. */
  readonly saveRules: (cwd: string, rules: readonly CosRule[]) => Promise<ChiefOfStaffState>
}
