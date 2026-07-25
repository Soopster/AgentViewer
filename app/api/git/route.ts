import { NextResponse, type NextRequest } from 'next/server'
import { fetchGitData, fetchGitPaneContent, fetchGitReviewData, isAllowedGitCommand, type GitData, type GitPaneId } from '@/lib/gitProvider'
import { runGitCommand } from '@/lib/gitNodeProvider'

type GitRequestBody = {
  cwd?: string
  args?: unknown
  action?: 'data' | 'content' | 'review'
  data?: GitData
  pane?: GitPaneId
  selectedFilePath?: string | null
  branchIndex?: number
  commitIndex?: number
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as GitRequestBody

    if (!body.cwd) {
      return NextResponse.json({ error: 'invalid' }, { status: 400 })
    }

    if (body.action === 'data') {
      const data = await fetchGitData(body.cwd, runGitCommand)
      return NextResponse.json({ data })
    }

    if (body.action === 'review') {
      const review = await fetchGitReviewData(body.cwd, runGitCommand)
      return NextResponse.json({ review })
    }

    if (body.action === 'content') {
      if (!body.data || typeof body.pane !== 'number') {
        return NextResponse.json({ error: 'invalid' }, { status: 400 })
      }
      const content = await fetchGitPaneContent({
        cwd: body.cwd,
        runGit: runGitCommand,
        data: body.data,
        pane: body.pane,
        selectedFilePath: body.selectedFilePath,
        branchIndex: body.branchIndex,
        commitIndex: body.commitIndex,
      })
      return NextResponse.json({ content })
    }

    if (!isAllowedGitCommand(body.args)) {
      return NextResponse.json({ error: 'invalid' }, { status: 400 })
    }
    const stdout = await runGitCommand(body.cwd, body.args)
    return NextResponse.json({ stdout })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
