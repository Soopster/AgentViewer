// The TUI's checkpoints service: lib/checkpoints.ts in this process, behind
// the contract the Web serves over /api/checkpoints.
import type { PluginCheckpointsService } from '../../../lib/plugins/checkpoints'
import {
  commitTuiAllChanges, createTuiReviewPullRequest, deleteTuiUntrackedFile, listTuiCheckpoints, listTuiWorkingDiff,
  readTuiCheckpointChanges, readTuiCheckpointDiff, readTuiFileHistory, rejectTuiWorkingHunk, restoreTuiCheckpoint, revertTuiFileHistoryHunk,
} from '../../../lib/tui/service'
import { findRepoRoot } from '../../../lib/worktreeTasks'

export const tuiCheckpoints: PluginCheckpointsService = {
  list: (cwd) => listTuiCheckpoints(cwd),
  changes: (cwd, sha) => readTuiCheckpointChanges(cwd, sha),
  diff: (cwd, sha, file, untilSha) => readTuiCheckpointDiff(cwd, sha, file, untilSha),
  restore: (cwd, sha, paths, context) => restoreTuiCheckpoint(cwd, sha, paths, context),
  working: (cwd) => listTuiWorkingDiff(cwd),
  rejectHunk: (cwd, patchText) => rejectTuiWorkingHunk(cwd, patchText),
  deleteUntracked: (cwd, path) => deleteTuiUntrackedFile(cwd, path),
  commit: (cwd, message) => commitTuiAllChanges(cwd, message),
  pullRequest: (cwd, title) => createTuiReviewPullRequest(cwd, title),
  fileHistory: (cwd, path) => readTuiFileHistory(cwd, path),
  // A history's patches name repository-relative paths, so they apply at the root.
  revertFileHunk: async (cwd, _path, patchText) => revertTuiFileHistoryHunk((await findRepoRoot(cwd)) ?? cwd, patchText),
}
