import type { PluginTaskControl } from '../../lib/plugins/tasks'
import { sessionIdentityKey, type SessionIdentity } from '../../lib/sessionIdentity'

/** Bound writes refuse after the owning reader changes, even if retained by a plugin. */
export function createWebTaskControls(target: SessionIdentity, isCurrent: () => boolean, jump: (uuid: string) => void): PluginTaskControl {
  const identity = Object.freeze({ sessionId: target.sessionId, provider: target.provider, providerInstanceId: target.providerInstanceId })
  const check = () => { if (!isCurrent()) { const error = new Error('Reader target changed'); error.name = 'AbortError'; throw error } }
  return {
    jumpTo(uuid) { check(); jump(uuid) },
    ...(identity.provider === 'claude' ? { async stop(session: SessionIdentity, taskId: string, signal?: AbortSignal) {
      check()
      if (sessionIdentityKey(session) !== sessionIdentityKey(identity)) throw new Error('Task target does not match this reader')
      const response = await fetch(`/api/sessions/${encodeURIComponent(identity.sessionId)}/actions`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: identity.provider, providerInstanceId: identity.providerInstanceId, action: 'stopTask', taskId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.error) throw new Error(data.error ?? `Task stop failed (${response.status})`)
      if (data.result?.stopped !== true) throw new Error('No running task to stop (session not warm).')
    } } : {}),
  }
}
