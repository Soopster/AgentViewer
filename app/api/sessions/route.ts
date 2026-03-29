import { NextResponse } from 'next/server'
import { listViewSessions } from '@/lib/sessionBackend'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500)
  const offset = parseInt(searchParams.get('offset') ?? '0')
  const dir = searchParams.get('dir')?.trim() || undefined
  const includeWorktrees = searchParams.get('includeWorktrees') !== 'false'
  const providerParam = searchParams.get('provider')
  const provider = providerParam === 'all' || providerParam === 'claude' || providerParam === 'codex' || providerParam === 'opencode'
    ? providerParam
    : undefined

  try {
    const sessions = await listViewSessions({ limit, offset, dir, includeWorktrees, provider })
    return NextResponse.json({ sessions })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
