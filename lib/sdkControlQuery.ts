import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

// Keep the streaming-input iterator open for the lifetime of the query so
// the SDK doesn't tear down the subprocess while we're still issuing control
// requests. SDK 0.3 treats a returned input iterator as "input closed" and
// closes the query — pre-0.3 it kept the subprocess warm even after an empty
// generator returned. Resolved via close() on the Query, which interrupts the
// pending promise.
function openPrompt(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<SDKUserMessage>>(() => {
          // never resolves; the query closes via q.close()
        }),
        return: () => Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true }),
      }
    },
  }
}

export function createSessionControlQuery(sessionId: string, model = 'claude-sonnet-4-6'): Query {
  return query({
    prompt: openPrompt(),
    options: {
      resume: sessionId,
      model,
      maxTurns: 0,
      enableFileCheckpointing: true,
    },
  })
}
