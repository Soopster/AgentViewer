// Pure row building for the GitHub popover: what each tab lists and what its
// detail pane says. No React, so the smoke can check it without a renderer.
import type {
  GithubAlert, GithubInbox, GithubInboxItem, GithubIssueDetail, GithubIssueSummary, GithubPrDetail, GithubPrSummary, GithubRelease,
  GithubReleaseDetail, GithubRepoOverview, GithubRun, GithubRunDetail, GithubSecurity,
} from '../../../lib/github/types'

export type GithubTab = 'overview' | 'inbox' | 'prs' | 'issues' | 'actions' | 'releases' | 'security'
export const GITHUB_TABS: ReadonlyArray<{ id: GithubTab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'inbox', label: 'Inbox' }, { id: 'prs', label: 'PRs' }, { id: 'issues', label: 'Issues' },
  { id: 'actions', label: 'Actions' }, { id: 'releases', label: 'Releases' }, { id: 'security', label: 'Security' },
]

export type GithubRow = {
  key: string; label: string; meta: string; url: string; number: number; id: number; tag: string
  tone: 'ok' | 'bad' | 'warn' | 'plain'
  /** A draft PR / draft release: what the draft toggle must flip. */
  draft: boolean
  /** A notification, not a PR or issue: its `key` is `n<thread id>`. */
  notification: boolean
}

const row = (fields: Partial<GithubRow> & Pick<GithubRow, 'key' | 'label' | 'meta'>): GithubRow => ({
  url: '', number: 0, id: 0, tag: '', tone: 'plain', draft: false, notification: false, ...fields,
})

export function runTone(run: { status: string; conclusion: string }): GithubRow['tone'] {
  if (run.status !== 'completed') return 'warn'
  return run.conclusion === 'success' ? 'ok' : run.conclusion === 'failure' || run.conclusion === 'timed_out' ? 'bad' : 'plain'
}

export function runLabel(run: { status: string; conclusion: string }): string {
  return run.status === 'completed' ? run.conclusion || 'completed' : run.status.replace(/_/g, ' ')
}

function inboxRow(item: GithubInboxItem, section: string): GithubRow {
  return row({ key: `${item.repo}#${item.number}`, label: `${item.isDraft ? '[draft] ' : ''}${item.title}`, meta: `#${item.number} ${item.author} · ${section}`, url: item.url, number: item.number, draft: item.isDraft })
}

export function inboxRows(inbox: GithubInbox): GithubRow[] {
  const rows = inbox.sections.flatMap(section => section.items.map(item => inboxRow(item, section.title.toLowerCase())))
  const notes = inbox.notifications.map((note): GithubRow => row({ key: `n${note.id}`, label: note.title, meta: `${note.repo} · ${note.reason.replace(/_/g, ' ')}`, url: note.url, tone: 'warn', notification: true }))
  return [...rows, ...notes]
}

export function myPullRequestRows(inbox: GithubInbox): GithubRow[] {
  return (inbox.sections.find(section => section.id === 'my-prs')?.items ?? []).map(item => inboxRow(item, 'mine'))
}

export function issueRows(issues: GithubIssueSummary[]): GithubRow[] {
  return issues.map(issue => row({ key: `i${issue.number}`, label: issue.title, meta: `#${issue.number} ${issue.author} · ${issue.comments} comments${issue.assignees.length ? ` · @${issue.assignees.join(',@')}` : ''}${issue.labels.length ? ` · ${issue.labels.join(', ')}` : ''}`, url: issue.url, number: issue.number }))
}

export function runRows(runs: GithubRun[]): GithubRow[] {
  return runs.map(run => row({ key: `r${run.id}`, label: run.title, meta: `${run.workflow} · ${run.branch} · ${runLabel(run)}`, url: run.url, id: run.id, tone: runTone(run) }))
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) { lines.push(line); line = word } else line = line ? `${line} ${word}` : word
      while (line.length > width) { lines.push(line.slice(0, width)); line = line.slice(width) }
    }
    lines.push(line)
  }
  return lines
}

