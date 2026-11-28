// What both panels show. Pure.
import { PSTACK_ROLES, type PstackRoleId } from '../../lib/pstack/roles'
import type { PstackState } from '../../lib/pstack/service'

export type PstackRoleRow = { id: PstackRoleId; panel: boolean; hint: string; line: string; problem: string | null }

export function roleRows(state: PstackState): PstackRoleRow[] {
  return PSTACK_ROLES.map(spec => ({ ...spec, line: state.roles[spec.id] ?? '', problem: state.problems.find(item => item.role === spec.id)?.message ?? null }))
}
export const fileProblems = (state: PstackState) => state.problems.filter(item => !PSTACK_ROLES.some(spec => spec.id === item.role))
export const ROLE_FORMAT = 'provider[:instance] [model] [effort]'
export const roleValue = (row: PstackRoleRow) => row.line || 'session model'
export const USAGE_LINES = ['/pstack <task>  routes the task through poteto-mode', '/pstack /interrogate <change>  or any other skill by name'] as const
