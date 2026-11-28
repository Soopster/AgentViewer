import path from 'node:path'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ProofService } from '../plugins/proof'
function invoke<T>(action: string, payload: object, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const compiled = import.meta.url.includes('$bunfs') || import.meta.url.includes('~BUN')
    const source = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rpc.mjs')
    const worker = !compiled && existsSync(source) ? source : path.join(process.cwd(), 'lib/proof/rpc.mjs')
    const child = execFile(compiled ? 'node' : process.execPath, [worker, action],
      { maxBuffer: 16 * 1024 * 1024, signal, timeout: 120_000 }, (error, stdout) => {
        try { const body = JSON.parse(stdout); if (body.error) reject(new Error(body.error)); else if (error) reject(error); else resolve(body.result) }
        catch { reject(error ?? new Error('Proof worker returned invalid data')) }
      })
    child.stdin?.on('error', () => { /* execFile reports worker startup failures. */ })
    child.stdin?.end(JSON.stringify(payload))
  })
}
export const nativeProof: ProofService = {
  read: (cwd, signal) => invoke('read', { cwd }, signal),
  configure: (cwd, checks, version) => invoke('configure', { cwd, checks, version }),
  start: (cwd, ids, version, origin) => invoke('start', { cwd, ids, version, origin }),
  cancel: (cwd, id) => invoke('cancel', { cwd, id }),
  output: (cwd, id, checkId, signal) => invoke('output', { cwd, id, checkId }, signal),
}
