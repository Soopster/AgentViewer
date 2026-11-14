// Pull requests as a list and a summary: enough to triage, review state, CI,
// threads and merge-readiness without opening the diff (that stays in
// lib/githubPr.ts / the pull-requests plugin). Reads are cached; mutations live
// in prActions.ts and invalidate this module's keys.
import { cachedGithubRead, githubCacheKey } from './cache'
import { ghFailure, parseJson, runGh } from './ghRunner'
import { fetchGithubRepoOverview } from './repo'
import { toIssueComment } from './issues'
import { scrubGithubText } from './text'
import type { GithubPrCheck, GithubPrDetail, GithubPrFilters, GithubPrReview, GithubPrSummary, GithubPrThread } from './types'

export const PRS_TTL_MS = 30_000
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 100
const LIST_FIELDS = 'number,title,state,isDraft,url,author,headRefName,baseRefName,updatedAt,reviewDecision,labels,statusCheckRollup'
const DETAIL_FIELDS = `${LIST_FIELDS},body,additions,deletions,changedFiles,mergeable,mergeStateStatus,reviewRequests,assignees,reviews,commits,files,comments`

const FAILING = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']
const PENDING = ['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING', 'EXPECTED']

function checkState(entry: Record<string, unknown>): GithubPrCheck['state'] {
  const conclusion = String(entry.conclusion ?? '')
  const status = String(entry.status ?? entry.state ?? '')
  if (FAILING.includes(conclusion) || FAILING.includes(status)) return 'failure'
  if (!conclusion && PENDING.includes(status)) return 'pending'
  if (conclusion === 'SUCCESS' || status === 'SUCCESS') return 'success'
  return conclusion || status ? 'neutral' : 'pending'
}

export function rollupState(rollup: unknown): GithubPrSummary['checks'] {
  const entries = Array.isArray(rollup) ? rollup as Array<Record<string, unknown>> : []
  if (entries.length === 0) return 'none'
  const states = entries.map(checkState)
  return states.includes('failure') ? 'failure' : states.includes('pending') ? 'pending' : 'success'
}

function logins(value: unknown): string[] {
  return (Array.isArray(value) ? value as Array<{ login?: unknown; name?: unknown; slug?: unknown }> : [])
    .map(entry => scrubGithubText(entry.login ?? entry.slug ?? entry.name)).filter(Boolean)
}

export function toPrSummary(raw: Record<string, unknown>): GithubPrSummary {
  const labels = Array.isArray(raw.labels) ? raw.labels as Array<{ name?: unknown }> : []
  return {
    number: Number(raw.number ?? 0),
    title: scrubGithubText(raw.title),
    state: String(raw.state ?? ''),
    isDraft: Boolean(raw.isDraft),
    url: String(raw.url ?? ''),
    author: scrubGithubText((raw.author as { login?: unknown } | null)?.login ?? 'unknown'),
    headRefName: scrubGithubText(raw.headRefName),
    baseRefName: scrubGithubText(raw.baseRefName),
    updatedAt: String(raw.updatedAt ?? ''),
    reviewDecision: String(raw.reviewDecision ?? ''),
    labels: labels.map(label => scrubGithubText(label.name)).filter(Boolean),
    checks: rollupState(raw.statusCheckRollup),
  }
}

export function buildPrListArgs(filters: GithubPrFilters): string[] {
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const args = ['pr', 'list', '--state', filters.state ?? 'open', '--limit', String(limit), '--json', LIST_FIELDS]
  const search: string[] = []
  if (filters.scope === 'mine') args.push('--author', '@me')
  else if (filters.scope === 'assigned') args.push('--assignee', '@me')
  else if (filters.scope === 'review-requested') search.push('review-requested:@me')
  if (filters.search?.trim()) search.push(filters.search.trim())
  if (search.length) args.push('--search', search.join(' '))
  return args
}

export function fetchGithubPrs(cwd: string, filters: GithubPrFilters = {}): Promise<GithubPrSummary[]> {
  return cachedGithubRead(githubCacheKey(cwd, 'prs', 'list', JSON.stringify(filters)), PRS_TTL_MS, async () => {
    const result = await runGh(cwd, buildPrListArgs(filters))
    if (result.code !== 0) throw ghFailure(result, 'Unable to list pull requests.')
    return parseJson<Array<Record<string, unknown>>>(result.stdout, []).map(toPrSummary)
  })
}

