import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProviderSelection } from './types'
import { resolveProviderInstance } from './providerInstances'

const PROVIDER_FILE = path.join(process.cwd(), '.agent-viewer-data', 'provider.json')

function getDefaultProvider(): ProviderSelection {
  if (process.env.AGENT_VIEWER_PROVIDER === 'all') return 'all'
  if (process.env.AGENT_VIEWER_PROVIDER === 'codex') return 'codex'
  if (process.env.AGENT_VIEWER_PROVIDER === 'opencode') return 'opencode'
  if (process.env.AGENT_VIEWER_PROVIDER === 'copilot') return 'copilot'
  if (process.env.AGENT_VIEWER_PROVIDER === 'pi') return 'pi'
  if (process.env.AGENT_VIEWER_PROVIDER === 'lmstudio') return 'lmstudio'
  return 'claude'
}

export async function getConfiguredProvider(): Promise<ProviderSelection> {
  try {
    const contents = await readFile(PROVIDER_FILE, 'utf8')
    const parsed = JSON.parse(contents) as { provider?: unknown }
    if (parsed.provider === 'all') return 'all'
    if (parsed.provider === 'codex') return 'codex'
    if (parsed.provider === 'opencode') return 'opencode'
    if (parsed.provider === 'copilot') return 'copilot'
    if (parsed.provider === 'pi') return 'pi'
    if (parsed.provider === 'lmstudio') return 'lmstudio'
    return 'claude'
  } catch {
    return getDefaultProvider()
  }
}

export type ConfiguredProviderTarget = {
  provider: ProviderSelection
  providerInstanceId?: string
}

export async function getConfiguredProviderTarget(): Promise<ConfiguredProviderTarget> {
  try {
    const contents = await readFile(PROVIDER_FILE, 'utf8')
    const parsed = JSON.parse(contents) as { provider?: unknown; providerInstanceId?: unknown }
    const provider = await getConfiguredProvider()
    if (provider === 'all') return { provider }
    const requested = typeof parsed.providerInstanceId === 'string' ? parsed.providerInstanceId : provider
    const instance = await resolveProviderInstance(requested, provider).catch(() => resolveProviderInstance(provider, provider))
    return { provider, providerInstanceId: instance.id }
  } catch {
    const provider = getDefaultProvider()
    return provider === 'all' ? { provider } : { provider, providerInstanceId: provider }
  }
}

export async function setConfiguredProvider(provider: ProviderSelection): Promise<void> {
  return setConfiguredProviderTarget({ provider, ...(provider === 'all' ? {} : { providerInstanceId: provider }) })
}

export async function setConfiguredProviderTarget(target: ConfiguredProviderTarget): Promise<void> {
  const providerInstanceId = target.provider === 'all'
    ? undefined
    : (await resolveProviderInstance(target.providerInstanceId, target.provider)).id
  await mkdir(path.dirname(PROVIDER_FILE), { recursive: true })
  await writeFile(PROVIDER_FILE, JSON.stringify({
    provider: target.provider,
    ...(providerInstanceId ? { providerInstanceId } : {}),
  }, null, 2), 'utf8')
}
