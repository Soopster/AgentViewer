import { NextResponse } from 'next/server'
import { isProviderSelection } from '@/lib/provider'
import { normalizeProjectPath } from '@/lib/projectPaths'
import { readCrossSessionAnalytics } from '@/lib/sessionPersistence'

function parseTimestamp(value: string | null): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) return n
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const providerParam = searchParams.get('provider')
  const provider = isProviderSelection(providerParam) ? providerParam : undefined
  const dir = normalizeProjectPath(searchParams.get('dir')) || undefined
  const includeWorktrees = searchParams.get('includeWorktrees') !== 'false'
  const from = parseTimestamp(searchParams.get('from'))
  const to = parseTimestamp(searchParams.get('to'))

  try {
    const data = await readCrossSessionAnalytics({ provider, dir, includeWorktrees, from, to })
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
