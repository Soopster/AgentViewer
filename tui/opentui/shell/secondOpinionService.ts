import type { SecondOpinionService } from '../../../lib/plugins/secondOpinion'
import { isRemoteAttached, remoteJson } from '../../../lib/tui/remote'
// In process unless attached; the service (and the provider SDK it calls) loads on first use.
const native = () => import('../../../lib/secondOpinion/service').then(module => module.nativeSecondOpinion)
async function write<T>(body: Record<string, unknown>): Promise<T> {
  return (await remoteJson<{ result: T }>('/api/second-opinion', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })).result
}
export const tuiSecondOpinion: SecondOpinionService = {
  read: async (cwd, signal) => isRemoteAttached() ? (await remoteJson<{ result: Awaited<ReturnType<SecondOpinionService['read']>> }>(`/api/second-opinion?${new URLSearchParams({ cwd })}`, { signal })).result : (await native()).read(cwd, signal),
  start: async (cwd, input) => isRemoteAttached() ? write({ cwd, action: 'start', ...input }) : (await native()).start(cwd, input),
  cancel: async (cwd, id) => isRemoteAttached() ? write({ cwd, action: 'cancel', id }) : (await native()).cancel(cwd, id),
  dismiss: async (cwd, id, findingId) => isRemoteAttached() ? write({ cwd, action: 'dismiss', id, findingId }) : (await native()).dismiss(cwd, id, findingId),
  configure: async (cwd, settings) => isRemoteAttached() ? write({ cwd, action: 'configure', settings }) : (await native()).configure(cwd, settings),
}
