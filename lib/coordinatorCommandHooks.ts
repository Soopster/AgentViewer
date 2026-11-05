import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Local command hooks — the lifecycle webhooks' sibling for a machine with no
// endpoint to post to (play a sound, post to a chat CLI, kick off CI).
//
// The config is the USER's, not the project's: <coordinator home>/hooks.json,
// never .agent-viewer/hooks.json. A webhook in a cloned repository can only
// receive data; a command there would run whatever the repository's author
// wrote the first time a run finished in that checkout.
//
//   { "commands": [ { "run": ["afplay", "/System/Library/Sounds/Glass.aiff"],
//                     "events"?: ["task.completed"], "project"?: "/abs/repo" } ] }
//
// `run` is argv, never a shell string, so an event's text cannot become syntax.
// The event arrives as JSON on stdin and as AGENT_VIEWER_HOOK_* variables.

export type CoordinatorCommandHook = { run: string[]; events?: string[]; project?: string }
export type CoordinatorHookPayload = {
  kind: string
  runId: string
  agentId?: string
  taskId?: string
  summary?: string
  detail?: string
  timestamp?: string
}

export const COMMAND_HOOK_TIMEOUT_MS = 10_000

export function commandHooksFilePath(): string {
  return path.join(path.resolve(process.env.AGENT_VIEWER_COORD_HOME || path.join(os.homedir(), '.agent-viewer', 'coordinator')), 'hooks.json')
}

export function parseCommandHooks(value: unknown): CoordinatorCommandHook[] {
  const list = value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).commands)
    ? (value as Record<string, unknown>).commands as unknown[]
    : []
  const hooks: CoordinatorCommandHook[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const { run, events, project } = entry as Record<string, unknown>
    if (!Array.isArray(run) || run.length === 0 || !run.every((part) => typeof part === 'string' && part.length > 0)) continue
    hooks.push({
      run: run as string[],
      ...(Array.isArray(events) ? { events: events.filter((kind): kind is string => typeof kind === 'string') } : {}),
      ...(typeof project === 'string' && project.trim() ? { project: path.resolve(project) } : {}),
    })
  }
  return hooks
}

export async function readCommandHooks(): Promise<CoordinatorCommandHook[]> {
  try {
    return parseCommandHooks(JSON.parse(await readFile(commandHooksFilePath(), 'utf8')))
  } catch {
    return []
  }
}

export function commandHookMatches(hook: CoordinatorCommandHook, payload: CoordinatorHookPayload, repoRoot: string): boolean {
  if (hook.events && !hook.events.includes(payload.kind)) return false
  return !hook.project || hook.project === path.resolve(repoRoot)
}

/**
 * Run one hook to completion or its timeout. Resolves either way: a hook is an
 * observer, and a broken one must never reach Coordinator correctness.
 */
export function runCommandHook(hook: CoordinatorCommandHook, payload: CoordinatorHookPayload, repoRoot: string, timeoutMs = COMMAND_HOOK_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(hook.run[0]!, hook.run.slice(1), {
        cwd: repoRoot,
        stdio: ['pipe', 'ignore', 'ignore'],
        env: {
          ...process.env,
          AGENT_VIEWER_HOOK_EVENT: payload.kind,
          AGENT_VIEWER_HOOK_RUN_ID: payload.runId,
          AGENT_VIEWER_HOOK_AGENT_ID: payload.agentId ?? '',
          AGENT_VIEWER_HOOK_TASK_ID: payload.taskId ?? '',
          AGENT_VIEWER_HOOK_SUMMARY: payload.summary ?? '',
        },
      })
    } catch {
      resolve()
      return
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    const done = () => { clearTimeout(timer); resolve() }
    child.on('error', done)
    child.on('exit', done)
    // A hook that never reads stdin closes the pipe; that is not a failure.
    child.stdin?.on('error', () => {})
    child.stdin?.end(JSON.stringify(payload))
  })
}

export async function dispatchCommandHooks(payload: CoordinatorHookPayload, repoRoot: string, hooks?: CoordinatorCommandHook[]): Promise<void> {
  const matching = (hooks ?? await readCommandHooks()).filter((hook) => commandHookMatches(hook, payload, repoRoot))
  await Promise.all(matching.map((hook) => runCommandHook(hook, payload, repoRoot)))
}
