import { extractSseFrames } from '../composerStream'
import type { BetterProgress } from './betterProgress'
import type { BetterResult } from '../promptResearch'
/** Both Web and attached TUI consume the same progress/result stream. */
export async function readBetterResponse(response: Response, signal: AbortSignal, onProgress?: (progress: BetterProgress) => void): Promise<BetterResult> {
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error || `Prompt research failed (${response.status})`) }
  if (!response.body) throw new Error('The research stream is unavailable')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = '', result: BetterResult | undefined
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const next = await reader.read()
      pending += decoder.decode(next.value, { stream: !next.done }) + (next.done ? '\n\n' : '')
      const extracted = extractSseFrames(pending); pending = extracted.remaining
      if (pending.length > 500_000) throw new Error('Research progress frame is too large')
      for (const frame of extracted.frames) {
        const event = JSON.parse(frame.data)
        if (event.type === 'progress') onProgress?.(event.value)
        if (event.type === 'result') result = event.value
        if (event.type === 'error') throw new Error(String(event.value))
      }
      if (next.done) break
    }
    signal.throwIfAborted()
    if (!result) throw new Error('Research ended without a rewritten prompt')
    return result
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock() }
}
