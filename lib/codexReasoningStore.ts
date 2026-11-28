import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { currentProviderInstanceId } from './providerInstances'
import type { CodexReasoningMetadata } from './codexReasoning'

function filename(sessionId: string) {
  return path.join(process.cwd(), '.agent-viewer-data', 'codex-reasoning', encodeURIComponent(currentProviderInstanceId('codex')), `${encodeURIComponent(sessionId)}.json`)
}
export async function readCodexReasoningMetadata(sessionId: string): Promise<CodexReasoningMetadata> {
  try {
    const data: unknown = JSON.parse(await readFile(filename(sessionId), 'utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    return Object.fromEntries(Object.entries(data).filter(([, value]) => value && typeof value === 'object' && Number.isFinite(value.startedAt)
      && (value.completedAt === undefined || Number.isFinite(value.completedAt)) && (value.tokens === undefined || (Number.isFinite(value.tokens) && value.tokens >= 0))))
  } catch { return {} }
}
const writes = new Map<string, Promise<void>>()
export function saveCodexReasoningMetadata(sessionId: string, metadata: CodexReasoningMetadata): Promise<void> {
  const file = filename(sessionId)
  const write = (writes.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const prior = await readCodexReasoningMetadata(sessionId)
    const entries = Object.entries({ ...prior, ...metadata }).slice(-2000)
    await mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(Object.fromEntries(entries)), 'utf8')
    await rename(temp, file)
  })
  writes.set(file, write)
  void write.finally(() => { if (writes.get(file) === write) writes.delete(file) }).catch(() => {})
  return write
}
