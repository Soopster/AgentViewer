'use client'
// The strip's readings the web has to fetch: Claude plan windows and the linked
// pull request. Each is asked for only while the view shows it.
import { useEffect, useState } from 'react'
import { githubRepoArgument } from '@/lib/github/links'
import { stripLimitEntries, stripPrEntry, type StripStatEntry } from '@/lib/sessionStripStats'
import type { ClaudePlanLimits } from '@/lib/claudePlanLimits'
import type { GithubPrDetail } from '@/lib/github/types'
import type { Session } from '@/lib/types'

const LIMITS_POLL_MS = 60_000
const PR_POLL_MS = 120_000

function usePolled<T>(url: string | null, everyMs: number): T | null {
  const [read, setRead] = useState<{ url: string; value: T } | null>(null)
  useEffect(() => {
    if (!url) return
    let live = true
    const load = () => {
      if (document.visibilityState === 'hidden') return
      void fetch(url).then(async (response) => {
        if (response.ok && live) setRead({ url, value: await response.json() as T })
      }).catch(() => { /* the last reading stays */ })
    }
    load()
    const timer = setInterval(load, everyMs)
    return () => { live = false; clearInterval(timer) }
  }, [url, everyMs])
  // Another session's reading is never shown under this one.
  return read && read.url === url ? read.value : null
}

export function useStripReadings(session: Session | null | undefined, wants: { limits: boolean; pr: boolean }): StripStatEntry[] {
  const claude = wants.limits && session?.provider === 'claude' && !session.isPending
  const limits = usePolled<{ limits: ClaudePlanLimits | null }>(claude
    ? `/api/sessions/${encodeURIComponent(session.sessionId)}/plan-limits?providerInstanceId=${encodeURIComponent(session.providerInstanceId ?? 'default')}`
    : null, LIMITS_POLL_MS)
  const linked = wants.pr ? session?.inbox?.linkedPr : undefined
  const cwd = linked?.cwd ?? session?.cwd
  const pr = usePolled<{ pr: GithubPrDetail }>(linked && cwd
    ? `/api/github/prs?cwd=${encodeURIComponent(cwd)}&number=${linked.number}&repo=${encodeURIComponent(githubRepoArgument(linked.url, linked.repo))}`
    : null, PR_POLL_MS)
  return [...stripLimitEntries(limits?.limits?.windows ?? []), ...(pr?.pr ? [stripPrEntry(pr.pr)] : [])]
}
