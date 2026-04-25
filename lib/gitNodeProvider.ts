import { execFile } from 'child_process'

export function runGitCommand(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const normalizedArgs = process.platform === 'win32'
      ? args.map((arg) => arg === '/dev/null' ? 'NUL' : arg)
      : args

    execFile('git', normalizedArgs, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout) => {
      const output = Buffer.isBuffer(stdout) ? stdout.toString('utf-8') : String(stdout ?? '')
      if (!err || output) {
        resolve(output.trimEnd())
        return
      }

      // Some git commands, notably diff --no-index, exit non-zero for a useful
      // result. Keep the fallback for runtimes that attach stdout to the error.
      if (typeof err === 'object' && err && 'stdout' in err) {
        const out = (err as { stdout?: unknown }).stdout
        if (!out) {
          resolve('')
          return
        }
        resolve(Buffer.isBuffer(out) ? out.toString('utf-8').trimEnd() : String(out).trimEnd())
        return
      }

      resolve('')
    })
  })
}
