// Node-only; settings stay outside mod source and are never served to renderers.
import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { localPluginsDir } from './localPlugins'
import { resolveModConfig, type ModConfigSchema } from './modConfig'
export function modConfigPath(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) throw new Error('Invalid mod id')
  return path.join(path.dirname(localPluginsDir()), 'mod-settings', `${id}.json`)
}
export function readModConfigValues(id: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(modConfigPath(id), 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid configuration')
    return value as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(`Cannot read configuration for ${id}`)
  }
}
export function readModConfig(id: string, schema: ModConfigSchema = {}) { return resolveModConfig(schema, readModConfigValues(id), process.env) }
export function writeModConfig(id: string, schema: ModConfigSchema, patch: unknown): void {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Config values must be an object')
  const values = { ...readModConfigValues(id), ...patch }
  resolveModConfig(Object.fromEntries(Object.entries(schema).map(([key, field]) => [key, { ...field, required: false }])), values, process.env)
  const file = modConfigPath(id), temp = `${file}.${randomUUID()}.tmp`
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  try { writeFileSync(temp, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); renameSync(temp, file) }
  finally { rmSync(temp, { force: true }) }
}
