import type { ProtocolRunSnapshot } from '../../lib/agentProtocol'
import type { Session } from '../../lib/types'
import { coordinatorAttention } from '../../lib/coordinatorAttention'
import { resolveCoordinationTranscriptTarget } from './splitPaneState'

/** Ledger order, never attention order: status changes must not move panes. */
export function planCoordinatorWorkspace(snapshot: ProtocolRunSnapshot, sessions: ReadonlyMap<string, Session>) {
  const lead = snapshot.agents.find(agent => agent.id === snapshot.run.leadAgentId)
  const ordered = [...(lead ? [lead] : []), ...snapshot.agents.filter(agent => agent.id !== lead?.id)]
  const seen = new Set<string>()
  const skipped: string[] = []
  const targets = ordered.flatMap(agent => {
    const target = resolveCoordinationTranscriptTarget(agent, sessions, Date.now())
    if (target.kind === 'unreadable') { skipped.push(target.reason); return [] }
    if (seen.has(target.sessionKey)) return []
    seen.add(target.sessionKey)
    return [{ ...target, agent }]
  })
  return { lead: targets.find(target => target.agent.id === lead?.id), targets, skipped }
}

/** Durable gates remain visible until resolved in Coordinator, even after viewing. */
export function coordinatorWindowBadges(snapshot: ProtocolRunSnapshot): Map<string, string> {
  const badges = new Map<string, string>()
  for (const item of coordinatorAttention(snapshot)) {
    if (item.kind === 'result') continue
    const agent = snapshot.agents.find(agent => agent.id === (item.agentId ?? snapshot.run.leadAgentId))
    if (!agent?.sessionId || agent.sessionId.startsWith('external:')) continue
    const key = `${agent.provider ?? 'claude'}:${agent.sessionId}`
    const badge = item.kind === 'plan' || item.kind === 'review' ? '? review' : '? reply'
    // Review is the more specific gate when an agent has several requests.
    if (!badges.has(key) || badge === '? review') badges.set(key, badge)
  }
  return badges
}
