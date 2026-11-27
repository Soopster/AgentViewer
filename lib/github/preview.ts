// Reads behind a link in the transcript: which repository this checkout is, and
// what a pull request or issue URL points at (for hover previews and the state
// icon on a link). `gh` takes the URL itself, so a link into a repository that
// is not checked out reads the same way.
import { execFile } from 'node:child_process'
import { cachedGithubRead, githubCacheKey } from './cache'
import { ghFailure, parseJson, runGh } from './ghRunner'
import { parseGithubUrl, repoFromRemoteUrl } from './links'
import { rollupState } from './prs'
import { scrubGithubText } from './text'
import type { GithubLinkPreview, GithubRepoRef } from './types'

const PREVIEW_TTL_MS = 60_000
const REPO_TTL_MS = 5 * 60_000
const PR_FIELDS = 'number,title,state,isDraft,url,author,createdAt,additions,deletions,headRefName,baseRefName,reviewDecision,statusCheckRollup'
const ISSUE_FIELDS = 'number,title,state,url,author,createdAt'

/** The checkout's GitHub repository from its `origin` remote, without a network call. */
export function readCheckoutRepo(cwd: string): Promise<GithubRepoRef | null> {
  return cachedGithubRead(githubCacheKey(cwd, 'checkout-repo'), REPO_TTL_MS, () => new Promise(resolve => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : repoFromRemoteUrl(String(stdout)))
    })
  }))
}

export function toLinkPreview(kind: 'pr' | 'issue', repo: string, raw: Record<string, unknown>): GithubLinkPreview {
  return {
    kind, repo,
    number: Number(raw.number ?? 0),
    title: scrubGithubText(raw.title),
    state: String(raw.state ?? ''),
    isDraft: Boolean(raw.isDraft),
    url: String(raw.url ?? ''),
    author: scrubGithubText((raw.author as { login?: unknown } | null)?.login ?? 'unknown'),
    createdAt: String(raw.createdAt ?? ''),
    ...(kind === 'pr' ? {
      additions: Number(raw.additions ?? 0), deletions: Number(raw.deletions ?? 0),
      headRefName: scrubGithubText(raw.headRefName), baseRefName: scrubGithubText(raw.baseRefName),
      reviewDecision: String(raw.reviewDecision ?? ''), checks: rollupState(raw.statusCheckRollup),
    } : {}),
  }
}

export function fetchGithubLinkPreview(cwd: string, url: string): Promise<GithubLinkPreview> {
  const link = parseGithubUrl(url)
  if (!link || (link.kind !== 'pr' && link.kind !== 'issue')) return Promise.reject(new Error('Not a pull request or issue URL.'))
  const kind = link.kind
  // Rebuilt from the parsed parts, so only a well-formed URL ever reaches argv.
  const canonical = `https://${link.host}/${link.repo}/${kind === 'pr' ? 'pull' : 'issues'}/${link.number}`
  return cachedGithubRead(githubCacheKey(cwd, 'prs', 'preview', canonical), PREVIEW_TTL_MS, async () => {
    const result = await runGh(cwd, [kind, 'view', canonical, '--json', kind === 'pr' ? PR_FIELDS : ISSUE_FIELDS])
    if (result.code !== 0) throw ghFailure(result, `Unable to read ${link.repo}#${link.number}.`)
    return toLinkPreview(kind, link.repo, parseJson<Record<string, unknown>>(result.stdout, {}))
  })
}
