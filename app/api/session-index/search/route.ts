import { NextResponse } from 'next/server'
import { isProviderSelection } from '@/lib/provider'
import { normalizeProjectPath } from '@/lib/projectPaths'
import { searchPersistedSessions } from '@/lib/sessionPersistence'
import type { SessionMessage } from '@/lib/types'

function parseRole(value: string | null): SessionMessage['type'] | undefined {
  if (value === 'user' || value === 'assistant' || value === 'system') return value
  return undefined
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') ?? searchParams.get('query') ?? ''
  const rawLimit = parseInt(searchParams.get('limit') ?? '', 10)
  const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 25, 100)
  const providerParam = searchParams.get('provider')
  const provider = isProviderSelection(providerParam) ? providerParam : undefined
  const dir = normalizeProjectPath(searchParams.get('dir')) || undefined
  const includeWorktrees = searchParams.get('includeWorktrees') !== 'false'
  const role = parseRole(searchParams.get('role'))

  try {
    const results = await searchPersistedSessions({
      query,
      limit,
      provider,
      dir,
      includeWorktrees,
      role,
    })
    return NextResponse.json(results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
