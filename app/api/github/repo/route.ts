import { NextRequest, NextResponse } from 'next/server'
import { githubError, readGithubCwd } from '@/lib/github/cwd'
import { fetchGithubRepoOverview } from '@/lib/github/repo'

/** GET ?cwd → GithubRepoOverview (repo facts, branches, recent commits, labels, assignable users). */
export async function GET(request: NextRequest) {
  const cwd = readGithubCwd(request.nextUrl.searchParams.get('cwd'))
  if (!cwd) return NextResponse.json({ error: 'Invalid working directory.' }, { status: 400 })
  try { return NextResponse.json({ repo: await fetchGithubRepoOverview(cwd) }) } catch (error) { return githubError(error) }
}
