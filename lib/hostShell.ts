// Which shell a terminal tab starts, and how a bare program name becomes a file.
// Pure (the environment, the platform and the file test are arguments) so the
// Windows choices are tested on any machine.

import { win32 } from 'node:path'

export type HostShell = { exec: string; args: string[]; name: string }
type Env = Record<string, string | undefined>

const nameOf = (exec: string): string => (exec.split(/[\\/]/).pop() ?? exec).replace(/\.exe$/i, '')

/**
 * POSIX: the login shell, as a new terminal tab runs it, so the profile that sets
 * PATH is read. Windows: PowerShell 7, else Windows PowerShell, else cmd.exe.
 */
export function hostShell(env: Env = process.env, platform: NodeJS.Platform = process.platform, exists: (file: string) => boolean = () => false): HostShell {
  if (platform !== 'win32') {
    const exec = env.SHELL || '/bin/sh'
    return { exec, args: ['-l'], name: exec.split('/').pop() || 'sh' }
  }
  const pwsh = resolveWindowsExecutable('pwsh', env, exists)
  if (pwsh) return { exec: pwsh, args: ['-NoLogo'], name: 'pwsh' }
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows'
  const windowsPowerShell = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (exists(windowsPowerShell)) return { exec: windowsPowerShell, args: ['-NoLogo'], name: 'powershell' }
  const exec = env.ComSpec || env.COMSPEC || 'cmd.exe'
  return { exec, args: [], name: nameOf(exec) || 'cmd' }
}

/**
 * A bare name searched along PATH with each PATHEXT extension (what CreateProcess
 * will not do for a pseudoconsole); a path with a separator is returned as it is.
 * Null when nothing exists.
 */
export function resolveWindowsExecutable(file: string, env: Env = process.env, exists: (file: string) => boolean = () => false): string | null {
  if (/[\\/]/.test(file) || win32.isAbsolute(file)) return file
  const extensions = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  const hasExtension = extensions.some((extension) => file.toLowerCase().endsWith(extension.toLowerCase()))
  const directories = (env.PATH || env.Path || '').split(';').filter(Boolean)
  for (const directory of directories) {
    for (const candidate of hasExtension ? [file] : extensions.map((extension) => file + extension)) {
      const full = win32.join(directory, candidate)
      if (exists(full)) return full
    }
  }
  return null
}
