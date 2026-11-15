import type { AdaptiveUiService } from '../../lib/plugins/adaptiveUi'
async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/adaptive-ui', { cache: 'no-store', ...init })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || 'Adaptive UI request failed')
  return value.result
}
const post = <T>(body: Record<string, unknown>, signal?: AbortSignal) => request<T>({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
export const webAdaptiveUi: AdaptiveUiService = {
  scan: signal => request({ signal }),
  setStatus: (id, status) => post({ action: 'set-status', id, status }),
  remove: id => post({ action: 'remove', id }),
  dismissShape: (key, dismissed) => post({ action: 'dismiss', key, dismissed }),
  applySuggestion: id => post<string>({ action: 'apply-suggestion', id }),
  dismissSuggestion: id => post({ action: 'dismiss-suggestion', id }),
  designHere: key => post<string>({ action: 'design-here', key }),
  designPrompt: key => post<string>({ action: 'design-prompt', key }),
}
