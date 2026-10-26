// The plugin enablement choice on disk (.agent-viewer-data/plugins.json), shared
// by the TUI and the web daemon on one machine. Written temp-and-rename: a torn
// write reads back as unparseable JSON, which would silently turn every plugin
// back on.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { decodePluginSettings, DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from './enablement'

/** Resolved per call: smokes and the TUI chdir into a workspace after loading modules. */
export function pluginSettingsPath(): string {
  // Smokes that exercise every provider point this at an empty file, so a
  // user's own switches do not change what they test.
  if (process.env.AGENT_VIEWER_PLUGIN_SETTINGS) return process.env.AGENT_VIEWER_PLUGIN_SETTINGS
  return path.join(process.cwd(), '.agent-viewer-data', 'plugins.json')
}

export function readPluginSettingsFile(file = pluginSettingsPath()): PluginSettings {
  try {
    return decodePluginSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return DEFAULT_PLUGIN_SETTINGS
  }
}

export function writePluginSettingsFile(settings: PluginSettings, file = pluginSettingsPath()): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, `${JSON.stringify(decodePluginSettings(settings), null, 2)}\n`)
  renameSync(temp, file)
}
