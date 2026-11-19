// "What needs me": PRs awaiting my review, my own PRs, issues/PRs assigned to
// me, and unread participating notifications. One `gh search` per section, run
// in parallel and cached briefly (lib/github/cache.ts).
import { cachedGithubRead, githubCacheKey, invalidateGithubCache } from './cache'
import { classifyGhFailure, ghFailure, ghUnavailableMessage, parseJson, runGh, type GhResult } from './ghRunner'
import { scrubGithubText } from './text'
import type {
  GithubAvailability, GithubInbox, GithubInboxItem, GithubInboxSection, GithubInboxSectionId, GithubNotification,
} from './types'

export const INBOX_TTL_MS = 30_000
const SEARCH_LIMIT = 30
const SEARCH_FIELDS = 'number,title,url,state,isDraft,author,updatedAt,labels,repository'

const SECTIONS: Array<{ id: GithubInboxSectionId; title: string; kind: 'prs' | 'issues'; qualifier: string }> = [
  { id: 'review-requested', title: 'Review requested', kind: 'prs', qualifier: 'review-requested:@me' },
  { id: 'my-prs', title: 'My pull requests', kind: 'prs', qualifier: 'author:@me' },
  { id: 'assigned', title: 'Assigned to me', kind: 'issues', qualifier: 'assignee:@me' },
  { id: 'mentioned', title: 'Mentions', kind: 'issues', qualifier: 'mentions:@me' },
]

export function toInboxItem(raw: Record<string, unknown>, kind: 'pr' | 'issue'): GithubInboxItem {
  const repository = raw.repository as { nameWithOwner?: unknown } | null
  const labels = Array.isArray(raw.labels) ? raw.labels as Array<{ name?: unknown }> : []
  return {
    kind,
    repo: scrubGithubText(repository?.nameWithOwner),
    number: Number(raw.number ?? 0),
    title: scrubGithubText(raw.title),
    url: String(raw.url ?? ''),
    state: String(raw.state ?? ''),
    isDraft: Boolean(raw.isDraft),
    author: scrubGithubText((raw.author as { login?: unknown } | null)?.login ?? 'unknown'),
    updatedAt: String(raw.updatedAt ?? ''),
    labels: labels.map(label => scrubGithubText(label.name)).filter(Boolean),
  }
}

export function toNotification(raw: Record<string, unknown>): GithubNotification {
  const subject = raw.subject as { title?: unknown; type?: unknown; url?: unknown } | null
  const repo = raw.repository as { full_name?: unknown } | null
  return {
    id: String(raw.id ?? ''),
    reason: String(raw.reason ?? ''),
    repo: scrubGithubText(repo?.full_name),
    title: scrubGithubText(subject?.title),
    type: String(subject?.type ?? ''),
    // The API URL is not browsable; the view maps it to the web URL.
    url: String(subject?.url ?? '').replace('https://api.github.com/repos/', 'https://github.com/').replace('/pulls/', '/pull/'),
    updatedAt: String(raw.updated_at ?? ''),
  }
}

export async function readGithubAvailability(cwd: string): Promise<GithubAvailability> {
  const auth = await runGh(cwd, ['auth', 'status'])
  if (auth.code !== 0) {
    const reason = classifyGhFailure(auth) ?? (/not found/i.test(auth.stderr) ? 'missing' : 'unauthenticated')
    return { ok: false, reason, message: ghUnavailableMessage(reason) }
  }
  const [repo, viewer] = await Promise.all([
    runGh(cwd, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']),
    runGh(cwd, ['api', 'user', '--jq', '.login']),
  ])
  return { ok: true, repo: repo.code === 0 ? repo.stdout || null : null, viewer: viewer.code === 0 ? viewer.stdout || null : null }
}

async function searchSection(cwd: string, spec: (typeof SECTIONS)[number], repo: string | null): Promise<GhResult> {
  const args = ['search', spec.kind, spec.qualifier, '--state', 'open', '--limit', String(SEARCH_LIMIT), '--sort', 'updated', '--json', SEARCH_FIELDS]
  // Scope to this repository when there is one; the account-wide view is the TUI's `A` toggle later.
  if (repo) args.push('--repo', repo)
  return runGh(cwd, args)
}

async function readInbox(cwd: string): Promise<GithubInbox> {
  const availability = await readGithubAvailability(cwd)
  if (!availability.ok) return { availability, sections: [], notifications: [] }
  const [results, notifications] = await Promise.all([
    Promise.all(SECTIONS.map(spec => searchSection(cwd, spec, availability.repo))),
    runGh(cwd, ['api', 'notifications?participating=true&per_page=30']),
  ])
  const sections: GithubInboxSection[] = SECTIONS.map((spec, index) => ({
    id: spec.id,
    title: spec.title,
    items: parseJson<Array<Record<string, unknown>>>(results[index].stdout, []).map(raw => toInboxItem(raw, spec.kind === 'prs' ? 'pr' : 'issue')),
  }))
  // "Mentions" and "Assigned" overlap with the sections above; a PR shows once, in the first section that has it.
  const seen = new Set<string>()
  for (const section of sections) {
    section.items = section.items.filter((item) => {
      const key = `${item.repo}#${item.number}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  return {
    availability,
    sections,
    notifications: parseJson<Array<Record<string, unknown>>>(notifications.stdout, []).map(toNotification),
  }
}

export function fetchGithubInbox(cwd: string): Promise<GithubInbox> {
  return cachedGithubRead(githubCacheKey(cwd, 'inbox'), INBOX_TTL_MS, () => readInbox(cwd))
}

const THREAD_ID = /^\d{1,20}$/

/** Marks one notification thread read (the web "Done" on a single row). */
export async function markGithubNotificationRead(cwd: string, id: string): Promise<void> {
  if (!THREAD_ID.test(id)) throw new Error('Invalid notification id.')
  const result = await runGh(cwd, ['api', '-X', 'PATCH', `notifications/threads/${id}`])
  if (result.code !== 0) throw ghFailure(result, 'Unable to mark the notification read.')
  invalidateGithubCache(cwd, 'inbox')
}

export async function markAllGithubNotificationsRead(cwd: string): Promise<void> {
  const result = await runGh(cwd, ['api', '-X', 'PUT', 'notifications', '-F', 'read=true'])
  if (result.code !== 0) throw ghFailure(result, 'Unable to mark notifications read.')
  invalidateGithubCache(cwd, 'inbox')
}
