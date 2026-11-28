import { randomUUID } from 'node:crypto'
import { open, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

type Owner = { pid: number; token: string }
async function ownerAt(path: string): Promise<Owner | null> {
  try { const owner = JSON.parse(await readFile(path, 'utf8')); return Number.isInteger(owner.pid) && typeof owner.token === 'string' ? owner : null } catch { return null }
}
function isDead(pid: number) {
  try { process.kill(pid, 0); return false } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' }
}
/** App processes share a lease; native Git retains authority over index/ref locks. */
export async function withWorkspaceOperationLock<T>(commonDir: string, action: () => Promise<T>): Promise<T> {
  const path = join(commonDir, 'agent-viewer-operation.lock'), owner = { pid: process.pid, token: randomUUID() }
  let handle
  try { handle = await open(path, 'wx', 0o600) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const previous = await ownerAt(path)
    if (!previous || !isDead(previous.pid)) throw new Error('Another Agent Viewer Git operation is running. Wait, then refresh.')
    // Serialize recovery so a second recovering process cannot remove the new
    // owner's lease after the dead owner's file has been removed.
    const recoveryPath = `${path}.recovery`
    const recovery = await open(recoveryPath, 'wx', 0o600).catch(() => { throw new Error('Git operation recovery is already running. Refresh shortly.') })
    try {
      const current = await ownerAt(path)
      if (current?.token === previous.token && isDead(current.pid)) await rm(path)
      handle = await open(path, 'wx', 0o600).catch(() => { throw new Error('Another Git operation started. Refresh shortly.') })
    } finally { await recovery.close(); await rm(recoveryPath, { force: true }) }
  }
  try { await handle.writeFile(JSON.stringify(owner)); return await action() }
  finally { await handle.close(); if ((await ownerAt(path))?.token === owner.token) await rm(path, { force: true }) }
}
