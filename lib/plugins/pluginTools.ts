// Tools a plugin or mod gives to AGENTS (not to people): a few named operations, each with a typed argument list, that
// an agent running in another program (Claude Code, Codex, OpenCode, Copilot, Pi) can call through the agent-viewer MCP
// bridge. The grammar is deliberately small — flat string/number/boolean/enum fields — so one definition converts
// faithfully to every consumer, and an argument the declaration lacks is refused rather than silently dropped
// (the failure the MCP bridge's coordinator tools were once bitten by). Browser-safe: no I/O.
export type PluginToolField =
  | { readonly t: 'string'; readonly min?: number; readonly max?: number; readonly optional?: boolean; readonly description?: string }
  | { readonly t: 'number'; readonly int?: boolean; readonly min?: number; readonly max?: number; readonly optional?: boolean; readonly description?: string }
  | { readonly t: 'boolean'; readonly optional?: boolean; readonly description?: string }
  | { readonly t: 'enum'; readonly values: readonly string[]; readonly optional?: boolean; readonly description?: string }
export type PluginToolSpec = { readonly name: string; readonly description: string; /** read: changes nothing. write: changes the app's own data (a draft, a setting); the agent's host asks the person as for any MCP tool. */ readonly scope: 'read' | 'write'; readonly fields: Readonly<Record<string, PluginToolField>> }

export const PLUGIN_TOOL_LIMITS = Object.freeze({ tools: 12, fields: 12, description: 600, fieldDescription: 200, enumValues: 24, name: 40, stringMax: 40_000, result: 16_000, nameFull: 64 })
export const PLUGIN_TOOL_NAME = /^[a-z][a-z0-9_]{0,39}$/
export const PLUGIN_TOOL_TIMEOUT_MS = 10_000

/** The name an agent sees: the plugin's id (dashes to underscores) and the tool's. */
export const pluginToolFullName = (pluginId: string, tool: string): string => `${pluginId.replace(/-/g, '_')}_${tool}`.slice(0, PLUGIN_TOOL_LIMITS.nameFull)

/** Tool specs from untrusted data (a plugin.json), or the reasons they were refused. */
export function validatePluginToolSpecs(raw: unknown): { specs: PluginToolSpec[]; problems: string[] } {
  const L = PLUGIN_TOOL_LIMITS
  const problems: string[] = [], specs: PluginToolSpec[] = []
  if (!Array.isArray(raw)) return { specs, problems: ['tools must be an array'] }
  if (raw.length > L.tools) problems.push(`at most ${L.tools} tools`)
  const names = new Set<string>()
  raw.slice(0, L.tools).forEach((entry, index) => {
    const t = entry as { name?: unknown; description?: unknown; scope?: unknown; fields?: unknown } | null
    const where = `tools[${index}]`
    if (!t || typeof t !== 'object') { problems.push(`${where} is not an object`); return }
    if (typeof t.name !== 'string' || !PLUGIN_TOOL_NAME.test(t.name)) { problems.push(`${where}.name must be lowercase letters, digits and "_" (at most ${L.name})`); return }
    if (names.has(t.name)) { problems.push(`${where}.name "${t.name}" is repeated`); return }
    names.add(t.name)
    if (typeof t.description !== 'string' || !t.description.trim() || t.description.length > L.description) problems.push(`${where}.description is required (at most ${L.description} characters)`)
    if (t.scope !== 'read' && t.scope !== 'write') problems.push(`${where}.scope must be "read" or "write"`)
    const fields: Record<string, PluginToolField> = {}
    const entries = t.fields && typeof t.fields === 'object' && !Array.isArray(t.fields) ? Object.entries(t.fields as Record<string, unknown>) : null
    if (!entries) { problems.push(`${where}.fields must be an object`); return }
    if (entries.length > L.fields) problems.push(`${where} has more than ${L.fields} fields`)
    for (const [field, spec] of entries.slice(0, L.fields)) {
      const f = spec as { t?: unknown; min?: unknown; max?: unknown; int?: unknown; values?: unknown; optional?: unknown; description?: unknown } | null
      const at = `${where}.fields.${field}`
      if (!PLUGIN_TOOL_NAME.test(field)) { problems.push(`${at}: field names are lowercase letters, digits and "_"`); continue }
      if (!f || typeof f !== 'object') { problems.push(`${at} is not an object`); continue }
      const common = { ...(f.optional === true ? { optional: true as const } : {}), ...(typeof f.description === 'string' ? { description: f.description.slice(0, L.fieldDescription) } : {}) }
      const bound = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined
      if (f.t === 'string') fields[field] = { t: 'string', ...(bound(f.min) !== undefined ? { min: bound(f.min)! } : {}), max: Math.min(bound(f.max) ?? L.stringMax, L.stringMax), ...common }
      else if (f.t === 'number') fields[field] = { t: 'number', ...(f.int === true ? { int: true as const } : {}), ...(bound(f.min) !== undefined ? { min: bound(f.min)! } : {}), ...(bound(f.max) !== undefined ? { max: bound(f.max)! } : {}), ...common }
      else if (f.t === 'boolean') fields[field] = { t: 'boolean', ...common }
      else if (f.t === 'enum' && Array.isArray(f.values) && f.values.length > 0 && f.values.length <= L.enumValues && f.values.every(value => typeof value === 'string' && value.length > 0 && value.length <= 80)) fields[field] = { t: 'enum', values: [...f.values as string[]], ...common }
      else problems.push(`${at}.t must be string, number, boolean or enum (an enum needs 1 to ${L.enumValues} string values)`)
    }
    if (!problems.some(problem => problem.startsWith(where))) specs.push({ name: t.name, description: t.description as string, scope: t.scope as 'read' | 'write', fields })
  })
  return { specs: problems.length ? [] : specs, problems }
}

