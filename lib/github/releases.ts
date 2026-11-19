import { cachedGithubRead, githubCacheKey, invalidateGithubCache } from './cache'
import { flagValue, ghFailure, parseJson, runGh } from './ghRunner'
import { scrubGithubText } from './text'
import type { GithubRelease, GithubReleaseCreate, GithubReleaseDetail } from './types'

export const RELEASES_TTL_MS = 60_000
const LIST_FIELDS = 'tagName,name,isDraft,isPrerelease,isLatest,publishedAt'
const VIEW_FIELDS = 'tagName,name,isDraft,isPrerelease,publishedAt,body,author,assets,url'

export function toRelease(raw: Record<string, unknown>): GithubRelease {
  return {
    tag: scrubGithubText(raw.tagName),
    name: scrubGithubText(raw.name) || scrubGithubText(raw.tagName),
    isDraft: Boolean(raw.isDraft),
    isPrerelease: Boolean(raw.isPrerelease),
    isLatest: Boolean(raw.isLatest),
    publishedAt: String(raw.publishedAt ?? ''),
    url: String(raw.url ?? ''),
  }
}

export function fetchGithubReleases(cwd: string): Promise<GithubRelease[]> {
  return cachedGithubRead(githubCacheKey(cwd, 'releases', 'list'), RELEASES_TTL_MS, async () => {
    const result = await runGh(cwd, ['release', 'list', '--limit', '30', '--json', LIST_FIELDS])
    if (result.code !== 0) throw ghFailure(result, 'Unable to list releases.')
    return parseJson<Array<Record<string, unknown>>>(result.stdout, []).map(toRelease)
  })
}

export function fetchGithubRelease(cwd: string, tag: string): Promise<GithubReleaseDetail> {
  let safe: string
  try { safe = flagValue(tag, 'tag') } catch (error) { return Promise.reject(error) }
  return cachedGithubRead(githubCacheKey(cwd, 'releases', 'view', safe), RELEASES_TTL_MS, async () => {
    const result = await runGh(cwd, ['release', 'view', safe, '--json', VIEW_FIELDS])
    if (result.code !== 0) throw ghFailure(result, `Unable to read release ${safe}.`)
    const raw = parseJson<Record<string, unknown>>(result.stdout, {})
    const assets = Array.isArray(raw.assets) ? raw.assets as Array<Record<string, unknown>> : []
    return {
      ...toRelease(raw),
      body: scrubGithubText(raw.body),
      author: scrubGithubText((raw.author as { login?: unknown } | null)?.login),
      assets: assets.map(asset => ({ name: scrubGithubText(asset.name), size: Number(asset.size ?? 0), downloads: Number(asset.downloadCount ?? 0) })),
    }
  })
}

/** Creates a release (and its tag when it does not exist). Returns the release URL. */
export async function createGithubRelease(cwd: string, request: GithubReleaseCreate): Promise<string> {
  const args = ['release', 'create', flagValue(request.tag, 'tag')]
  if (request.title?.trim()) args.push('--title', request.title.trim())
  if (request.target) args.push('--target', flagValue(request.target, 'target'))
  if (request.draft) args.push('--draft')
  if (request.prerelease) args.push('--prerelease')
  // Notes the author wrote win; otherwise ask GitHub to generate them from merged PRs.
  const notes = request.notes?.trim()
  if (notes) args.push('--notes-file', '-')
  else if (request.generateNotes !== false) args.push('--generate-notes')
  const result = await runGh(cwd, args, { input: notes ?? undefined })
  if (result.code !== 0) throw ghFailure(result, 'Release creation failed.')
  invalidateGithubCache(cwd, 'releases')
  invalidateGithubCache(cwd, 'repo')
  return result.stdout.split('\n').find(line => line.startsWith('https://')) ?? ''
}
