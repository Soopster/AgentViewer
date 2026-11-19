import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { StoredMachine } from '../lib/machines.mjs'

export async function startRemoteMachineFixture(name: string): Promise<{ machine: StoredMachine & { readOnly: string }; child: ChildProcess }> {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./coordRemoteMachineFixture.ts', import.meta.url))], { env: { ...process.env, REMOTE_FIXTURE_LABEL: name }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    let output = '', errors = ''
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Daemon startup timed out: ${errors}`)) }, 15_000)
    child.stderr!.on('data', chunk => { errors += String(chunk) })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Daemon exited ${code}: ${errors}`)) })
    child.stdout!.on('data', chunk => {
      output += String(chunk)
      const line = output.split('\n').find(entry => entry.startsWith('{"baseUrl"'))
      if (line) {
        clearTimeout(timer)
        const info = JSON.parse(line)
        resolve({ child, machine: { name, baseUrl: info.baseUrl, credential: info.full, scope: 'full', addedAt: new Date().toISOString(), readOnly: info.readOnly } })
      }
    })
  })
}
