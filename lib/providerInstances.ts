import { PROVIDER_IDS, getProviderManifest } from './extensions/providers/catalog'
import { AsyncLocalStorage } from 'node:async_hooks'
import { statSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isAgentProvider } from './provider'
import type { AgentProvider, ProviderInstanceSummary } from './types'
import { providerPluginId } from './plugins/providerPlugins'
import { pluginSettingsPath, readPluginSettingsFile } from './plugins/settingsFile'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const INSTANCE_FILE = path.join(DATA_DIR, 'provider-instances.json')
const INSTANCE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

const DEFAULT_PROVIDER_LABELS = Object.fromEntries(PROVIDER_IDS.map(id => [id, id === 'copilot' ? 'GitHub Copilot' : getProviderManifest(id).displayName])) as Record<AgentProvider, string>
const DEFAULT_PROVIDER_ORDER = PROVIDER_IDS

export type ProviderInstance = {
  id: string
  provider: AgentProvider
  displayName: string
  accentColor?: string
  enabled: boolean
  environment: Record<string, string>
  executable?: string
  isDefault: boolean
}

type ProviderInstanceFile = {
  version: 1
  instances: Array<{
    id: string
    provider: AgentProvider
    displayName?: string
    accentColor?: string
    enabled?: boolean
    environment?: Record<string, string>
    executable?: string
  }>
}

type ProviderInstanceContext = {
  instance: ProviderInstance
}

declare global {
  // Keep one request context through Next.js module reloads. Provider clients
  // read this context when they choose their process/runtime pool.
  // eslint-disable-next-line no-var
  var __agentViewerProviderInstanceStorage: AsyncLocalStorage<ProviderInstanceContext> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerProviderInstancesCache: { mtimeMs: number; instances: ProviderInstance[] } | undefined
}

const instanceStorage = globalThis.__agentViewerProviderInstanceStorage
  ?? (globalThis.__agentViewerProviderInstanceStorage = new AsyncLocalStorage<ProviderInstanceContext>())

let processEnvironmentQueue: Promise<void> = Promise.resolve()
// Swapping process.env is process-wide, so a read for the default instance
// that overlapped one would look in the other account's store and find
// nothing. Unswapped reads run freely among themselves and only queue while a
// swap is waiting or running; a swap waits for the ones already under way.
let environmentSwapsPending = 0
let unswappedReads = 0
let unswappedDrained: (() => void) | null = null
const insideEnvironmentSwap = new AsyncLocalStorage<boolean>()

/** Serialize short SDK metadata reads that discover config roots via process.env. */
export function withProviderProcessEnvironment<T>(run: () => T | Promise<T>): Promise<T> {
  // Already inside a swap (a wrapped read calling another): the environment
  // is in place, and queueing behind the swap we are part of would never run.
  if (insideEnvironmentSwap.getStore()) return Promise.resolve(run())
  const active = currentProviderInstance()
  if (!active || Object.keys(active.environment).length === 0) {
    if (environmentSwapsPending > 0) {
      const queued = processEnvironmentQueue.then(run)
      processEnvironmentQueue = queued.then(() => undefined, () => undefined)
      return queued
    }
    unswappedReads += 1
    return (async () => run())().finally(() => {
      unswappedReads -= 1
      if (unswappedReads === 0) unswappedDrained?.()
    })
  }
  environmentSwapsPending += 1
  const task = processEnvironmentQueue.then(async () => {
    if (unswappedReads > 0) await new Promise<void>((resolve) => { unswappedDrained = resolve })
    unswappedDrained = null
    const previous = new Map<string, string | undefined>()
    for (const [name, value] of Object.entries(active.environment)) {
      previous.set(name, process.env[name])
      process.env[name] = value
    }
    try {
      return await insideEnvironmentSwap.run(true, run)
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      environmentSwapsPending -= 1
    }
  })
  processEnvironmentQueue = task.then(() => undefined, () => undefined)
  return task
}

function defaultInstance(provider: AgentProvider): ProviderInstance {
  return {
    id: provider,
    provider,
    displayName: DEFAULT_PROVIDER_LABELS[provider],
    enabled: true,
    environment: {},
    isDefault: true,
  }
}

function normalizeEnvironment(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [name, raw] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof raw !== 'string') continue
    result[name] = raw
  }
  return result
}

function parseInstanceFile(value: unknown): ProviderInstance[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const rows = Array.isArray((value as Partial<ProviderInstanceFile>).instances)
    ? (value as Partial<ProviderInstanceFile>).instances ?? []
    : []
  const seen = new Set<string>()
  const result: ProviderInstance[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (!INSTANCE_ID_PATTERN.test(id) || seen.has(id) || !isAgentProvider(row.provider)) continue
    // Extensions opt into configured instances only when their SDK resources
    // are isolated. Do not offer duplicate labels for one shared runtime.
    if (id !== row.provider && !getProviderManifest(row.provider).supportsInstances) continue
    seen.add(id)
    const displayName = typeof row.displayName === 'string' && row.displayName.trim()
      ? row.displayName.trim()
      : DEFAULT_PROVIDER_LABELS[row.provider]
    result.push({
      id,
      provider: row.provider,
      displayName,
      ...(typeof row.accentColor === 'string' && row.accentColor.trim()
        ? { accentColor: row.accentColor.trim() }
        : {}),
      enabled: row.enabled !== false,
      environment: normalizeEnvironment(row.environment),
      ...(typeof row.executable === 'string' && row.executable.trim()
        ? { executable: row.executable.trim() }
        : {}),
      isDefault: id === row.provider,
    })
  }
  return result
}

