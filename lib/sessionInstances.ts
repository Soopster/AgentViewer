// Which provider instance a session belongs to.
//
// Two instances of one provider are two different stores (two ACP agents, two
// Claude accounts), and a session id means nothing to the other one. A caller
// that names the instance (a web request carrying `providerInstanceId`, a
// teammate dispatch) is already in the right context; one that names only the
// provider and the session — most TUI reads and sends — would otherwise reach
// the default instance, which answers that it has no such session, and the chat
// opens empty.
//
// So the pairing is remembered where it is learned (a listing, a new session)
// and looked up where it is needed. It is a file rather than memory because the
// TUI reads transcripts in a worker isolate that never ran the listing.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { currentProviderInstance, withProviderInstance } from './providerInstances'
import type { AgentProvider } from './types'

const INDEX_FILE = path.join(process.cwd(), '.agent-viewer-data', 'session-instances.json')
const MAX_ENTRIES = 2000

let cache: { mtimeMs: number; entries: Map<string, string> } | null = null

function load(): Map<string, string> {
  let mtimeMs = 0
  try {
    mtimeMs = statSync(INDEX_FILE).mtimeMs
  } catch {
    return cache?.mtimeMs === 0 ? cache.entries : (cache = { mtimeMs: 0, entries: new Map() }).entries
  }
  if (cache?.mtimeMs === mtimeMs) return cache.entries
  let entries = new Map<string, string>()
  try {
    const parsed = JSON.parse(readFileSync(INDEX_FILE, 'utf8')) as Record<string, unknown>
    entries = new Map(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    // Unreadable is "nothing remembered": the next listing rebuilds it.
  }
  cache = { mtimeMs, entries }
  return entries
}

// Keyed by provider as well: an id is only unique within one provider's stores.
function entryKey(provider: AgentProvider, sessionId: string): string {
  return `${provider}:${sessionId}`
}

/** Only non-default instances are stored; the default is what an absent entry means. */
export function rememberSessionInstances(provider: AgentProvider, sessionIds: readonly string[], instanceId: string): void {
  if (instanceId === provider || sessionIds.length === 0) return
  const entries = load()
  const keys = sessionIds.map((sessionId) => entryKey(provider, sessionId))
  if (keys.every((key) => entries.get(key) === instanceId)) return
  for (const key of keys) {
    entries.delete(key)
    entries.set(key, instanceId)
  }
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
  try {
    mkdirSync(path.dirname(INDEX_FILE), { recursive: true })
    const temp = `${INDEX_FILE}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(Object.fromEntries(entries)))
    renameSync(temp, INDEX_FILE)
    cache = { mtimeMs: statSync(INDEX_FILE).mtimeMs, entries }
  } catch {
    // Best effort: this process still has it in memory.
    cache = { mtimeMs: cache?.mtimeMs ?? 0, entries }
  }
}

export function sessionInstanceId(provider: AgentProvider, sessionId: string): string | undefined {
  return load().get(entryKey(provider, sessionId))
}

/**
 * Runs `run` as the agent that owns the session. An instance the caller chose
 * is kept; only "no instance" and "the default instance" defer to what was
 * remembered, because those are what a caller that named none ends up with.
 */
export function withSessionInstance<T>(provider: AgentProvider, sessionId: string, run: () => T | Promise<T>): T | Promise<T> {
  const current = currentProviderInstance()
  if (current?.provider === provider && !current.isDefault) return run()
  const remembered = sessionInstanceId(provider, sessionId)
  if (!remembered) return run()
  // An instance since removed from the file falls back to the caller's own context.
  return withProviderInstance(remembered, provider, run).catch((error: unknown) => {
    if (error instanceof Error && error.message.startsWith('Unknown or disabled provider instance')) return run()
    throw error
  })
}
