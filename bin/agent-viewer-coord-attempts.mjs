import { randomUUID } from 'node:crypto'
import { processAlive } from './agent-viewer-coord-state.mjs'

const UNRESOLVED = new Set(['prepared', 'submitted', 'uncertain'])

export function workerAttemptUnresolved(attempt) { return Boolean(attempt && UNRESOLVED.has(attempt.state)) }

export function newWorkerAttempt(state, taskId) {
  return { id: randomUUID(), runId: state.runId, agentId: state.agentId, taskId: taskId ?? null,
    provider: state.provider, providerInstanceId: state.providerInstanceId ?? null,
    sessionId: state.providerSessionId ?? null, transport: state.transport ?? 'cli',
    state: 'prepared', pid: null, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}

/** Refuse both uncertain replay and PID reuse; this never signals a process. */
export function reconcileWorkerAttempt(state, expectedId) {
  const attempt = state.providerAttempt
  if (!workerAttemptUnresolved(attempt)) {
    if (expectedId) throw new Error('The inspected provider attempt changed; inspect the worker again')
    return false
  }
  if (attempt.pid && processAlive(Number(attempt.pid))) throw new Error(`Provider attempt ${attempt.id} still has a live recorded pid ${attempt.pid}; observe it before restarting`)
  if (expectedId !== attempt.id) throw new Error(`Provider attempt ${attempt.id} is unresolved; inspect its transcript and use --reconcile-attempt ${attempt.id} before restarting`)
  state.providerAttempt = { ...attempt, state: 'reconciled', updatedAt: new Date().toISOString() }
  state.providerAttempts = [state.providerAttempt, ...(Array.isArray(state.providerAttempts) ? state.providerAttempts : []).filter(entry => entry.id !== attempt.id)].slice(0, 10)
  return true
}

/** Allowlisted public evidence; never forward an identity/config object. */
export function publicWorkerAttempt(attempt) {
  if (!attempt || typeof attempt !== 'object' || typeof attempt.id !== 'string') return null
  return Object.fromEntries(['id', 'runId', 'agentId', 'taskId', 'provider', 'providerInstanceId', 'sessionId', 'transport', 'state', 'pid', 'startedAt', 'updatedAt', 'exitCode', 'signal', 'failureClass'].map(key => [key, attempt[key] ?? null]))
}
