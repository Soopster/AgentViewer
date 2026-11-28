import type { FocusService } from '../../../lib/plugins/focusMode'
import { isRemoteAttached, remoteJson } from '../../../lib/tui/remote'
const native = () => import('../../../lib/focus/service').then(module => module.nativeFocus)
async function write<T>(body: Record<string, unknown>): Promise<T> {
  return (await remoteJson<{ result: T }>('/api/focus', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })).result
}
export const tuiFocus: FocusService = {
  read: async signal => isRemoteAttached() ? (await remoteJson<{ result: Awaited<ReturnType<FocusService['read']>> }>('/api/focus', { signal })).result : (await native()).read(signal),
  start: async minutes => isRemoteAttached() ? write({ action: 'start', minutes }) : (await native()).start(minutes),
  end: async () => isRemoteAttached() ? write({ action: 'end' }) : (await native()).end(),
  hold: async items => isRemoteAttached() ? write({ action: 'hold', items }) : (await native()).hold(items),
  clearDigest: async () => isRemoteAttached() ? write({ action: 'clear-digest' }) : (await native()).clearDigest(),
}
