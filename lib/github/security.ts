// Security visibility: Dependabot, code-scanning and secret-scanning alerts.
// A repository with one of them off answers 403/404, which is reported as
// "unavailable" — never as "zero alerts", which would read as clean.
import { cachedGithubRead, githubCacheKey } from './cache'
import { ghFailure, isFeatureOff, parseJson, runGh } from './ghRunner'
import { fetchGithubRepoOverview } from './repo'
import { scrubGithubText } from './text'
import type { GithubAlert, GithubAlertKind, GithubSecurity } from './types'

export const SECURITY_TTL_MS = 5 * 60_000
const LIMIT = 50
const SEVERITY_ORDER = ['critical', 'high', 'error', 'medium', 'warning', 'moderate', 'low', 'note', 'unknown']

export function toDependabotAlert(raw: Record<string, unknown>): GithubAlert {
  const advisory = raw.security_advisory as { summary?: unknown; severity?: unknown } | null
  const dependency = raw.dependency as { package?: { name?: unknown; ecosystem?: unknown }; manifest_path?: unknown } | null
  return {
    kind: 'dependabot',
    number: Number(raw.number ?? 0),
    severity: String(advisory?.severity ?? 'unknown').toLowerCase(),
    title: scrubGithubText(advisory?.summary),
    detail: scrubGithubText(`${dependency?.package?.name ?? ''} (${dependency?.package?.ecosystem ?? ''}) in ${dependency?.manifest_path ?? ''}`),
    url: String(raw.html_url ?? ''),
    createdAt: String(raw.created_at ?? ''),
  }
}

export function toCodeScanningAlert(raw: Record<string, unknown>): GithubAlert {
  const rule = raw.rule as { description?: unknown; security_severity_level?: unknown; severity?: unknown } | null
  const location = (raw.most_recent_instance as { location?: { path?: unknown; start_line?: unknown } } | null)?.location
  return {
    kind: 'code-scanning',
    number: Number(raw.number ?? 0),
    severity: String(rule?.security_severity_level ?? rule?.severity ?? 'unknown').toLowerCase(),
    title: scrubGithubText(rule?.description),
    detail: scrubGithubText(location?.path ? `${location.path}:${location.start_line ?? ''}` : ''),
    url: String(raw.html_url ?? ''),
    createdAt: String(raw.created_at ?? ''),
  }
}

export function toSecretAlert(raw: Record<string, unknown>): GithubAlert {
  return {
    kind: 'secret-scanning',
    number: Number(raw.number ?? 0),
    severity: 'critical',
    title: scrubGithubText(raw.secret_type_display_name ?? raw.secret_type),
    // The secret value itself is never carried: it is a live credential.
    detail: '',
    url: String(raw.html_url ?? ''),
    createdAt: String(raw.created_at ?? ''),
  }
}

const SOURCES: Array<{ kind: GithubAlertKind; path: string; map: (raw: Record<string, unknown>) => GithubAlert }> = [
  { kind: 'dependabot', path: 'dependabot/alerts', map: toDependabotAlert },
  { kind: 'code-scanning', path: 'code-scanning/alerts', map: toCodeScanningAlert },
  { kind: 'secret-scanning', path: 'secret-scanning/alerts', map: toSecretAlert },
]

export function fetchGithubSecurity(cwd: string): Promise<GithubSecurity> {
  return cachedGithubRead(githubCacheKey(cwd, 'security'), SECURITY_TTL_MS, async () => {
    const { repo } = await fetchGithubRepoOverview(cwd)
    const results = await Promise.all(SOURCES.map(source => runGh(cwd, ['api', `repos/${repo}/${source.path}?state=open&per_page=${LIMIT}`])))
    const alerts: GithubAlert[] = []
    const unavailable: GithubAlertKind[] = []
    results.forEach((result, index) => {
      if (result.code !== 0) {
        if (isFeatureOff(result)) { unavailable.push(SOURCES[index].kind); return }
        throw ghFailure(result, 'Unable to read security alerts.')
      }
      for (const raw of parseJson<Array<Record<string, unknown>>>(result.stdout, [])) alerts.push(SOURCES[index].map(raw))
    })
    alerts.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.createdAt.localeCompare(a.createdAt))
    return { alerts, unavailable }
  })
}
