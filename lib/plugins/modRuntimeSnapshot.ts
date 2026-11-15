// Bun caches imported modules by real path even when a query string changes.
// Give each trusted mod revision its own source-tree identity. This does not
// import or evaluate mod code; snapshots are private process-lifetime files.
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const MOD_RUNTIME_SNAPSHOT_LIMITS = Object.freeze({ files: 1000, entries: 2000, bytes: 32 * 1024 * 1024, fileBytes: 10 * 1024 * 1024, depth: 64 })
const snapshots = new Map<string, { root: string; sourceRoot: string }>()
let processRoot: string | null = null
function temporaryRoot(): string {
  if (processRoot) return processRoot
  processRoot = mkdtempSync(path.join(tmpdir(), 'agent-viewer-mod-runtime-'))
  process.once('exit', () => { if (processRoot) { try { rmSync(processRoot, { recursive: true, force: true }) } catch { /* Process exit cannot recover cleanup failures. */ } } })
  return processRoot
}
function contained(root: string, file: string): boolean { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) }
function nearestDependencies(root: string): string | null {
  let current = root
  for (;;) {
    const candidate = path.join(current, 'node_modules')
    try { if (statSync(candidate).isDirectory()) return realpathSync(candidate) } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/** Snapshot a trusted mod tree; entryPath may be absolute or relative to pluginDir. */
export function snapshotLocalModEntry(pluginDir: string, entryPath: string, revision: string): string {
  if (typeof revision !== 'string' || !revision.length || revision.length > 1000) throw new Error('Mod snapshot requires a bounded revision string')
  const logicalRoot = path.resolve(pluginDir), sourceRoot = realpathSync(logicalRoot)
  if (!statSync(sourceRoot).isDirectory()) throw new Error('Mod snapshot source is not a directory')
  const logicalEntry = path.isAbsolute(entryPath) ? path.resolve(entryPath) : path.resolve(logicalRoot, entryPath)
  // Support callers using the canonical entry path after package symlink resolution.
  if (!contained(logicalRoot, logicalEntry) && !contained(sourceRoot, logicalEntry)) throw new Error('Mod snapshot entry is outside the plugin directory')
  const sourceEntry = realpathSync(logicalEntry)
  if (!contained(sourceRoot, sourceEntry) || !statSync(sourceEntry).isFile()) throw new Error('Mod snapshot entry is outside the source tree or not a file')
  const relativeEntry = path.relative(sourceRoot, sourceEntry)
  if (relativeEntry.split(path.sep).some(part => part === '.git' || part === 'node_modules')) throw new Error('Mod snapshot entry belongs to an excluded directory')
  const cacheKey = JSON.stringify([logicalRoot, sourceRoot, revision])
  const cached = snapshots.get(cacheKey)
  if (cached) return path.join(cached.root, relativeEntry)
  const destination = path.join(temporaryRoot(), randomUUID())
  mkdirSync(destination, { mode: 0o700 })
  let files = 0, entries = 0, bytes = 0
  const walk = (source: string, target: string, depth: number) => {
    if (depth > MOD_RUNTIME_SNAPSHOT_LIMITS.depth) throw new Error('Mod snapshot exceeds directory depth limit')
    for (const name of readdirSync(source).sort()) {
      if (name === '.git' || name === 'node_modules') continue
      if (++entries > MOD_RUNTIME_SNAPSHOT_LIMITS.entries) throw new Error('Mod snapshot exceeds entry limit')
      const file = path.join(source, name), dest = path.join(target, name), info = lstatSync(file)
      if (info.isSymbolicLink()) throw new Error(`Mod snapshot refuses source symlink: ${path.relative(sourceRoot, file)}`)
      if (!contained(sourceRoot, realpathSync(file))) throw new Error('Mod snapshot source path escaped its tree')
      if (info.isDirectory()) { mkdirSync(dest, { mode: 0o700 }); walk(file, dest, depth + 1); continue }
      if (!info.isFile()) throw new Error('Mod snapshot refuses special files')
      if (++files > MOD_RUNTIME_SNAPSHOT_LIMITS.files || info.size > MOD_RUNTIME_SNAPSHOT_LIMITS.fileBytes || bytes + info.size > MOD_RUNTIME_SNAPSHOT_LIMITS.bytes) throw new Error('Mod snapshot exceeds file or byte limits')
      // O_NOFOLLOW closes the final-component symlink race between lstat/open.
      const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const current = fstatSync(fd)
        if (!current.isFile() || current.size > MOD_RUNTIME_SNAPSHOT_LIMITS.fileBytes || bytes + current.size > MOD_RUNTIME_SNAPSHOT_LIMITS.bytes) throw new Error('Mod snapshot file changed beyond limits')
        const data = readFileSync(fd)
        bytes += data.length
        if (data.length > MOD_RUNTIME_SNAPSHOT_LIMITS.fileBytes || bytes > MOD_RUNTIME_SNAPSHOT_LIMITS.bytes) throw new Error('Mod snapshot grew beyond byte limits')
        writeFileSync(dest, data, { flag: 'wx', mode: current.mode & 0o111 ? 0o700 : 0o600 })
      } finally { closeSync(fd) }
    }
  }
  try {
    walk(sourceRoot, destination, 0)
    // Dependencies remain at their original location; they are not versioned or
    // isolated by a source reload. Prefer canonical-path resolution, then the
    // logical package location when the active install is a symlink.
    const dependencies = nearestDependencies(sourceRoot) ?? nearestDependencies(logicalRoot)
    if (dependencies) symlinkSync(dependencies, path.join(destination, 'node_modules'), 'dir')
    const result = path.join(destination, relativeEntry)
    if (!statSync(result).isFile()) throw new Error('Mod snapshot entry was excluded from the source copy')
    snapshots.set(cacheKey, { root: destination, sourceRoot })
    return result
  } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error }
}