export function issueDetailLines(issue: GithubIssueDetail, width: number): string[] {
  const lines = [`#${issue.number} ${issue.title}`, `${issue.state} · ${issue.author} · ${issue.url}`, '', ...wrap(issue.body || '(no description)', width)]
  for (const entry of issue.thread) lines.push('', `— ${entry.author}`, ...wrap(entry.body, width))
  return lines
}

export function runDetailLines(run: GithubRunDetail, width: number, log?: { text: string; truncated: boolean } | null): string[] {
  const lines = [run.title, `${run.workflow} · ${runLabel(run)} · ${run.url}`, '']
  for (const job of run.jobs) {
    lines.push(`${job.conclusion === 'failure' ? '✕' : job.status === 'completed' ? '✓' : '…'} ${job.name}`)
    if (job.conclusion === 'failure') for (const step of job.steps.filter(entry => entry.conclusion === 'failure')) lines.push(`    ✕ ${step.name}`)
  }
  if (log) lines.push('', log.truncated ? '— failed-step log (end) —' : '— failed-step log —', ...log.text.split('\n').flatMap(line => wrap(line, width)))
  return lines
}

const CHECK_TONE = { success: 'ok', failure: 'bad', pending: 'warn', none: 'plain' } as const
const DECISION_WORD: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'review required' }

export function prRows(prs: GithubPrSummary[]): GithubRow[] {
  return prs.map(pr => row({
    key: `p${pr.number}`,
    label: `${pr.isDraft ? '[draft] ' : ''}${pr.title}`,
    meta: `#${pr.number} ${pr.author} · ${pr.headRefName}→${pr.baseRefName}${pr.reviewDecision ? ` · ${DECISION_WORD[pr.reviewDecision] ?? pr.reviewDecision.toLowerCase()}` : ''}${pr.checks !== 'none' ? ` · ci ${pr.checks}` : ''}`,
    url: pr.url, number: pr.number, tone: CHECK_TONE[pr.checks], draft: pr.isDraft,
  }))
}

export function releaseRows(releases: GithubRelease[]): GithubRow[] {
  return releases.map(release => row({
    key: `v${release.tag}`, label: `${release.name}${release.isLatest ? ' (latest)' : ''}`,
    meta: `${release.tag}${release.isDraft ? ' · draft' : ''}${release.isPrerelease ? ' · pre-release' : ''}`,
    url: release.url, tag: release.tag, tone: release.isLatest ? 'ok' : 'plain', draft: release.isDraft,
  }))
}

const SEVERITY_TONE = (severity: string): GithubRow['tone'] => (['critical', 'high', 'error'].includes(severity) ? 'bad' : ['medium', 'moderate', 'warning'].includes(severity) ? 'warn' : 'plain')

export function alertRows(security: GithubSecurity): GithubRow[] {
  return security.alerts.map(alert => row({
    key: `a${alert.kind}${alert.number}`, label: alert.title, meta: `${alert.severity} · ${alert.kind}${alert.detail ? ` · ${alert.detail}` : ''}`,
    url: alert.url, number: alert.number, tone: SEVERITY_TONE(alert.severity),
  }))
}

export function alertDetailLines(alert: GithubAlert | undefined, security: GithubSecurity, width: number): string[] {
  if (!alert) {
    return security.unavailable.length
      ? [`Not available: ${security.unavailable.join(', ')}.`, 'Turned off for this repository, or the token cannot read them. That is not the same as no alerts.']
      : []
  }
  return [alert.title, `${alert.severity} · ${alert.kind} #${alert.number}`, alert.detail, alert.url, '', ...wrap(alert.createdAt, width)]
}

