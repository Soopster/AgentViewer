import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createLayoutStore } from '../layout'

const file = () => path.join(process.cwd(), '.agent-viewer-data', 'omni-bar.json')

/** The TUI's layout lives beside the other local state; written temp-and-rename so a torn write never reads as a layout. */
export const omniLayoutStore = createLayoutStore({
  read: () => { try { return JSON.parse(readFileSync(file(), 'utf8')) } catch { return null } },
  write: layout => {
    const target = file()
    mkdirSync(path.dirname(target), { recursive: true })
    const temp = `${target}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(layout, null, 2))
    renameSync(temp, target)
  },
})
