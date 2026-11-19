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
  const messagesOnly = searchParams.get('messagesOnly') === '1' || searchParams.get('messagesOnly') === 'true'
  const toolNameRaw = searchParams.get('toolName')?.trim() ?? ''
  const toolName = toolNameRaw ? toolNameRaw : undefined

  const finite = (name: string) => { const value = Number(searchParams.get(name)); return searchParams.get(name) && Number.isFinite(value) ? value : undefined }
  const hasError = searchParams.get('hasError') === '1' || searchParams.get('hasError') === 'true'
  const touchedFile = searchParams.get('touchedFile')?.trim() || undefined

  try {
    const results = await searchPersistedSessions({
      sinceMs: finite('sinceMs'),
      untilMs: finite('untilMs'),
      hasError: hasError || undefined,
      touchedFile,
      query,
      limit,
      provider,
      dir,
      includeWorktrees,
      role,
      messagesOnly,
      toolName,
    })
    return NextResponse.json(results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
