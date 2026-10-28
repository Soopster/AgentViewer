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
