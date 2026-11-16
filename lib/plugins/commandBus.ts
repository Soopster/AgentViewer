import type { SessionIdentity } from '../sessionIdentity'
import type { PluginCommandInput } from './commands'
// The shared dispatcher for plugin commands. A palette, a menu or a shortcut
// dispatches a command id; the host that owns the command's target (the
// session view on the web) subscribes and resolves the target itself, so a
// palette never needs a prop per feature. Browser-safe: no imports.
type Listener = (commandId: string, input?: PluginCommandInput, target?: SessionIdentity) => boolean

const listeners = new Set<Listener>()

/** True when a subscribed host handled the command. */
export function dispatchPluginCommand(commandId: string, input?: PluginCommandInput, target?: SessionIdentity): boolean {
  for (const listener of [...listeners]) {
    if (listener(commandId, input, target)) return true
  }
  return false
}

export function subscribePluginCommands(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Dispatches a command at a session whose view may not be on screen yet (a rail
 * menu selects the session, then asks for the command): retried briefly until the
 * view that owns the target has mounted and handles it. Returns a cancel function.
 */
export function dispatchPluginCommandWhenShown(commandId: string, target: SessionIdentity, input?: PluginCommandInput, attempts = 40, intervalMs = 50): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let left = attempts
  const attempt = () => {
    timer = null
    if (dispatchPluginCommand(commandId, input, target) || --left <= 0) return
    timer = setTimeout(attempt, intervalMs)
  }
  attempt()
  return () => { if (timer) clearTimeout(timer); left = 0 }
}
