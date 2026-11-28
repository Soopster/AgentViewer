import type { PluginPstackService } from '../../lib/plugins/pstack'

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error || `pstack answered ${response.status}`)
  return body as T
}

export const webPstack: PluginPstackService = {
  read: async (cwd, signal) => json(await fetch(`/api/pstack?cwd=${encodeURIComponent(cwd)}`, { signal })),
  saveRole: async (cwd, role, line) => json(await fetch('/api/pstack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd, role, line }) })),
}
