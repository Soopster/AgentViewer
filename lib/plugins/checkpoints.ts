// Turn checkpoints as a plugin service: the snapshot each agent turn took of
// the working tree, what changed since one, restoring from it, and the working
// diff as hunks to reject, commit or open a pull request for. Browser-safe
// types only; the operations are lib/checkpoints.ts behind each renderer.
import type { CheckpointFileChange, FileHistory, FileHistoryStep, TurnCheckpoint, WorkingDiffHunk } from '../checkpoints'

export type { CheckpointFileChange, FileHistory, FileHistoryStep, TurnCheckpoint, WorkingDiffHunk }

/** Who a restore is for: a provider that tracks files itself is told what was put back. */
export type CheckpointRestoreContext = { readonly sessionId?: string; readonly provider?: string; readonly providerInstanceId?: string }

export type PluginCheckpointsService = {
  readonly list: (cwd: string, signal?: AbortSignal) => Promise<TurnCheckpoint[]>
  readonly changes: (cwd: string, sha: string, signal?: AbortSignal) => Promise<CheckpointFileChange[]>
  /** The diff since `sha`, or up to `untilSha` (another checkpoint) when given. */
  readonly diff: (cwd: string, sha: string, file?: string, untilSha?: string, signal?: AbortSignal) => Promise<string>
  readonly restore: (cwd: string, sha: string, paths?: string[], context?: CheckpointRestoreContext) => Promise<{ restored: number; deleted: number }>
  readonly working: (cwd: string, signal?: AbortSignal) => Promise<{ hunks: WorkingDiffHunk[]; untracked: string[] }>
  readonly rejectHunk: (cwd: string, patchText: string) => Promise<void>
  readonly deleteUntracked: (cwd: string, path: string) => Promise<void>
  readonly commit: (cwd: string, message: string) => Promise<string>
  readonly pullRequest: (cwd: string, title: string) => Promise<string>
  /** One file through every turn that changed it, oldest first. */
  readonly fileHistory: (cwd: string, path: string, signal?: AbortSignal) => Promise<FileHistory>
  /** Undo one hunk of an earlier step against the file as it is now; refuses when later edits rewrote it. */
  readonly revertFileHunk: (cwd: string, path: string, patchText: string) => Promise<void>
}
