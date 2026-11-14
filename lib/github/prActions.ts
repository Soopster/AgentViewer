// Pull-request lifecycle: create, merge, ready/draft, checkout, close/reopen,
// reviewers and labels. Review itself (comments, approvals) stays in lib/githubPr.ts.
import { execFile } from 'node:child_process'
import { invalidateGithubCache } from './cache'
import { flagValue, ghFailure, parseJson, runGh, type GhResult } from './ghRunner'
import { scrubGithubText } from './text'
import type { GithubPrAction } from './types'

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim()))
      else resolve(String(stdout).trim())
    })
  })
}

const THREAD_ID = /^[A-Za-z0-9_=-]{8,128}$/

function assertNumber(number: number): void {
  if (!Number.isInteger(number) || number < 1) throw new Error('Invalid pull request number.')
}

/** The base branch gh would pick: the repository's default branch. */
async function defaultBase(cwd: string): Promise<string> {
  const result = await runGh(cwd, ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'])
  return result.code === 0 && result.stdout ? result.stdout : 'main'
}

/** A body from the commits the PR will carry, so a PR is never opened with an empty or boilerplate description. */
export async function draftPullRequestBody(cwd: string, base?: string): Promise<string> {
  const target = base ?? await defaultBase(cwd)
  const log = await git(cwd, ['log', `origin/${target}..HEAD`, '--format=%s%n%b%n--'])
    .catch(() => git(cwd, ['log', '-n', '10', '--format=%s%n%b%n--']))
  const commits = log.split('\n--').map(entry => entry.trim()).filter(Boolean)
  if (commits.length === 0) return ''
  const [first, ...rest] = commits
  if (rest.length === 0) return first.includes('\n') ? first.split('\n').slice(1).join('\n').trim() : ''
  return commits.map(entry => `- ${entry.split('\n')[0]}`).join('\n')
}

export type MergeReadiness = { ok: boolean; reasons: string[] }

/** Merge is refused unless GitHub says it is mergeable and no check is failing; pending checks need `auto`. */
export function assessMerge(view: Record<string, unknown>, auto: boolean): MergeReadiness {
  const reasons: string[] = []
  if (view.state !== 'OPEN') reasons.push(`pull request is ${String(view.state).toLowerCase() || 'not open'}`)
  if (view.isDraft) reasons.push('pull request is a draft')
  if (view.mergeable === 'CONFLICTING') reasons.push('has merge conflicts')
  else if (view.mergeable !== 'MERGEABLE') reasons.push('mergeability is not known yet')
  if (view.reviewDecision === 'CHANGES_REQUESTED') reasons.push('changes were requested')
  const checks = Array.isArray(view.statusCheckRollup) ? view.statusCheckRollup as Array<Record<string, unknown>> : []
  const failing = checks.filter(check => ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'].includes(String(check.conclusion ?? check.state ?? '')))
  const pending = checks.filter(check => ['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING', 'EXPECTED'].includes(String(check.status ?? check.state ?? '')) && !check.conclusion)
  if (failing.length) reasons.push(`${failing.length} check${failing.length === 1 ? '' : 's'} failing`)
  if (pending.length && !auto) reasons.push(`${pending.length} check${pending.length === 1 ? '' : 's'} still running (use auto-merge to wait)`)
  return { ok: reasons.length === 0, reasons }
}

export async function runGithubPrAction(cwd: string, request: GithubPrAction): Promise<{ url: string }> {
  let result: GhResult
  switch (request.action) {
    case 'create': {
      if (!request.title.trim()) throw new Error('Title is required.')
      const base = request.base ? flagValue(request.base, 'base branch') : undefined
      await git(cwd, ['push', '-u', 'origin', 'HEAD'])
      const body = request.body ?? await draftPullRequestBody(cwd, base)
      const args = ['pr', 'create', '--title', request.title.trim(), '--body-file', '-']
      if (base) args.push('--base', base)
      if (request.draft) args.push('--draft')
      result = await runGh(cwd, args, { input: body })
      break
    }
    case 'merge': {
      assertNumber(request.number)
      const view = await runGh(cwd, ['pr', 'view', String(request.number), '--json', 'state,isDraft,mergeable,reviewDecision,statusCheckRollup'])
      if (view.code !== 0) throw ghFailure(view, `Unable to read pull request #${request.number}.`)
      const readiness = assessMerge(parseJson<Record<string, unknown>>(view.stdout, {}), request.auto === true)
      if (!readiness.ok) throw new Error(`Not merging #${request.number}: ${readiness.reasons.join('; ')}.`)
      const args = ['pr', 'merge', String(request.number), `--${request.method}`]
      if (request.auto) args.push('--auto')
      if (request.deleteBranch) args.push('--delete-branch')
      result = await runGh(cwd, args)
      break
    }
    case 'ready':
      assertNumber(request.number)
      result = await runGh(cwd, request.ready ? ['pr', 'ready', String(request.number)] : ['pr', 'ready', String(request.number), '--undo'])
      break
    case 'checkout': {
      assertNumber(request.number)
      // checkout rewrites the working tree; never do that over uncommitted work.
      if (await git(cwd, ['status', '--porcelain'])) throw new Error('Working tree has uncommitted changes; commit or stash before checking out a pull request.')
      result = await runGh(cwd, ['pr', 'checkout', String(request.number)])
      break
    }
    case 'close':
      assertNumber(request.number)
      result = await runGh(cwd, ['pr', 'close', String(request.number)])
      break
    case 'reopen':
      assertNumber(request.number)
      result = await runGh(cwd, ['pr', 'reopen', String(request.number)])
      break
    case 'comment': {
      assertNumber(request.number)
      if (!request.body.trim()) throw new Error('Comment is empty.')
      result = await runGh(cwd, ['pr', 'comment', String(request.number), '--body-file', '-'], { input: request.body })
      break
    }
    case 'review': {
      assertNumber(request.number)
      const flag = request.verdict === 'approve' ? '--approve' : request.verdict === 'request-changes' ? '--request-changes' : '--comment'
      // GitHub rejects a changes-requested or comment-only review with no body.
      if (request.verdict !== 'approve' && !request.body?.trim()) throw new Error(`A ${request.verdict.replace('-', ' ')} review needs a message.`)
      const args = ['pr', 'review', String(request.number), flag]
      if (request.body?.trim()) args.push('--body-file', '-')
      result = await runGh(cwd, args, { input: request.body?.trim() ? request.body : undefined })
      break
    }
    case 'update-branch':
      assertNumber(request.number)
      result = await runGh(cwd, ['pr', 'update-branch', String(request.number)])
      break
    case 'thread': {
      if (!THREAD_ID.test(request.threadId)) throw new Error('Invalid review thread id.')
      const mutation = request.resolved ? 'resolveReviewThread' : 'unresolveReviewThread'
      result = await runGh(cwd, ['api', 'graphql', '-f', `query=mutation($id:ID!){${mutation}(input:{threadId:$id}){thread{id}}}`, '-f', `id=${request.threadId}`])
      break
    }
    case 'edit': {
      assertNumber(request.number)
      const args = ['pr', 'edit', String(request.number)]
      const add = (flag: string, values: string[] | undefined, what: string) => { for (const value of values ?? []) args.push(flag, flagValue(value, what)) }
      add('--add-reviewer', request.addReviewers, 'reviewer'); add('--remove-reviewer', request.removeReviewers, 'reviewer')
      add('--add-label', request.addLabels, 'label'); add('--remove-label', request.removeLabels, 'label')
      add('--add-assignee', request.addAssignees, 'assignee'); add('--remove-assignee', request.removeAssignees, 'assignee')
      if (args.length === 3) throw new Error('Nothing to edit.')
      result = await runGh(cwd, args)
      break
    }
  }
  if (result.code !== 0) throw ghFailure(result, `Pull request ${request.action} failed.`)
  // Everything keyed to this checkout is now suspect: lists, inbox, runs for the new head.
  invalidateGithubCache(cwd)
  return { url: result.stdout.split('\n').find(line => line.startsWith('https://')) ?? '' }
}
