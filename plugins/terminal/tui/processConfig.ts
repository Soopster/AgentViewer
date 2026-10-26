// Which long-running processes a repository has: the ones it declares in
// `.agent-viewer/processes.json`, else ones suggested from what is on disk
// (package.json scripts, a compose file, a Procfile). Suggestions are only
// offered, never started — starting something is the user's decision.

import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

export type ProcessDefinition = {
  name: string
  command: string
  /** Absolute. */
  cwd: string
  /** Declared in processes.json (true) or inferred from the repository (false). */
  declared: boolean
}

export type ProcessConfig = { definitions: ProcessDefinition[]; source: string | null; error: string | null }

export const PROCESS_CONFIG_PATH = '.agent-viewer/processes.json'

type RawEntry = { name?: unknown; command?: unknown; cwd?: unknown }

function parseLenient(raw: string): unknown {
  // Comments and trailing commas are what people write in a config file, as in lsp.json.
  const stripped = raw
    .replace(/^﻿/, '')
    .replace(/(^|[^:])\/\/[^\n\r]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(stripped) as unknown
}

const exists = (path: string) => stat(path).then(() => true, () => false)

async function packageRunner(root: string): Promise<string> {
  if (await exists(join(root, 'bun.lock')) || await exists(join(root, 'bun.lockb'))) return 'bun run'
  if (await exists(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await exists(join(root, 'yarn.lock'))) return 'yarn'
  return 'npm run'
}

const SCRIPT_SUGGESTIONS = ['dev', 'start', 'serve', 'watch', 'storybook', 'test:watch']
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']

export async function suggestProcesses(root: string): Promise<ProcessDefinition[]> {
  const suggestions: ProcessDefinition[] = []
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> }
    const runner = await packageRunner(root)
    for (const script of SCRIPT_SUGGESTIONS) {
      if (typeof pkg.scripts?.[script] === 'string') suggestions.push({ name: script, command: `${runner} ${script}`, cwd: root, declared: false })
    }
  } catch { /* no package.json */ }
  for (const file of COMPOSE_FILES) {
    if (await exists(join(root, file))) {
      suggestions.push({ name: 'compose logs', command: 'docker compose logs -f --tail=200', cwd: root, declared: false })
      break
    }
  }
  try {
    const procfile = await readFile(join(root, 'Procfile'), 'utf8')
    for (const line of procfile.split('\n')) {
      const match = /^([\w-]+):\s*(.+)$/.exec(line.trim())
      if (match) suggestions.push({ name: match[1]!, command: match[2]!, cwd: root, declared: false })
    }
  } catch { /* no Procfile */ }
  return suggestions
}

export async function readProcessConfig(root: string): Promise<ProcessConfig> {
  const source = join(root, PROCESS_CONFIG_PATH)
  let raw: string
  try {
    raw = await readFile(source, 'utf8')
  } catch {
    return { definitions: await suggestProcesses(root), source: null, error: null }
  }
  try {
    const parsed = parseLenient(raw) as { processes?: unknown } | null
    const entries = Array.isArray(parsed?.processes) ? parsed.processes as RawEntry[] : []
    const definitions = entries.flatMap((entry): ProcessDefinition[] => {
      if (!entry || typeof entry.command !== 'string' || !entry.command.trim()) return []
      const cwd = typeof entry.cwd === 'string' && entry.cwd ? (isAbsolute(entry.cwd) ? entry.cwd : resolve(root, entry.cwd)) : root
      const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : entry.command.trim().split(/\s+/).slice(0, 3).join(' ')
      return [{ name, command: entry.command.trim(), cwd, declared: true }]
    })
    return { definitions, source, error: null }
  } catch (error) {
    // A broken file is reported, and the suggestions still work.
    return { definitions: await suggestProcesses(root), source, error: `${PROCESS_CONFIG_PATH}: ${error instanceof Error ? error.message : 'unreadable'}` }
  }
}
