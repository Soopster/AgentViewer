import { normalizeProjectPath, sameProjectPath } from '../projectPaths'
import { rowToSessionRecord } from './sessionRecords'
import type { IndexReader, PersistedIndexFilters, PersistedSessionRecord } from './types'

function matchesFilters(session: PersistedSessionRecord, filters: PersistedIndexFilters): boolean {
  if (filters.provider && filters.provider !== 'all' && session.provider !== filters.provider) return false
  const dir = normalizeProjectPath(filters.dir)
  if (!dir) return true
  const cwd = normalizeProjectPath(session.cwd)
  if (!cwd) return false
  return filters.includeWorktrees === false ? cwd === dir : sameProjectPath(dir, cwd)
}

// SQL prefilters exact paths; JS preserves worktree/basename matching.
export async function selectFilteredSessions(readRows: IndexReader, filters: PersistedIndexFilters): Promise<PersistedSessionRecord[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filters.provider && filters.provider !== 'all') {
    where.push('provider = ?')
    params.push(filters.provider)
  }
  const dir = normalizeProjectPath(filters.dir)
  if (dir && filters.includeWorktrees === false) {
    where.push('cwd = ?')
    params.push(dir)
  }
  if (Number.isFinite(filters.sinceMs)) {
    where.push('last_message_at >= ?')
    params.push(filters.sinceMs)
  }
  if (Number.isFinite(filters.untilMs)) {
    where.push('last_message_at < ?')
    params.push(filters.untilMs)
  }
  if (filters.hasError) where.push('key IN (SELECT session_key FROM message_tools WHERE is_error = 1)')
  const touched = filters.touchedFile?.trim()
  if (touched) {
    where.push('key IN (SELECT session_key FROM file_edits WHERE instr(lower(file_path), lower(?)) > 0)')
    params.push(touched)
  }
  const sql = where.length === 0
    ? 'SELECT * FROM sessions'
    : `SELECT * FROM sessions WHERE ${where.join(' AND ')}`
  const rows = await readRows(sql, params)
  const records: PersistedSessionRecord[] = []
  for (const row of rows) {
    const session = rowToSessionRecord(row)
    if (session) records.push(session)
  }
  // Re-check via matchesFilters for the worktree/basename case which is
  // expensive to express purely in SQL.
  return records.filter((session) => matchesFilters(session, filters))
}
