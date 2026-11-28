// An agent that is not one of our SDK providers says what it is doing
// (herdr's `pane report-agent`): a hook in Cursor, Amp or a script calls
// `agent-viewer session report --state working|blocked|idle`.
//
// A report is a claim with a lifetime. `seq` orders a source's reports so a slow
// one cannot overwrite a newer one, and `ttlMs` makes it lapse: an agent that
// died mid-"working" must not read as working forever.

export type ReportedState = 'working' | 'blocked' | 'idle'
export type SessionReport = {
  source: string
  sessionId: string | null
  state: ReportedState
  seq: number
  reportedAt: number
  expiresAt: number
}

export const DEFAULT_REPORT_TTL_MS = 10 * 60 * 1000
const MAX_REPORT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_REPORTS = 200

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerSessionReports: Map<string, SessionReport> | undefined
}
const reports = () => (globalThis.__agentViewerSessionReports ??= new Map())

export const isReportedState = (value: unknown): value is ReportedState =>
  value === 'working' || value === 'blocked' || value === 'idle'

function prune(now: number): void {
  const store = reports()
  for (const [source, report] of store) if (report.expiresAt <= now) store.delete(source)
  while (store.size > MAX_REPORTS) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

/** Returns the stored report, or null when an equal-or-newer `seq` from this source already holds. */
export function recordSessionReport(input: {
  source: string
  state: ReportedState
  sessionId?: string | null
  seq?: number
  ttlMs?: number
}, now = Date.now()): SessionReport | null {
  const source = input.source.trim().slice(0, 120)
  if (!source) throw new Error('source is required')
  prune(now)
  const previous = reports().get(source)
  const seq = Number.isSafeInteger(input.seq) ? input.seq as number : (previous?.seq ?? 0) + 1
  if (previous && seq <= previous.seq) return null
  const ttl = Math.min(Math.max(input.ttlMs ?? DEFAULT_REPORT_TTL_MS, 1000), MAX_REPORT_TTL_MS)
  const report: SessionReport = {
    source, sessionId: input.sessionId?.trim() || null, state: input.state, seq, reportedAt: now, expiresAt: now + ttl,
  }
  reports().delete(source)
  reports().set(source, report)
  return report
}

export function listSessionReports(sessionId?: string, now = Date.now()): SessionReport[] {
  prune(now)
  return [...reports().values()].filter((report) => !sessionId || report.sessionId === sessionId)
    .sort((a, b) => b.reportedAt - a.reportedAt)
}

export function clearSessionReport(source: string): boolean {
  return reports().delete(source)
}
