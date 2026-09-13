export type FieldSpec =
  | { t: 'string'; min?: number; max?: number; optional?: boolean }
  | { t: 'enum'; values: readonly [string, ...string[]]; optional?: boolean }
  | { t: 'number'; int?: boolean; min?: number; max?: number; optional?: boolean }
  | { t: 'boolean'; optional?: boolean }
  | { t: 'stringArray'; min?: number; max?: number; optional?: boolean }

export type ToolSpec = {
  name: string
  description: string
  fields: Record<string, FieldSpec>
  action: string
  mapArgs: (args: Record<string, any>) => Record<string, unknown>
}

export const COORD_TOOL_SPECS: ToolSpec[]
export const COORD_FINDING_DETAIL_MAX_CHARS: number
