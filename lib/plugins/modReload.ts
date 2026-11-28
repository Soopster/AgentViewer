// Explicit reload requests shared by local Web daemons and TUI processes.
// Reading the marker never imports executable mod code.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
export type ModReloadRequest = { readonly revision: string; readonly developmentDirs: readonly string[] }
export function modReloadPath(): string {
  const plugins = process.env.AGENT_VIEWER_PLUGINS_DIR ? path.resolve(process.env.AGENT_VIEWER_PLUGINS_DIR) : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'agent-viewer', 'plugins')
  return path.join(path.dirname(plugins), 'mods-reload.json')
}
export function readModReloadRequest(): ModReloadRequest {
  try {
    const value = JSON.parse(readFileSync(modReloadPath(), 'utf8'))
    if (typeof value?.revision !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.revision) || !Array.isArray(value.developmentDirs) || value.developmentDirs.length > 20 || value.developmentDirs.some((dir: unknown) => typeof dir !== 'string' || !path.isAbsolute(dir))) throw new Error('Invalid reload marker')
    return { revision: value.revision, developmentDirs: value.developmentDirs }
  } catch { return { revision: 'initial', developmentDirs: [] } }
}
export function requestModReload(developmentDirs?: readonly string[]): ModReloadRequest {
  const dirs = developmentDirs ?? readModReloadRequest().developmentDirs
  if (dirs.length > 20) throw new Error('At most 20 development directories may be loaded')
  const value = { revision: randomUUID(), developmentDirs: [...new Set(dirs.map(dir => path.resolve(dir)))] }
  const file = modReloadPath(), temporary = `${file}.${randomUUID()}.tmp`
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  try { writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); renameSync(temporary, file) }
  finally { rmSync(temporary, { force: true }) }
  return value
}
