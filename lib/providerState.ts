import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProviderSelection } from './types'
import { isAgentProvider } from './provider'
import { resolveProviderInstance } from './providerInstances'

const PROVIDER_FILE = path.join(process.cwd(), '.agent-viewer-data', 'provider.json')

// Any provider id is a valid selection. This used to be a list of six, so
// choosing an ACP provider was saved and then read back as Claude: the choice
// did not survive a reload or a restart.
function asProviderSelection(value: unknown): ProviderSelection | null {
  return value === 'all' || isAgentProvider(value) ? value : null
}

function getDefaultProvider(): ProviderSelection {
  return asProviderSelection(process.env.AGENT_VIEWER_PROVIDER) ?? 'claude'
}

export async function getConfiguredProvider(): Promise<ProviderSelection> {
  try {
    const contents = await readFile(PROVIDER_FILE, 'utf8')
    const parsed = JSON.parse(contents) as { provider?: unknown }
    return asProviderSelection(parsed.provider) ?? 'claude'
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
