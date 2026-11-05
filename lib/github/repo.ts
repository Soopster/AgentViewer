// Repository overview: what the project is, where you are in it, recent
// commits, branches, labels and who you can assign. One cached read, six `gh`
// calls in parallel — the header of the GitHub view.
import { execFile } from 'node:child_process'
import { cachedGithubRead, githubCacheKey } from './cache'
import { ghFailure, parseJson, runGh } from './ghRunner'
import { scrubGithubText } from './text'
import type { GithubBranch, GithubCommit, GithubLabel, GithubRepoOverview } from './types'

export const REPO_TTL_MS = 60_000

function currentBranch(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' }, (error, stdout) => resolve(error ? '' : String(stdout).trim()))
  })
}

export function toBranch(raw: Record<string, unknown>): GithubBranch {
  return { name: scrubGithubText(raw.name), protected: Boolean(raw.protected), sha: String((raw.commit as { sha?: unknown } | null)?.sha ?? '').slice(0, 7) }
}

export function toCommit(raw: Record<string, unknown>): GithubCommit {
  const commit = raw.commit as { message?: unknown; author?: { name?: unknown; date?: unknown } } | null
  return {
    sha: String(raw.sha ?? '').slice(0, 7),
    message: scrubGithubText(String(commit?.message ?? '').split('\n')[0]),
    author: scrubGithubText((raw.author as { login?: unknown } | null)?.login ?? commit?.author?.name ?? 'unknown'),
    date: String(commit?.author?.date ?? ''),
    url: String(raw.html_url ?? ''),
  }
}

async function readOverview(cwd: string): Promise<GithubRepoOverview> {
  const view = await runGh(cwd, ['repo', 'view', '--json', 'nameWithOwner,description,url,defaultBranchRef,visibility,isFork,stargazerCount,forkCount,issues,pullRequests,primaryLanguage,licenseInfo,pushedAt'])
  if (view.code !== 0) throw ghFailure(view, 'Unable to read the repository.')
  const raw = parseJson<Record<string, unknown>>(view.stdout, {})
  const repo = String(raw.nameWithOwner ?? '')
  const [branches, commits, labels, collaborators, branch] = await Promise.all([
    runGh(cwd, ['api', `repos/${repo}/branches?per_page=30`]),
    runGh(cwd, ['api', `repos/${repo}/commits?per_page=15`]),
    runGh(cwd, ['label', 'list', '--limit', '100', '--json', 'name,color,description']),
    runGh(cwd, ['api', `repos/${repo}/assignees?per_page=50`, '--jq', '[.[].login]']),
    currentBranch(cwd),
  ])
  const count = (value: unknown) => Number((value as { totalCount?: unknown } | null)?.totalCount ?? 0)
  return {
    repo,
    description: scrubGithubText(raw.description),
    url: String(raw.url ?? ''),
    defaultBranch: scrubGithubText((raw.defaultBranchRef as { name?: unknown } | null)?.name),
    visibility: String(raw.visibility ?? '').toLowerCase(),
    isFork: Boolean(raw.isFork),
    stars: Number(raw.stargazerCount ?? 0),
    forks: Number(raw.forkCount ?? 0),
    openIssues: count(raw.issues),
    openPullRequests: count(raw.pullRequests),
    language: scrubGithubText((raw.primaryLanguage as { name?: unknown } | null)?.name),
    license: scrubGithubText((raw.licenseInfo as { name?: unknown } | null)?.name),
    pushedAt: String(raw.pushedAt ?? ''),
    currentBranch: branch,
    branches: parseJson<Array<Record<string, unknown>>>(branches.stdout, []).map(toBranch),
    commits: parseJson<Array<Record<string, unknown>>>(commits.stdout, []).map(toCommit),
    labels: parseJson<Array<Record<string, unknown>>>(labels.stdout, []).map((entry): GithubLabel => ({ name: scrubGithubText(entry.name), color: String(entry.color ?? ''), description: scrubGithubText(entry.description) })),
    collaborators: parseJson<string[]>(collaborators.stdout, []).map(scrubGithubText),
  }
}

export function fetchGithubRepoOverview(cwd: string): Promise<GithubRepoOverview> {
  return cachedGithubRead(githubCacheKey(cwd, 'repo'), REPO_TTL_MS, () => readOverview(cwd))
}
