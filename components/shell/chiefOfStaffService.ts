import type { PluginChiefOfStaffService } from '../../lib/plugins/chiefOfStaff'

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error || `Chief of Staff answered ${response.status}`)
  return body as T
}

export const webChiefOfStaff: PluginChiefOfStaffService = {
  read: async (cwd, signal) => json(await fetch(`/api/chief-of-staff?cwd=${encodeURIComponent(cwd)}`, { signal })),
  start: async params => json(await fetch('/api/chief-of-staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })),
  saveRules: async (cwd, rules) => json(await fetch('/api/chief-of-staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-rules', cwd, rules }) })),
}
