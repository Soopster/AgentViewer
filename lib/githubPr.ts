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
  files: PullRequestFile[]
}

export type PullRequestWorkspace = {
  available: boolean
  authenticated: boolean
  repo: string | null
  pullRequests: PullRequestListItem[]
  selected: PullRequestDetail | null
  error?: string
}

type GhResult = { stdout: string; stderr: string; code: number }

function runGh(cwd: string, args: string[], maxBuffer = 20 * 1024 * 1024): Promise<GhResult> {
  return new Promise((resolve) => {
    execFile('gh', args, { cwd, encoding: 'utf8', maxBuffer }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? '').trim(),
        stderr: String(stderr || (error instanceof Error ? error.message : '')).trim(),
        code: typeof error === 'object' && error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
      })
    })
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
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function fetchPullRequestWorkspace(cwd: string, selectedNumber?: number): Promise<PullRequestWorkspace> {
  const auth = await runGh(cwd, ['auth', 'status'])
  if (auth.code !== 0) {
    const unavailable = /not found|ENOENT/i.test(auth.stderr)
    return { available: !unavailable, authenticated: false, repo: null, pullRequests: [], selected: null, error: unavailable ? 'GitHub CLI (gh) is not installed.' : auth.stderr || 'Run gh auth login to review pull requests.' }
  }

  const [repoResult, listResult] = await Promise.all([
    runGh(cwd, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']),
    runGh(cwd, ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,state,url,isDraft,author,headRefName,baseRefName,updatedAt']),
  ])
  const repo = repoResult.stdout || null
  const pullRequests = parseJson<Array<Record<string, unknown>>>(listResult.stdout, []).map(normalizeListItem)
  if (listResult.code !== 0) {
    return { available: true, authenticated: true, repo, pullRequests: [], selected: null, error: listResult.stderr || 'Unable to list pull requests.' }
  }
  const number = selectedNumber || pullRequests[0]?.number
  if (!repo || !number) {
    return { available: true, authenticated: true, repo, pullRequests, selected: null, error: repo ? undefined : repoResult.stderr || 'No GitHub repository found for this project.' }
  }

  const [detailResult, filesResult, discussion] = await Promise.all([
    runGh(cwd, ['pr', 'view', String(number), '--json', 'number,title,state,url,isDraft,author,headRefName,baseRefName,updatedAt,body,additions,deletions,changedFiles,mergeable,reviewDecision,headRefOid,labels,reviews']),
    runGh(cwd, ['api', `repos/${repo}/pulls/${number}/files`, '--paginate'], 50 * 1024 * 1024),
    fetchDiscussion(cwd, repo, number),
  ])
  if (detailResult.code !== 0) throw new Error(detailResult.stderr || `Unable to load PR #${number}`)
  const raw = parseJson<Record<string, unknown>>(detailResult.stdout, {})
  const rawFiles = parseJson<Array<Record<string, unknown>>>(filesResult.stdout, [])
  const reviews = Array.isArray(raw.reviews) ? raw.reviews as Array<Record<string, unknown>> : []
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
    files: rawFiles.map((file) => ({
      filename: String(file.filename ?? ''), status: String(file.status ?? ''), additions: Number(file.additions ?? 0),
      deletions: Number(file.deletions ?? 0), changes: Number(file.changes ?? 0), patch: String(file.patch ?? ''),
    })),
  }
  return { available: true, authenticated: true, repo, pullRequests, selected }
}

export type PullRequestMutation =
  | { action: 'comment'; number: number; body: string }
  | { action: 'review'; number: number; body: string; verdict: 'approve' | 'comment' | 'request-changes' }
  | { action: 'inline-comment'; number: number; body: string; commitId: string; path: string; line: number; side: 'LEFT' | 'RIGHT'; startLine?: number; startSide?: 'LEFT' | 'RIGHT' }

export async function mutatePullRequest(cwd: string, repo: string, mutation: PullRequestMutation): Promise<void> {
  const body = mutation.body.trim()
  if (!body && mutation.action !== 'review') throw new Error('Comment text is required.')
  let args: string[]
  if (mutation.action === 'comment') {
    args = ['pr', 'comment', String(mutation.number), '--body', body]
  } else if (mutation.action === 'review') {
    args = ['pr', 'review', String(mutation.number), `--${mutation.verdict}`, ...(body ? ['--body', body] : [])]
  } else {
    args = ['api', `repos/${repo}/pulls/${mutation.number}/comments`, '--method', 'POST', '-f', `body=${body}`, '-f', `commit_id=${mutation.commitId}`, '-f', `path=${mutation.path}`, '-F', `line=${mutation.line}`, '-f', `side=${mutation.side}`]
    if (mutation.startLine != null) args.push('-F', `start_line=${mutation.startLine}`, '-f', `start_side=${mutation.startSide ?? mutation.side}`)
  }
  const result = await runGh(cwd, args)
  if (result.code !== 0) throw new Error(result.stderr || 'GitHub CLI command failed.')
}
