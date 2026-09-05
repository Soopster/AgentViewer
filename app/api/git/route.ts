import { NextResponse, type NextRequest } from 'next/server'
import { fetchGitBranches, fetchGitData, fetchGitReviewData, fetchGitSummary, isAllowedGitCommand, isSafeGitBranchName, parseGitDiffSource } from '@/lib/gitProvider'
import { fetchSourceStatus, listGitTurns } from '@/lib/gitDiffSources'
import { runGitCommand, runGitCommandStrict } from '@/lib/gitNodeProvider'

type GitRequestBody = {
  cwd?: string
  args?: unknown
  action?: unknown
  branch?: unknown
}

/** The read half of the git surface: the panel's data and the review diff.
 *
 *  Split out of POST so it can be declared `read` in lib/routeScopes.ts. That
 *  table works per route and method, and the old shape put a pure read
 *  (`action: 'data'`) and a mutation escape hatch behind the same POST, with
 *  the action buried in the request body where no route-level rule can see it
 *  — so the whole route had to be `write`, and a read-only paired device lost
 *  the git panel. Both actions need nothing but `cwd`, so they fit a GET.
 *
 *  The compact composer summary is also a read and intentionally avoids the
 *  branch/commit lists loaded by the full panel data request. Pane content
 *  needs a GitData body, so it lives at
 *  /api/git/content instead. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const cwd = searchParams.get('cwd')
  const action = searchParams.get('action') ?? 'data'
  if (!cwd) return NextResponse.json({ error: 'invalid' }, { status: 400 })

  try {
    if (action === 'data') {
      const data = await fetchGitData(cwd, runGitCommand)
      // A non-working source replaces the file list only: branch, upstream and
      // the commit/branch panes describe the repository, not the change set.
      const source = parseGitDiffSource(searchParams.get('source'), searchParams.get('sha'))
      if (source.kind === 'working') return NextResponse.json({ data })
      return NextResponse.json({ data: { ...data, status: await fetchSourceStatus(cwd, runGitCommand, source) } })
    }
    if (action === 'turns') {
      return NextResponse.json(
        { turns: await listGitTurns(cwd, searchParams.get('sessionId')) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (action === 'review') {
      return NextResponse.json({ review: await fetchGitReviewData(cwd, runGitCommand) })
    }
    if (action === 'summary') {
      return NextResponse.json({ summary: await fetchGitSummary(cwd, runGitCommand) })
    }
    if (action === 'branches') {
      return NextResponse.json(
        { branches: await fetchGitBranches(cwd, runGitCommand) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return NextResponse.json({ error: 'action must be data, turns, review, summary, or branches' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

/** The raw command escape hatch.
 *
 *  Stays `write` even though the allowlist looks read-only: it includes
 *  `branch`, and `git branch <name>` / `git branch -D <name>` create and delete
 *  branches. Only the argv's first token is checked, so this cannot be treated
 *  as a read without narrowing the allowlist itself. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as GitRequestBody
    if (!body.cwd) return NextResponse.json({ error: 'invalid' }, { status: 400 })
    if (body.action === 'switch') {
      if (!isSafeGitBranchName(body.branch)) {
        return NextResponse.json({ error: 'Invalid local branch name' }, { status: 400 })
      }
      await runGitCommandStrict(body.cwd, ['switch', '--', body.branch])
      return NextResponse.json(
        { summary: await fetchGitSummary(body.cwd, runGitCommand) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (!isAllowedGitCommand(body.args)) {
      return NextResponse.json({ error: 'invalid' }, { status: 400 })
    }
    const stdout = await runGitCommand(body.cwd, body.args)
    return NextResponse.json({ stdout })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 409 })
  }
}
