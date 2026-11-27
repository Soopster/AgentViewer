import { NextResponse } from 'next/server'
import { isProviderSelection } from '@/lib/provider'
import { normalizeProjectPath } from '@/lib/projectPaths'
import { searchPersistedSessions } from '@/lib/sessionPersistence'
import { searchSessionsProgressively } from '@/lib/session-index/progressiveSearch'
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

  const params = {
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
  }
  if (searchParams.get('stream') === '1') {
    const cancellation = new AbortController()
    const signal = AbortSignal.any([request.signal, cancellation.signal])
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (frame: unknown) => {
          if (!signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(frame) + '\n'))
        }
        void searchSessionsProgressively(params, signal, result => send({ type: 'partial', result }))
          .then(result => send({ type: 'complete', result }))
          .catch(error => send({ type: 'error', message: error instanceof Error ? error.message : 'Search failed' }))
          .finally(() => { if (!cancellation.signal.aborted) controller.close() })
      },
      cancel() { cancellation.abort() },
    })
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } })
  }
  try {
    const results = await searchPersistedSessions(params)
    return NextResponse.json(results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