/** Arguments from an agent, checked against the declaration. Unknown fields are refused, never dropped. */
export function validatePluginToolArgs(spec: PluginToolSpec, raw: unknown): { args: Record<string, string | number | boolean> } | { error: string } {
  const input = raw === undefined || raw === null ? {} : raw
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'arguments must be an object' }
  const given = input as Record<string, unknown>
  const args: Record<string, string | number | boolean> = {}
  for (const key of Object.keys(given)) if (!Object.hasOwn(spec.fields, key)) return { error: `${spec.name} takes no argument "${key.slice(0, 40)}" (it takes: ${Object.keys(spec.fields).join(', ') || 'none'})` }
  for (const [name, field] of Object.entries(spec.fields)) {
    const value = given[name]
    if (value === undefined || value === null) { if (field.optional) continue; return { error: `${spec.name} needs "${name}"` } }
    if (field.t === 'string') {
      if (typeof value !== 'string') return { error: `"${name}" must be a string` }
      if (field.min !== undefined && value.length < field.min) return { error: `"${name}" must be at least ${field.min} characters` }
      if (field.max !== undefined && value.length > field.max) return { error: `"${name}" must be at most ${field.max} characters` }
      args[name] = value
    } else if (field.t === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (field.int && !Number.isInteger(value))) return { error: `"${name}" must be ${field.int ? 'an integer' : 'a number'}` }
      if (field.min !== undefined && value < field.min) return { error: `"${name}" must be at least ${field.min}` }
      if (field.max !== undefined && value > field.max) return { error: `"${name}" must be at most ${field.max}` }
      args[name] = value
    } else if (field.t === 'boolean') {
      if (typeof value !== 'boolean') return { error: `"${name}" must be true or false` }
      args[name] = value
    } else {
      if (typeof value !== 'string' || !field.values.includes(value)) return { error: `"${name}" must be one of: ${field.values.join(', ')}` }
      args[name] = value
    }
  }
  return { args }
}

/** What a model is handed back: text, bounded. A longer result says how much was cut. */
export function boundPluginToolResult(result: unknown): string {
  const text = typeof result === 'string' ? result : result === undefined ? 'done' : JSON.stringify(result, null, 2)
  return text.length > PLUGIN_TOOL_LIMITS.result ? `${text.slice(0, PLUGIN_TOOL_LIMITS.result)}\n… ${text.length - PLUGIN_TOOL_LIMITS.result} more characters cut` : text
}
