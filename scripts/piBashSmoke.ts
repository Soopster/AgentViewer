// E2E smoke for Pi input-box bash mode (`!command`): live pi_bash_delta
// streaming, persisted bashExecution mapping, cancellation, and truncated
// output surfacing fullOutputPath. Runs entirely locally — no model creds.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listViewSessionMessages, streamViewSessionTurn } from '../lib/sessionBackend'

type Frame = { at: number; data: Record<string, unknown> }
type SseResult = { sessionId: string | null; frames: Frame[] }

async function runBashTurn(params: {
  sessionId: string
  cwd: string
  message: string
  isPendingSession: boolean
  abortAfterDelta?: (frame: Frame) => boolean
}): Promise<SseResult> {
  const controller = new AbortController()
  const response = await streamViewSessionTurn({
    sessionId: params.sessionId,
    provider: 'pi',
    signal: controller.signal,
    body: {
      message: params.message,
      isPendingSession: params.isPendingSession,
      cwd: params.cwd,
    },
  })
  assert.ok(response.body, 'send stream has a body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let sessionId: string | null = null
  const frames: Frame[] = []
  let aborted = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    let boundary = buffered.indexOf('\n\n')
    while (boundary !== -1) {
      const rawEvent = buffered.slice(0, boundary)
      buffered = buffered.slice(boundary + 2)
      boundary = buffered.indexOf('\n\n')
      const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(dataLine.slice(6)) as Record<string, unknown>
      } catch {
        continue
      }
      if (rawEvent.includes('event: session') && typeof parsed.sessionId === 'string') {
        sessionId = parsed.sessionId
        continue
      }
      const frame = { at: Date.now(), data: parsed }
      frames.push(frame)
      if (!aborted && params.abortAfterDelta?.(frame)) {
        aborted = true
        controller.abort()
      }
    }
  }
  return { sessionId, frames }
}

function bashDeltas(frames: Frame[]): Frame[] {
  return frames.filter((frame) => frame.data.type === 'pi_bash_delta')
}

async function latestBashCard(sessionId: string): Promise<string> {
  const messages = await listViewSessionMessages(sessionId, { limit: 200, offset: 0 }, 'pi')
  const cards: string[] = []
  for (const message of messages) {
    const content = (message.message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const record = block as { type?: string; content?: unknown }
      if (record.type === 'tool_result' && typeof record.content === 'string' && record.content.startsWith('$ ')) {
        cards.push(record.content)
      }
    }
  }
  assert.ok(cards.length > 0, 'transcript has a bash card')
  return cards[cards.length - 1]!
}

const cwd = mkdtempSync(join(tmpdir(), 'pi-bash-smoke-'))
try {
  // 1) Streaming: two echoes separated by a sleep must arrive as separate
  //    deltas with a real time gap — proves live chunk streaming, not a
  //    single buffered result.
  const first = await runBashTurn({
    sessionId: randomUUID(),
    cwd,
    message: '!echo first-chunk && sleep 1 && echo second-chunk',
    isPendingSession: true,
  })
  assert.ok(first.sessionId, 'stream reported a session id')
  const firstDeltas = bashDeltas(first.frames)
  assert.ok(firstDeltas.length >= 2, `expected >=2 pi_bash_delta frames, got ${firstDeltas.length}`)
  const firstText = firstDeltas.map((frame) => String(frame.data.delta)).join('')
  assert.ok(firstText.includes('first-chunk') && firstText.includes('second-chunk'), 'both chunks streamed')
  const firstChunkFrame = firstDeltas.find((frame) => String(frame.data.delta).includes('first-chunk'))!
  const secondChunkFrame = firstDeltas.find((frame) => String(frame.data.delta).includes('second-chunk'))!
  const gapMs = secondChunkFrame.at - firstChunkFrame.at
  assert.ok(gapMs >= 500, `expected streamed gap >=500ms across sleep, got ${gapMs}ms`)
  const firstCard = await latestBashCard(first.sessionId!)
  assert.ok(firstCard.includes('first-chunk'), 'persisted card has output')
  assert.ok(firstCard.includes('(exit 0)'), 'persisted card has exit code')
  console.log(`[pi-bash-smoke] streaming ok (${firstDeltas.length} deltas, ${gapMs}ms gap)`)

  // 2) Truncation: >100KB of output must persist truncated with the
  //    fullOutputPath note surfaced in the mapped card.
  const second = await runBashTurn({
    sessionId: first.sessionId!,
    cwd,
    message: '!seq 1 30000',
    isPendingSession: false,
  })
  const secondCard = await latestBashCard(first.sessionId!)
  assert.ok(secondCard.includes('[output truncated — full output: '), 'truncated card names fullOutputPath')
  assert.ok(secondCard.includes('(exit 0)'), 'truncated card still reports exit code')
  assert.ok(bashDeltas(second.frames).length >= 1, 'truncated run still streamed deltas')
  console.log('[pi-bash-smoke] truncation + fullOutputPath ok')

  // 3) Cancellation: abort the client request mid-command; the persisted card
  //    must report (cancelled) and flag as an error.
  await runBashTurn({
    sessionId: first.sessionId!,
    cwd,
    message: '!echo before-cancel && sleep 30',
    isPendingSession: false,
    abortAfterDelta: (frame) => String(frame.data.delta ?? '').includes('before-cancel'),
  })
  // The abort tears down the SSE reader before the final record lands; give
  // the backend a beat to persist the cancelled result.
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const thirdCard = await latestBashCard(first.sessionId!)
  assert.ok(thirdCard.includes('before-cancel'), 'cancelled card kept streamed output')
  assert.ok(thirdCard.includes('(cancelled)'), 'cancelled card labelled')
  console.log('[pi-bash-smoke] cancellation ok')

  console.log('[pi-bash-smoke] all checks passed')
  process.exit(0)
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
