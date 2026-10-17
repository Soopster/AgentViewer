// Pins the background-daemon lifecycle without starting Next: what a port's
// answer means, that a running daemon is reused rather than started over, that
// a port held by something else is refused, and that stop only ever kills a
// daemon this command started.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'

const home = await mkdtemp(path.join(os.tmpdir(), 'daemon-smoke-'))
process.env.AGENT_VIEWER_DAEMON_HOME = home
const daemon = await import('../bin/agent-viewer-daemon.mjs')

const listen = (handler, port = 0) => new Promise((resolve) => {
  const server = createServer(handler)
  server.listen(port, '127.0.0.1', () => resolve(server))
})
const version = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ name: 'agent-viewer', version: '9.9.9', protocol: 1 })) }
const freePort = async () => { const server = await listen(() => {}); const { port } = server.address(); await new Promise((resolve) => server.close(resolve)); return port }
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

const servers = []
const children = []
try {
  const port = await freePort()
  assert.equal((await daemon.probeDaemon(port)).state, 'absent')
  assert.deepEqual(await daemon.stopDaemon(port), { stopped: false, reason: 'not-running' })

  // Something else on the port must be neither attached to nor started over.
  const other = await listen((_req, res) => { res.writeHead(200); res.end('<html>') })
  servers.push(other)
  assert.equal((await daemon.probeDaemon(other.address().port)).state, 'foreign')
  let startedOverForeign = false
  await assert.rejects(() => daemon.ensureDaemon({ port: other.address().port, start: () => { startedOverForeign = true } }), /not as agent-viewer/)
  assert.equal(startedOverForeign, false, 'a daemon was started over a port something else holds')

  // Free port: start once, record the pid, wait for the listener.
  let starts = 0
  const start = async (startPort) => {
    starts += 1
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' })
    child.unref()
    children.push(child.pid)
    setTimeout(async () => servers.push(await listen(version, startPort)), 300)
    return child.pid
  }
  let waited = false
  const first = await daemon.ensureDaemon({ port, start, onWait: () => { waited = true } })
  assert.deepEqual([first.url, first.started, first.version, starts, waited], [`http://127.0.0.1:${port}`, true, '9.9.9', 1, true])
  const record = JSON.parse(await readFile(daemon.daemonRecordPath(port), 'utf8'))
  assert.equal(record.pid, children[0])

  const again = await daemon.ensureDaemon({ port, start })
  assert.deepEqual([again.started, starts], [false, 1], 'a running daemon was started a second time')
  const status = await daemon.daemonStatus(port)
  assert.deepEqual([status.state, status.managed, status.pid], ['running', true, children[0]])

  // A daemon that dies while starting is reported, not waited out.
  const deadPort = await freePort()
  await assert.rejects(() => daemon.ensureDaemon({ port: deadPort, timeoutMs: 20_000, start: () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    return new Promise((resolve) => child.on('exit', () => resolve(child.pid)))
  } }), /exited while starting/)
  const slowPort = await freePort()
  await assert.rejects(() => daemon.ensureDaemon({ port: slowPort, timeoutMs: 600, start: () => process.pid }), /did not answer/)

  // Stop kills what this command started…
  const stopped = await daemon.stopDaemon(port)
  assert.deepEqual(stopped, { stopped: true, pid: children[0] })
  assert.equal(alive(children[0]), false, 'stop left the daemon process running')
  // …and never a daemon someone ran by hand, which has no record.
  assert.deepEqual(await daemon.stopDaemon(port), { stopped: false, reason: 'not-managed' })
  console.log('Daemon smoke passed (probe states, reuse, foreign port refused, early exit, timeout, managed-only stop)')
} finally {
  for (const server of servers) server.close()
  for (const pid of children) { try { process.kill(pid, 'SIGKILL') } catch {} }
  await rm(home, { recursive: true, force: true })
}
