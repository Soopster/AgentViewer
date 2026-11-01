import { cachedGithubRead, githubCacheKey, invalidateGithubCache } from './cache'
import { flagValue, ghFailure, parseJson, runGh } from './ghRunner'
import { scrubGithubText } from './text'
import type { GithubWorkflow, GithubWorkflowDispatch } from './types'

export const WORKFLOWS_TTL_MS = 5 * 60_000

export function fetchGithubWorkflows(cwd: string): Promise<GithubWorkflow[]> {
  return cachedGithubRead(githubCacheKey(cwd, 'workflows'), WORKFLOWS_TTL_MS, async () => {
    const result = await runGh(cwd, ['workflow', 'list', '--all', '--json', 'id,name,state,path'])
    if (result.code !== 0) throw ghFailure(result, 'Unable to list workflows.')
    return parseJson<Array<Record<string, unknown>>>(result.stdout, []).map(raw => ({
      id: Number(raw.id ?? 0), name: scrubGithubText(raw.name), state: String(raw.state ?? ''), path: scrubGithubText(raw.path),
    }))
  })
}

const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/

/** Triggers a `workflow_dispatch` run. Input names are restricted; values travel as `-f name=value` argv. */
export async function dispatchGithubWorkflow(cwd: string, request: GithubWorkflowDispatch): Promise<void> {
  const args = ['workflow', 'run', flagValue(request.workflow, 'workflow')]
  if (request.ref) args.push('--ref', flagValue(request.ref, 'ref'))
  for (const [name, value] of Object.entries(request.inputs ?? {})) {
    if (!INPUT_NAME.test(name)) throw new Error(`Invalid input name: ${name}.`)
    args.push('-f', `${name}=${value}`)
  }
  const result = await runGh(cwd, args)
  if (result.code !== 0) throw ghFailure(result, 'Workflow dispatch failed.')
  invalidateGithubCache(cwd, 'runs')
}
