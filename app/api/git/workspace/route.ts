import { readConflict } from '@/lib/git/workflowOperations'
import { NextRequest, NextResponse } from 'next/server'
import { actWorkspace, inspectWorkspace, previewWorkspace, readWorkspace } from '@/lib/git/workspaceService'
import type { IndexSide, WorkspaceAction } from '@/lib/git/workspaceTypes'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams, cwd = query.get('cwd')
  if (!cwd) return NextResponse.json({ error: 'Repository directory required' }, { status: 400 })
  try {
    const data = query.get('view') === 'conflict'
      ? await readConflict(cwd, query.get('path') ?? '')
      : query.get('view') === 'inspect'
      ? { content: await inspectWorkspace(cwd, query.get('kind') ?? '', query.get('ref') ?? '') }
      : query.get('view') === 'preview'
      ? await previewWorkspace(cwd, query.get('side') as IndexSide, query.get('path'))
      : await readWorkspace(cwd)
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 409 }) }
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: string; requestId?: string; action?: WorkspaceAction }
    if (typeof body.cwd !== 'string' || !body.action || typeof body.requestId !== 'string') return NextResponse.json({ error: 'Invalid Git operation' }, { status: 400 })
    return NextResponse.json(await actWorkspace(body.cwd, body.requestId, body.action), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }) }
}
