import { getCodexClient } from './codexClient'
import type {
  CodexAppsListResponse,
  CodexExperimentalFeatureListResponse,
  CodexMcpServerListResponse,
  CodexNotification,
  CodexSkillsListResponse,
  CodexThreadTokenUsage,
} from './codexProtocol'

// Mirror of lib/opencodeHarness.ts for the codex app-server. The codex
// client already maintains a single long-lived child process with one
// JSON-RPC pipe — this harness wraps it with the same shape opencode's
// harness provides:
//   1. Persistent shared subscription, fanned out to per-thread async
//      generators with state replay on subscribe.
//   2. Cached per-thread snapshot (status, last token usage, latest turn)
//      so a late subscriber sees the current state immediately.
//   3. Cached project-level diagnostics (mcpServerStatus, experimental
//      features, skills, apps) with event-driven invalidation so the
//      diagnostics endpoint doesn't fan out a fresh 6-way HTTP request
//      every time the panel opens.
//   4. Receive-once messages route subscribes via this harness instead of
//      polling every 1.5s — refetches only when item/turn lifecycle
//      events fire.

const HEARTBEAT_HINT = 'thread/tokenUsage/updated'

export type CodexHarnessEvent =
  | { type: 'notification'; notification: CodexNotification; threadId?: string }
  | { type: 'connected' }
  | { type: 'disconnected' }

export type CodexThreadSnapshot = {
  status?: string
  latestTurnId?: string
  latestTurnStatus?: string
  tokenUsage?: CodexThreadTokenUsage
  model?: string
}

export type CodexProjectDiagnostics = {
  mcpServers: CodexMcpServerListResponse['data']
  features: CodexExperimentalFeatureListResponse['data']
  skills: CodexSkillsListResponse['data']
  apps: CodexAppsListResponse['data']
}

type Subscriber = {
  threadId?: string
  push(event: CodexHarnessEvent): void
}

type DiagnosticsCacheEntry = {
  value: CodexProjectDiagnostics
  fetchedAt: number
  stale: boolean
}

// Diagnostics rarely change but we still want a backstop so a missed
// invalidation event doesn't strand the cache forever.
const DIAGNOSTICS_TTL_MS = 30_000

function notificationThreadId(notification: CodexNotification): string | undefined {
  const params = notification.params as { threadId?: unknown }
  return typeof params?.threadId === 'string' ? params.threadId : undefined
}

class CodexHarness {
  private subscribers = new Set<Subscriber>()
  private snapshots = new Map<string, CodexThreadSnapshot>()
  private diagnostics: DiagnosticsCacheEntry | undefined
  private diagnosticsInflight: Promise<CodexProjectDiagnostics> | undefined
  private subscribed = false

