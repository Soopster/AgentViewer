// Where each session had been read to when its window was last left. Its own small
// file: the reader's state is dropped when it is the default (following the tail),
// which is exactly when "what is new since" matters.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type LastSeen = { cardKey: string; at: number }
const MAX_ENTRIES = 200
const file = () => path.join(process.cwd(), '.agent-viewer-data', 'tui-last-seen.json')

function readAll(): Record<string, LastSeen> {
  try {
    if (!existsSync(file())) return {}
    const parsed = JSON.parse(readFileSync(file(), 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, LastSeen> : {}
  } catch {
    return {}
  }
}

export function readLastSeen(sessionKey: string): LastSeen | null {
  const entry = readAll()[sessionKey]
  return entry && typeof entry.cardKey === 'string' && typeof entry.at === 'number' ? entry : null
}

export function writeLastSeen(sessionKey: string, entry: LastSeen): void {
  const all = readAll()
  delete all[sessionKey]
  all[sessionKey] = entry
  const keys = Object.keys(all)
  for (const key of keys.slice(0, Math.max(keys.length - MAX_ENTRIES, 0))) delete all[key]
  try {
    mkdirSync(path.dirname(file()), { recursive: true })
    const temporary = `${file()}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(all), 'utf-8')
    renameSync(temporary, file())
  } catch {
    // Best effort: losing it only means no divider next time.
  }
}