export function overviewLines(repo: GithubRepoOverview): string[] {
  const lines = [
    `${repo.repo}  (${repo.visibility}${repo.isFork ? ', fork' : ''})`,
    repo.description || '(no description)',
    `★ ${repo.stars}  ⑂ ${repo.forks}  ${repo.openPullRequests} open PRs  ${repo.openIssues} open issues${repo.language ? `  ${repo.language}` : ''}${repo.license ? `  ${repo.license}` : ''}`,
    `on ${repo.currentBranch || '(detached)'} · default ${repo.defaultBranch} · pushed ${repo.pushedAt}`,
    '', 'Recent commits',
    ...repo.commits.slice(0, 10).map(commit => `  ${commit.sha} ${commit.message}  — ${commit.author}`),
    '', 'Branches',
    ...repo.branches.slice(0, 15).map(branch => `  ${branch.name === repo.currentBranch ? '●' : ' '} ${branch.name}${branch.protected ? '  (protected)' : ''}`),
  ]
  if (repo.labels.length) lines.push('', `Labels: ${repo.labels.map(label => label.name).join(', ')}`)
  return lines
}

export function prDetailLines(pr: GithubPrDetail, width: number): string[] {
  const lines = [
    `#${pr.number} ${pr.title}`,
    `${pr.state.toLowerCase()}${pr.isDraft ? ' · draft' : ''} · ${pr.author} · ${pr.headRefName}→${pr.baseRefName}`,
    `${pr.mergeable.toLowerCase() || 'mergeability unknown'}${pr.mergeStateStatus === 'BEHIND' ? ' · behind base (u updates)' : ''}${pr.reviewDecision ? ` · ${DECISION_WORD[pr.reviewDecision] ?? pr.reviewDecision.toLowerCase()}` : ''} · +${pr.additions} −${pr.deletions} in ${pr.changedFiles} files`,
    pr.url,
  ]
  if (pr.reviewRequests.length) lines.push(`review requested: ${pr.reviewRequests.join(', ')}`)
  if (pr.body) lines.push('', ...wrap(pr.body, width))
  if (pr.checkRuns.length) lines.push('', 'Checks', ...pr.checkRuns.map(check => `  ${check.state === 'success' ? '✓' : check.state === 'failure' ? '✕' : check.state === 'pending' ? '…' : '·'} ${check.name}`))
  if (pr.reviews.length) lines.push('', 'Reviews', ...pr.reviews.flatMap(review => [`  ${review.state.toLowerCase().replace('_', ' ')} · ${review.author}`, ...(review.body ? wrap(review.body, width - 4).map(line => `    ${line}`) : [])]))
  if (pr.threads.length) {
    lines.push('', `Review threads (${pr.threads.filter(thread => !thread.resolved).length} unresolved)`)
    for (const thread of pr.threads) lines.push(`  ${thread.resolved ? '✓' : '○'} ${thread.path}${thread.line ? `:${thread.line}` : ''}${thread.outdated ? ' (outdated)' : ''} — ${thread.author}`, ...wrap(thread.body, width - 6).slice(0, 4).map(line => `      ${line}`))
  }
  if (pr.files.length) lines.push('', `Files (${pr.files.length})`, ...pr.files.slice(0, 40).map(file => `  +${file.additions} −${file.deletions} ${file.path}`))
  if (pr.commits.length) lines.push('', `Commits (${pr.commits.length})`, ...pr.commits.map(commit => `  ${commit.oid} ${commit.message}`))
  for (const comment of pr.comments) lines.push('', `— ${comment.author}`, ...wrap(comment.body, width))
  return lines
}

export function releaseDetailLines(release: GithubReleaseDetail, width: number): string[] {
  return [
    `${release.name}  (${release.tag})`,
    `${release.isDraft ? 'draft · ' : ''}${release.isPrerelease ? 'pre-release · ' : ''}${release.author} · ${release.publishedAt}`,
    release.url, '', ...wrap(release.body || '(no notes)', width),
    ...(release.assets.length ? ['', 'Assets', ...release.assets.map(asset => `  ${asset.name}  ${Math.round(asset.size / 1024)} KB  ${asset.downloads} downloads`)] : []),
  ]
}
