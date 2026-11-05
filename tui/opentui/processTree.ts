import { spawn, type ChildProcess } from 'node:child_process'

/**
 * Stops a child and everything it started. POSIX signals the process group (the child was spawned
 * detached, so its pid is the group id); Windows has no groups, so `taskkill /T` walks the tree.
 * `signal` only chooses force on Windows: SIGKILL is `/F`, anything else asks politely first.
 */
export function killProcessTree(child: ChildProcess | null | undefined, signal: NodeJS.Signals, platform: NodeJS.Platform = process.platform): void {
  const pid = child?.pid
  if (!pid) return
  if (platform === 'win32') {
    try {
      const args = ['/PID', String(pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])]
      spawn('taskkill', args, { stdio: 'ignore', windowsHide: true }).on('error', () => { try { child?.kill(signal) } catch { /* gone */ } }).unref()
    } catch { try { child?.kill(signal) } catch { /* gone */ } }
    return
  }
  try { process.kill(-pid, signal) } catch { try { child?.kill(signal) } catch { /* gone */ } }
}

/** What runs a command line: the user's login shell, or `cmd.exe` on Windows. */
export function commandShell(command: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { file: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform === 'win32') return { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command], windowsVerbatimArguments: true }
  return { file: env.SHELL || '/bin/sh', args: ['-lc', command] }
}
