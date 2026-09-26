import { execFile } from 'node:child_process'

export type PullRequestListItem = {
  number: number
  title: string
  state: string
  url: string
  isDraft: boolean
  author: { login: string }
  headRefName: string
  baseRefName: string
  updatedAt: string
}

export type PullRequestFile = {
  filename: string
  previousFilename?: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch: string
}

export type PullRequestComment = {
  id: string
  body: string
  author: string
  createdAt: string
  url?: string
  path?: string
  line?: number | null
  side?: string | null
  originalLine?: number | null
  originalSide?: string | null
}

export type PullRequestCommit = {
  oid: string
  messageHeadline: string
  author: string
  authoredDate: string
}

export type PullRequestCheck = {
  name: string
  workflow: string
  state: 'success' | 'failure' | 'pending' | 'neutral'
  rawState: string
  detailsUrl?: string
  startedAt?: string
  completedAt?: string
}

export type PullRequestDetail = PullRequestListItem & {
  body: string
  additions: number
  deletions: number
  changedFiles: number
  mergeable: string
  reviewDecision: string
  headRefOid: string
  labels: Array<{ name: string; color: string }>
  comments: PullRequestComment[]
  reviews: Array<{ id: string; author: string; body: string; state: string; submittedAt: string }>
  reviewRequests: string[]
  commits: PullRequestCommit[]
  checks: PullRequestCheck[]
  files: PullRequestFile[]
}

export type PullRequestWorkspace = {
  available: boolean
  authenticated: boolean
  repo: string | null
  viewer: string | null
  pullRequests: PullRequestListItem[]
  selected: PullRequestDetail | null
  error?: string
}

type GhResult = { stdout: string; stderr: string; code: number }

function runGh(cwd: string, args: string[], maxBuffer = 20 * 1024 * 1024, input?: string): Promise<GhResult> {
  return new Promise((resolve) => {
    const child = execFile('gh', args, { cwd, encoding: 'utf8', maxBuffer }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? '').trim(),
        stderr: String(stderr || (error instanceof Error ? error.message : '')).trim(),
        code: typeof error === 'object' && error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
      })
    })
    if (input != null && child.stdin) {
      child.stdin.write(input)
      child.stdin.end()
    }
  })
}

function parseJson<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T } catch { return fallback }
}

function normalizeListItem(value: Record<string, unknown>): PullRequestListItem {
  const author = value.author as { login?: unknown } | null
  return {
    number: Number(value.number ?? 0),
    title: String(value.title ?? ''),
    state: String(value.state ?? ''),
    url: String(value.url ?? ''),
    isDraft: Boolean(value.isDraft),
    author: { login: String(author?.login ?? 'unknown') },
    headRefName: String(value.headRefName ?? ''),
    baseRefName: String(value.baseRefName ?? ''),
    updatedAt: String(value.updatedAt ?? ''),
  }
}

