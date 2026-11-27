// Recognising GitHub web URLs in transcript text. No Node imports: both views
// and the terminal formatter use it. A doubtful match is worse than no match —
// anything unrecognised stays an ordinary link.

export type GithubLinkKind = 'pr' | 'issue' | 'commit' | 'run' | 'release' | 'compare' | 'new-pr'

export type GithubLink = {
  kind: GithubLinkKind
  host: string
  /** owner/name, as written. */
  repo: string
  number?: number
  sha?: string
  runId?: string
  /** Tag, compare range or branch, for the kinds that name one. */
  ref?: string
  url: string
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/

/** github.com, a subdomain of it, or an Enterprise install named after it. */
function isGithubHost(host: string): boolean {
  return host === 'github.com' || host.endsWith('.github.com') || host.split('.').includes('github')
}

export function parseGithubUrl(value: string): GithubLink | null {
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  if (!isGithubHost(host) || host === 'api.github.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  const [owner, name, section, ...rest] = parts
  if (!owner || !name || !section || !SEGMENT.test(owner) || !SEGMENT.test(name)) return null
  const base = { host, repo: `${owner}/${name}`, url: value }
  const numbered = (kind: GithubLinkKind): GithubLink | null => {
    const number = Number(rest[0])
    return Number.isSafeInteger(number) && number > 0 ? { ...base, kind, number } : null
  }
  if (section === 'pull') {
    if (rest[0] === 'new' && rest.length > 1) return { ...base, kind: 'new-pr', ref: decodeSafe(rest.slice(1).join('/')) }
    return numbered('pr')
  }
  if (section === 'issues') return numbered('issue')
  if (section === 'commit' && /^[0-9a-f]{7,40}$/i.test(rest[0] ?? '')) return { ...base, kind: 'commit', sha: rest[0] }
  if (section === 'actions' && rest[0] === 'runs' && /^\d+$/.test(rest[1] ?? '')) return { ...base, kind: 'run', runId: rest[1] }
  if (section === 'releases' && rest[0] === 'tag' && rest[1]) return { ...base, kind: 'release', ref: decodeSafe(rest.slice(1).join('/')) }
  if (section === 'compare' && rest[0]) return { ...base, kind: 'compare', ref: decodeSafe(rest.join('/')) }
  return null
}

function decodeSafe(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]}]+/g

/** Every GitHub URL in a piece of text, in order, trailing punctuation removed. */
export function findGithubLinks(text: string): GithubLink[] {
  if (!text.includes('://')) return []
  const found: GithubLink[] = []
  for (const match of text.matchAll(URL_PATTERN)) {
    const link = parseGithubUrl(match[0].replace(/[.,;:!?]+$/, ''))
    if (link) found.push(link)
  }
  return found
}

/** The short name a link is shown as: `#12`, `owner/repo#12` for another repository, a short sha. */
export function githubLinkLabel(link: GithubLink, currentRepo?: string | null): string {
  const here = !!currentRepo && link.repo.toLowerCase() === currentRepo.toLowerCase()
  const prefix = here ? '' : link.repo
  switch (link.kind) {
    case 'pr':
    case 'issue': return `${prefix}#${link.number}`
    case 'commit': return `${prefix}${prefix ? '@' : ''}${link.sha!.slice(0, 7)}`
    case 'run': return `${prefix}${prefix ? ' ' : ''}run ${link.runId}`
    case 'release': return `${prefix}${prefix ? ' ' : ''}${link.ref}`
    case 'compare': return `${prefix}${prefix ? ' ' : ''}${link.ref}`
    case 'new-pr': return `${prefix}${prefix ? ' ' : ''}open PR for ${link.ref}`
  }
}

/** owner/name from a git remote URL (https or ssh form), or null for another host. */
export function repoFromRemoteUrl(remote: string): { host: string; repo: string } | null {
  const trimmed = remote.trim()
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)([^\s]+)$/.exec(trimmed)
  let host: string
  let pathname: string
  if (scp && !trimmed.includes('://')) {
    host = scp[1]!
    pathname = scp[2]!
  } else {
    try {
      const url = new URL(trimmed)
      host = url.hostname
      pathname = url.pathname
    } catch { return null }
  }
  host = host.toLowerCase().replace(/^ssh\./, '')
  if (!isGithubHost(host)) return null
  const parts = pathname.replace(/\.git\/?$/, '').split('/').filter(Boolean)
  return parts.length === 2 && parts.every(part => SEGMENT.test(part)) ? { host, repo: `${parts[0]}/${parts[1]}` } : null
}

const REPO_ARGUMENT = /^(?:[A-Za-z0-9.-]+\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** The `--repo` value naming a link's repository (`owner/name`, host-qualified off github.com). */
export function githubRepoArgument(url: string, fallback: string): string {
  const link = parseGithubUrl(url)
  return !link ? fallback : link.host === 'github.com' ? link.repo : `${link.host}/${link.repo}`
}

/** `--repo` args for a repository that may not be the checkout's; refuses anything that is not a repository name. */
export function githubRepoFlags(repo?: string): string[] {
  if (!repo) return []
  if (repo.startsWith('-') || !REPO_ARGUMENT.test(repo)) throw new Error('Invalid repository.')
  return ['--repo', repo]
}
