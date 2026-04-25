import { NextRequest, NextResponse } from 'next/server'
import { fetchGitData, fetchGitPaneContent, isAllowedGitCommand, type GitData, type GitPaneId } from '@/lib/gitProvider'
import { runGitCommand } from '@/lib/gitNodeProvider'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      cwd?: string
      args?: unknown
      action?: 'data' | 'content'
      data?: GitData
      pane?: GitPaneId
      selectedFilePath?: string | null
      branchIndex?: number
      commitIndex?: number
    }

    if (!body.cwd) {
      return NextResponse.json({ error: 'invalid' }, { status: 400 })
    }

    if (body.action === 'data') {
      const data = await fetchGitData(body.cwd, runGitCommand)
      return NextResponse.json({ data })
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
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
