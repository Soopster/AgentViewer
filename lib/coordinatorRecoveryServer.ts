import path from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import type { ProtocolAgent, ProtocolRunSnapshot } from './agentProtocol'
import { readViewSessionInfo } from './sessionBackend'
import type { RecoveryEvidence, RecoveryInspection } from './coordinatorRecovery'

const TIMEOUT_MS = 2500
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Observation timed out; refresh before resuming')), TIMEOUT_MS) })])
  } finally { clearTimeout(timer) }
}
const detail = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 240)

/** Read-only checks. Neither a missing conversation nor directory is recreated. */
export async function inspectRecoveryAgent(agent: ProtocolAgent): Promise<RecoveryEvidence> {
  const [directory, conversation] = await Promise.all([
    bounded(stat(agent.worktreePath)).then(info => ({ available: info.isDirectory(), detail: info.isDirectory() ? 'available' : 'saved path is not a directory' }), error => ({ available: false, detail: detail(error) })),
    agent.sessionId.startsWith('external:') ? Promise.resolve({ available: false, detail: 'External participant controls its own conversation; reconnect in its client' })
      : bounded(readViewSessionInfo(agent.sessionId, agent.provider)).then(async info => {
        if (!info) return { available: false, detail: 'native conversation was not found' }
        if (info.sessionId !== agent.sessionId || (info.provider && info.provider !== agent.provider)) return { available: false, detail: 'provider returned a different conversation identity' }
        if (info.cwd && path.resolve(info.cwd) !== path.resolve(agent.worktreePath)) {
          const [native, saved] = await bounded(Promise.all([realpath(info.cwd), realpath(agent.worktreePath)]))
          if (native !== saved) return { available: false, detail: 'native conversation uses a different directory; inspect before reconnecting' }
        }
        return { available: true, detail: 'native conversation available' }
      }).catch(error => ({ available: false, detail: detail(error) })),
  ])
  return { agentId: agent.id, sessionId: agent.sessionId, provider: agent.provider, worktreePath: agent.worktreePath, checkedAt: new Date().toISOString(), directory, conversation }
}

export async function inspectCoordinatorRecovery(snapshot: ProtocolRunSnapshot): Promise<RecoveryInspection> {
  return { runId: snapshot.run.id, evidence: await Promise.all(snapshot.agents.map(inspectRecoveryAgent)) }
}
