// Standalone Node/Bun domain: also imported by the detached verification worker.
import { createHash, randomUUID } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
const exec = promisify(execFile)
const hash = value => createHash('sha256').update(value).digest('hex')
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/
export const MAX_OUTPUT = 1024 * 1024
async function git(cwd, args) { return (await exec('git', ['-C', cwd, ...args], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })).stdout }
export async function repository(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('An absolute Git worktree path is required')
  return fs.realpath((await git(cwd, ['rev-parse', '--show-toplevel'])).toString().trim())
}
export function storage(root) {
  return path.join(process.env.AGENT_VIEWER_PROOF_DIR || path.join(os.homedir(), '.config', 'agent-viewer', 'proof'), hash(root))
}
async function json(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw error } }
export async function atomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600 })
  await fs.rename(temporary, file)
}
async function fingerprintOnce(root) {
  // Hash actual Git-visible contents, not mtimes or status letters. Index changes count too.
  const files = (await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).toString().split('\0').filter(Boolean)
  const digest = createHash('sha256')
  let head
  try { head = await git(root, ['rev-parse', '--verify', 'HEAD']) } catch { head = Buffer.from('unborn') }
  let branch; try { branch = await git(root, ['symbolic-ref', '-q', 'HEAD']) } catch { branch = Buffer.from('detached') }
  digest.update(head).update(branch).update(await git(root, ['ls-files', '--stage', '-z']))
  for (const file of [...new Set(files)].sort()) {
    digest.update(JSON.stringify(file))
    const full = path.join(root, file)
    try {
      const stat = await fs.lstat(full)
      if (stat.isDirectory()) throw new Error('Submodule/directory freshness is unavailable')
      digest.update(String(stat.mode & 0o777))
      if (stat.isSymbolicLink()) digest.update(await fs.readlink(full))
      else {
        // Stream large source files without blocking the renderer or loading the tree into memory.
        const handle = await fs.open(full, 'r')
        try { for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk) } finally { await handle.close() }
      }
    } catch (error) { if (error.code === 'ENOENT') digest.update('deleted'); else throw error }
    digest.update('\0')
  }
  return digest.digest('hex')
}
export async function fingerprint(root) {
  const before = await fingerprintOnce(root), after = await fingerprintOnce(root)
  if (before !== after) throw new Error('Source changed while reading freshness; refresh when the worktree settles')
  return after
}
export function validateChecks(checks) {
  if (!Array.isArray(checks) || checks.length > 40) throw new Error('Provide at most 40 checks')
  if (Buffer.byteLength(JSON.stringify(checks)) > 64 * 1024) throw new Error('Check configuration must fit in 64 KiB')
  const seen = new Set()
  return checks.map(check => {
    if (!check || typeof check.id !== 'string' || !idPattern.test(check.id) || seen.has(check.id)) throw new Error('Check IDs must be unique letters, numbers, underscores or hyphens')
    seen.add(check.id)
    if (typeof check.label !== 'string' || !check.label.trim() || check.label.length > 120 || typeof check.executable !== 'string' || !check.executable.trim() || check.executable.length > 4096 || check.executable.includes('\0')) throw new Error('Each check needs a label and executable')
    if (!Array.isArray(check.args) || check.args.length > 100 || check.args.some(arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'))) throw new Error('Arguments must be an array of strings')
    const cwd = check.cwd ?? '.'
    if (typeof cwd !== 'string' || path.isAbsolute(cwd) || cwd.split(/[\\/]/).includes('..') || cwd.includes('\0')) throw new Error('Check working directory must stay inside the repository')
    const timeoutMs = check.timeoutMs ?? 300_000
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3_600_000) throw new Error('Timeout must be between 100ms and one hour')
    return { id: check.id, label: check.label.trim(), executable: check.executable, args: check.args, cwd, timeoutMs }
  })
}
async function config(root) { return json(path.join(storage(root), 'config.json'), { version: '0', checks: [] }) }
export function alive(pid) { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' } }
async function exclusive(root, name, fn) {
  const dir = storage(root), lock = path.join(dir, `${name}.lock`)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  try { await fs.mkdir(lock) } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const owner = await json(path.join(lock, 'owner.json'), null)
    const age = Date.now() - (await fs.stat(lock)).mtimeMs
    if ((owner && alive(owner.pid)) || age < 10_000) throw new Error('Proof is busy in another process; try again shortly')
    // Rename before removal so another contender cannot remove a freshly acquired lock.
    const abandoned = `${lock}.${randomUUID()}.abandoned`
    try { await fs.rename(lock, abandoned); await fs.rm(abandoned, { recursive: true, force: true }) } catch { throw new Error('Proof lock changed; retry') }
    return exclusive(root, name, fn)
  }
  try { await atomic(path.join(lock, 'owner.json'), { pid: process.pid }); return await fn() } finally { await fs.rm(lock, { recursive: true, force: true }) }
}
export async function configure(cwd, checks, version) {
  const root = await repository(cwd), validated = validateChecks(checks)
  // Resolve symlinks as well as lexical paths before saving any executable configuration.
  for (const check of validated) {
    const resolved = await fs.realpath(path.resolve(root, check.cwd))
    if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Check directory resolves outside the repository')
  }
  return exclusive(root, 'config', async () => {
    const current = await config(root)
    if (current.version !== version) throw new Error('Configuration changed; refresh before saving')
    const next = { version: randomUUID(), checks: validated }
    await atomic(path.join(storage(root), 'config.json'), next)
    return next
  })
}
const runPath = (root, id) => { if (!idPattern.test(id)) throw new Error('Invalid run ID'); return path.join(storage(root), 'runs', `${id}.json`) }
export async function readRun(root, id) { const run = await json(runPath(root, id), null); if (!run) throw new Error('Unknown run'); return run }
export async function saveRun(root, run) { await atomic(runPath(root, run.id), run) }
async function recover(root, run) {
  if (!run.finishedAt && !alive(run.pid) && Date.now() - run.createdAt > 10_000) {
    run.finishedAt = Date.now()
    for (const result of run.results) if (result.status === 'running' || result.status === 'queued') { result.status = 'interrupted'; result.error = 'Verification worker exited before recording a result' }
    await saveRun(root, run)
  }
  return run
}
export async function read(cwd) {
  const root = await repository(cwd), dir = storage(root)
  const configured = await config(root)
  let names = []; try { names = await fs.readdir(path.join(dir, 'runs')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const runs = (await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => recover(root, await readRun(root, name.slice(0, -5)))))).sort((a, b) => b.createdAt - a.createdAt)
  let current = null, fingerprintError
  // No configuration or receipts: a widget read does not scan the source tree.
  if (configured.checks.length || runs.length) try { current = await fingerprint(root) } catch (error) { fingerprintError = error.message }
  let suggestions = []
  try {
    const pkg = await json(path.join(root, 'package.json'), {})
    suggestions = Object.keys(pkg.scripts || {}).slice(0, 40).map(name => ({ id: `script-${hash(name).slice(0, 12)}`, label: name, executable: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', name], cwd: '.', timeoutMs: 300_000 }))
  } catch { /* Suggestions are optional; malformed package metadata does not hide receipts. */ }
  return { cwd: root, config: configured, suggestions, runs: runs.slice(0, 100), fingerprint: current, ...(fingerprintError ? { fingerprintError } : {}) }
}
export async function start(cwd, ids, version, origin, workerPath) {
  const root = await repository(cwd)
  return exclusive(root, 'start', async () => {
    const current = await config(root)
    if (current.version !== version) throw new Error('Configuration changed; refresh before running')
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error('Select one or more checks')
    const checks = ids.map(id => { const check = current.checks.find(check => check.id === id); if (!check) throw new Error('Unknown check'); return check })
    const activeFile = path.join(storage(root), 'active.json'), active = await json(activeFile, null)
    if (active) { const previous = await recover(root, await readRun(root, active.id)); if (!previous.finishedAt) throw new Error('Proof already has an active run in this worktree') }
    const run = { id: randomUUID(), cwd: root, createdAt: Date.now(), configVersion: version, ...(origin ? { origin } : {}), results: checks.map(check => ({ check, status: 'queued' })) }
    await saveRun(root, run)
    await atomic(activeFile, { id: run.id })
    try {
      const child = spawn(process.execPath, [workerPath, root, run.id], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env })
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      run.pid = child.pid
      // Worker waits for this handshake before executing checks.
      await saveRun(root, run)
      child.unref()
    } catch (error) {
      run.finishedAt = Date.now(); for (const result of run.results) { result.status = 'interrupted'; result.error = error.message }
      await saveRun(root, run); throw error
    }
    const snapshot = await readHistory(root).catch(() => [])
    for (const old of snapshot.slice(100)) if (old.finishedAt) {
      try {
      await fs.rm(runPath(root, old.id), { force: true })
      await fs.rm(path.join(storage(root), 'logs', old.id), { recursive: true, force: true })
      await fs.rm(path.join(storage(root), `${old.id}.cancel`), { force: true })
      } catch { /* A retention failure must not turn an accepted run into an apparent refusal. */ }
    }
    return { id: run.id }
  })
}
async function readHistory(root) {
  const names = await fs.readdir(path.join(storage(root), 'runs'))
  return (await Promise.all(names.filter(name => name.endsWith('.json')).map(name => readRun(root, name.slice(0, -5))))).sort((a, b) => b.createdAt - a.createdAt)
}
export async function cancel(cwd, id) {
  const root = await repository(cwd), run = await readRun(root, id)
  if (!run.finishedAt) await fs.writeFile(path.join(storage(root), `${id}.cancel`), '', { mode: 0o600 })
}
export async function output(cwd, id, checkId) {
  const root = await repository(cwd), run = await readRun(root, id)
  if (!run.results.some(result => result.check.id === checkId)) throw new Error('Unknown check in receipt')
  try { return await fs.readFile(path.join(storage(root), 'logs', id, `${checkId}.txt`), 'utf8') } catch (error) { if (error.code === 'ENOENT') return ''; throw error }
}
