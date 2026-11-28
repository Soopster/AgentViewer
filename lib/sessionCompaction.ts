import { currentProviderInstanceId } from './providerInstances'
import { getRunningSession } from './sessionRuntime'

type Provider = 'opencode' | 'pi'
type Status = 'pending' | 'completed' | 'failed' | 'unconfirmed'
const operations = new Map<string, { status: Status }>()

function key(provider: Provider, sessionId: string): string {
  return JSON.stringify([provider, currentProviderInstanceId(provider), sessionId])
}

export function readSessionCompaction(provider: Provider, sessionId: string) {
  const status = operations.get(key(provider, sessionId))?.status
  const busy = !!getRunningSession(sessionId, { provider, providerInstanceId: currentProviderInstanceId(provider) })
  return { status, busy: busy || status === 'pending' }
}

export function beginSessionCompaction(provider: Provider, sessionId: string) {
  const id = key(provider, sessionId)
  if (readSessionCompaction(provider, sessionId).busy) throw new Error('This session is busy.')
  if (operations.size >= 512) {
    for (const [old, entry] of operations) {
      if (entry.status !== 'pending') { operations.delete(old); break }
    }
  }
  const entry: { status: Status } = { status: 'pending' }
  operations.set(id, entry)
  return (status: Exclude<Status, 'pending'>) => {
    if (operations.get(id) !== entry || entry.status !== 'pending') return
    entry.status = status
  }
}
