import { accessSync, constants } from 'node:fs'
import { posix as posixPath, win32 as win32Path } from 'node:path'

// Resolving a language-server command before spawning it buys two things.
//
// On Windows most of these servers install as `.cmd` shims, and `spawn` cannot
// execute one without a shell — `bash-language-server`, every
// `vscode-*-language-server`, `pyright-langserver` and `yaml-language-server`
// are all npm shims, so the whole table was unreachable there. A shim is run
// through `cmd.exe` explicitly rather than with `shell: true`, so a path with a
// space in it (`C:\Program Files\…`, the default) still resolves.
//
// And on every platform, knowing a command is absent means the fallback chain
// costs a `stat` instead of a process spawn that fails asynchronously.

export type ResolvedLspCommand = {
  command: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

export type LspCommandLookup = {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** Directory the server will run in; `node_modules/.bin` is searched from here upwards. */
  cwd?: string
  isExecutable?: (candidate: string) => boolean
}

/**
 * Path arithmetic for the *target* platform, not the running one. A test that
 * drives Windows resolution on macOS would otherwise build `C:\tools\bin/gopls`
 * and find nothing, which is exactly the bug this module exists to prevent.
 */
function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32Path : posixPath
}

const DEFAULT_WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD'

function executableByDefault(candidate: string): boolean {
  try {
    accessSync(candidate, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function pathExtensions(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform !== 'win32') return ['']
  const raw = env.PATHEXT ?? DEFAULT_WINDOWS_PATHEXT
  const extensions = raw.split(';').map((entry) => entry.trim()).filter(Boolean)
  // An explicit extension still has to be tried on its own, or `foo.exe` only
  // ever resolves as `foo.exe.EXE`.
  return ['', ...extensions]
}

/** `node_modules/.bin` for `cwd` and every ancestor, nearest first. */
function localBinDirectories(cwd: string, platform: NodeJS.Platform): string[] {
  const { resolve, parse, dirname, join } = pathApi(platform)
  const directories: string[] = []
  let current = resolve(cwd)
  const { root } = parse(current)
  while (true) {
    directories.push(join(current, 'node_modules', '.bin'))
    if (current === root) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return directories
}

function searchDirectories(lookup: LspCommandLookup, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const fromPath = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean)
  return lookup.cwd ? [...localBinDirectories(lookup.cwd, platform), ...fromPath] : fromPath
}

/**
 * The absolute path a bare command resolves to, or null when it is not
 * installed. An absolute or explicitly relative command is returned as given
 * once it exists.
 */
export function findLspExecutable(command: string, lookup: LspCommandLookup = {}): string | null {
  const platform = lookup.platform ?? process.platform
  const env = lookup.env ?? process.env
  const isExecutable = lookup.isExecutable ?? executableByDefault
  const { isAbsolute, join } = pathApi(platform)
  const extensions = pathExtensions(platform, env)
  const explicit = isAbsolute(command) || command.startsWith('./') || command.startsWith('../')
    || (platform === 'win32' && (command.startsWith('.\\') || command.startsWith('..\\')))
  if (explicit) {
    for (const extension of extensions) {
      const candidate = `${command}${extension}`
      if (isExecutable(candidate)) return candidate
    }
    return null
  }
  for (const directory of searchDirectories(lookup, platform, env)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

function quoteForCmd(value: string): string {
  // cmd.exe splits on spaces and treats these as operators, so anything
  // containing one has to arrive quoted. `windowsVerbatimArguments` stops Node
  // from quoting a second time on top of this.
  return /[\s"&()[\]{}^=;!'+,`~|<>]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * The spawnable form of a server spec: a Windows script shim is wrapped in
 * `cmd.exe`, everything else keeps its own argv. Returns null when the command
 * is not installed, so a caller can move to the next candidate without paying
 * for a failed spawn.
 */
export function resolveLspCommand(
  command: string,
  args: readonly string[],
  lookup: LspCommandLookup = {},
): ResolvedLspCommand | null {
  const platform = lookup.platform ?? process.platform
  const env = lookup.env ?? process.env
  const executable = findLspExecutable(command, { ...lookup, platform, env })
  if (!executable) return null
  if (platform !== 'win32') return { command: executable, args: [...args] }
  const isShim = /\.(cmd|bat)$/i.test(executable)
  if (!isShim) return { command: executable, args: [...args] }
  const commandLine = [executable, ...args].map(quoteForCmd).join(' ')
  return {
    command: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe',
    // `/d` skips AutoRun scripts, `/s` makes the outer quoting rules
    // predictable, `/c` runs and exits.
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true,
  }
}