const THREADS_QUERY = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:50){nodes{id isResolved isOutdated path line comments(first:1){totalCount nodes{author{login} body}}}}}}}'

export function toThread(raw: Record<string, unknown>): GithubPrThread {
  const comments = raw.comments as { totalCount?: unknown; nodes?: Array<{ author?: { login?: unknown } | null; body?: unknown }> } | null
  const first = comments?.nodes?.[0]
  return {
    id: String(raw.id ?? ''),
    path: scrubGithubText(raw.path),
    line: raw.line == null ? null : Number(raw.line),
    resolved: Boolean(raw.isResolved),
    outdated: Boolean(raw.isOutdated),
    author: scrubGithubText(first?.author?.login ?? 'unknown'),
    body: scrubGithubText(first?.body),
    replies: Math.max(Number(comments?.totalCount ?? 1) - 1, 0),
  }
}

async function readThreads(cwd: string, number: number): Promise<GithubPrThread[]> {
  const { repo } = await fetchGithubRepoOverview(cwd)
  const [owner, name] = repo.split('/')
  const result = await runGh(cwd, ['api', 'graphql', '-f', `query=${THREADS_QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`])
  // Threads are an enrichment; the summary is still useful without them.
  if (result.code !== 0) return []
  const parsed = parseJson<{ data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: Array<Record<string, unknown>> } } } } }>(result.stdout, {})
  return (parsed.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []).map(toThread)
}

export function fetchGithubPr(cwd: string, number: number): Promise<GithubPrDetail> {
  if (!Number.isInteger(number) || number < 1) return Promise.reject(new Error('Invalid pull request number.'))
  return cachedGithubRead(githubCacheKey(cwd, 'prs', 'view', number), PRS_TTL_MS, async () => {
    const [view, threads] = await Promise.all([runGh(cwd, ['pr', 'view', String(number), '--json', DETAIL_FIELDS]), readThreads(cwd, number)])
    if (view.code !== 0) throw ghFailure(view, `Unable to read pull request #${number}.`)
    const raw = parseJson<Record<string, unknown>>(view.stdout, {})
    const rollup = Array.isArray(raw.statusCheckRollup) ? raw.statusCheckRollup as Array<Record<string, unknown>> : []
    const reviews = Array.isArray(raw.reviews) ? raw.reviews as Array<Record<string, unknown>> : []
    const commits = Array.isArray(raw.commits) ? raw.commits as Array<Record<string, unknown>> : []
    const files = Array.isArray(raw.files) ? raw.files as Array<Record<string, unknown>> : []
    const comments = Array.isArray(raw.comments) ? raw.comments as Array<Record<string, unknown>> : []
    return {
      ...toPrSummary(raw),
      body: scrubGithubText(raw.body),
      additions: Number(raw.additions ?? 0),
      deletions: Number(raw.deletions ?? 0),
      changedFiles: Number(raw.changedFiles ?? 0),
      mergeable: String(raw.mergeable ?? ''),
      mergeStateStatus: String(raw.mergeStateStatus ?? ''),
      reviewRequests: logins(raw.reviewRequests),
      assignees: logins(raw.assignees),
      reviews: reviews.map((review): GithubPrReview => ({
        author: scrubGithubText((review.author as { login?: unknown } | null)?.login ?? 'unknown'),
        state: String(review.state ?? ''), body: scrubGithubText(review.body), submittedAt: String(review.submittedAt ?? ''),
      })),
      checkRuns: rollup.map((entry): GithubPrCheck => ({ name: scrubGithubText(entry.name ?? entry.context), state: checkState(entry), url: String(entry.detailsUrl ?? entry.targetUrl ?? '') })),
      commits: commits.map(commit => ({
        oid: String(commit.oid ?? '').slice(0, 7), message: scrubGithubText(commit.messageHeadline),
        author: scrubGithubText(Array.isArray(commit.authors) ? (commit.authors[0] as { login?: unknown } | undefined)?.login : ''),
      })),
      files: files.map(file => ({ path: scrubGithubText(file.path), additions: Number(file.additions ?? 0), deletions: Number(file.deletions ?? 0) })),
      comments: comments.map(toIssueComment),
      threads,
    }
  })
}
