import type { AdaptiveUiService } from '../../../lib/plugins/adaptiveUi'
import { isRemoteAttached, remoteJson } from '../../../lib/tui/remote'
// In process the TUI reads its own shape book (its transcript worker feeds it through the same
// behaviour host); attached to a daemon it asks the daemon, which is where those reads run.
const lazy = async () => (await import('../../../lib/adaptiveUi/runtime')).nativeAdaptiveUi
const get = async <T>(): Promise<T> => (await remoteJson<{ result: T }>('/api/adaptive-ui')).result
const post = async <T>(body: Record<string, unknown>): Promise<T> => (await remoteJson<{ result: T }>('/api/adaptive-ui', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).result
export const tuiAdaptiveUi: AdaptiveUiService = {
  scan: async () => isRemoteAttached() ? get() : (await lazy()).scan(),
  setStatus: async (id, status) => { isRemoteAttached() ? await post({ action: 'set-status', id, status }) : await (await lazy()).setStatus(id, status) },
  remove: async id => { isRemoteAttached() ? await post({ action: 'remove', id }) : await (await lazy()).remove(id) },
  dismissShape: async (key, dismissed) => { isRemoteAttached() ? await post({ action: 'dismiss', key, dismissed }) : await (await lazy()).dismissShape(key, dismissed) },
  designPrompt: async key => isRemoteAttached() ? post<string>({ action: 'design-prompt', key }) : (await lazy()).designPrompt(key),
}
