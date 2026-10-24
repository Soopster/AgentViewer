import type { WorkspaceTransport } from './workspaceTypes'
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Git request failed')
  return data as T
}
export const webWorkspaceTransport: WorkspaceTransport = {
  conflict: (cwd, path) => request(`/api/git/workspace?view=conflict&cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`),
  inspect: async (cwd, kind, ref) => (await request<{ content: string }>(`/api/git/workspace?view=inspect&cwd=${encodeURIComponent(cwd)}&kind=${kind}&ref=${encodeURIComponent(ref)}`)).content,
  snapshot: cwd => request(`/api/git/workspace?cwd=${encodeURIComponent(cwd)}`),
  preview: (cwd, side, path) => request(`/api/git/workspace?view=preview&cwd=${encodeURIComponent(cwd)}&side=${side}${path !== null ? `&path=${encodeURIComponent(path)}` : ''}`),
  act: (cwd, requestId, action) => request('/api/git/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd, requestId, action }) }),
}
