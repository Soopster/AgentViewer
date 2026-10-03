import type { AgentProvider } from './types'

export type LiveSessionHarnessEvent =
  | { type: 'connected' }
  | { type: 'activity'; provider: AgentProvider; sessionId: string }
  | { type: 'turn-start'; provider: AgentProvider; sessionId: string }
  | { type: 'turn-end'; provider: AgentProvider; sessionId: string }
  | { type: 'recycled'; provider: AgentProvider; sessionId: string }

type Subscriber = {
  provider?: AgentProvider
  sessionId?: string
  push: (event: LiveSessionHarnessEvent) => void
}

class LiveSessionHarness {
  private subscribers = new Set<Subscriber>()

  subscribe(options: { provider?: AgentProvider; sessionId?: string } = {}): {
    events: AsyncGenerator<LiveSessionHarnessEvent>
    close: () => void
  } {
    const queue: LiveSessionHarnessEvent[] = []
    const waiters: Array<(value: IteratorResult<LiveSessionHarnessEvent>) => void> = []
    let closed = false

    const subscriber: Subscriber = {
      provider: options.provider,
      sessionId: options.sessionId,
      push: (event) => {
        if (closed) return
        const waiter = waiters.shift()
        if (waiter) waiter({ value: event, done: false })
        else queue.push(event)
      },
    }

    this.subscribers.add(subscriber)
    subscriber.push({ type: 'connected' })

    const generator = (async function* (): AsyncGenerator<LiveSessionHarnessEvent> {
      try {
        while (true) {
          if (closed && queue.length === 0) return
          const next = queue.shift()
          if (next) {
            yield next
            continue
          }
          const result = await new Promise<IteratorResult<LiveSessionHarnessEvent>>((resolve) => {
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
          waiter({ value: undefined as unknown as LiveSessionHarnessEvent, done: true })
        }
      },
    }
  }

  broadcast(event: LiveSessionHarnessEvent): void {
    for (const subscriber of this.subscribers) {
      if ('provider' in event && subscriber.provider && subscriber.provider !== event.provider) continue
      if ('sessionId' in event && subscriber.sessionId && subscriber.sessionId !== event.sessionId) continue
      subscriber.push(event)
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __liveSessionHarness: LiveSessionHarness | undefined
}

function getHarness(): LiveSessionHarness {
  if (!globalThis.__liveSessionHarness) {
    globalThis.__liveSessionHarness = new LiveSessionHarness()
  }
  return globalThis.__liveSessionHarness
}

export function subscribeToLiveSessionEvents(options: { provider?: AgentProvider; sessionId?: string } = {}) {
  return getHarness().subscribe(options)
}

export function broadcastLiveSessionActivity(provider: AgentProvider, sessionId: string): void {
  getHarness().broadcast({ type: 'activity', provider, sessionId })
}

export function broadcastLiveSessionTurnStart(provider: AgentProvider, sessionId: string): void {
  getHarness().broadcast({ type: 'turn-start', provider, sessionId })
}

export function broadcastLiveSessionTurnEnd(provider: AgentProvider, sessionId: string): void {
  getHarness().broadcast({ type: 'turn-end', provider, sessionId })
}

export function broadcastLiveSessionRecycled(provider: AgentProvider, sessionId: string): void {
  getHarness().broadcast({ type: 'recycled', provider, sessionId })
}
