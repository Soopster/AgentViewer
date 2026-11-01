import { NextRequest, NextResponse } from 'next/server'
import { githubError, readGithubCwd } from '@/lib/github/cwd'
import { dispatchGithubWorkflow, fetchGithubWorkflows } from '@/lib/github/workflows'
import type { GithubWorkflowDispatch } from '@/lib/github/types'

/** GET ?cwd → workflows. POST { cwd, dispatch } triggers a workflow_dispatch run. */
export async function GET(request: NextRequest) {
  const cwd = readGithubCwd(request.nextUrl.searchParams.get('cwd'))
  if (!cwd) return NextResponse.json({ error: 'Invalid working directory.' }, { status: 400 })
  try { return NextResponse.json({ workflows: await fetchGithubWorkflows(cwd) }) } catch (error) { return githubError(error) }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { cwd?: unknown; dispatch?: GithubWorkflowDispatch }
  const cwd = readGithubCwd(body.cwd)
  if (!cwd || !body.dispatch || typeof body.dispatch.workflow !== 'string') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  try { await dispatchGithubWorkflow(cwd, body.dispatch); return NextResponse.json({ ok: true }) } catch (error) { return githubError(error, 400) }
}
