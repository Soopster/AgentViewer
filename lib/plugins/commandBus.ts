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
