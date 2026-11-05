// The TUI's GitHub reads and writes. Attached to a daemon they are the same
// requests the web view makes; otherwise they run lib/github in this process.
// `gh` runs where the checkout is, so attaching assumes the daemon shares the
// machine (as git-based features already do).
import { isRemoteAttached, remoteJson } from './remote'
import type {
  GithubPrDetail, GithubPrFilters, GithubPrSummary, GithubRelease, GithubReleaseCreate, GithubReleaseDetail, GithubRepoOverview,
  GithubSecurity, GithubWorkflow, GithubWorkflowDispatch,
  GithubInbox, GithubIssueDetail, GithubIssueFilters, GithubIssueMutation, GithubIssueSummary, GithubPrAction,
  GithubRun, GithubRunAction, GithubRunDetail, GithubRunLog,
} from '../github/types'

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
  return search.toString()
}

const post = (path: string, body: unknown) => ({ method: 'POST' as const, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, path })

export async function readTuiGithubInbox(cwd: string): Promise<GithubInbox> {
  if (isRemoteAttached()) return (await remoteJson<{ inbox: GithubInbox }>(`/api/github/inbox?${query({ cwd })}`)).inbox
  return (await import('../github/inbox')).fetchGithubInbox(cwd)
}

export async function readTuiGithubIssues(cwd: string, filters: GithubIssueFilters = {}): Promise<GithubIssueSummary[]> {
  if (isRemoteAttached()) return (await remoteJson<{ issues: GithubIssueSummary[] }>(`/api/github/issues?${query({ cwd, ...filters })}`)).issues
  return (await import('../github/issues')).fetchGithubIssues(cwd, filters)
}

export async function readTuiGithubIssue(cwd: string, number: number): Promise<GithubIssueDetail> {
  if (isRemoteAttached()) return (await remoteJson<{ issue: GithubIssueDetail }>(`/api/github/issues?${query({ cwd, number })}`)).issue
  return (await import('../github/issues')).fetchGithubIssue(cwd, number)
}

export async function mutateTuiGithubIssue(cwd: string, mutation: GithubIssueMutation): Promise<string> {
  if (isRemoteAttached()) {
    const { path, ...init } = post('/api/github/issues', { cwd, mutation })
    return (await remoteJson<{ url: string }>(path, init)).url
  }
  return (await import('../github/issues')).mutateGithubIssue(cwd, mutation)
}

export async function readTuiGithubRuns(cwd: string, options: { branch?: string; all?: boolean } = {}): Promise<{ branch: string; runs: GithubRun[] }> {
  if (isRemoteAttached()) return remoteJson(`/api/github/runs?${query({ cwd, branch: options.branch, all: options.all ? 1 : undefined })}`)
  return (await import('../github/actions')).fetchGithubRuns(cwd, options)
}

export async function readTuiGithubRun(cwd: string, id: number): Promise<GithubRunDetail> {
  if (isRemoteAttached()) return (await remoteJson<{ run: GithubRunDetail }>(`/api/github/runs?${query({ cwd, id })}`)).run
  return (await import('../github/actions')).fetchGithubRun(cwd, id)
}

export async function readTuiGithubRunLog(cwd: string, id: number): Promise<GithubRunLog> {
  if (isRemoteAttached()) return (await remoteJson<{ log: GithubRunLog }>(`/api/github/runs?${query({ cwd, id, log: 1 })}`)).log
  return (await import('../github/actions')).fetchGithubRunFailedLog(cwd, id)
}

export async function actOnTuiGithubRun(cwd: string, id: number, action: GithubRunAction): Promise<void> {
  if (isRemoteAttached()) {
    const { path, ...init } = post('/api/github/runs', { cwd, id, action })
    await remoteJson(path, init)
    return
  }
  await (await import('../github/actions')).actOnGithubRun(cwd, id, action)
}

export async function runTuiGithubPrAction(cwd: string, request: GithubPrAction): Promise<string> {
  if (isRemoteAttached()) {
    const { path, ...init } = post('/api/github/pr-actions', { cwd, request })
    return (await remoteJson<{ url: string }>(path, init)).url
  }
  return (await (await import('../github/prActions')).runGithubPrAction(cwd, request)).url
}

