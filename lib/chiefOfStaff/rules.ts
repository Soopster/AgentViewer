/**
 * Routing rules: which provider, model and effort should take which kind of work.
 * The Chief of Staff is a model, so a rule is guidance it reads, not a mechanical switch.
 * What this module guarantees is that guidance is true: a rule naming a model the provider
 * does not advertise is reported and left out of the table, never passed on silently.
 */
import { COORDINATOR_PROVIDER_IDS } from '../extensions/providers/catalog'

export const COS_PROVIDERS = COORDINATOR_PROVIDER_IDS

export interface CosRule {
  /** What kind of work this is for, in words ("frontend", "database migrations"). */
  match: string
  provider: string
  instance?: string
  model?: string
  effort?: string
  role?: string
  worktree?: boolean
}

export interface RulesProblem {
  /** 1-based position in the file; 0 for a problem with the file itself. */
  rule: number
  message: string
}

export const MAX_RULES = 40

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined

/** Reads the rules file's text. Anything wrong with a rule is a problem, not an exception. */
export function parseRules(source: string | null): { rules: CosRule[]; problems: RulesProblem[] } {
  if (source === null) return { rules: [], problems: [] }
  let parsed: unknown
  try {
    // Hand-edited: tolerate comments and trailing commas, as the other project config files do.
    parsed = JSON.parse(source.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'))
  } catch (error) {
    return { rules: [], problems: [{ rule: 0, message: `chief-of-staff.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }] }
  }
  const list = (parsed as { rules?: unknown } | null)?.rules
  if (!Array.isArray(list)) return { rules: [], problems: [{ rule: 0, message: 'chief-of-staff.json needs a "rules" array' }] }
  const rules: CosRule[] = []
  const problems: RulesProblem[] = []
  if (list.length > MAX_RULES) problems.push({ rule: 0, message: `Only the first ${MAX_RULES} rules are read` })
  list.slice(0, MAX_RULES).forEach((entry, index) => {
    const at = index + 1
    const item = (entry ?? {}) as Record<string, unknown>
    const match = text(item.match, 200)
    const provider = text(item.provider, 40)
    if (!match) { problems.push({ rule: at, message: 'has no "match" (what kind of work it is for)' }); return }
    if (!provider) { problems.push({ rule: at, message: `"${match}" has no provider` }); return }
    if (!(COS_PROVIDERS as readonly string[]).includes(provider)) { problems.push({ rule: at, message: `"${match}" names an unknown provider "${provider}"` }); return }
    rules.push({
      match, provider,
      ...(text(item.instance, 80) ? { instance: text(item.instance, 80) } : {}),
      ...(text(item.model, 120) ? { model: text(item.model, 120) } : {}),
      ...(text(item.effort, 20) ? { effort: text(item.effort, 20) } : {}),
      ...(text(item.role, 60) ? { role: text(item.role, 60) } : {}),
      ...(typeof item.worktree === 'boolean' ? { worktree: item.worktree } : {}),
    })
    ;(rules[rules.length - 1] as CosRule & { at?: number }).at = at
  })
  return { rules, problems }
}

export type SelectionCheck = (provider: string, cwd: string, model?: string, effort?: string, instance?: string) => Promise<void>

/** Checks each rule against what its provider advertises. Invalid rules come back as problems. */
export async function validateRules(rules: readonly CosRule[], cwd: string, check: SelectionCheck): Promise<{ valid: CosRule[]; problems: RulesProblem[] }> {
  const valid: CosRule[] = []
  const problems: RulesProblem[] = []
  await Promise.all(rules.map(async (rule, index) => {
    const at = (rule as CosRule & { at?: number }).at ?? index + 1
    try {
      await check(rule.provider, cwd, rule.model, rule.effort, rule.instance)
      valid[index] = rule
    } catch (error) {
      problems.push({ rule: at, message: `"${rule.match}": ${error instanceof Error ? error.message : String(error)}` })
    }
  }))
  return { valid: valid.filter(Boolean), problems: problems.sort((a, b) => a.rule - b.rule) }
}

export function formatRoutingTable(rules: readonly CosRule[], problems: readonly RulesProblem[]): string {
  const lines = rules.length
    ? rules.map(rule => `- ${rule.match} → ${rule.provider}${rule.instance ? `/${rule.instance}` : ''}${rule.model ? ` ${rule.model}` : ''}${rule.effort ? ` (${rule.effort} effort)` : ''}${rule.role ? `, role ${rule.role}` : ''}${rule.worktree === false ? ', no worktree' : ''}`)
    : ['- (no routing rules: choose a provider and model by fit)']
  const skipped = problems.length ? ['', 'Rules that were NOT applied (tell the user if one matters):', ...problems.map(problem => `- ${problem.rule ? `#${problem.rule} ` : ''}${problem.message}`)] : []
  return ['Routing table (pass these as coord_delegate provider/model/effort):', ...lines, ...skipped].join('\n')
}
