import { NextRequest, NextResponse } from 'next/server'
import { fetchGithubIssue, fetchGithubIssues, mutateGithubIssue } from '@/lib/github/issues'
import { readGithubCwd } from '@/lib/github/cwd'
import type { GithubIssueFilters, GithubIssueMutation } from '@/lib/github/types'

const STATES = new Set(['open', 'closed', 'all'])

/** GET ?cwd&number → one issue with its thread; GET ?cwd[&state&label&assignee&search&limit] → the list. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const cwd = readGithubCwd(params.get('cwd'))
  if (!cwd) return NextResponse.json({ error: 'Invalid working directory.' }, { status: 400 })
  try {
    const number = params.get('number')
    if (number) return NextResponse.json({ issue: await fetchGithubIssue(cwd, Number(number)) })
    const state = params.get('state') ?? undefined
    if (state && !STATES.has(state)) return NextResponse.json({ error: 'Invalid state.' }, { status: 400 })
    const filters: GithubIssueFilters = {
      state: state as GithubIssueFilters['state'],
      label: params.get('label') ?? undefined,
      assignee: params.get('assignee') ?? undefined,
      search: params.get('search') ?? undefined,
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    }
    return NextResponse.json({ issues: await fetchGithubIssues(cwd, filters) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

/** POST { cwd, mutation } → { url }. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { cwd?: unknown; mutation?: GithubIssueMutation }
  const cwd = readGithubCwd(body.cwd)
  if (!cwd || !body.mutation || typeof body.mutation.action !== 'string') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  try {
    return NextResponse.json({ url: await mutateGithubIssue(cwd, body.mutation) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
