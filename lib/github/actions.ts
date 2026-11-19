// CI: workflow runs for a branch, their jobs, the failing step's log, and
// rerun/cancel. Runs change while a person watches, so the list is cached for
// 10s when anything is in progress and 60s when everything has settled.
import { execFile } from 'node:child_process'
import { cachedGithubRead, githubCacheKey, invalidateGithubCache } from './cache'
import { flagValue, ghFailure, parseJson, runGh, type GhResult } from './ghRunner'
import { scrubGithubText, tailText } from './text'
import type { GithubRun, GithubRunAction, GithubRunDetail, GithubRunJob, GithubRunLog } from './types'

export const RUNS_ACTIVE_TTL_MS = 10_000
export const RUNS_SETTLED_TTL_MS = 60_000
export const RUN_LOG_MAX_CHARS = 200_000
const RUN_LIMIT = 20
const RUN_FIELDS = 'databaseId,displayTitle,workflowName,headBranch,event,status,conclusion,url,createdAt,updatedAt'

export function toRun(raw: Record<string, unknown>): GithubRun {
  return {
    id: Number(raw.databaseId ?? 0),
    title: scrubGithubText(raw.displayTitle),
    workflow: scrubGithubText(raw.workflowName),
    branch: scrubGithubText(raw.headBranch),
    event: String(raw.event ?? ''),
    status: String(raw.status ?? ''),
    conclusion: String(raw.conclusion ?? ''),
    url: String(raw.url ?? ''),
    createdAt: String(raw.createdAt ?? ''),
    updatedAt: String(raw.updatedAt ?? ''),
  }
}

function toJob(raw: Record<string, unknown>): GithubRunJob {
  const steps = Array.isArray(raw.steps) ? raw.steps as Array<Record<string, unknown>> : []
  return {
    id: Number(raw.databaseId ?? 0),
    name: scrubGithubText(raw.name),
    status: String(raw.status ?? ''),
    conclusion: String(raw.conclusion ?? ''),
    url: String(raw.url ?? ''),
    steps: steps.map(step => ({ name: scrubGithubText(step.name), status: String(step.status ?? ''), conclusion: String(step.conclusion ?? '') })),
  }
}

function currentBranch(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' }, (error, stdout) => {
      const branch = String(stdout ?? '').trim()
      resolve(error || branch === 'HEAD' ? '' : branch)
    })
  })
}

/** An empty `branch` means the checked-out one; `all` lists the repository's latest runs. */
export async function fetchGithubRuns(cwd: string, options: { branch?: string; all?: boolean } = {}): Promise<{ branch: string; runs: GithubRun[] }> {
  const branch = options.all ? '' : (options.branch ?? await currentBranch(cwd))
  if (branch.startsWith('-')) throw new Error('Invalid branch.')
  const key = githubCacheKey(cwd, 'runs', 'list', branch)
  const read = async () => {
    const args = ['run', 'list', '--limit', String(RUN_LIMIT), '--json', RUN_FIELDS]
    if (branch) args.push('--branch', branch)
    const result = await runGh(cwd, args)
    if (result.code !== 0) throw ghFailure(result, 'Unable to list workflow runs.')
    return { branch, runs: parseJson<Array<Record<string, unknown>>>(result.stdout, []).map(toRun) }
  }
  // The TTL depends on the answer, so a settled list is served from cache and an active one re-read soon.
  const settled = await cachedGithubRead(key, RUNS_ACTIVE_TTL_MS, read)
  if (settled.runs.some(run => run.status !== 'completed')) return settled
  return cachedGithubRead(githubCacheKey(cwd, 'runs', 'settled', branch), RUNS_SETTLED_TTL_MS, async () => settled)
}

function assertRunId(id: number): void {
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid run id.')
}

export function fetchGithubRun(cwd: string, id: number): Promise<GithubRunDetail> {
  try { assertRunId(id) } catch (error) { return Promise.reject(error) }
  return cachedGithubRead(githubCacheKey(cwd, 'runs', 'view', id), RUNS_ACTIVE_TTL_MS, async () => {
    const result = await runGh(cwd, ['run', 'view', String(id), '--json', `${RUN_FIELDS},jobs`])
    if (result.code !== 0) throw ghFailure(result, `Unable to read run ${id}.`)
    const raw = parseJson<Record<string, unknown>>(result.stdout, {})
    const jobs = Array.isArray(raw.jobs) ? raw.jobs as Array<Record<string, unknown>> : []
    return { ...toRun({ ...raw, databaseId: raw.databaseId ?? id }), jobs: jobs.map(toJob) }
  })
}

/** The log of the steps that failed, tail-capped: the cause is nearly always at the end. */
export async function fetchGithubRunFailedLog(cwd: string, id: number): Promise<GithubRunLog> {
  assertRunId(id)
  const result = await runGh(cwd, ['run', 'view', String(id), '--log-failed'], { maxBuffer: 50 * 1024 * 1024, timeoutMs: 60_000 })
  if (result.code !== 0) throw ghFailure(result, `No failed-step log for run ${id}.`)
  return tailText(scrubGithubText(result.stdout), RUN_LOG_MAX_CHARS)
}

export async function actOnGithubRun(cwd: string, id: number, action: GithubRunAction): Promise<void> {
  assertRunId(id)
  const args = action === 'cancel' ? ['run', 'cancel', String(id)]
    : action === 'rerun-failed' ? ['run', 'rerun', String(id), '--failed']
    : action === 'rerun-all' ? ['run', 'rerun', String(id)]
    : null
  if (!args) throw new Error('Unknown run action.')
  const result = await runGh(cwd, args)
  if (result.code !== 0) throw ghFailure(result, `Run ${action} failed.`)
  invalidateGithubCache(cwd, 'runs')
}
