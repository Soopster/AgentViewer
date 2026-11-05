import { NextRequest, NextResponse } from 'next/server'
import { readGithubCwd } from '@/lib/github/cwd'
import { draftPullRequestBody, runGithubPrAction } from '@/lib/github/prActions'
import type { GithubPrAction } from '@/lib/github/types'

/** GET ?cwd[&base] → { body }: a suggested description from the commits the PR would carry. */
export async function GET(request: NextRequest) {
  const cwd = readGithubCwd(request.nextUrl.searchParams.get('cwd'))
  if (!cwd) return NextResponse.json({ error: 'Invalid working directory.' }, { status: 400 })
  try {
    return NextResponse.json({ body: await draftPullRequestBody(cwd, request.nextUrl.searchParams.get('base') ?? undefined) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

/** POST { cwd, request: GithubPrAction } → { url }. Merge re-checks readiness server-side. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { cwd?: unknown; request?: GithubPrAction }
  const cwd = readGithubCwd(body.cwd)
  if (!cwd || !body.request || typeof body.request.action !== 'string') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  try {
    return NextResponse.json(await runGithubPrAction(cwd, body.request))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