  subscribe(options: { threadId?: string } = {}): {
    snapshot: CodexThreadSnapshot | undefined
    events: AsyncGenerator<CodexHarnessEvent>
    close: () => void
  } {
    this.ensureSubscribed()

    const queue: CodexHarnessEvent[] = []
    const waiters: Array<(value: IteratorResult<CodexHarnessEvent>) => void> = []
    let closed = false

    const subscriber: Subscriber = {
      threadId: options.threadId,
      push: (event) => {
        if (closed) return
        const waiter = waiters.shift()
        if (waiter) waiter({ value: event, done: false })
        else queue.push(event)
      },
    }

    this.subscribers.add(subscriber)

    // Codex's child process is local and effectively always connected once
    // spawned. Emit a `connected` event eagerly so subscribers can mirror
    // the pattern they use for opencode.
    subscriber.push({ type: 'connected' })

    const snapshot = options.threadId ? this.snapshots.get(options.threadId) : undefined

    const generator = (async function* (): AsyncGenerator<CodexHarnessEvent> {
      try {
        while (true) {
          if (closed && queue.length === 0) return
          const next = queue.shift()
          if (next) {
            yield next
            continue
          }
          const result = await new Promise<IteratorResult<CodexHarnessEvent>>((resolve) => {
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
      snapshot,
      events: generator,
      close: () => {
        if (closed) return
        closed = true
        this.subscribers.delete(subscriber)
        for (const waiter of waiters.splice(0)) {
          waiter({ value: undefined as unknown as CodexHarnessEvent, done: true })
        }
      },
    }
  }

  getSnapshot(threadId: string): CodexThreadSnapshot | undefined {
    return this.snapshots.get(threadId)
  }

  async getProjectDiagnostics(): Promise<CodexProjectDiagnostics> {
    const now = Date.now()
    if (this.diagnostics && !this.diagnostics.stale && now - this.diagnostics.fetchedAt < DIAGNOSTICS_TTL_MS) {
      return this.diagnostics.value
    }
    if (this.diagnosticsInflight) return this.diagnosticsInflight

    const client = getCodexClient()
    this.diagnosticsInflight = (async () => {
      const [mcpServers, features, skills, apps] = await Promise.all([
        client.request<CodexMcpServerListResponse>('mcpServerStatus/list', {}),
        client.request<CodexExperimentalFeatureListResponse>('experimentalFeature/list', {}),
        client.request<CodexSkillsListResponse>('skills/list', {}),
        client.request<CodexAppsListResponse>('app/list', {}),
      ])
      const next: CodexProjectDiagnostics = {
        mcpServers: mcpServers.data ?? [],
        features: features.data ?? [],
        skills: skills.data ?? [],
        apps: apps.data ?? [],
      }
      this.diagnostics = { value: next, fetchedAt: Date.now(), stale: false }
      return next
    })()

    try {
      return await this.diagnosticsInflight
    } finally {
      this.diagnosticsInflight = undefined
    }
  }

  ensureStarted(): void {
    this.ensureSubscribed()
  }

  private ensureSubscribed(): void {
    if (this.subscribed) return
    this.subscribed = true
    const client = getCodexClient()
    client.subscribe((notification) => this.handleNotification(notification))
  }

  private handleNotification(notification: CodexNotification): void {
    this.applyToSnapshot(notification)
    this.invalidateDiagnostics(notification)
    this.broadcast(notification)
  }

  private applyToSnapshot(notification: CodexNotification): void {
    const threadId = notificationThreadId(notification)
    if (!threadId) return
    const existing = this.snapshots.get(threadId) ?? {}

    switch (notification.method) {
      case 'thread/started': {
        existing.status = 'running'
        break
      }
      case 'thread/status/changed': {
        const status = (notification.params as { status?: unknown }).status
        if (typeof status === 'string') existing.status = status
        break
      }
      case 'thread/closed': {
        existing.status = 'closed'
        break
      }
      case 'thread/archived': {
        existing.status = 'archived'
        break
      }
      case 'turn/started': {
        const params = notification.params as { turn?: { id?: string; status?: string }; turnId?: string }
        existing.latestTurnId = params.turn?.id ?? params.turnId ?? existing.latestTurnId
        existing.latestTurnStatus = params.turn?.status ?? 'running'
        break
      }
      case 'turn/completed': {
        const params = notification.params as { turn?: { id?: string; status?: string }; turnId?: string }
        existing.latestTurnId = params.turn?.id ?? params.turnId ?? existing.latestTurnId
        existing.latestTurnStatus = params.turn?.status ?? 'completed'
        break
      }
      case 'thread/tokenUsage/updated': {
        const params = notification.params as { tokenUsage?: CodexThreadTokenUsage }
        if (params.tokenUsage) existing.tokenUsage = params.tokenUsage
        break
      }
      default:
        if (notification.method === HEARTBEAT_HINT) {
          // Already handled above. Kept as an explicit signal so future
          // contributors notice that token-usage events double as a
          // liveness heartbeat for the per-thread snapshot.
        }
        break
    }

    this.snapshots.set(threadId, existing)
  }

  private invalidateDiagnostics(notification: CodexNotification): void {
    if (!this.diagnostics) return
    switch (notification.method) {
      case 'mcpServer/startupStatus/updated':
      case 'mcpServer/oauthLogin/completed':
      case 'skills/changed':
      case 'app/list/updated':
      case 'externalAgentConfig/import/completed':
        this.diagnostics.stale = true
        break
      default:
        break
    }
  }

  private broadcast(notification: CodexNotification): void {
    const threadId = notificationThreadId(notification)
    const event: CodexHarnessEvent = { type: 'notification', notification, threadId }
    for (const subscriber of this.subscribers) {
      if (subscriber.threadId && threadId && subscriber.threadId !== threadId) continue
      subscriber.push(event)
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __codexHarness: CodexHarness | undefined
}

function getHarness(): CodexHarness {
  if (!globalThis.__codexHarness) {
    globalThis.__codexHarness = new CodexHarness()
  }
  return globalThis.__codexHarness
}

export function subscribeToCodexEvents(options: { threadId?: string } = {}) {
  return getHarness().subscribe(options)
}

export function getCodexThreadSnapshot(threadId: string): CodexThreadSnapshot | undefined {
  return globalThis.__codexHarness?.getSnapshot(threadId)
}

export function getCodexProjectDiagnostics(): Promise<CodexProjectDiagnostics> {
  const harness = getHarness()
  harness.ensureStarted()
  return harness.getProjectDiagnostics()
}