export async function readTuiGithubPrBody(cwd: string, base?: string): Promise<string> {
  if (isRemoteAttached()) return (await remoteJson<{ body: string }>(`/api/github/pr-actions?${query({ cwd, base })}`)).body
  return (await import('../github/prActions')).draftPullRequestBody(cwd, base)
}

export async function readTuiGithubRepo(cwd: string): Promise<GithubRepoOverview> {
  if (isRemoteAttached()) return (await remoteJson<{ repo: GithubRepoOverview }>(`/api/github/repo?${query({ cwd })}`)).repo
  return (await import('../github/repo')).fetchGithubRepoOverview(cwd)
}

export async function readTuiGithubPrs(cwd: string, filters: GithubPrFilters = {}): Promise<GithubPrSummary[]> {
  if (isRemoteAttached()) return (await remoteJson<{ prs: GithubPrSummary[] }>(`/api/github/prs?${query({ cwd, ...filters })}`)).prs
  return (await import('../github/prs')).fetchGithubPrs(cwd, filters)
}

export async function readTuiGithubPr(cwd: string, number: number): Promise<GithubPrDetail> {
  if (isRemoteAttached()) return (await remoteJson<{ pr: GithubPrDetail }>(`/api/github/prs?${query({ cwd, number })}`)).pr
  return (await import('../github/prs')).fetchGithubPr(cwd, number)
}

export async function readTuiGithubReleases(cwd: string): Promise<GithubRelease[]> {
  if (isRemoteAttached()) return (await remoteJson<{ releases: GithubRelease[] }>(`/api/github/releases?${query({ cwd })}`)).releases
  return (await import('../github/releases')).fetchGithubReleases(cwd)
}

export async function readTuiGithubRelease(cwd: string, tag: string): Promise<GithubReleaseDetail> {
  if (isRemoteAttached()) return (await remoteJson<{ release: GithubReleaseDetail }>(`/api/github/releases?${query({ cwd, tag })}`)).release
  return (await import('../github/releases')).fetchGithubRelease(cwd, tag)
}

export async function createTuiGithubRelease(cwd: string, release: GithubReleaseCreate): Promise<string> {
  if (isRemoteAttached()) {
    const { path, ...init } = post('/api/github/releases', { cwd, release })
    return (await remoteJson<{ url: string }>(path, init)).url
  }
  return (await import('../github/releases')).createGithubRelease(cwd, release)
}

export async function readTuiGithubSecurity(cwd: string): Promise<GithubSecurity> {
  if (isRemoteAttached()) return (await remoteJson<{ security: GithubSecurity }>(`/api/github/security?${query({ cwd })}`)).security
  return (await import('../github/security')).fetchGithubSecurity(cwd)
}

export async function readTuiGithubWorkflows(cwd: string): Promise<GithubWorkflow[]> {
  if (isRemoteAttached()) return (await remoteJson<{ workflows: GithubWorkflow[] }>(`/api/github/workflows?${query({ cwd })}`)).workflows
  return (await import('../github/workflows')).fetchGithubWorkflows(cwd)
}

export async function dispatchTuiGithubWorkflow(cwd: string, dispatch: GithubWorkflowDispatch): Promise<void> {
  if (isRemoteAttached()) {
    const { path, ...init } = post('/api/github/workflows', { cwd, dispatch })
    await remoteJson(path, init)
    return
  }
  await (await import('../github/workflows')).dispatchGithubWorkflow(cwd, dispatch)
}

export async function markTuiGithubNotifications(cwd: string, target: { id: string } | { all: true }): Promise<void> {
  if (isRemoteAttached()) {
    const { path, ...init } = post('/api/github/notifications', { cwd, ...target })
    await remoteJson(path, init)
    return
  }
  const inbox = await import('../github/inbox')
  if ('all' in target) await inbox.markAllGithubNotificationsRead(cwd)
  else await inbox.markGithubNotificationRead(cwd, target.id)
}
