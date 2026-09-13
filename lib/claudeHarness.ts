// Process-wide broadcast bus for live Claude turn activity. Mirrors
// lib/codexHarness.ts / lib/opencodeHarness.ts in shape so the message-events
// SSE route can drive Claude refreshes off real events instead of a fixed
// timed poll.
//
// The claudePool owns one long-lived `Query` per active session and drains it
// in `pumpQueryToSubscriber`. That pump has a single subscriber slot reserved
// for the turn that started it (the POST send), so any *other* observer — a
// second tab, or the page reloaded mid-turn — previously only saw 1500ms JSONL
// polling. The pump now also fans every message out through this harness, and
// the events route subscribes to it: each broadcast triggers a debounced
// refetch + re-emit of the canonical persisted window, so the transcript stays
// up to date in real time for every observer, not just the sender.
//
// We deliberately broadcast lightweight signals (message type + turn
// boundaries) rather than the full SDKMessage payload: the events route reads
// the canonical persisted window itself, so subscribers only need a "something
// changed, refetch now" nudge plus turn-start/turn-end for live status.

export type ClaudeHarnessEvent =
  | { type: 'connected' }
  // A message flowed through the session's live Query. `messageType` is the
  // SDK message discriminator (assistant/user/result/system/stream_event/…).
  | { type: 'message'; sessionId: string; messageType: string }
  // Turn boundaries — useful for an observer's live "working…" indicator.
  | { type: 'turn-start'; sessionId: string }
  | { type: 'turn-end'; sessionId: string }
  // The pool entry died (CLI exit / eviction / explicit recycle). Subscribers
  // should do a final refetch so any tail messages still surface.
  | { type: 'recycled'; sessionId: string }

type Subscriber = {
  sessionId?: string
  push: (event: ClaudeHarnessEvent) => void
}

class ClaudeHarness {
  private subscribers = new Set<Subscriber>()

  subscribe(options: { sessionId?: string } = {}): {
    events: AsyncGenerator<ClaudeHarnessEvent>
    close: () => void
  } {
    const queue: ClaudeHarnessEvent[] = []
    const waiters: Array<(value: IteratorResult<ClaudeHarnessEvent>) => void> = []
    let closed = false

    const subscriber: Subscriber = {
      sessionId: options.sessionId,
      push: (event) => {
        if (closed) return
        const waiter = waiters.shift()
        if (waiter) waiter({ value: event, done: false })
        else queue.push(event)
      },
    }

    this.subscribers.add(subscriber)

    // The pool's Query is a local subprocess that's effectively always
    // connected once spawned. Emit `connected` eagerly so the events route can
    // prime its window the same way it does for codex/opencode.
    subscriber.push({ type: 'connected' })

    const generator = (async function* (): AsyncGenerator<ClaudeHarnessEvent> {
      try {
        while (true) {
          if (closed && queue.length === 0) return
          const next = queue.shift()
          if (next) {
            yield next
            continue
          }
          const result = await new Promise<IteratorResult<ClaudeHarnessEvent>>((resolve) => {
            waiters.push(resolve)
          })
          if (result.done) return
          yield result.value
        }
      } finally {
        closed = true
      }
    })()

    return {
      events: generator,
      close: () => {
        if (closed) return
        closed = true
        this.subscribers.delete(subscriber)
        for (const waiter of waiters.splice(0)) {
          waiter({ value: undefined as unknown as ClaudeHarnessEvent, done: true })
        }
      },
    }
  }

  broadcast(event: ClaudeHarnessEvent): void {
    const sessionId = 'sessionId' in event ? event.sessionId : undefined
    for (const subscriber of this.subscribers) {
      if (subscriber.sessionId && sessionId && subscriber.sessionId !== sessionId) continue
      subscriber.push(event)
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __claudeHarness: ClaudeHarness | undefined
}

function getHarness(): ClaudeHarness {
  if (!globalThis.__claudeHarness) {
    globalThis.__claudeHarness = new ClaudeHarness()
  }
  return globalThis.__claudeHarness
}

export function subscribeToClaudeEvents(options: { sessionId?: string } = {}) {
  return getHarness().subscribe(options)
}

export function broadcastClaudeMessage(sessionId: string, messageType: string): void {
  getHarness().broadcast({ type: 'message', sessionId, messageType })
}

export function broadcastClaudeTurnStart(sessionId: string): void {
  getHarness().broadcast({ type: 'turn-start', sessionId })
}

export function broadcastClaudeTurnEnd(sessionId: string): void {
  getHarness().broadcast({ type: 'turn-end', sessionId })
}

export function broadcastClaudeRecycled(sessionId: string): void {
  getHarness().broadcast({ type: 'recycled', sessionId })
}
