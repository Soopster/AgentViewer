import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProviderSelection } from './types'

const PROVIDER_FILE = path.join(process.cwd(), '.agent-viewer-data', 'provider.json')

export function getDefaultProvider(): ProviderSelection {
  if (process.env.AGENT_VIEWER_PROVIDER === 'all') return 'all'
  if (process.env.AGENT_VIEWER_PROVIDER === 'codex') return 'codex'
  if (process.env.AGENT_VIEWER_PROVIDER === 'opencode') return 'opencode'
  if (process.env.AGENT_VIEWER_PROVIDER === 'copilot') return 'copilot'
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
    return 'claude'
  } catch {
    return getDefaultProvider()
  }
}

export async function setConfiguredProvider(provider: ProviderSelection): Promise<void> {
  await mkdir(path.dirname(PROVIDER_FILE), { recursive: true })
  await writeFile(PROVIDER_FILE, JSON.stringify({ provider }, null, 2), 'utf8')
}
