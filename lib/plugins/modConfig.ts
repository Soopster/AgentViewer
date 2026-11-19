// Browser-safe configuration schema. Values are resolved only on the server.
export type ModConfigValue = string | number | boolean
export type ModConfigField = {
  readonly type: 'string' | 'number' | 'boolean'
  readonly title: string
  readonly description?: string
  readonly required?: boolean
  readonly default?: ModConfigValue
  readonly enum?: readonly string[]
  readonly min?: number
  readonly max?: number
  /** Environment variable reference; no secret value is persisted or sent to a renderer. */
  readonly secretEnv?: string
}
export type ModConfigSchema = Readonly<Record<string, ModConfigField>>
export function parseModConfigSchema(raw: unknown): ModConfigSchema {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config must be an object')
  const result: Record<string, ModConfigField> = Object.create(null)
  if (Object.keys(raw).length > 50) throw new Error('config supports at most 50 fields')
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[a-z][a-zA-Z0-9_]{0,47}$/.test(key) || !value || typeof value !== 'object') throw new Error(`Invalid config field ${key}`)
    const f = value as ModConfigField
    if (!['string', 'number', 'boolean'].includes(f.type) || typeof f.title !== 'string' || !f.title.trim() || f.title.length > 120) throw new Error(`Invalid config field ${key}`)
    if (f.required !== undefined && typeof f.required !== 'boolean') throw new Error(`Invalid required flag for ${key}`)
    if (f.description !== undefined && (typeof f.description !== 'string' || f.description.length > 1000)) throw new Error(`Invalid description for ${key}`)
    if (f.enum !== undefined && (f.type !== 'string' || !Array.isArray(f.enum) || !f.enum.length || f.enum.length > 100 || f.enum.some(v => typeof v !== 'string' || v.length > 2000) || new Set(f.enum).size !== f.enum.length)) throw new Error(`Invalid enum for ${key}`)
    if ([f.min, f.max].some(v => v !== undefined && (f.type !== 'number' || !Number.isFinite(v))) || (f.min !== undefined && f.max !== undefined && f.min > f.max)) throw new Error(`Invalid bounds for ${key}`)
    if (f.secretEnv !== undefined && (f.type !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.secretEnv) || f.default !== undefined || f.enum !== undefined)) throw new Error(`Invalid secretEnv for ${key}`)
    const field = { type: f.type, title: f.title, ...(f.description !== undefined ? { description: f.description } : {}), ...(f.required !== undefined ? { required: f.required } : {}), ...(f.default !== undefined ? { default: f.default } : {}), ...(f.enum ? { enum: [...f.enum] } : {}), ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}), ...(f.secretEnv ? { secretEnv: f.secretEnv } : {}) }
    if (field.default !== undefined) validateValue(key, field, field.default)
    result[key] = field
  }
  return result
}
function validateValue(key: string, field: ModConfigField, value: unknown): asserts value is ModConfigValue {
  if (typeof value !== field.type || (typeof value === 'string' && value.length > 10000) || (typeof value === 'number' && (!Number.isFinite(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) || (field.enum && !field.enum.includes(value as string))) throw new Error(`Invalid config value for ${key}`)
}
export function resolveModConfig(schema: ModConfigSchema = {}, raw: unknown = {}, env: Record<string, string | undefined> = {}): Readonly<Record<string, ModConfigValue>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Config values must be an object')
  for (const key of Object.keys(raw)) if (!Object.hasOwn(schema, key) || schema[key]!.secretEnv) throw new Error(`Config field ${key} is unknown or uses secretEnv`)
  const result: Record<string, ModConfigValue> = Object.create(null)
  for (const [key, field] of Object.entries(schema)) {
    const value = field.secretEnv ? env[field.secretEnv] : Object.hasOwn(raw, key) ? (raw as Record<string, unknown>)[key] : field.default
    if (value === undefined) { if (field.required) throw new Error(`Missing config value for ${key}`); continue }
    validateValue(key, field, value)
    result[key] = value
  }
  return Object.freeze(result)
}
