// pstack's model roles. One line of text per role, so both editors are a text field:
// `provider[:instance] [model] [effort]`, comma separated for a panel. Pure: safe in any client.
import { COORDINATOR_PROVIDER_IDS } from '../extensions/providers/catalog'

export const PSTACK_ROLES = [
  { id: 'feature, refactoring', panel: false, hint: 'Writing features and refactors' },
  { id: 'bug-fix', panel: false, hint: 'Reproducing and fixing defects' },
  { id: 'perf-issue', panel: false, hint: 'Measured slowness' },
  { id: 'hillclimb', panel: false, hint: 'Improving one metric over many rounds' },
  { id: 'judgment and prose', panel: false, hint: 'Judgement calls and writing' },
  { id: 'swarm workers', panel: false, hint: 'Parallel workers and verification' },
  { id: 'arena runners', panel: true, hint: 'Competing attempts at one task' },
  { id: 'arena cross-judge pool', panel: true, hint: 'Judges, in order of preference' },
  { id: 'interrogate reviewers', panel: true, hint: 'Adversarial reviewers' },
] as const

export type PstackRoleId = (typeof PSTACK_ROLES)[number]['id']
export type PstackRoles = Partial<Record<PstackRoleId, string>>
export interface PstackSeat { provider: string; instance?: string; model?: string; effort?: string }
export interface PstackRoleProblem { role: string; message: string }

export const MAX_PANEL_SEATS = 6
const EFFORTS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export function parseRoleLine(role: string, line: string): { seats: PstackSeat[] } | { error: string } {
  const spec = PSTACK_ROLES.find(item => item.id === role)
  if (!spec) return { error: `Unknown role "${role}"` }
  const entries = line.split(',').map(entry => entry.trim()).filter(Boolean)
  if (!spec.panel && entries.length > 1) return { error: 'takes one model, not a list' }
  if (entries.length > MAX_PANEL_SEATS) return { error: `takes at most ${MAX_PANEL_SEATS} seats` }
  const seats: PstackSeat[] = []
  for (const entry of entries) {
    const words = entry.split(/\s+/)
    if (words.length > 3 || !/^[\w@./:\[\] -]+$/.test(entry)) return { error: `"${entry.slice(0, 80)}" is not "provider[:instance] [model] [effort]"` }
    const [target, ...rest] = words
    const colon = target!.indexOf(':')
    const provider = colon < 0 ? target! : target!.slice(0, colon)
    if (!(COORDINATOR_PROVIDER_IDS as readonly string[]).includes(provider)) return { error: `unknown provider "${provider}" (one of ${COORDINATOR_PROVIDER_IDS.join(', ')})` }
    // A lone second word is an effort when it names one, else a model.
    const effort = rest.length === 2 ? rest[1] : rest.length === 1 && EFFORTS.has(rest[0]!) ? rest[0] : undefined
    const model = rest.length === 2 ? rest[0] : effort ? undefined : rest[0]
    seats.push({ provider, ...(colon < 0 ? {} : { instance: target!.slice(colon + 1) }), ...(model ? { model } : {}), ...(effort ? { effort } : {}) })
  }
  return { seats }
}

/** The role lines the model reads. A role that is unset or invalid is left out, so it runs on the session's model. */
export function formatRoleTable(roles: PstackRoles, problems: readonly PstackRoleProblem[] = []): string {
  const bad = new Set(problems.map(problem => problem.role))
  const lines = PSTACK_ROLES.flatMap(spec => {
    const line = roles[spec.id]?.trim()
    return line && !bad.has(spec.id) && !('error' in parseRoleLine(spec.id, line)) ? [`${spec.id}: ${line}`] : []
  })
  return [
    lines.length ? lines.join('\n') : 'No role models are set: every role runs on your current model.',
    ...(bad.size ? [`NOT applied (these run on your current model): ${problems.map(problem => `${problem.role}: ${problem.message}`).join('; ')}`] : []),
  ].join('\n')
}
