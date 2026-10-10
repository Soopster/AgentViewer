import { NextRequest, NextResponse } from 'next/server'
import { isProviderSelection } from '@/lib/provider'
import { normalizeProjectPath } from '@/lib/projectPaths'
import { maxDuration, rebuildViewSessionIndex } from '@/lib/sessionBackend'

export { maxDuration }

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const provider = isProviderSelection(body?.provider) ? body.provider : 'all'
  const dir = normalizeProjectPath(body?.dir) || undefined
  const includeWorktrees = body?.includeWorktrees !== false

  try {
    const result = await rebuildViewSessionIndex({ provider, dir, includeWorktrees })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
