import { NextResponse, type NextRequest } from 'next/server'
import { fetchGitPaneContent, parseGitDiffSource, type GitData, type GitPaneId } from '@/lib/gitProvider'
import { fetchSourceDiff } from '@/lib/gitDiffSources'
import { runGitCommand } from '@/lib/gitNodeProvider'

type GitContentBody = {
  cwd?: string
  data?: GitData
  pane?: GitPaneId
  selectedFilePath?: string | null
  branchIndex?: number
  commitIndex?: number
  sourceKind?: unknown
  sourceSha?: unknown
}

/** Rendered content for one pane of the git panel.
 *
 *  A read, but a POST: it needs the caller's already-fetched GitData to know
 *  which branch/commit a pane index refers to, and that does not fit a query
 *  string. It gets its own route so lib/routeScopes.ts can declare it `read`
 *  without also opening the raw-command escape hatch on /api/git — the table
 *  keys on route and method, and method is not intent (see the same pattern on
 *  POST /api/sessions/project/messages).
 *
 *  Everything reachable here runs read-only git commands via
 *  fetchGitPaneContent; the caller's `data` is treated as a display hint, not
 *  as authority over what gets executed. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as GitContentBody
    if (!body.cwd || !body.data || typeof body.pane !== 'number') {
      return NextResponse.json({ error: 'invalid' }, { status: 400 })
    }
    const cwd = body.cwd
    // The diff panes (0: whole change set, 2: one file) are the only ones a
    // source changes; the status/branch/commit panes describe the repository.
    const source = parseGitDiffSource(body.sourceKind, body.sourceSha)
    if (source.kind !== 'working' && (body.pane === 0 || body.pane === 2)) {
      if (body.pane === 2 && !body.selectedFilePath) {
        return NextResponse.json({
          content: body.data.status.length === 0 ? '(no changes)' : '(select a file)',
        })
      }
      const diff = await fetchSourceDiff(cwd, runGitCommand, source, body.pane === 2 ? body.selectedFilePath : null)
      return NextResponse.json({ content: diff || '(no changes)' })
    }

    const content = await fetchGitPaneContent({
      cwd,
      runGit: runGitCommand,
      data: body.data,
      pane: body.pane,
      selectedFilePath: body.selectedFilePath,
      branchIndex: body.branchIndex,
      commitIndex: body.commitIndex,
    })
    return NextResponse.json({ content })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
