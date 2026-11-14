import { NextRequest, NextResponse } from 'next/server'
import { githubError, readGithubCwd } from '@/lib/github/cwd'
import { fetchGithubPr, fetchGithubPrs } from '@/lib/github/prs'
import type { GithubPrFilters } from '@/lib/github/types'

const STATES = new Set(['open', 'closed', 'merged', 'all'])
const SCOPES = new Set(['all', 'mine', 'review-requested', 'assigned'])

/** GET ?cwd&number → one PR's summary; GET ?cwd[&state&scope&search&limit] → the list. Mutations go through /api/github/pr-actions. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const cwd = readGithubCwd(params.get('cwd'))
  if (!cwd) return NextResponse.json({ error: 'Invalid working directory.' }, { status: 400 })
  try {
    const number = params.get('number')
    if (number) return NextResponse.json({ pr: await fetchGithubPr(cwd, Number(number)) })
    const state = params.get('state') ?? undefined
    const scope = params.get('scope') ?? undefined
    if ((state && !STATES.has(state)) || (scope && !SCOPES.has(scope))) return NextResponse.json({ error: 'Invalid filter.' }, { status: 400 })
    const filters: GithubPrFilters = {
      state: state as GithubPrFilters['state'], scope: scope as GithubPrFilters['scope'],
      search: params.get('search') ?? undefined, limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    }
    return NextResponse.json({ prs: await fetchGithubPrs(cwd, filters) })
  } catch (error) { return githubError(error) }
}