async function fetchDiscussion(cwd: string, repo: string, number: number): Promise<PullRequestComment[]> {
  const [issueResult, reviewResult] = await Promise.all([
    runGh(cwd, ['api', `repos/${repo}/issues/${number}/comments`, '--paginate']),
    runGh(cwd, ['api', `repos/${repo}/pulls/${number}/comments`, '--paginate']),
  ])
  const issueComments = parseJson<Array<Record<string, unknown>>>(issueResult.stdout, [])
  const reviewComments = parseJson<Array<Record<string, unknown>>>(reviewResult.stdout, [])
  return [
    ...issueComments.map((comment): PullRequestComment => ({
      id: String(comment.id ?? ''), body: String(comment.body ?? ''),
      author: String((comment.user as { login?: unknown } | null)?.login ?? 'unknown'),
      createdAt: String(comment.created_at ?? ''), url: String(comment.html_url ?? ''),
    })),
    ...reviewComments.map((comment): PullRequestComment => ({
      id: String(comment.id ?? ''), body: String(comment.body ?? ''),
      author: String((comment.user as { login?: unknown } | null)?.login ?? 'unknown'),
      createdAt: String(comment.created_at ?? ''), url: String(comment.html_url ?? ''),
      path: String(comment.path ?? ''), line: comment.line == null ? null : Number(comment.line),
      side: comment.side == null ? null : String(comment.side),
      originalLine: comment.original_line == null ? null : Number(comment.original_line),
      originalSide: comment.original_side == null ? null : String(comment.original_side),
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function fetchPullRequestWorkspace(cwd: string, selectedNumber?: number): Promise<PullRequestWorkspace> {
  const auth = await runGh(cwd, ['auth', 'status'])
  if (auth.code !== 0) {
    const unavailable = /not found|ENOENT/i.test(auth.stderr)
    return { available: !unavailable, authenticated: false, repo: null, viewer: null, pullRequests: [], selected: null, error: unavailable ? 'GitHub CLI (gh) is not installed.' : auth.stderr || 'Run gh auth login to review pull requests.' }
  }

  const [repoResult, listResult, viewerResult] = await Promise.all([
    runGh(cwd, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']),
    runGh(cwd, ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,state,url,isDraft,author,headRefName,baseRefName,updatedAt']),
    runGh(cwd, ['api', 'user', '--jq', '.login']),
  ])
  const repo = repoResult.stdout || null
  const viewer = viewerResult.code === 0 ? viewerResult.stdout || null : null
  const pullRequests = parseJson<Array<Record<string, unknown>>>(listResult.stdout, []).map(normalizeListItem)
  if (listResult.code !== 0) {
    return { available: true, authenticated: true, repo, viewer, pullRequests: [], selected: null, error: listResult.stderr || 'Unable to list pull requests.' }
  }
  const number = selectedNumber || pullRequests[0]?.number
  if (!repo || !number) {
    return { available: true, authenticated: true, repo, viewer, pullRequests, selected: null, error: repo ? undefined : repoResult.stderr || 'No GitHub repository found for this project.' }
  }

  const [detailResult, filesResult, discussion] = await Promise.all([
    runGh(cwd, ['pr', 'view', String(number), '--json', 'number,title,state,url,isDraft,author,headRefName,baseRefName,updatedAt,body,additions,deletions,changedFiles,mergeable,reviewDecision,headRefOid,labels,reviews,reviewRequests,commits,statusCheckRollup']),
    runGh(cwd, ['api', `repos/${repo}/pulls/${number}/files`, '--paginate'], 50 * 1024 * 1024),
    fetchDiscussion(cwd, repo, number),
  ])
  if (detailResult.code !== 0) throw new Error(detailResult.stderr || `Unable to load PR #${number}`)
  const raw = parseJson<Record<string, unknown>>(detailResult.stdout, {})
  const rawFiles = parseJson<Array<Record<string, unknown>>>(filesResult.stdout, [])
  const reviews = Array.isArray(raw.reviews) ? raw.reviews as Array<Record<string, unknown>> : []
  const rawCommits = Array.isArray(raw.commits) ? raw.commits as Array<Record<string, unknown>> : []
  const rawChecks = Array.isArray(raw.statusCheckRollup) ? raw.statusCheckRollup as Array<Record<string, unknown>> : []
  const rawReviewRequests = Array.isArray(raw.reviewRequests) ? raw.reviewRequests as Array<Record<string, unknown>> : []
  const selected: PullRequestDetail = {
    ...normalizeListItem(raw),
    body: String(raw.body ?? ''), additions: Number(raw.additions ?? 0), deletions: Number(raw.deletions ?? 0),
    changedFiles: Number(raw.changedFiles ?? rawFiles.length), mergeable: String(raw.mergeable ?? ''),
    reviewDecision: String(raw.reviewDecision ?? ''), headRefOid: String(raw.headRefOid ?? ''),
    labels: Array.isArray(raw.labels) ? (raw.labels as Array<Record<string, unknown>>).map((label) => ({ name: String(label.name ?? ''), color: String(label.color ?? '') })) : [],
    comments: discussion,
    reviews: reviews.map((review) => ({
      id: String(review.id ?? ''), author: String((review.author as { login?: unknown } | null)?.login ?? 'unknown'),
      body: String(review.body ?? ''), state: String(review.state ?? ''), submittedAt: String(review.submittedAt ?? ''),
    })),
    reviewRequests: rawReviewRequests
      .map((request) => String(request.login ?? request.name ?? request.slug ?? ''))
      .filter(Boolean),
    commits: rawCommits.map((commit): PullRequestCommit => {
      const authors = Array.isArray(commit.authors) ? commit.authors as Array<Record<string, unknown>> : []
      return {
        oid: String(commit.oid ?? ''),
        messageHeadline: String(commit.messageHeadline ?? ''),
        author: String(authors[0]?.login || authors[0]?.name || 'unknown'),
        authoredDate: String(commit.authoredDate ?? commit.committedDate ?? ''),
      }
    }),
    checks: rawChecks.map((check): PullRequestCheck => {
      // statusCheckRollup mixes CheckRun (status/conclusion) and StatusContext (state) nodes.
      const rawState = String(check.conclusion || check.state || check.status || '').toUpperCase()
      const state: PullRequestCheck['state'] =
        rawState === 'SUCCESS' ? 'success'
          : rawState === 'FAILURE' || rawState === 'ERROR' || rawState === 'TIMED_OUT' || rawState === 'ACTION_REQUIRED' ? 'failure'
            : rawState === 'NEUTRAL' || rawState === 'SKIPPED' || rawState === 'CANCELLED' ? 'neutral'
              : 'pending'
      return {
        name: String(check.name ?? check.context ?? 'check'),
        workflow: String(check.workflowName ?? ''),
        state,
        rawState: rawState.toLowerCase().replace(/_/g, ' '),
        ...(check.detailsUrl || check.targetUrl ? { detailsUrl: String(check.detailsUrl ?? check.targetUrl) } : {}),
        ...(check.startedAt ? { startedAt: String(check.startedAt) } : {}),
        ...(check.completedAt ? { completedAt: String(check.completedAt) } : {}),
      }
    }),
    files: rawFiles.map((file) => ({
      filename: String(file.filename ?? ''), status: String(file.status ?? ''), additions: Number(file.additions ?? 0),
      deletions: Number(file.deletions ?? 0), changes: Number(file.changes ?? 0), patch: String(file.patch ?? ''),
      ...(file.previous_filename ? { previousFilename: String(file.previous_filename) } : {}),
    })),
  }
  return { available: true, authenticated: true, repo, viewer, pullRequests, selected }
}

export type PullRequestReviewComment = {
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  startLine?: number
  startSide?: 'LEFT' | 'RIGHT'
  body: string
}

export type PullRequestMutation =
  | { action: 'comment'; number: number; body: string }
  | { action: 'review'; number: number; body: string; verdict: 'approve' | 'comment' | 'request-changes' }
  | { action: 'inline-comment'; number: number; body: string; commitId: string; path: string; line: number; side: 'LEFT' | 'RIGHT'; startLine?: number; startSide?: 'LEFT' | 'RIGHT' }
  | { action: 'submit-review'; number: number; body: string; verdict: 'approve' | 'comment' | 'request-changes'; commitId: string; comments: PullRequestReviewComment[] }

const REVIEW_EVENTS = { approve: 'APPROVE', comment: 'COMMENT', 'request-changes': 'REQUEST_CHANGES' } as const

export async function mutatePullRequest(cwd: string, repo: string, mutation: PullRequestMutation): Promise<void> {
  const body = mutation.body.trim()
  if (!body && (mutation.action === 'comment' || mutation.action === 'inline-comment')) throw new Error('Comment text is required.')
  let args: string[]
  let input: string | undefined
  if (mutation.action === 'comment') {
    args = ['pr', 'comment', String(mutation.number), '--body', body]
  } else if (mutation.action === 'review') {
    args = ['pr', 'review', String(mutation.number), `--${mutation.verdict}`, ...(body ? ['--body', body] : [])]
  } else if (mutation.action === 'submit-review') {
    // GitHub's real review flow: pending comments + verdict submitted as one review.
    if (mutation.verdict === 'comment' && !body && mutation.comments.length === 0) throw new Error('Review text or pending comments are required.')
    args = ['api', `repos/${repo}/pulls/${mutation.number}/reviews`, '--method', 'POST', '--input', '-']
    input = JSON.stringify({
      commit_id: mutation.commitId,
      event: REVIEW_EVENTS[mutation.verdict],
      ...(body ? { body } : {}),
      comments: mutation.comments.map((comment) => ({
        path: comment.path,
        line: comment.line,
        side: comment.side,
        body: comment.body,
        ...(comment.startLine != null && comment.startLine !== comment.line
          ? { start_line: comment.startLine, start_side: comment.startSide ?? comment.side }
          : {}),
      })),
    })
  } else {
    args = ['api', `repos/${repo}/pulls/${mutation.number}/comments`, '--method', 'POST', '-f', `body=${body}`, '-f', `commit_id=${mutation.commitId}`, '-f', `path=${mutation.path}`, '-F', `line=${mutation.line}`, '-f', `side=${mutation.side}`]
    if (mutation.startLine != null) args.push('-F', `start_line=${mutation.startLine}`, '-f', `start_side=${mutation.startSide ?? mutation.side}`)
  }
  const result = await runGh(cwd, args, undefined, input)
  if (result.code !== 0) throw new Error(result.stderr || 'GitHub CLI command failed.')
}

/** Current state of specific pull requests, for the linked-PR sweep.
 *
 *  Deliberately leaner than fetchPullRequestWorkspace: that one runs an auth
 *  check, a list, and a full detail fetch, which is far too much to do on a
 *  background refresh. This asks only the question being asked.
 *
 *  REST reports `state` as open/closed and signals a merge separately, so a
 *  merged PR must be derived rather than read — `closed` alone would settle
 *  sessions whose PR was rejected. Returns states uppercased to match the
 *  GraphQL vocabulary the rest of this module uses (OPEN/CLOSED/MERGED).
 *
 *  An absent or unauthenticated `gh` yields an empty map, never an error: a
 *  machine without it simply has no linked-PR state. */
export async function fetchPullRequestStates(
  cwd: string,
  repo: string,
  numbers: number[],
): Promise<Map<number, string>> {
  const states = new Map<number, string>()
  const pending = [...new Set(numbers)]
  const CONCURRENCY = 4
  let cursor = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
    while (cursor < pending.length) {
      const number = pending[cursor++]
      const result = await runGh(cwd, [
        'api', `repos/${repo}/pulls/${number}`,
        '--jq', '{state: .state, merged: .merged}',
      ])
      if (result.code !== 0) continue
      const parsed = parseJson<{ state?: string; merged?: boolean }>(result.stdout, {})
      if (!parsed.state) continue
      states.set(number, parsed.merged ? 'MERGED' : parsed.state.toUpperCase())
    }
  })
  await Promise.all(workers)
  return states
}
