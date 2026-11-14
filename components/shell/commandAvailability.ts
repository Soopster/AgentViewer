import { getPluginSurface, isPluginSurfaceId, type ResolvedPluginCommand } from '../../lib/plugins/catalog'
import type { SessionIdentity } from '../../lib/sessionIdentity'
import type { WebPluginServices } from './pluginTypes'

export function canOfferWebPluginCommand(command: ResolvedPluginCommand, session: SessionIdentity | null, services: WebPluginServices) {
  if (command.providers && (!session || !command.providers.includes(session.provider ?? 'claude'))) return false
  if (command.requires === 'session' && !session) return false
  if (!command.handler && isPluginSurfaceId(command.opens)) return getPluginSurface(command.opens).services.every(id => Boolean(services[id as keyof WebPluginServices]))
  return true
}
