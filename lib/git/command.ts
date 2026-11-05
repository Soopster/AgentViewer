import { spawn } from 'node:child_process'

export class WorkspaceGitError extends Error {
  constructor(readonly args: string[], readonly code: number | null, readonly stdout: string, readonly stderr: string) {
    super(stderr.trim() || stdout.trim() || `git ${args[0]} exited with ${code}`)
  }
}
export function gitBytes(cwd: string, args: string[], input?: string, env?: Record<string, string>): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((accept, reject) => {
    const child = spawn('git', ['--no-optional-locks', ...args], {
      cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = [], errors: Buffer[] = []
    let size = 0, errorSize = 0, exceeded = false
    child.stdout.on('data', (data: Buffer) => { size += data.length; if (size > 32 * 1024 * 1024) { exceeded = true; child.kill() } else chunks.push(data) })
    child.stderr.on('data', (data: Buffer) => { errorSize += data.length; if (errorSize < 1024 * 1024) errors.push(data) })
    child.on('error', reject)
    child.stdin.on('error', () => {})
    child.on('close', code => {
      const stdout = Buffer.concat(chunks), stderr = Buffer.concat(errors).toString('utf8')
      if (exceeded) reject(new Error('Git output exceeds the workspace limit. Narrow the selection.'))
      else if (code !== 0) reject(new WorkspaceGitError(args, code, stdout.toString('utf8'), stderr))
      else accept({ stdout, stderr })
    })
    child.stdin.end(input)
  })
}
export async function git(cwd: string, args: string[], input?: string, env?: Record<string, string>, captureOutput = false): Promise<string> {
  const result = await gitBytes(cwd, args, input, env)
  return result.stdout.toString('utf8') + (captureOutput ? result.stderr : '')
}
