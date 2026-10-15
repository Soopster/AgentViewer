// getSessionMessages() currently strips SDK tool_use_result sidecars. Retain
// only the artifact/app sidecars observed through the SDK, never raw transcripts.
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { extractClaudeStreamToolResults } from './claudeMapper'
import { currentProviderInstanceId } from './providerInstances'
import type { ApiMessage, SessionMessage, ToolResultBlock } from './types'

type Artifact = Pick<ToolResultBlock, 'resourceLinks' | 'structuredContent' | 'mcpMeta'>
const MAX_ENTRIES = 32
const MAX_APP_DATA = 128_000

export function createClaudeArtifactStore(directory: string) {
  const writes = new Map<string, Promise<void>>()
  function filename(sessionId: string, instanceId: string) {
    const key = createHash('sha256').update(JSON.stringify([instanceId, sessionId])).digest('hex')
    return path.join(directory, `${key}.json`)
  }
  async function read(file: string): Promise<Record<string, Artifact>> {
    try {
      if ((await stat(file)).size > MAX_ENTRIES * (MAX_APP_DATA + 100_000)) return {}
      const value = JSON.parse(await readFile(file, 'utf8'))
      return value?.version === 1 && value.results && typeof value.results === 'object' && !Array.isArray(value.results) ? value.results : {}
    } catch { return {} }
  }
  return {
    async capture(sessionId: string, message: unknown, instanceId = currentProviderInstanceId('claude')): Promise<void> {
      const results = extractClaudeStreamToolResults(message).filter(result =>
        result.resourceLinks?.length || result.structuredContent !== undefined || result.mcpMeta)
      if (!results.length) return
      const file = filename(sessionId, instanceId)
      const pending = (writes.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
        const stored = new Map(Object.entries(await read(file)))
        for (const result of results) {
          const appData = { structuredContent: result.structuredContent, mcpMeta: result.mcpMeta }
          const artifact: Artifact = {
            ...(result.resourceLinks?.length ? { resourceLinks: result.resourceLinks } : {}),
            ...(JSON.stringify(appData).length <= MAX_APP_DATA ? appData : {}),
          }
          stored.delete(result.tool_use_id)
          stored.set(result.tool_use_id, artifact)
        }
        while (stored.size > MAX_ENTRIES) stored.delete(stored.keys().next().value!)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        const temporary = `${file}.${process.pid}.tmp`
        await writeFile(temporary, JSON.stringify({ version: 1, results: Object.fromEntries(stored) }), { mode: 0o600 })
        await rename(temporary, file)
      })
      writes.set(file, pending)
      try { await pending } finally { if (writes.get(file) === pending) writes.delete(file) }
    },
    async token(sessionId: string, instanceId = currentProviderInstanceId('claude')): Promise<string> {
      const file = filename(sessionId, instanceId)
      await writes.get(file)?.catch(() => {})
      try { const info = await stat(file); return `${info.mtimeMs}:${info.size}` } catch { return 'none' }
    },
    async hydrate(sessionId: string, messages: SessionMessage[], instanceId = currentProviderInstanceId('claude')): Promise<SessionMessage[]> {
      const file = filename(sessionId, instanceId)
      await writes.get(file)?.catch(() => {})
      const stored = await read(file)
      return messages.map(message => {
        if (message.type !== 'user') return message
        const api = message.message as ApiMessage
        if (!Array.isArray(api.content)) return message
        let changed = false
        const content = api.content.map(block => {
          if (block.type !== 'tool_result') return block
          const result = block as ToolResultBlock
          const artifact = Object.hasOwn(stored, result.tool_use_id) ? stored[result.tool_use_id] : undefined
          if (!artifact) return block
          changed = true
          return { ...result, ...artifact }
        })
        return changed ? { ...message, message: { ...api, content } } : message
      })
    },
  }
}

export const claudeArtifactStore = createClaudeArtifactStore(path.join(process.cwd(), '.agent-viewer-data', 'claude-artifacts'))
