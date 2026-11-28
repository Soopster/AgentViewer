import { NextRequest, NextResponse } from 'next/server'
import { githubError, readGithubCwd } from '@/lib/github/cwd'
import { findPrWatch, startPrWatch, stopPrWatch, type PrWatchTarget } from '@/lib/github/watchStore'
import { isAgentProvider } from '@/lib/provider'
import { providerInstanceIdFromRequest } from '@/lib/providerRequest'
import { resolveProviderInstance } from '@/lib/providerInstances'
import { ensureScheduleEngine } from '@/lib/schedules/engine'

async function readTarget(request: NextRequest, source: Record<string, unknown>): Promise<PrWatchTarget | null> {
  const provider = isAgentProvider(source.provider) ? source.provider : undefined
  if (!provider || typeof source.sessionId !== 'string' || !source.sessionId) return null
  const instance = await resolveProviderInstance(providerInstanceIdFromRequest(request, source), provider)
  return { provider, sessionId: source.sessionId, providerInstanceId: instance.id }
}

/** GET ?provider&sessionId → { watch } for a session, or null. */
export async function GET(request: NextRequest) {
  try {
    const target = await readTarget(request, Object.fromEntries(request.nextUrl.searchParams))
    if (!target) return NextResponse.json({ error: 'provider and sessionId are required' }, { status: 400 })
    ensureScheduleEngine()
    return NextResponse.json({ watch: findPrWatch(target) })
  } catch (error) { return githubError(error, 400) }
}

/** POST { provider, sessionId, watching, linkedPr? } — turning it on lets the daemon start turns on this session. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  try {
    const target = await readTarget(request, body)
    if (!target || typeof body.watching !== 'boolean') return NextResponse.json({ error: 'provider, sessionId and watching are required' }, { status: 400 })
    if (!body.watching) { stopPrWatch(target); return NextResponse.json({ watch: null }) }
    const pr = body.linkedPr as { repo?: unknown; number?: unknown; url?: unknown; cwd?: unknown } | undefined
    const cwd = readGithubCwd(pr?.cwd)
    const number = Number(pr?.number)
    if (!cwd || typeof pr?.repo !== 'string' || typeof pr.url !== 'string' || !Number.isSafeInteger(number) || number < 1) return NextResponse.json({ error: 'watching requires linkedPr { repo, number, url, cwd }' }, { status: 400 })
    ensureScheduleEngine()
    return NextResponse.json({ watch: startPrWatch(target, { repo: pr.repo, number, url: pr.url, cwd }, cwd) })
  } catch (error) { return githubError(error, 400) }
}
