import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ActivityDismissal, ActivityDismissalStore } from '../plugins/activityFeed'

// Activity-island dismissals, kept so a dismissed row stays dismissed after the TUI restarts.
// Presentation only. Temp-and-rename, so a torn write reads back as "nothing dismissed" rather than half a list.
const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const FILE = path.join(DATA_DIR, 'island-dismissals.json')

export const tuiIslandDismissals: ActivityDismissalStore = {
  load(): readonly ActivityDismissal[] {
    let parsed: unknown
    try { parsed = JSON.parse(readFileSync(FILE, 'utf8')) } catch { return [] }
    if (!Array.isArray(parsed)) return []
    return parsed.filter((row): row is ActivityDismissal => !!row && typeof row.id === 'string' && typeof row.key === 'string' && typeof row.at === 'number')
  },
  save(rows) {
    mkdirSync(DATA_DIR, { recursive: true })
    const temp = `${FILE}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify(rows))
    renameSync(temp, FILE)
  },
}
