// Managed local packages: immutable content-addressed releases, an atomic active
// symlink, and a recovery journal. No package code or install scripts run here.
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, existsSync, readlinkSync, symlinkSync, renameSync, rmSync, openSync, closeSync } from 'node:fs'
import path from 'node:path'
import { localPluginsDir } from './localPlugins'
import { LOCAL_PLUGIN_ID, parseLocalPluginManifest } from './localManifest'
import { PLUGIN_MANIFESTS } from './catalog'
import { parseModPackageMetadata } from './modPackageMetadata'

export type ModPackageReceipt = { readonly id: string; readonly version: string; readonly sha256: string; readonly source: string; readonly installedAt: string }
export type ModPackageState = { readonly schema: 1; readonly id: string; readonly current: ModPackageReceipt | null; readonly history: readonly ModPackageReceipt[] }
export type ModPackageInspection = ModPackageReceipt & { readonly files: number; readonly bytes: number }
type Snapshot = { inspection: ModPackageInspection; files: { name: string; bytes: Buffer; mode: number }[] }
const HASH = /^[a-f0-9]{64}$/
const MAX_FILES = 500, MAX_BYTES = 32 * 1024 * 1024, MAX_FILE_BYTES = 10 * 1024 * 1024
const safeId = (id: string) => { if (!LOCAL_PLUGIN_ID.test(id)) throw new Error('Invalid mod id'); return id }
function locations(id: string) {
  safeId(id)
  const plugins = localPluginsDir(), root = path.join(path.dirname(plugins), 'mod-packages', id)
  return { plugins, root, active: path.join(plugins, id), state: path.join(root, 'state.json'), journal: path.join(root, 'pending.json'), lock: path.join(root, 'lock') }
}
function release(id: string, digest: string) { if (!HASH.test(digest)) throw new Error('Invalid package digest'); return path.join(locations(id).root, 'releases', digest, 'content') }
function json(file: string): unknown { return JSON.parse(readFileSync(file, 'utf8')) }
function atomicJson(file: string, value: unknown): void {
  const temp = `${file}.${randomUUID()}.tmp`
  try { writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); renameSync(temp, file) } finally { rmSync(temp, { force: true }) }
}
function readReceipt(raw: unknown, id: string): ModPackageReceipt {
  const value = raw as ModPackageReceipt | null
  if (!value || value.id !== id || typeof value.version !== 'string' || typeof value.sha256 !== 'string' || !HASH.test(value.sha256) || typeof value.source !== 'string' || typeof value.installedAt !== 'string') throw new Error(`Invalid package receipt for ${id}`)
  parseModPackageMetadata({ version: value.version }, { requireVersion: true })
  return { id, version: value.version, sha256: value.sha256, source: value.source, installedAt: value.installedAt }
}
function decodeState(raw: unknown, id: string): ModPackageState {
  const value = raw as ModPackageState | null
  if (!value || value.schema !== 1 || value.id !== id || !Array.isArray(value.history) || value.history.length > 50) throw new Error(`Invalid package state for ${id}`)
  return { schema: 1, id, current: value.current === null ? null : readReceipt(value.current, id), history: value.history.map(item => readReceipt(item, id)) }
}
function readState(id: string): ModPackageState {
  const loc = locations(id)
  return existsSync(loc.state) ? decodeState(json(loc.state), id) : { schema: 1, id, current: null, history: [] }
}
function activeTarget(id: string): string | null {
  const loc = locations(id)
  try {
    if (!lstatSync(loc.active).isSymbolicLink()) throw new Error(`${id} is an unmanaged directory; refusing to overwrite it`)
    return path.resolve(path.dirname(loc.active), readlinkSync(loc.active))
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
function recover(id: string): void {
  const loc = locations(id)
  if (!existsSync(loc.journal)) return
  const pending = json(loc.journal) as { before?: unknown; after?: unknown }
  const before = decodeState(pending.before, id), after = decodeState(pending.after, id)
  const target = activeTarget(id)
  const expected = after.current ? release(id, after.current.sha256) : null
  const old = before.current ? release(id, before.current.sha256) : null
  if (target !== expected && target !== old) throw new Error(`${id} activation was interrupted and its pointer changed; manual inspection is required`)
  atomicJson(loc.state, target === expected ? after : before)
  rmSync(loc.journal)
}
function locked<T>(id: string, work: () => T): T {
  const loc = locations(id); mkdirSync(loc.root, { recursive: true, mode: 0o700 })
  let fd: number
  try { fd = openSync(loc.lock, 'wx', 0o600) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    // A crashed owner leaves a lock; only reclaim it when its process is gone.
    const owner = Number(readFileSync(loc.lock, 'utf8'))
    if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error(`${id} package lock needs manual inspection`)
    try { process.kill(owner, 0) } catch (probe) {
      if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { rmSync(loc.lock); return locked(id, work) }
    }
    throw new Error(`Another package operation is using ${id}`)
  }
  try { writeFileSync(fd, String(process.pid)); recover(id); return work() }
  finally { closeSync(fd); rmSync(loc.lock, { force: true }) }
}
function snapshot(source: string, validate = true, installed = false): Snapshot {
  const root = path.resolve(source)
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Package source must be an ordinary directory')
  const files: Snapshot['files'] = []; let total = 0
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === '.git' || entry === 'node_modules') {
        if (installed) throw new Error('Installed release contains unexpected excluded files')
        continue
      }
      const file = path.join(dir, entry), stat = lstatSync(file)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Packages cannot contain symlinks or special files')
      if (stat.isDirectory()) { walk(file); continue }
      if (stat.size > MAX_FILE_BYTES || total + stat.size > MAX_BYTES || files.length >= MAX_FILES) throw new Error('Package exceeds file or size limits')
      const bytes = readFileSync(file); total += bytes.length
      if (bytes.length > MAX_FILE_BYTES || total > MAX_BYTES) throw new Error('Package grew beyond size limits while reading')
      files.push({ name: path.relative(root, file).split(path.sep).join('/'), bytes, mode: stat.mode & 0o111 ? 0o700 : 0o600 })
    }
  }
  walk(root)
  const manifestFile = files.find(file => file.name === 'plugin.json')
  if (!manifestFile) throw new Error('Package has no plugin.json')
  const raw = JSON.parse(manifestFile.bytes.toString('utf8')) as Record<string, unknown>
  const metadata = parseModPackageMetadata(validate ? raw : { version: raw.version }, { requireVersion: true })
  if (validate) {
    const parsed = parseLocalPluginManifest(raw, new Set(PLUGIN_MANIFESTS.map(item => item.id)))
    if (!parsed.manifest) throw new Error(parsed.problems.join('; '))
    if (!['server.mjs', 'server.js', 'server.ts'].some(name => files.some(file => file.name === name))) throw new Error('Package needs a server module')
    const runtime = globalThis as unknown as { Bun?: { Transpiler: new (options: { loader: string }) => { scan(source: string): unknown } } }
    if (!runtime.Bun) throw new Error('Package syntax validation requires Bun')
    for (const file of files.filter(file => /\.(mjs|js|ts|jsx|tsx)$/.test(file.name))) {
      const loader = /\.tsx$/.test(file.name) ? 'tsx' : /\.jsx$/.test(file.name) ? 'jsx' : /\.ts$/.test(file.name) ? 'ts' : 'js'
      new runtime.Bun.Transpiler({ loader }).scan(file.bytes.toString('utf8'))
    }
  }
  safeId(String(raw.id))
  const hash = createHash('sha256')
  for (const file of files) { hash.update(file.name); hash.update('\0'); hash.update(String(file.mode)); hash.update('\0'); hash.update(String(file.bytes.length)); hash.update('\0'); hash.update(file.bytes); hash.update('\0') }
  return { inspection: { id: raw.id as string, version: metadata.version!, sha256: hash.digest('hex'), source: root, installedAt: new Date().toISOString(), files: files.length, bytes: total }, files }
}
export function inspectModPackage(source: string): ModPackageInspection { return snapshot(source).inspection }
function ensureClean(state: ModPackageState): void {
  const target = activeTarget(state.id)
  if (!state.current) { if (target) throw new Error(`${state.id} is not a managed active install`); return }
  if (target !== release(state.id, state.current.sha256)) throw new Error(`${state.id} active pointer was modified`)
  if (snapshot(target, false, true).inspection.sha256 !== state.current.sha256) throw new Error(`${state.id} has local edits; preserve them before changing this package`)
}
function activate(before: ModPackageState, after: ModPackageState): void {
  const loc = locations(before.id)
  mkdirSync(loc.plugins, { recursive: true })
  atomicJson(loc.journal, { before, after })
  const temp = path.join(loc.root, `.activate.${randomUUID()}.tmp`)
  try {
    if (after.current) { symlinkSync(release(before.id, after.current.sha256), temp, 'dir'); renameSync(temp, loc.active) }
    else rmSync(loc.active)
    atomicJson(loc.state, after)
    rmSync(loc.journal)
  } catch (error) {
    // Finish or undo the state record according to the atomic pointer's value.
    recover(before.id)
    throw error
  } finally { rmSync(temp, { force: true }) }
}
export function installModPackage(source: string, sha256: string, updateId?: string): ModPackageState {
  if (!HASH.test(sha256)) throw new Error('Supply the exact SHA-256 from mods inspect')
  const captured = snapshot(source)
  if (captured.inspection.sha256 !== sha256) throw new Error('Package digest does not match the requested pin')
  const id = captured.inspection.id
  if (updateId !== undefined && updateId !== id) throw new Error('Source mod id does not match the mod being updated')
  return locked(id, () => {
    const before = readState(id); ensureClean(before)
    if (updateId === undefined && before.current) throw new Error(`${id} is installed; use update`)
    if (updateId !== undefined && !before.current) throw new Error(`${id} is not installed`)
    if (before.current?.version === captured.inspection.version) throw new Error('An update must use a different version')
    const content = release(id, sha256), releaseRoot = path.dirname(content)
    if (!existsSync(content)) {
      const stage = `${releaseRoot}.${randomUUID()}.stage`
      try {
        mkdirSync(path.join(stage, 'content'), { recursive: true, mode: 0o700 })
        for (const file of captured.files) { const dest = path.join(stage, 'content', file.name); mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 }); writeFileSync(dest, file.bytes, { flag: 'wx', mode: file.mode }) }
        mkdirSync(path.dirname(releaseRoot), { recursive: true }); renameSync(stage, releaseRoot)
      } finally { rmSync(stage, { recursive: true, force: true }) }
    } else if (snapshot(content, false, true).inspection.sha256 !== sha256) throw new Error('Stored package release was modified')
    const { files: _files, bytes: _bytes, ...receipt } = captured.inspection
    const after: ModPackageState = { schema: 1, id, current: receipt, history: [...(before.current ? [before.current] : []), ...before.history].slice(0, 50) }
    activate(before, after); return after
  })
}
export function removeModPackage(id: string): ModPackageState {
  return locked(id, () => { const before = readState(id); ensureClean(before); if (!before.current) throw new Error(`${id} is not installed`); const after: ModPackageState = { ...before, current: null, history: [before.current, ...before.history].slice(0, 50) }; activate(before, after); return after })
}
export function rollbackModPackage(id: string): ModPackageState {
  return locked(id, () => {
    const before = readState(id); ensureClean(before)
    const previous = before.history[0]; if (!previous) throw new Error(`${id} has no previous release`)
    if (snapshot(release(id, previous.sha256), true, true).inspection.sha256 !== previous.sha256) throw new Error('Rollback release was modified')
    const after: ModPackageState = { ...before, current: previous, history: [...(before.current ? [before.current] : []), ...before.history.slice(1)].slice(0, 50) }
    activate(before, after); return after
  })
}
export function listModPackages(): (ModPackageState & { readonly dirty: boolean })[] {
  const root = path.join(path.dirname(localPluginsDir()), 'mod-packages')
  if (!existsSync(root)) return []
  return readdirSync(root).filter(id => LOCAL_PLUGIN_ID.test(id)).sort().map(id => locked(id, () => { const state = readState(id); let dirty = false; try { ensureClean(state) } catch { dirty = true }; return { ...state, dirty } }))
}
