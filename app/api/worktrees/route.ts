import { NextRequest, NextResponse } from 'next/server'
import { validateWorktreeTaskLocks } from '@/lib/agentCoordination'
import { listWorktreeTasks, mergeWorktreeTask, type WorktreeTask } from '@/lib/worktreeTasks'

function readWorktreeTask(value: unknown): WorktreeTask | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const path = typeof record.path === 'string' && record.path.trim() ? record.path.trim() : ''
  const branch = typeof record.branch === 'string' && record.branch.trim() ? record.branch.trim() : ''
  const repoRoot = typeof record.repoRoot === 'string' && record.repoRoot.trim() ? record.repoRoot.trim() : ''
  const slug = typeof record.slug === 'string' && record.slug.trim() ? record.slug.trim() : ''
  if (!path || !branch || !repoRoot || !slug) return null
  return {
    path,
    branch,
    repoRoot,
    slug,
    dirtyFiles: Number(record.dirtyFiles) || 0,
    aheadCommits: Number(record.aheadCommits) || 0,
  }
}

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get('cwd')?.trim() || process.cwd()
  try {
    const tasks = await listWorktreeTasks(cwd)
    return NextResponse.json({ tasks }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : ''
  if (action !== 'merge') {
    return NextResponse.json({ error: 'Unsupported worktree action' }, { status: 400 })
  }
  const task = readWorktreeTask(body.task)
  if (!task) return NextResponse.json({ error: 'Invalid worktree task' }, { status: 400 })

  try {
    const validation = await validateWorktreeTaskLocks(task)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message, paths: validation.paths }, { status: 409 })
    }
    const result = await mergeWorktreeTask(task)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
