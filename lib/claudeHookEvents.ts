import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { HookInput } from '@anthropic-ai/claude-agent-sdk'

export type ClaudeHookEventRecord = {
  id: string
  sessionId: string
  timestamp: string
  event: string
  toolUseId?: string
  summary: string
  payload: Record<string, unknown>
}

const HOOK_DIR = path.join(process.cwd(), '.agent-viewer-data', 'claude-hook-events')
const MAX_HOOK_FILE_BYTES = 8 * 1024 * 1024
const REDACTED_KEY = /(authorization|api[-_]?key|token|secret|password|cookie|credential)/i

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerClaudeHookWrites: Map<string, Promise<void>> | undefined
}

const writeTails = globalThis.__agentViewerClaudeHookWrites
  ?? (globalThis.__agentViewerClaudeHookWrites = new Map<string, Promise<void>>())

function fileFor(sessionId: string): string {
  const digest = createHash('sha256').update(sessionId).digest('hex')
  return path.join(HOOK_DIR, `${digest}.jsonl`)
}

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth limit]'
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeValue(item, depth + 1))
  if (!value || typeof value !== 'object') return String(value)
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [
    key,
    REDACTED_KEY.test(key) ? '[redacted]' : safeValue(item, depth + 1),
  ]))
}

function summarize(input: Record<string, unknown>): string {
  const event = String(input.hook_event_name ?? 'Hook')
  const subject = [input.tool_name, input.agent_type, input.task_id, input.source, input.file_path]
    .find((value) => typeof value === 'string' && value.trim())
  const detail = [input.message, input.error, input.reason]
    .find((value) => typeof value === 'string' && value.trim())
  return [event, subject, detail].filter(Boolean).join(' · ').slice(0, 500)
}

export async function appendClaudeHookEvent(
  sessionId: string,
  input: HookInput,
  toolUseId?: string,
): Promise<ClaudeHookEventRecord> {
  const raw = input as unknown as Record<string, unknown>
  const payload = safeValue(raw) as Record<string, unknown>
  const record: ClaudeHookEventRecord = {
    id: randomUUID(),
    sessionId,
    timestamp: new Date().toISOString(),
    event: String(raw.hook_event_name ?? 'Hook'),
    ...(toolUseId ? { toolUseId } : {}),
    summary: summarize(raw),
    payload,
  }
  const prior = writeTails.get(sessionId) ?? Promise.resolve()
  const next = prior.catch(() => {}).then(async () => {
    await mkdir(HOOK_DIR, { recursive: true })
    const file = fileFor(sessionId)
    const size = await stat(file).then((info) => info.size).catch(() => 0)
    if (size >= MAX_HOOK_FILE_BYTES) {
      await rename(file, `${file}.1`).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
  })
  writeTails.set(sessionId, next)
  await next.finally(() => {
    if (writeTails.get(sessionId) === next) writeTails.delete(sessionId)
  })
  return record
}

export async function listClaudeHookEvents(
  sessionId: string,
  options: { query?: string; limit?: number } = {},
): Promise<ClaudeHookEventRecord[]> {
  await writeTails.get(sessionId)?.catch(() => {})
  const file = fileFor(sessionId)
  const readOptional = (target: string) => readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  const [rotated, current] = await Promise.all([readOptional(`${file}.1`), readOptional(file)])
  const content = `${rotated}${current}`
  const query = options.query?.trim().toLowerCase()
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)))
  const records = content.split('\n').filter(Boolean).flatMap((line) => {
    try {
      const record = JSON.parse(line) as ClaudeHookEventRecord
      return record.sessionId === sessionId ? [record] : []
    } catch {
      return []
    }
  })
  return records
    .filter((record) => !query || `${record.event}\n${record.summary}\n${JSON.stringify(record.payload)}`.toLowerCase().includes(query))
    .slice(-limit)
    .reverse()
}

export async function deleteClaudeHookEvents(sessionId: string): Promise<void> {
  await writeTails.get(sessionId)?.catch(() => {})
  const file = fileFor(sessionId)
  await Promise.all([rm(file, { force: true }), rm(`${file}.1`, { force: true })])
}
