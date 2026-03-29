import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentProvider } from './types'

const PROVIDER_FILE = path.join(process.cwd(), '.agent-viewer-data', 'provider.json')

export function getDefaultProvider(): AgentProvider {
  if (process.env.AGENT_VIEWER_PROVIDER === 'codex') return 'codex'
  if (process.env.AGENT_VIEWER_PROVIDER === 'opencode') return 'opencode'
  return 'claude'
}

export async function getConfiguredProvider(): Promise<AgentProvider> {
  try {
    const contents = await readFile(PROVIDER_FILE, 'utf8')
    const parsed = JSON.parse(contents) as { provider?: unknown }
    if (parsed.provider === 'codex') return 'codex'
    if (parsed.provider === 'opencode') return 'opencode'
    return 'claude'
  } catch {
    return getDefaultProvider()
  }
}

export async function setConfiguredProvider(provider: AgentProvider): Promise<void> {
  await mkdir(path.dirname(PROVIDER_FILE), { recursive: true })
  await writeFile(PROVIDER_FILE, JSON.stringify({ provider }, null, 2), 'utf8')
}
