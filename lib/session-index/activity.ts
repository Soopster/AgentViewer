import { rowToSessionRecord } from './sessionRecords'
import { optionalString, toNullableTimestamp } from './rows'
import type { IndexReader, PersistedActivity } from './types'

const MAX_ACTIVITY_SESSIONS = 500
const MAX_ACTIVITY_PROMPT_CHARS = 600

export async function queryPersistedActivity(readRows: IndexReader, fromMs: number, toMs: number): Promise<PersistedActivity> {
  const sessionSql = `
    SELECT * FROM sessions
    WHERE COALESCE(last_message_at, last_modified, 0) BETWEEN ? AND ?
       OR COALESCE(last_modified, 0) BETWEEN ? AND ?
    ORDER BY MAX(COALESCE(last_message_at, 0), COALESCE(last_modified, 0)) DESC
    LIMIT ${MAX_ACTIVITY_SESSIONS}
  `
  const sessionParams = [fromMs, toMs, fromMs, toMs]
  const sessionRows = await readRows(sessionSql, sessionParams)
  const sessions = sessionRows.flatMap((row) => rowToSessionRecord(row) ?? [])

  const promptSql = `
    SELECT session_key, timestamp_ms, substr(text, 1, ${MAX_ACTIVITY_PROMPT_CHARS}) AS text
    FROM messages
    WHERE is_prompt = 1 AND timestamp_ms BETWEEN ? AND ?
    ORDER BY timestamp_ms ASC
  `
  const editSql = `
    SELECT session_key, timestamp_ms, file_path, kind, substr(prompt, 1, ${MAX_ACTIVITY_PROMPT_CHARS}) AS prompt
    FROM file_edits
    WHERE timestamp_ms BETWEEN ? AND ?
    ORDER BY timestamp_ms ASC
  `
  const rangeParams = [fromMs, toMs]
  const [promptRows, editRows] = await Promise.all([
    readRows(promptSql, rangeParams),
    readRows(editSql, rangeParams),
  ])
  const prompts = promptRows.flatMap((row) => {
    const sessionKey = optionalString(row.session_key)
    const timestampMs = toNullableTimestamp(row.timestamp_ms)
    const text = optionalString(row.text)?.trim()
    return sessionKey && timestampMs !== null && text ? [{ sessionKey, timestampMs, text }] : []
  })
  const edits = editRows.flatMap((row) => {
    const sessionKey = optionalString(row.session_key)
    const timestampMs = toNullableTimestamp(row.timestamp_ms)
    const filePath = optionalString(row.file_path)
    if (!sessionKey || timestampMs === null || !filePath) return []
    return [{ sessionKey, timestampMs, filePath, kind: optionalString(row.kind) ?? 'edit', prompt: optionalString(row.prompt) ?? null }]
  })
  return { sessions, prompts, edits }
}
