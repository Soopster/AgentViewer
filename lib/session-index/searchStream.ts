import type { PersistedSearchParams, PersistedSearchResponse } from './types'

type SearchFrame =
  | { type: 'partial' | 'complete'; result: PersistedSearchResponse }
  | { type: 'error'; message: string }

export function sessionSearchQuery(params: PersistedSearchParams): URLSearchParams {
  const query = new URLSearchParams({ q: params.query })
  for (const key of ['limit', 'provider', 'dir', 'includeWorktrees', 'sinceMs', 'untilMs', 'hasError', 'touchedFile', 'role', 'messagesOnly', 'toolName'] as const) {
    if (params[key] != null) query.set(key, String(params[key]))
  }
  return query
}

export async function readSessionSearchStream(
  response: Response,
  onPartial: (result: PersistedSearchResponse) => void,
): Promise<PersistedSearchResponse> {
  if (!response.ok) throw new Error(`Search failed (${response.status})`)
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) return response.json()
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader()
  if (!reader) throw new Error('Search returned no response')
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) throw new Error('Search ended before returning results')
      buffer += value
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        const frame = JSON.parse(line) as SearchFrame
        if (frame.type === 'complete') return frame.result
        if (frame.type === 'error') throw new Error(frame.message)
        onPartial(frame.result)
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
