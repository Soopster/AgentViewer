// Wire types shared by the GitHub routes, the TUI service wrappers and both views.
// No Node imports: client components import this file.
import type { GhUnavailableReason } from './ghRunner'

export type GithubAvailability =
  | { ok: true; repo: string | null; viewer: string | null }
  | { ok: false; reason: GhUnavailableReason; message: string }

export type GithubInboxItem = {
  kind: 'pr' | 'issue'
  repo: string
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  author: string
  updatedAt: string
  labels: string[]
}

export type GithubInboxSectionId = 'review-requested' | 'my-prs' | 'assigned' | 'mentioned'

export type GithubInboxSection = { id: GithubInboxSectionId; title: string; items: GithubInboxItem[] }

export type GithubNotification = {
  id: string
  reason: string
  repo: string
  title: string
  type: string
  url: string
  updatedAt: string
}

export type GithubInbox = {
  availability: GithubAvailability
  sections: GithubInboxSection[]
  notifications: GithubNotification[]
}

export type GithubIssueSummary = {
  number: number
  title: string
  state: string
  url: string
  author: string
  assignees: string[]
  labels: string[]
  comments: number
  updatedAt: string
}

export type GithubIssueComment = { id: string; author: string; body: string; createdAt: string; url: string }

export type GithubIssueDetail = GithubIssueSummary & { body: string; thread: GithubIssueComment[] }

export type GithubIssueFilters = {
  state?: 'open' | 'closed' | 'all'
  label?: string
  assignee?: string
  search?: string
  limit?: number
}

export type GithubIssueMutation =
  | { action: 'comment'; number: number; body: string }
  | { action: 'create'; title: string; body: string; labels?: string[]; assignees?: string[] }
  | { action: 'close'; number: number; reason?: 'completed' | 'not planned' }
  | { action: 'reopen'; number: number }
  | { action: 'edit'; number: number; addLabels?: string[]; removeLabels?: string[]; addAssignees?: string[]; removeAssignees?: string[] }

export type GithubRun = {
  id: number
  title: string
  workflow: string
  branch: string
  event: string
  status: string
  conclusion: string
  url: string
  createdAt: string
  updatedAt: string
}

export type GithubRunJob = {
  id: number
  name: string
  status: string
  conclusion: string
  url: string
  steps: Array<{ name: string; status: string; conclusion: string }>
}

export type GithubRunDetail = GithubRun & { jobs: GithubRunJob[] }

export type GithubRunLog = { text: string; truncated: boolean }

export type GithubRunAction = 'rerun-failed' | 'rerun-all' | 'cancel'

export type GithubMergeMethod = 'merge' | 'squash' | 'rebase'

export type GithubPrAction =
  | { action: 'create'; title: string; body?: string; base?: string; draft?: boolean }
  | { action: 'merge'; number: number; method: GithubMergeMethod; auto?: boolean; deleteBranch?: boolean }
  | { action: 'ready'; number: number; ready: boolean }
  | { action: 'checkout'; number: number }
  | { action: 'close'; number: number }
  | { action: 'reopen'; number: number }
  | { action: 'comment'; number: number; body: string }
  | { action: 'review'; number: number; verdict: GithubReviewVerdict; body?: string }
  | { action: 'update-branch'; number: number }
  | { action: 'thread'; threadId: string; resolved: boolean }
  | { action: 'edit'; number: number; addReviewers?: string[]; removeReviewers?: string[]; addLabels?: string[]; removeLabels?: string[]; addAssignees?: string[]; removeAssignees?: string[] }

// --- Repository overview -----------------------------------------------------
export type GithubRepoOverview = {
  repo: string
  description: string
  url: string
  defaultBranch: string
  visibility: string
  isFork: boolean
  stars: number
  forks: number
  openIssues: number
  openPullRequests: number
  language: string
  license: string
  pushedAt: string
  currentBranch: string
  branches: GithubBranch[]
  commits: GithubCommit[]
  labels: GithubLabel[]
  collaborators: string[]
}

export type GithubBranch = { name: string; protected: boolean; sha: string }
export type GithubCommit = { sha: string; message: string; author: string; date: string; url: string }
export type GithubLabel = { name: string; color: string; description: string }

// --- Pull requests (the list and the summary; the diff lives in lib/githubPr.ts) ---
export type GithubPrFilters = {
  state?: 'open' | 'closed' | 'merged' | 'all'
  scope?: 'all' | 'mine' | 'review-requested' | 'assigned'
  search?: string
  limit?: number
}

export type GithubPrSummary = {
  number: number
  title: string
  state: string
  isDraft: boolean
  url: string
  author: string
  headRefName: string
  baseRefName: string
  updatedAt: string
  reviewDecision: string
  labels: string[]
  checks: 'success' | 'failure' | 'pending' | 'none'
}

export type GithubPrReview = { author: string; state: string; body: string; submittedAt: string }
export type GithubPrCheck = { name: string; state: 'success' | 'failure' | 'pending' | 'neutral'; url: string }
export type GithubPrThread = { id: string; path: string; line: number | null; resolved: boolean; outdated: boolean; author: string; body: string; replies: number }

export type GithubPrDetail = GithubPrSummary & {
  body: string
  additions: number
  deletions: number
  changedFiles: number
  mergeable: string
  mergeStateStatus: string
  reviewRequests: string[]
  assignees: string[]
  reviews: GithubPrReview[]
  checkRuns: GithubPrCheck[]
  commits: Array<{ oid: string; message: string; author: string }>
  files: Array<{ path: string; additions: number; deletions: number }>
  comments: GithubIssueComment[]
  threads: GithubPrThread[]
}

export type GithubReviewVerdict = 'approve' | 'comment' | 'request-changes'

// --- Releases ------------------------------------------------------------------
export type GithubRelease = {
  tag: string
  name: string
  isDraft: boolean
  isPrerelease: boolean
  isLatest: boolean
  publishedAt: string
  url: string
}
export type GithubReleaseDetail = GithubRelease & { body: string; author: string; assets: Array<{ name: string; size: number; downloads: number }> }
export type GithubReleaseCreate = { tag: string; title?: string; notes?: string; generateNotes?: boolean; draft?: boolean; prerelease?: boolean; target?: string }

// --- Security --------------------------------------------------------------------
export type GithubAlertKind = 'dependabot' | 'code-scanning' | 'secret-scanning'
export type GithubAlert = {
  kind: GithubAlertKind
  number: number
  severity: string
  title: string
  detail: string
  url: string
  createdAt: string
}
export type GithubSecurity = {
  alerts: GithubAlert[]
  /** A kind absent from `alerts` because the repository has it off (or the token lacks access), never read as "no alerts". */
  unavailable: GithubAlertKind[]
}

// --- Workflows ---------------------------------------------------------------------
export type GithubWorkflow = { id: number; name: string; state: string; path: string }
export type GithubWorkflowDispatch = { workflow: string; ref?: string; inputs?: Record<string, string> }
