import type { ProtocolRunSnapshot } from '../agentProtocol'

/** The board as the Chief of Staff and its panel read it: compact, bounded, no raw ids. */
export interface Workstream {
  title: string
  status: string
  owner?: string
  provider?: string
}

export interface BoardDigest {
  workstreams: Workstream[]
  /** Things only a person can move: blocked or failed work, an agent waiting on an answer. */
  needsYou: string[]
  summary: string
}

const OPEN = new Set(['pending', 'claimed', 'planning', 'planned', 'in_progress', 'blocked', 'failed'])
export const BOARD_MAX_WORKSTREAMS = 12

export function digestBoard(snapshot: ProtocolRunSnapshot | null): BoardDigest {
  if (!snapshot) return { workstreams: [], needsYou: [], summary: 'No team yet.' }
  const agentById = new Map(snapshot.agents.map(agent => [agent.id, agent]))
  const open = snapshot.tasks.filter(task => OPEN.has(task.status))
  const workstreams = open.slice(0, BOARD_MAX_WORKSTREAMS).map(task => {
    const owner = task.ownerAgentId ? agentById.get(task.ownerAgentId) : undefined
    return { title: task.title.slice(0, 100), status: task.status, ...(owner ? { owner: owner.name, provider: owner.provider } : {}) }
  })
  const needsYou = [
    ...open.filter(task => task.status === 'blocked' || task.status === 'failed').map(task => `${task.title.slice(0, 80)} is ${task.status}`),
    ...snapshot.agents.filter(agent => agent.role !== 'lead' && agent.status === 'blocked').map(agent => `${agent.name} is blocked`),
  ].slice(0, 8)
  const done = snapshot.tasks.filter(task => task.status === 'completed').length
  const rollup = snapshot.rollup
  const summary = `${open.length} open, ${done} done${rollup?.idleWarning ? `; ${rollup.idleWarning}` : ''}${rollup?.budgetWarning ? `; ${rollup.budgetWarning}` : ''}${open.length > workstreams.length ? `; ${open.length - workstreams.length} more not listed` : ''}`
  return { workstreams, needsYou, summary }
}

export function formatBoardDigest(digest: BoardDigest): string {
  const lines = digest.workstreams.length
    ? digest.workstreams.map(item => `- ${item.title} [${item.status}${item.owner ? `, ${item.owner}${item.provider ? ` (${item.provider})` : ''}` : ''}]`)
    : ['- (nothing open)']
  return ['Board: ' + digest.summary, ...lines, ...(digest.needsYou.length ? ['Needs the user:', ...digest.needsYou.map(item => `- ${item}`)] : [])].join('\n')
}
