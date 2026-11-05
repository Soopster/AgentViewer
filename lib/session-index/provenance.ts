import { isAgentProvider } from '../provider'
import type { FileEditKind } from '../provenanceExtract'
import type { IndexReader, Row, PersistedFileEditRecord } from './types'

function rowToFileEditRecord(row: Row): PersistedFileEditRecord | null {
  const filePath = typeof row.file_path === 'string' ? row.file_path : null
  const provider = typeof row.provider === 'string' && isAgentProvider(row.provider) ? row.provider : null
  if (!filePath || !provider) return null
  let addedLines: string[] = []
  try {
    const parsed = JSON.parse(typeof row.added_lines_json === 'string' ? row.added_lines_json : '[]')
    if (Array.isArray(parsed)) addedLines = parsed.filter((line): line is string => typeof line === 'string')
  } catch {
    addedLines = []
  }
  const kindRaw = typeof row.kind === 'string' ? row.kind : 'touch'
  const kind: FileEditKind = kindRaw === 'edit' || kindRaw === 'write' || kindRaw === 'patch' ? kindRaw : 'touch'
  return {
    id: typeof row.id === 'number' ? row.id : Number(row.id ?? 0),
    sessionKey: typeof row.session_key === 'string' ? row.session_key : '',
    provider,
    sessionId: typeof row.session_id === 'string' ? row.session_id : '',
    messageUuid: typeof row.message_uuid === 'string' ? row.message_uuid : '',
    timestampMs: typeof row.timestamp_ms === 'number' ? row.timestamp_ms : null,
    tool: typeof row.tool === 'string' ? row.tool : 'unknown',
    kind,
    filePath,
    addedLines,
    prompt: typeof row.prompt === 'string' ? row.prompt : null,
    model: typeof row.model === 'string' ? row.model : null,
    sessionTitle:
      typeof row.session_custom_title === 'string' && row.session_custom_title
        ? row.session_custom_title
        : typeof row.session_title === 'string'
          ? row.session_title
          : null,
    sessionCwd: typeof row.session_cwd === 'string' ? row.session_cwd : null,
  }
}

const FILE_EDIT_SELECT = `
  SELECT
    fe.*,
    s.title AS session_title,
    s.custom_title AS session_custom_title,
    s.cwd AS session_cwd
  FROM file_edits fe
  LEFT JOIN sessions s ON s.key = fe.session_key
`

/**
 * All recorded edits that plausibly target the given file, oldest first.
 * Matches on the exact absolute path, the exact repo-relative path, or a
 * '/'-anchored suffix (edits recorded from other checkouts/worktrees of the
 * same repo still resolve). SQL pre-narrows; the suffix check is re-verified
 * in JS because LIKE treats '_' as a wildcard.
 */
export async function queryFileEditsForFile(
  readRows: IndexReader,
  absolutePath: string,
  relativePath?: string | null,
): Promise<PersistedFileEditRecord[]> {
  const where: string[] = ['fe.file_path = ?']
  const params: unknown[] = [absolutePath]
  if (relativePath) {
    where.push('fe.file_path = ?', 'fe.file_path LIKE ?')
    params.push(relativePath, `%/${relativePath}`)
  }
  const sql = `${FILE_EDIT_SELECT} WHERE ${where.join(' OR ')} ORDER BY COALESCE(fe.timestamp_ms, 0) ASC, fe.id ASC`
  const rows = await readRows(sql, params)
  const records: PersistedFileEditRecord[] = []
  for (const row of rows) {
    const record = rowToFileEditRecord(row)
    if (!record) continue
    const matches =
      record.filePath === absolutePath ||
      (relativePath != null && (record.filePath === relativePath || record.filePath.endsWith(`/${relativePath}`)))
    if (matches) records.push(record)
  }
  return records
}

/** Every recorded edit made by one session, oldest first. */
export async function queryFileEditsForSession(
  readRows: IndexReader,
  sessionKey: string,
): Promise<PersistedFileEditRecord[]> {
  const sql = `${FILE_EDIT_SELECT} WHERE fe.session_key = ? ORDER BY COALESCE(fe.timestamp_ms, 0) ASC, fe.id ASC`
  const params = [sessionKey]
  const rows = await readRows(sql, params)
  const records: PersistedFileEditRecord[] = []
  for (const row of rows) {
    const record = rowToFileEditRecord(row)
    if (record) records.push(record)
  }
  return records
}
