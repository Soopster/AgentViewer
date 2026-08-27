import { NextRequest, NextResponse } from 'next/server'
import { isProviderSelection } from '@/lib/provider'
import { normalizeProjectPath } from '@/lib/projectPaths'
import { listProjectSessionMessageBatches } from '@/lib/sessionBackend'
import { withProviderRequest } from '@/lib/providerRequest'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const dir = normalizeProjectPath(body?.dir)
  const includeWorktrees = body?.includeWorktrees !== false
  const provider = isProviderSelection(body?.provider) ? body.provider : undefined
  const initialLimit = Math.min(
    Number.isFinite(body?.initialLimit) && body.initialLimit > 0 ? body.initialLimit : 2000,
    2000,
  )
  const incrementalLimit = Math.min(
    Number.isFinite(body?.incrementalLimit) && body.incrementalLimit > 0 ? body.incrementalLimit : 200,
    500,
  )
  const offsets = body?.offsets && typeof body.offsets === 'object' && !Array.isArray(body.offsets)
    ? Object.fromEntries(
        Object.entries(body.offsets as Record<string, unknown>).map(([key, value]) => [
          key,
          Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 0,
        ]),
      )
    : {}

  if (!dir) {
    return NextResponse.json({ error: 'Missing project directory' }, { status: 400 })
  }

  try {
    const result = await withProviderRequest(request, provider === 'all' ? undefined : provider, body, () =>
      listProjectSessionMessageBatches({
        dir,
        includeWorktrees,
        provider,
        providerInstanceId: typeof body?.providerInstanceId === 'string' ? body.providerInstanceId : undefined,
        offsets,
        initialLimit,
        incrementalLimit,
      }))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
