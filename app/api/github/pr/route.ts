import { NextRequest, NextResponse } from 'next/server'
import { fetchPullRequestWorkspace, mutatePullRequest, type PullRequestMutation } from '@/lib/githubPr'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string; number?: number; mutation?: PullRequestMutation }
    if (!body.cwd || typeof body.cwd !== 'string') return NextResponse.json({ error: 'Invalid working directory.' }, { status: 400 })
    if (body.mutation) {
      if (body.mutation.number < 1) return NextResponse.json({ error: 'Invalid PR mutation.' }, { status: 400 })
      const current = await fetchPullRequestWorkspace(body.cwd, body.mutation.number)
      if (!current.repo || current.selected?.number !== body.mutation.number) {
        return NextResponse.json({ error: 'Pull request was not found in the active repository.' }, { status: 404 })
      }
      await mutatePullRequest(body.cwd, current.repo, body.mutation)
    }
    return NextResponse.json({ workspace: await fetchPullRequestWorkspace(body.cwd, body.number ?? body.mutation?.number) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
