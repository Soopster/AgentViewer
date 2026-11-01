import { NextRequest, NextResponse } from 'next/server'
import { actOnGithubRun, fetchGithubRun, fetchGithubRunFailedLog, fetchGithubRuns } from '@/lib/github/actions'
import { readGithubCwd } from '@/lib/github/cwd'
import type { GithubRunAction } from '@/lib/github/types'

const ACTIONS = new Set<GithubRunAction>(['rerun-failed', 'rerun-all', 'cancel'])

/** GET ?cwd[&branch|&all=1] → runs; ?cwd&id → one run with jobs; ?cwd&id&log=1 → failed-step log. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const cwd = readGithubCwd(params.get('cwd'))
  if (!cwd) return NextResponse.json({ error: 'Invalid working directory.' }, { status: 400 })
  try {
    const id = params.get('id')
    if (id && params.get('log')) return NextResponse.json({ log: await fetchGithubRunFailedLog(cwd, Number(id)) })
    if (id) return NextResponse.json({ run: await fetchGithubRun(cwd, Number(id)) })
    return NextResponse.json(await fetchGithubRuns(cwd, { branch: params.get('branch') ?? undefined, all: params.get('all') === '1' }))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

/** POST { cwd, id, action } — rerun or cancel. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { cwd?: unknown; id?: unknown; action?: unknown }
  const cwd = readGithubCwd(body.cwd)
  if (!cwd || typeof body.id !== 'number' || !ACTIONS.has(body.action as GithubRunAction)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  try {
    await actOnGithubRun(cwd, body.id, body.action as GithubRunAction)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
