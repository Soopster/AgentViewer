import type { ProofService } from '../../../lib/plugins/proof'
import { nativeProof } from '../../../lib/proof/service'
import { isRemoteAttached, remoteJson } from '../../../lib/tui/remote'
async function read<T>(body: Record<string, string>, signal?: AbortSignal): Promise<T> {
  return (await remoteJson<{ result: T }>(`/api/proof?${new URLSearchParams(body)}`, { signal })).result
}
async function write<T>(body: Record<string, unknown>): Promise<T> {
  return (await remoteJson<{ result: T }>('/api/proof', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })).result
}
export const tuiProof: ProofService = {
  read: (cwd, signal) => isRemoteAttached() ? read({ cwd, action: 'read' }, signal) : nativeProof.read(cwd, signal),
  configure: (cwd, checks, version) => isRemoteAttached() ? write({ cwd, action: 'configure', checks, version }) : nativeProof.configure(cwd, checks, version),
  start: (cwd, ids, version, origin) => isRemoteAttached() ? write({ cwd, action: 'start', ids, version, origin }) : nativeProof.start(cwd, ids, version, origin),
  cancel: (cwd, id) => isRemoteAttached() ? write({ cwd, action: 'cancel', id }) : nativeProof.cancel(cwd, id),
  output: (cwd, id, checkId, signal) => isRemoteAttached() ? read({ cwd, action: 'output', id, checkId }, signal) : nativeProof.output(cwd, id, checkId, signal),
}
