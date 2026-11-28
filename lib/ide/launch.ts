// Hands a file to the user's own editor, at a line. Argv only, never a shell
// string: a path is data and must not become syntax. Server/TUI only (Node).
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { resolveWindowsExecutable } from '../hostShell'
import { parseAcpCommand } from '../acpCommand.mjs'
import { IDE_CATALOG, ideLabel, type IdeEntry, type IdeId } from '../ideCatalog'

type Env = Record<string, string | undefined>

export type IdeOpenRequest = { readonly path: string; readonly line?: number | null; readonly column?: number | null; readonly cwd?: string | null }
export type IdeCommand = { readonly argv: readonly string[]; readonly terminal: boolean; readonly label: string }

const isFile = (file: string) => { try { return statSync(file).isFile() } catch { return false } }

/** A bare command on PATH, or null. */
export function findOnPath(command: string, env: Env = process.env, platform: NodeJS.Platform = process.platform): string | null {
  if (platform === 'win32') return resolveWindowsExecutable(command, env, existsSync)
  for (const directory of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const full = path.join(directory, command)
    if (isFile(full)) return full
  }
  return null
}

const MAC_APP_DIRS = (env: Env) => ['/Applications', env.HOME ? path.join(env.HOME, 'Applications') : null].filter((dir): dir is string => !!dir)

function resolveEntry(entry: IdeEntry, env: Env, platform: NodeJS.Platform): string | null {
  for (const command of entry.commands) {
    const found = findOnPath(command, env, platform)
    if (found) return found
  }
  if (platform !== 'darwin') return null
  for (const dir of MAC_APP_DIRS(env)) for (const app of entry.macApps) {
    const full = path.join(dir, app)
    if (isFile(full)) return full
  }
  return null
}

let detectCache: { at: number; key: string; value: readonly { id: IdeId; label: string; executable: string }[] } | null = null
const DETECT_TTL_MS = 60_000

/** The editors installed here. A stat per candidate, no spawn; cached for a minute. */
export function detectIdes(env: Env = process.env, platform: NodeJS.Platform = process.platform, now = Date.now()) {
  const key = `${platform}\0${env.PATH ?? ''}\0${env.HOME ?? ''}`
  if (detectCache && detectCache.key === key && now - detectCache.at < DETECT_TTL_MS) return detectCache.value
  const value = IDE_CATALOG.flatMap(entry => {
    const executable = resolveEntry(entry, env, platform)
    return executable ? [{ id: entry.id as IdeId, label: entry.label, executable }] : []
  })
  detectCache = { at: now, key, value }
  return value
}

export function resetIdeDetectionCache() { detectCache = null }

/** The checkout a file belongs to (a worktree's own root), so a VS Code-family editor uses that window. Walks up for `.git`; no spawn. */
export function workspaceFor(file: string): string | null {
  let dir = path.dirname(file)
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const TERMINAL_EDITORS = new Set(['vi', 'vim', 'nvim', 'nano', 'emacs', 'micro', 'hx', 'helix', 'kak', 'ne', 'joe', 'mg', 'pico', 'ed'])
const GOTO_EDITORS = new Set(['code', 'cursor', 'windsurf', 'code-insiders', 'codium'])
const SUFFIX_EDITORS = new Set(['zed', 'subl', 'mate'])

const positive = (value: number | null | undefined) => typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null

function lineArgs(style: IdeEntry['lineStyle'], file: string, line: number | null, column: number | null): string[] {
  if (!line) return [file]
  if (style === 'goto-flag') return ['-g', `${file}:${line}${column ? `:${column}` : ''}`]
  if (style === 'line-flag') return ['--line', String(line), ...(column ? ['--column', String(column)] : []), file]
  return [`${file}:${line}${column ? `:${column}` : ''}`]
}

/** `$VISUAL`/`$EDITOR` as argv, with the line in the form that editor reads. */
export function editorCommand(file: string, line: number | null, env: Env = process.env): IdeCommand {
  const value = env.VISUAL?.trim() || env.EDITOR?.trim()
  if (!value) throw new Error('Neither $VISUAL nor $EDITOR is set')
  const argv = parseAcpCommand(value, '$EDITOR')
  const name = path.basename(argv[0]!).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
  const terminal = TERMINAL_EDITORS.has(name)
  if (!line) return { argv: [...argv, file], terminal, label: name }
  if (GOTO_EDITORS.has(name)) return { argv: [...argv, '-g', `${file}:${line}`], terminal: false, label: name }
  if (SUFFIX_EDITORS.has(name)) return { argv: [...argv, `${file}:${line}`], terminal: false, label: name }
  if (terminal) return { argv: [...argv, `+${line}`, file], terminal, label: name }
  return { argv: [...argv, file], terminal, label: name }
}

/** Validates the request and resolves the file to an absolute path that exists. */
export function resolveOpenPath(request: IdeOpenRequest): { file: string; line: number | null; column: number | null } {
  const raw = request.path
  if (typeof raw !== 'string' || !raw || raw.includes('\0')) throw new Error('No file to open')
  const base = request.cwd && path.isAbsolute(request.cwd) ? request.cwd : null
  const file = path.isAbsolute(raw) ? path.normalize(raw) : base ? path.resolve(base, raw) : null
  if (!file) throw new Error(`"${raw}" is relative and there is no project directory to resolve it against`)
  if (!existsSync(file)) throw new Error(`${file} does not exist`)
  return { file, line: positive(request.line), column: positive(request.column) }
}

/** The command that opens `request` in `ide`. `builtin` has none: the host opens its own editor. */
export function ideCommand(ide: Exclude<IdeId, 'builtin'>, request: IdeOpenRequest, env: Env = process.env, platform: NodeJS.Platform = process.platform): IdeCommand {
  const { file, line, column } = resolveOpenPath(request)
  if (ide === 'editor') return editorCommand(file, line, env)
  const entry = IDE_CATALOG.find(candidate => candidate.id === ide)
  if (!entry) throw new Error(`Unknown editor: ${ide}`)
  const executable = resolveEntry(entry, env, platform)
  if (!executable) throw new Error(`${entry.label} is not installed here — put its \`${entry.commands[0]}\` command on PATH`)
  const isDirectory = (() => { try { return statSync(file).isDirectory() } catch { return false } })()
  if (isDirectory) return { argv: [executable, file], terminal: false, label: entry.label }
  const workspace = entry.lineStyle === 'goto-flag' ? workspaceFor(file) : null
  return { argv: [executable, ...(workspace ? [workspace] : []), ...lineArgs(entry.lineStyle, file, line, column)], terminal: false, label: entry.label }
}

/** Starts a GUI editor detached. Resolves once it has started; rejects with a stated reason. */
export function launchDetached(command: IdeCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command.argv[0]!, command.argv.slice(1), { detached: true, stdio: 'ignore', windowsHide: true })
    } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); return }
    child.once('error', (error: NodeJS.ErrnoException) => reject(new Error(error.code === 'ENOENT' ? `${command.label}: \`${command.argv[0]}\` was not found` : `${command.label} did not start: ${error.message}`)))
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

export { ideLabel }
