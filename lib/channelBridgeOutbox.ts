import {
  sendChannelMessage,
  type ChannelBridgeConfig,
  type ChannelMessageResponse,
} from './channelBridge'

export const CHANNEL_BRIDGE_OUTBOX_VERSION = 1 as const
export const CHANNEL_BRIDGE_BROWSER_OUTBOX_KEY = 'agentviewer:channel-bridge-outbox:v1'

export type ChannelBridgeOutboxEntry = {
  version: typeof CHANNEL_BRIDGE_OUTBOX_VERSION
  messageId: string
  baseUrl: string
  targetSessionId: string
  chatId?: string
  text: string
  createdAt: string
  attempts: number
  lastAttemptAt?: string
}

export type ChannelBridgeOutboxStorage = {
  load: () => Promise<ChannelBridgeOutboxEntry[]>
  save: (entries: ChannelBridgeOutboxEntry[]) => Promise<void>
}

export type ChannelBridgeDelivery = {
  entry: ChannelBridgeOutboxEntry
  response: ChannelMessageResponse
}

export type ChannelBridgeFlushResult = {
  delivered: ChannelBridgeDelivery[]
  pending: ChannelBridgeOutboxEntry[]
  error?: Error
}

type DeliverChannelMessage = (
  config: ChannelBridgeConfig,
  entry: ChannelBridgeOutboxEntry,
) => Promise<ChannelMessageResponse>

const storageLocks = new WeakMap<ChannelBridgeOutboxStorage, Promise<void>>()

function normalizedBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function isOutboxEntry(value: unknown): value is ChannelBridgeOutboxEntry {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.version === CHANNEL_BRIDGE_OUTBOX_VERSION
    && typeof record.messageId === 'string'
    && Boolean(record.messageId)
    && typeof record.baseUrl === 'string'
    && Boolean(record.baseUrl)
    && typeof record.targetSessionId === 'string'
    && Boolean(record.targetSessionId)
    && typeof record.text === 'string'
    && Boolean(record.text.trim())
    && typeof record.createdAt === 'string'
    && typeof record.attempts === 'number'
    && Number.isSafeInteger(record.attempts)
    && record.attempts >= 0
    && (record.chatId === undefined || typeof record.chatId === 'string')
    && (record.lastAttemptAt === undefined || typeof record.lastAttemptAt === 'string')
  )
}

export function sanitizeChannelBridgeOutbox(value: unknown): ChannelBridgeOutboxEntry[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const entries: ChannelBridgeOutboxEntry[] = []
  for (const candidate of value) {
    if (!isOutboxEntry(candidate) || seen.has(candidate.messageId)) continue
    seen.add(candidate.messageId)
    entries.push({
      ...candidate,
      baseUrl: normalizedBaseUrl(candidate.baseUrl),
      text: candidate.text.trim(),
    })
  }
  return entries.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export function createChannelBridgeMessageId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `channel-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createChannelBridgeOutboxEntry(params: {
  config: ChannelBridgeConfig
  targetSessionId: string
  text: string
  chatId?: string
  messageId?: string
  createdAt?: string
}): ChannelBridgeOutboxEntry {
  const targetSessionId = params.targetSessionId.trim()
  const text = params.text.trim()
  if (!targetSessionId) throw new Error('A target Claude session is required for durable channel delivery')
  if (!text) throw new Error('Cannot queue an empty channel message')
  return {
    version: CHANNEL_BRIDGE_OUTBOX_VERSION,
    messageId: params.messageId?.trim() || createChannelBridgeMessageId(),
    baseUrl: normalizedBaseUrl(params.config.baseUrl),
    targetSessionId,
    chatId: params.chatId,
    text,
    createdAt: params.createdAt ?? new Date().toISOString(),
    attempts: 0,
  }
}

async function withStorageLock<T>(storage: ChannelBridgeOutboxStorage, work: () => Promise<T>): Promise<T> {
  const previous = storageLocks.get(storage) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => current)
  storageLocks.set(storage, tail)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (storageLocks.get(storage) === tail) storageLocks.delete(storage)
  }
}

export async function enqueueChannelBridgeMessage(
  storage: ChannelBridgeOutboxStorage,
  entry: ChannelBridgeOutboxEntry,
): Promise<void> {
  await withStorageLock(storage, async () => {
    const entries = sanitizeChannelBridgeOutbox(await storage.load())
    if (entries.some((candidate) => candidate.messageId === entry.messageId)) return
    await storage.save([...entries, entry])
  })
}

const defaultDeliver: DeliverChannelMessage = (config, entry) => sendChannelMessage(config, entry.text, {
  chatId: entry.chatId,
  messageId: entry.messageId,
  targetSessionId: entry.targetSessionId,
})

export async function flushChannelBridgeOutbox(
  storage: ChannelBridgeOutboxStorage,
  config: ChannelBridgeConfig,
  targetSessionId: string,
  options: {
    deliver?: DeliverChannelMessage
    onDelivered?: (delivery: ChannelBridgeDelivery) => void
  } = {},
): Promise<ChannelBridgeFlushResult> {
  return withStorageLock(storage, async () => {
    const baseUrl = normalizedBaseUrl(config.baseUrl)
    const deliver = options.deliver ?? defaultDeliver
    let entries = sanitizeChannelBridgeOutbox(await storage.load())
    const delivered: ChannelBridgeDelivery[] = []
    let error: Error | undefined

    for (const candidate of [...entries]) {
      if (candidate.baseUrl !== baseUrl || candidate.targetSessionId !== targetSessionId) continue
      const attempted: ChannelBridgeOutboxEntry = {
        ...candidate,
        attempts: candidate.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
      }
      entries = entries.map((entry) => entry.messageId === attempted.messageId ? attempted : entry)
      await storage.save(entries)
      try {
        const response = await deliver(config, attempted)
        const delivery = { entry: attempted, response }
        delivered.push(delivery)
        entries = entries.filter((entry) => entry.messageId !== attempted.messageId)
        await storage.save(entries)
        options.onDelivered?.(delivery)
      } catch (cause) {
        error = cause instanceof Error ? cause : new Error(String(cause))
        break
      }
    }

    return { delivered, pending: entries, ...(error ? { error } : {}) }
  })
}

export async function sendDurableChannelMessage(
  storage: ChannelBridgeOutboxStorage,
  config: ChannelBridgeConfig,
  params: {
    targetSessionId: string
    text: string
    chatId?: string
    messageId?: string
  },
): Promise<{
  entry: ChannelBridgeOutboxEntry
  response?: ChannelMessageResponse
  queued: boolean
  error?: Error
}> {
  const entry = createChannelBridgeOutboxEntry({ config, ...params })
  await enqueueChannelBridgeMessage(storage, entry)
  const result = await flushChannelBridgeOutbox(storage, config, entry.targetSessionId)
  const delivery = result.delivered.find((candidate) => candidate.entry.messageId === entry.messageId)
  return {
    entry,
    response: delivery?.response,
    queued: !delivery,
    ...(result.error ? { error: result.error } : {}),
  }
}

export const browserChannelBridgeOutboxStorage: ChannelBridgeOutboxStorage = {
  async load() {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem(CHANNEL_BRIDGE_BROWSER_OUTBOX_KEY)
      return raw ? sanitizeChannelBridgeOutbox(JSON.parse(raw)) : []
    } catch {
      return []
    }
  },
  async save(entries) {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(CHANNEL_BRIDGE_BROWSER_OUTBOX_KEY, JSON.stringify(entries))
    } catch {
      throw new Error('Could not persist the channel bridge outbox in this browser')
    }
  },
}
