import { cachedGithubRead, githubCacheKey, invalidateGithubCache } from './cache'
import { flagValue, ghFailure, parseJson, runGh, type GhResult } from './ghRunner'
import { scrubGithubText } from './text'
import type {
  GithubIssueComment, GithubIssueDetail, GithubIssueFilters, GithubIssueMutation, GithubIssueSummary,
} from './types'

export const ISSUES_TTL_MS = 30_000
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const LIST_FIELDS = 'number,title,state,url,author,assignees,labels,comments,updatedAt'
const VIEW_FIELDS = `${LIST_FIELDS},body`

type Named = Array<{ login?: unknown; name?: unknown }>

function names(value: unknown, key: 'login' | 'name'): string[] {
  return (Array.isArray(value) ? value as Named : []).map(entry => scrubGithubText(entry[key])).filter(Boolean)
}

export function toIssueSummary(raw: Record<string, unknown>): GithubIssueSummary {
  // `comments` is a count from `list` and an array from `view`.
  const comments = Array.isArray(raw.comments) ? raw.comments.length : Number(raw.comments ?? 0)
  return {
    number: Number(raw.number ?? 0),
    title: scrubGithubText(raw.title),
    state: String(raw.state ?? ''),
    url: String(raw.url ?? ''),
    author: scrubGithubText((raw.author as { login?: unknown } | null)?.login ?? 'unknown'),
    assignees: names(raw.assignees, 'login'),
    labels: names(raw.labels, 'name'),
    comments,
    updatedAt: String(raw.updatedAt ?? ''),
  }
}

export function toIssueComment(raw: Record<string, unknown>): GithubIssueComment {
  return {
    id: String(raw.id ?? ''),
    author: scrubGithubText((raw.author as { login?: unknown } | null)?.login ?? 'unknown'),
    body: scrubGithubText(raw.body),
    createdAt: String(raw.createdAt ?? ''),
    url: String(raw.url ?? ''),
  }
}

export function buildIssueListArgs(filters: GithubIssueFilters): string[] {
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const args = ['issue', 'list', '--state', filters.state ?? 'open', '--limit', String(limit), '--json', LIST_FIELDS]
  if (filters.label) args.push('--label', flagValue(filters.label, 'label'))
  if (filters.assignee) args.push('--assignee', flagValue(filters.assignee, 'assignee'))
  if (filters.search?.trim()) args.push('--search', filters.search.trim())
  return args
}

export function fetchGithubIssues(cwd: string, filters: GithubIssueFilters = {}): Promise<GithubIssueSummary[]> {
  const key = githubCacheKey(cwd, 'issues', 'list', JSON.stringify(filters))
  return cachedGithubRead(key, ISSUES_TTL_MS, async () => {
    const result = await runGh(cwd, buildIssueListArgs(filters))
    if (result.code !== 0) throw ghFailure(result, 'Unable to list issues.')
    return parseJson<Array<Record<string, unknown>>>(result.stdout, []).map(toIssueSummary)
  })
}

export function fetchGithubIssue(cwd: string, number: number): Promise<GithubIssueDetail> {
  if (!Number.isInteger(number) || number < 1) return Promise.reject(new Error('Invalid issue number.'))
  return cachedGithubRead(githubCacheKey(cwd, 'issues', 'view', number), ISSUES_TTL_MS, async () => {
    const result = await runGh(cwd, ['issue', 'view', String(number), '--json', `${VIEW_FIELDS},comments`])
    if (result.code !== 0) throw ghFailure(result, `Unable to read issue #${number}.`)
    const raw = parseJson<Record<string, unknown>>(result.stdout, {})
    const thread = (Array.isArray(raw.comments) ? raw.comments as Array<Record<string, unknown>> : []).map(toIssueComment)
    return { ...toIssueSummary(raw), body: scrubGithubText(raw.body), thread }
  })
}

/** Returns the URL `gh` printed for a created issue or comment, else ''. */
export async function mutateGithubIssue(cwd: string, mutation: GithubIssueMutation): Promise<string> {
  const number = 'number' in mutation ? mutation.number : 0
  if ('number' in mutation && (!Number.isInteger(number) || number < 1)) throw new Error('Invalid issue number.')
  let result: GhResult
  switch (mutation.action) {
    case 'comment': {
      if (!mutation.body.trim()) throw new Error('Comment is empty.')
      result = await runGh(cwd, ['issue', 'comment', String(number), '--body-file', '-'], { input: mutation.body })
      break
    }
    case 'create': {
      if (!mutation.title.trim()) throw new Error('Title is required.')
      const args = ['issue', 'create', '--title', mutation.title.trim(), '--body-file', '-']
      for (const label of mutation.labels ?? []) args.push('--label', flagValue(label, 'label'))
      for (const assignee of mutation.assignees ?? []) args.push('--assignee', flagValue(assignee, 'assignee'))
      result = await runGh(cwd, args, { input: mutation.body })
      break
    }
    case 'close': {
      const args = ['issue', 'close', String(number)]
      if (mutation.reason) args.push('--reason', mutation.reason)
      result = await runGh(cwd, args)
      break
    }
    case 'reopen':
      result = await runGh(cwd, ['issue', 'reopen', String(number)])
      break
    case 'edit': {
      const args = ['issue', 'edit', String(number)]
      for (const label of mutation.addLabels ?? []) args.push('--add-label', flagValue(label, 'label'))
      for (const label of mutation.removeLabels ?? []) args.push('--remove-label', flagValue(label, 'label'))
      for (const who of mutation.addAssignees ?? []) args.push('--add-assignee', flagValue(who, 'assignee'))
      for (const who of mutation.removeAssignees ?? []) args.push('--remove-assignee', flagValue(who, 'assignee'))
      if (args.length === 3) throw new Error('Nothing to edit.')
      result = await runGh(cwd, args)
      break
    }
  }
  if (result.code !== 0) throw ghFailure(result, `Issue ${mutation.action} failed.`)
  invalidateGithubCache(cwd, 'issues')
  invalidateGithubCache(cwd, 'inbox')
  return result.stdout.split('\n').find(line => line.startsWith('https://')) ?? ''
}
