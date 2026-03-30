import { NextResponse } from 'next/server'
import { isProviderSelection } from '@/lib/provider'
import { normalizeProjectPath } from '@/lib/projectPaths'
import { listViewSessions } from '@/lib/sessionBackend'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawLimit = parseInt(searchParams.get('limit') ?? '', 10)
  const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100, 500)
  const rawOffset = parseInt(searchParams.get('offset') ?? '', 10)
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0
  const dir = normalizeProjectPath(searchParams.get('dir')) || undefined
  const includeWorktrees = searchParams.get('includeWorktrees') !== 'false'
  const providerParam = searchParams.get('provider')
  const provider = isProviderSelection(providerParam) ? providerParam : undefined

  try {
    const sessions = await listViewSessions({ limit, offset, dir, includeWorktrees, provider })
    return NextResponse.json({ sessions })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