async function readConfiguredInstances(): Promise<ProviderInstance[]> {
  let fileStat: { mtimeMs: number }
  try {
    fileStat = await stat(INSTANCE_FILE)
  } catch {
    return []
  }
  const cached = globalThis.__agentViewerProviderInstancesCache
  if (cached?.mtimeMs === fileStat.mtimeMs) return cached.instances
  try {
    const parsed = JSON.parse(await readFile(INSTANCE_FILE, 'utf8')) as unknown
    const instances = parseInstanceFile(parsed)
    globalThis.__agentViewerProviderInstancesCache = { mtimeMs: fileStat.mtimeMs, instances }
    return instances
  } catch {
    globalThis.__agentViewerProviderInstancesCache = { mtimeMs: fileStat.mtimeMs, instances: [] }
    return []
  }
}

// Providers turned off in the plugin manager. Read from the shared settings file
// (the TUI and the web daemon write it) and re-read only when it changes, since
// every instance lookup passes through here.
let disabledProvidersCache: { file: string; mtimeMs: number; disabled: ReadonlySet<string> } | undefined

function disabledPluginIds(): ReadonlySet<string> {
  const file = pluginSettingsPath()
  let mtimeMs = 0
  try { mtimeMs = statSync(file).mtimeMs } catch { /* no file: every plugin on */ }
  if (disabledProvidersCache?.file === file && disabledProvidersCache.mtimeMs === mtimeMs) return disabledProvidersCache.disabled
  const disabled = new Set(mtimeMs ? readPluginSettingsFile(file).disabled : [])
  disabledProvidersCache = { file, mtimeMs, disabled }
  return disabled
}

/** Whether the plugin manager has turned this provider off (shared settings file, mtime-cached). */
export function isProviderDisabled(provider: AgentProvider): boolean {
  return disabledPluginIds().has(providerPluginId(provider))
}

export async function listProviderInstances(): Promise<ProviderInstance[]> {
  const configured = await readConfiguredInstances()
  const configuredById = new Map(configured.map((instance) => [instance.id, instance]))
  const defaults = DEFAULT_PROVIDER_ORDER.map((provider) => configuredById.get(provider) ?? defaultInstance(provider))
  const extras = configured.filter((instance) => instance.id !== instance.provider)
  const off = disabledPluginIds()
  return [...defaults, ...extras].filter((instance) => instance.enabled && !off.has(providerPluginId(instance.provider)))
}

export async function listProviderInstanceSummaries(): Promise<ProviderInstanceSummary[]> {
  const configuredIds = new Set((await readConfiguredInstances()).map((instance) => instance.id))
  return (await listProviderInstances()).map(({ environment: _environment, executable: _executable, ...instance }) => ({
    ...instance,
    configured: configuredIds.has(instance.id),
  }))
}

export async function resolveProviderInstance(
  instanceId: string | undefined,
  provider?: AgentProvider,
): Promise<ProviderInstance> {
  const instances = await listProviderInstances()
  const requested = instanceId?.trim()
  const instance = requested
    ? instances.find((candidate) => candidate.id === requested)
    : provider
      ? instances.find((candidate) => candidate.id === provider)
      : undefined
  if (!instance) {
    throw new Error(requested
      ? `Unknown or disabled provider instance: ${requested}`
      : provider
        ? `Provider is disabled or unknown: ${provider}`
        : 'A provider instance is required')
  }
  if (provider && instance.provider !== provider) {
    throw new Error(`Provider instance ${instance.id} uses ${instance.provider}, not ${provider}`)
  }
  return instance
}

export async function withProviderInstance<T>(
  instanceId: string | undefined,
  provider: AgentProvider,
  run: () => T | Promise<T>,
): Promise<T> {
  const current = instanceStorage.getStore()?.instance
  if (current && (!instanceId || current.id === instanceId) && current.provider === provider) {
    return run()
  }
  const instance = await resolveProviderInstance(instanceId, provider)
  return instanceStorage.run({ instance }, run)
}

export function currentProviderInstance(): ProviderInstance | null {
  return instanceStorage.getStore()?.instance ?? null
}

export function currentProviderInstanceId(provider?: AgentProvider): string {
  const active = currentProviderInstance()
  return active && (!provider || active.provider === provider) ? active.id : (provider ?? 'claude')
}

export function currentProviderEnvironment(): NodeJS.ProcessEnv {
  const active = currentProviderInstance()
  return active ? { ...process.env, ...active.environment } : { ...process.env }
}

export function currentProviderEnvironmentValue(name: string): string | undefined {
  return currentProviderInstance()?.environment[name] ?? process.env[name]
}

export function currentProviderExecutable(fallback: string): string {
  return currentProviderInstance()?.executable ?? fallback
}

export async function writeProviderInstancesFile(contents: ProviderInstanceFile): Promise<void> {
  const normalized = parseInstanceFile(contents)
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(INSTANCE_FILE, JSON.stringify({
    version: 1,
    instances: normalized.map(({ isDefault: _isDefault, ...instance }) => instance),
  }, null, 2), 'utf8')
  globalThis.__agentViewerProviderInstancesCache = undefined
}
