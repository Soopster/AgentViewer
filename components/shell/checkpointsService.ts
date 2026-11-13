import type { PluginCheckpointsService } from '../../lib/plugins/checkpoints'

// The Web's checkpoints service: /api/checkpoints over lib/checkpoints.ts.
export function createWebCheckpointsService(fetcher: typeof fetch = (...args) => fetch(...args)): PluginCheckpointsService {
  const read = async <T,>(cwd: string, action: string, extra: Record<string, string>, signal?: AbortSignal): Promise<T> => {
    const response = await fetcher(`/api/checkpoints?${new URLSearchParams({ cwd, action, ...extra })}`, { signal })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.error) throw new Error(body.error || `Could not read checkpoints (${response.status})`)
    return body as T
  }
  const write = async <T,>(cwd: string, action: string, payload: Record<string, unknown>): Promise<T> => {
    const response = await fetcher('/api/checkpoints', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, action, ...payload }) })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.error) throw new Error(body.error || `Checkpoint ${action} failed (${response.status})`)
    return body as T
  }
  return {
    list: async (cwd, signal) => (await read<{ checkpoints: Awaited<ReturnType<PluginCheckpointsService['list']>> }>(cwd, 'list', {}, signal)).checkpoints,
    changes: async (cwd, sha, signal) => (await read<{ changes: Awaited<ReturnType<PluginCheckpointsService['changes']>> }>(cwd, 'changes', { sha }, signal)).changes,
    diff: async (cwd, sha, file, untilSha, signal) => (await read<{ diff: string }>(cwd, 'diff', { sha, ...(file ? { file } : {}), ...(untilSha ? { until: untilSha } : {}) }, signal)).diff,
    restore: (cwd, sha, paths, context) => write(cwd, 'restore', { sha, ...(paths ? { paths } : {}), ...(context ? { context } : {}) }),
    working: (cwd, signal) => read(cwd, 'working', {}, signal),
    rejectHunk: async (cwd, patchText) => { await write(cwd, 'reject-hunk', { patchText }) },
    deleteUntracked: async (cwd, path) => { await write(cwd, 'delete-untracked', { path }) },
    commit: async (cwd, message) => (await write<{ sha: string }>(cwd, 'commit', { message })).sha,
    pullRequest: async (cwd, title) => (await write<{ url: string }>(cwd, 'pull-request', { title })).url,
  }
}

export const webCheckpoints = createWebCheckpointsService()
