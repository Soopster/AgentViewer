import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** One Chief of Staff chat per repository. A file, because the TUI, daemon and schedules engine all read it. */
export interface CosEntry {
  sessionId: string
  provider: string
  cwd: string
  createdAt: number
  /** The Chief of Staff's most recent reply: what its panel shows as the latest report. */
  report?: { text: string; at: number }
}

export const COS_REPORT_MAX_CHARS = 4000

function file(): string {
  return path.join(process.env.AGENT_VIEWER_COS_DIR ?? path.join(process.cwd(), '.agent-viewer-data'), 'chief-of-staff.json')
}

export function readCosEntries(): Record<string, CosEntry> {
  try {
    if (!existsSync(file())) return {}
    const parsed = JSON.parse(readFileSync(file(), 'utf-8')) as { version?: number; repos?: Record<string, CosEntry> }
    return parsed.version === 1 && parsed.repos && typeof parsed.repos === 'object' ? parsed.repos : {}
  } catch {
    return {}
  }
}

export function setCosEntry(repoRoot: string, entry: CosEntry | null): void {
  const repos = readCosEntries()
  if (entry) repos[repoRoot] = entry
  else delete repos[repoRoot]
  mkdirSync(path.dirname(file()), { recursive: true })
  const temporary = `${file()}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify({ version: 1, repos }, null, 2), { encoding: 'utf-8', mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, file())
}

export function cosEntryForSession(sessionId: string): { repoRoot: string; entry: CosEntry } | null {
  for (const [repoRoot, entry] of Object.entries(readCosEntries())) if (entry.sessionId === sessionId) return { repoRoot, entry }
  return null
}

/** Keeps the session's newest reply. A reply that says nothing never replaces one that did. */
export function setCosReport(sessionId: string, text: string, at = Date.now()): void {
  const found = cosEntryForSession(sessionId)
  const trimmed = text.trim()
  if (!found || !trimmed) return
  setCosEntry(found.repoRoot, { ...found.entry, report: { text: trimmed.slice(0, COS_REPORT_MAX_CHARS), at } })
}
