import type { PluginPlaybookService } from '../../lib/plugins/playbooks'

export function createWebPlaybooksService(fetcher: typeof fetch = (...args) => fetch(...args)): PluginPlaybookService {
  async function request<T>(init: RequestInit, cwd: string, name?: string): Promise<T> {
    init.signal?.throwIfAborted()
    const query = new URLSearchParams({ cwd })
    if (name !== undefined) query.set('name', name)
    const response = await fetcher(`/api/agent-protocol/playbooks?${query}`, { ...init, cache: 'no-store' })
    const body = await response.json()
    init.signal?.throwIfAborted()
    if (!response.ok || body.error) throw new Error(body.error || `Playbook operation failed (${response.status})`)
    return body as T
  }
  return {
    list: (cwd, signal) => request({ signal }, cwd),
    read: async (cwd, name, signal) => (await request<{ playbook: Awaited<ReturnType<PluginPlaybookService['read']>> }>({ signal }, cwd, name)).playbook,
    write: (cwd, playbook, previousName, signal) => request({ method: 'PUT', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd, playbook, previousName }) }, cwd),
    remove: async (cwd, name, signal) => { await request({ method: 'DELETE', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd, name }) }, cwd) },
  }
}

export const webPlaybooks = createWebPlaybooksService()
