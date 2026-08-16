import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

// LM Studio exposes an OpenAI-compatible REST server (default localhost:1234)
// with no server-side session/thread concept — every request carries the full
// message history. Agent Viewer supplies the missing session layer itself:
// each session is one JSON file under .agent-viewer-data/lmstudio-sessions/,
// holding the full chat history plus local-only title/tag/model metadata.
const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data', 'lmstudio-sessions')

export function lmstudioBaseUrl(): string {
  return (process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1').replace(/\/+$/, '')
}

export type LmstudioMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  model?: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

export type LmstudioSessionRecord = {
  id: string
  cwd: string
  title?: string
  tag?: string
  model?: string
  createdAt: string
  lastModified: string
  messages: LmstudioMessage[]
}

function sessionPath(sessionId: string): string {
  // Session ids are server-generated UUIDs (see createLmstudioSession) — safe to
  // use directly as a filename component.
  return path.join(DATA_DIR, `${sessionId}.json`)
}

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
}

export async function listLmstudioSessions(): Promise<LmstudioSessionRecord[]> {
  await ensureDataDir()
  let files: string[]
  try {
    files = await readdir(DATA_DIR)
  } catch {
    return []
  }
  const records = await Promise.all(
    files.filter((f) => f.endsWith('.json')).map(async (file) => {
      try {
        const raw = await readFile(path.join(DATA_DIR, file), 'utf8')
        return JSON.parse(raw) as LmstudioSessionRecord
      } catch {
        return null
      }
    }),
  )
  return records.filter((r): r is LmstudioSessionRecord => r !== null)
    .sort((a, b) => Date.parse(b.lastModified) - Date.parse(a.lastModified))
}

export async function getLmstudioSession(sessionId: string): Promise<LmstudioSessionRecord | null> {
  try {
    const raw = await readFile(sessionPath(sessionId), 'utf8')
    return JSON.parse(raw) as LmstudioSessionRecord
  } catch {
    return null
  }
}

async function saveLmstudioSession(record: LmstudioSessionRecord): Promise<void> {
  await ensureDataDir()
  await writeFile(sessionPath(record.id), JSON.stringify(record, null, 2), 'utf8')
}

export async function createLmstudioSession(cwd: string, title?: string): Promise<LmstudioSessionRecord> {
  const { randomUUID } = await import('node:crypto')
  const now = new Date().toISOString()
  const record: LmstudioSessionRecord = {
    id: randomUUID(),
    cwd,
    title: title?.trim() || undefined,
    createdAt: now,
    lastModified: now,
    messages: [],
  }
  await saveLmstudioSession(record)
  return record
}

export async function deleteLmstudioSession(sessionId: string): Promise<void> {
  await unlink(sessionPath(sessionId)).catch(() => {})
}

export async function patchLmstudioSession(sessionId: string, patch: { title?: string | null; tag?: string | null }): Promise<void> {
  const record = await getLmstudioSession(sessionId)
  if (!record) throw new Error(`LM Studio session not found: ${sessionId}`)
  if ('title' in patch) record.title = patch.title?.trim() || undefined
  if ('tag' in patch) record.tag = patch.tag?.trim() || undefined
  await saveLmstudioSession(record)
}

export async function appendLmstudioTurn(
  sessionId: string,
  userText: string,
  assistantText: string,
  model: string | undefined,
  usage: { promptTokens?: number; completionTokens?: number } | undefined,
): Promise<LmstudioSessionRecord> {
  const record = await getLmstudioSession(sessionId)
  if (!record) throw new Error(`LM Studio session not found: ${sessionId}`)
  const { randomUUID } = await import('node:crypto')
  const now = new Date().toISOString()
  record.messages.push({ id: randomUUID(), role: 'user', content: userText, createdAt: now })
  record.messages.push({ id: randomUUID(), role: 'assistant', content: assistantText, createdAt: now, model, usage })
  record.lastModified = now
  if (model) record.model = model
  if (!record.title) record.title = userText.slice(0, 80)
  await saveLmstudioSession(record)
  return record
}

export type LmstudioModel = { id: string }

export async function listLmstudioModels(): Promise<LmstudioModel[]> {
  const res = await fetch(`${lmstudioBaseUrl()}/models`)
  if (!res.ok) {
    throw new Error(`LM Studio server error (${res.status}). Is LM Studio running with the local server enabled?`)
  }
  const body = await res.json() as { data?: Array<{ id: string }> }
  return (body.data ?? []).map((m) => ({ id: m.id }))
}

export type LmstudioChatDelta = { content?: string; done: boolean; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }

/**
 * Stream a chat completion from LM Studio's OpenAI-compatible endpoint,
 * invoking `onDelta` for each token chunk. Returns the full assistant text.
 */
export async function streamLmstudioChatCompletion(
  history: LmstudioMessage[],
  userText: string,
  model: string | undefined,
  signal: AbortSignal,
  onDelta: (chunk: LmstudioChatDelta) => void,
): Promise<{ text: string; model?: string; usage?: { promptTokens?: number; completionTokens?: number } }> {
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: userText },
  ]
  const res = await fetch(`${lmstudioBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || undefined, messages, stream: true }),
    signal,
  })
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new Error(`LM Studio request failed (${res.status}). ${body || 'Is LM Studio running with the local server enabled?'}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usedModel: string | undefined
  let usage: { promptTokens?: number; completionTokens?: number } | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const parsed = JSON.parse(payload) as {
          model?: string
          choices?: Array<{ delta?: { content?: string } }>
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        if (parsed.model) usedModel = parsed.model
        if (parsed.usage) {
          usage = { promptTokens: parsed.usage.prompt_tokens, completionTokens: parsed.usage.completion_tokens }
        }
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          text += delta
          onDelta({ content: delta, done: false, model: parsed.model, usage: parsed.usage })
        }
      } catch {
        // Ignore malformed SSE lines (e.g. a stray keep-alive comment).
      }
    }
  }
  onDelta({ done: true, model: usedModel, usage: usage ? { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens } : undefined })
  return { text, model: usedModel, usage }
}
