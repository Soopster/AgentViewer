// Detached worker: accepted runs outlive view closure, plugin disable and app restarts.
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { readRun, saveRun, storage, fingerprint, MAX_OUTPUT } from './engine.mjs'
const [root, id] = process.argv.slice(2)
const cancelFile = path.join(storage(root), `${id}.cancel`)
async function cancelled() { try { await fs.access(cancelFile); return true } catch { return false } }
async function mark() { try { return await fingerprint(root) } catch { return null } }
function killTree(child, signal) {
  if (!child.pid) return
  if (process.platform === 'win32') { const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); killer.on('error', () => {}) }
  else try { process.kill(-child.pid, signal) } catch { /* It has already exited. */ }
}
async function execute(run, result) {
  result.before = await mark()
  if (await cancelled()) { result.status = 'cancelled'; result.finishedAt = Date.now(); await saveRun(root, run); return }
  result.status = 'running'; result.startedAt = Date.now()
  await saveRun(root, run)
  const dir = path.join(storage(root), 'logs', id)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const log = await fs.open(path.join(dir, `${result.check.id}.txt`), 'w', 0o600)
  const chunks = []; let size = 0, timedOut = false, stopped = false
  const capture = chunk => { const buffer = Buffer.from(chunk); const room = MAX_OUTPUT - size; if (buffer.length > room) result.truncated = true; if (room > 0) { chunks.push(buffer.subarray(0, room)); size += Math.min(room, buffer.length) } }
  let child, force
  try {
    const cwd = await fs.realpath(path.resolve(root, result.check.cwd))
    if (cwd !== root && !cwd.startsWith(root + path.sep)) throw new Error('Check directory resolves outside the repository')
    // npm.cmd is the one Windows shim that needs cmd.exe; package script names are quoted.
    let executable = result.check.executable, args = result.check.args
    if (process.platform === 'win32' && executable.toLowerCase() === 'npm.cmd') {
      if (args.length !== 2 || args[0] !== 'run' || !/^[\w:.-]+$/.test(args[1])) throw new Error('Windows npm checks require a simple package script name')
      executable = process.env.ComSpec || 'cmd.exe'; args = ['/d', '/s', '/c', `npm.cmd run ${args[1]}`]
    }
    child = spawn(executable, args, { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    child.stdout.on('data', capture); child.stderr.on('data', capture)
    const stop = () => { killTree(child, 'SIGTERM'); force ??= setTimeout(() => killTree(child, 'SIGKILL'), 750) }
    const timer = setInterval(() => {
      if (Date.now() - result.startedAt > result.check.timeoutMs) { timedOut = true; stop() }
      void cancelled().then(value => { if (value) { stopped = true; stop() } })
    }, 100)
    try {
      const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)) })
      result.exitCode = exit; result.status = timedOut ? 'timeout' : stopped ? 'cancelled' : exit === 0 ? 'passed' : 'failed'
    } finally { clearInterval(timer); if (force) { clearTimeout(force); killTree(child, 'SIGKILL') } }
  } catch (error) { result.status = 'failed'; result.error = error.message; capture(Buffer.from(error.message)) }
  finally {
    await log.writeFile(Buffer.concat(chunks)); await log.close()
    result.after = await mark(); result.finishedAt = Date.now(); await saveRun(root, run)
  }
}
let run
try {
  for (let attempt = 0; attempt < 100; attempt++) { run = await readRun(root, id); if (run.pid === process.pid) break; await delay(50) }
  if (run.pid !== process.pid) throw new Error('Worker startup handshake failed')
  for (const result of run.results) {
    if (await cancelled()) { result.status = 'cancelled'; result.finishedAt = Date.now(); continue }
    await execute(run, result)
  }
  run.finishedAt = Date.now(); await saveRun(root, run)
} catch (error) {
  if (run) { for (const result of run.results) if (result.status === 'running' || result.status === 'queued') { result.status = 'interrupted'; result.error = error.message }; run.finishedAt = Date.now(); await saveRun(root, run) }
  process.exitCode = 1
}
