import { mkdir, readFile, writeFile, lstat, realpath, rename, rm, mkdtemp, open, readdir, stat, chmod } from 'node:fs/promises'
import path from 'node:path'
import { constants } from 'node:fs'
import { z } from 'zod'
import { isPluginEnabled } from '../plugins/enablement'
import { canonicalSkillPath, discoverSkillRoots, skillDigest, skillsContext, type SkillsContext } from './roots'
import { inventorySkills, readSkillBundle, safeSkillKey, withinSkillRoot, type SkillBundle } from './files'
import type { InstalledSkill, SkillCopyApply, SkillCopyPreview, SkillCopyReceipt, SkillCopyRequest, SkillCopyTarget, SkillRoot, SkillsManagerService, SkillsSnapshot } from '../plugins/skillsManager'
const id = z.string().regex(/^[a-f0-9]{64}$/)
const requestSchema = z.strictObject({ sourceId: id, targetIds: z.array(id).min(1).max(30) })
const applySchema = requestSchema.extend({ previewId: id, replaceIds: z.array(id).max(30), requestId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) })
const enabled = () => { if (!isPluginEnabled('skills-manager')) throw new Error('Skills Manager is disabled') }
async function exists(file: string) { try { await lstat(file); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }
async function safeDestination(root: SkillRoot, key: string) {
  if (!safeSkillKey(key) || key.split('/').includes('.system')) throw new Error('This skill folder is reserved or invalid')
  const destination = path.join(root.path, ...key.split('/'))
  if (!withinSkillRoot(root.path, destination) || destination === root.path) throw new Error('Invalid destination')
  if (await canonicalSkillPath(root.path) !== root.path) throw new Error('Destination location changed into a link; refresh locations')
  let current = root.path
  for (const segment of key.split('/')) {
    current = path.join(current, segment)
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Destination contains a link; choose a direct skill folder') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return destination
}
function select(snapshot: SkillsSnapshot, skillId: string) {
  const skill = snapshot.skills.find(item => item.id === skillId), root = snapshot.roots.find(item => item.id === skill?.rootId)
  if (!skill || !root) throw new Error('Skill no longer exists. Refresh the inventory.')
  return { skill, root, directory: path.join(root.path, ...skill.key.split('/')) }
}
async function fileChanges(source: SkillBundle, destination: string): Promise<{ hash: string | null; files: SkillCopyTarget['files'] }> {
  const previous = await exists(destination) ? await readSkillBundle(destination, undefined, true) : null
  const before = new Map(previous?.files.map(file => [file.path, file])), after = new Map(source.files.map(file => [file.path, file]))
  return { hash: previous?.hash ?? null, files: [...new Set([...after.keys(), ...before.keys()])].sort().map(file => ({ path: file, status: !after.has(file) ? 'remove' : !before.has(file) ? 'add' : after.get(file)!.hash === before.get(file)!.hash && after.get(file)!.mode === before.get(file)!.mode ? 'same' : 'replace' })) }
}
async function copyBundle(bundle: SkillBundle, destination: string) {
  await mkdir(destination, { recursive: true })
  for (const file of bundle.files) {
    const target = path.join(destination, ...file.path.split('/'))
    if (!withinSkillRoot(destination, target)) throw new Error('Invalid resource path')
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, file.content, { mode: file.mode, flag: 'wx' })
    await chmod(target, file.mode)
  }
}
async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await rename(temporary, file) }
  finally { await rm(temporary, { force: true }) }
}
async function acquireLock(dataDir: string) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const lock = path.join(dataDir, 'sync.lock')
  try { const handle = await open(lock, 'wx', 0o600); await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() })); await handle.close() }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    throw new Error('A skill sync lock already exists. If a previous process was interrupted, inspect its receipt and backups before removing sync.lock.')
  }
  return () => rm(lock, { force: true })
}
async function installCopy(bundle: SkillBundle, root: SkillRoot, skill: InstalledSkill, target: SkillCopyTarget, backupDir: string, signal?: AbortSignal): Promise<SkillCopyReceipt['results'][number]> {
  const destination = await safeDestination(root, skill.key)
  await mkdir(root.path, { recursive: true })
  const work = await mkdtemp(path.join(path.dirname(root.path), '.agent-viewer-skills-'))
  const staged = path.join(work, 'new'), old = path.join(work, 'previous')
  let moved = false, installed = false, recoveryNeeded = false
  try {
    await copyBundle(bundle, staged)
    signal?.throwIfAborted()
    await safeDestination(root, skill.key)
    const actual = await exists(destination) ? await readSkillBundle(destination, signal, true) : null
    if ((actual?.hash ?? null) !== target.hash) throw new Error('Destination changed since preview. Preview again.')
    let backup: string | undefined
    if (actual) { backup = path.join(backupDir, root.id); await copyBundle(actual, backup) }
    await mkdir(path.dirname(destination), { recursive: true })
    if (actual) {
      await rename(destination, old); moved = true
      if ((await readSkillBundle(old, signal, true)).hash !== target.hash) throw new Error('Destination was edited during the copy. Restoring it.')
    }
    // A create must not replace a folder that appeared after its preview.
    if (await exists(destination)) throw new Error('Destination appeared during the copy. Preview again.')
    signal?.throwIfAborted()
    await rename(staged, destination); installed = true
    return { rootId: root.id, path: destination, status: 'copied', ...(backup ? { backup } : {}) }
  } catch (error) {
    if (moved && !installed) {
      try { if (await exists(destination)) throw new Error('Another writer recreated the destination'); await rename(old, destination); moved = false }
      catch (cause) { recoveryNeeded = true; throw new Error(`Copy failed and needs recovery. Previous files: ${old}. ${String(cause)}`) }
    }
    throw error
  } finally { if (!recoveryNeeded) await rm(work, { recursive: true, force: true }) }
}
export function createSkillsManager(loadContext: () => Promise<SkillsContext> = skillsContext): SkillsManagerService {
  const cached = new Map<string, { at: number; value: SkillsSnapshot }>()
  const scan = async (cwd: string, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const context = await loadContext(), roots = await discoverSkillRoots(cwd, context)
    const inventory = await inventorySkills(roots, signal)
    const receipts: SkillCopyReceipt[] = []
    try {
      const directory = path.join(context.dataDir, 'receipts'), canonical = await realpath(cwd)
      const names = (await readdir(directory)).filter(name => /^[a-zA-Z0-9_-]+\.json$/.test(name))
      const dated = await Promise.all(names.map(async name => ({ name, at: (await stat(path.join(directory, name))).mtimeMs })))
      for (const { name } of dated.sort((a, b) => b.at - a.at).slice(0, 100)) {
        try { const saved = JSON.parse(await readFile(path.join(directory, name), 'utf8')); if (saved.cwd === canonical) receipts.push(saved.receipt) } catch { /* an unreadable receipt does not hide installed skills */ }
        if (receipts.length >= 10) break
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') inventory.diagnostics.push(`Copy receipts unavailable: ${String(error)}`) }
    const value = { roots, ...inventory, receipts }
    signal?.throwIfAborted(); cached.set(cwd, { at: Date.now(), value }); return value
  }
  const prepare = async (cwd: string, raw: SkillCopyRequest, signal?: AbortSignal) => {
    const request = requestSchema.parse(raw), snapshot = await scan(cwd, signal), source = select(snapshot, request.sourceId)
    if (!source.skill.syncable) throw new Error(source.skill.issues.join('; ') || 'This skill cannot be copied')
    const canonicalSource = await realpath(source.directory), bundle = await readSkillBundle(canonicalSource, signal)
    if (bundle.hash !== source.skill.hash) throw new Error('Source changed during discovery. Refresh and preview again.')
    const targets: SkillCopyTarget[] = []
    for (const targetId of [...new Set(request.targetIds)].sort()) {
      signal?.throwIfAborted()
      const root = snapshot.roots.find(item => item.id === targetId)
      if (!root) throw new Error('Destination location no longer exists. Refresh locations.')
      const destination = path.join(root.path, ...source.skill.key.split('/'))
      try {
        if (!root.writable) throw new Error(root.note || 'Destination is read-only')
        await safeDestination(root, source.skill.key)
        if (withinSkillRoot(canonicalSource, destination) || withinSkillRoot(destination, canonicalSource)) throw new Error('Source and destination overlap')
        const change = await fileChanges(bundle, destination)
        targets.push({ rootId: root.id, path: destination, ...change, status: change.hash === bundle.hash ? 'same' : change.hash ? 'replace' : 'add' })
      } catch (error) { targets.push({ rootId: root.id, path: destination, status: 'blocked', hash: null, files: [], reason: error instanceof Error ? error.message : String(error) }) }
    }
    for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
      if (withinSkillRoot(targets[i].path, targets[j].path) || withinSkillRoot(targets[j].path, targets[i].path)) {
        targets[i] = { ...targets[i], status: 'blocked', reason: 'Selected destinations overlap' }
        targets[j] = { ...targets[j], status: 'blocked', reason: 'Selected destinations overlap' }
      }
    }
    const bindings = snapshot.roots.filter(root => root.id === source.root.id || request.targetIds.includes(root.id)).map(root => [root.id, root.path, root.writable, root.consumers.slice().sort()]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    const preview: SkillCopyPreview = { id: skillDigest(JSON.stringify([cwd, canonicalSource, source.skill.id, bundle.hash, targets, bindings])), sourceId: source.skill.id, sourceHash: bundle.hash, sourceName: source.skill.name, targets }
    return { preview, bundle, source, snapshot }
  }
  return {
    scan,
    async file(cwd, skillId, file, signal) {
      id.parse(skillId)
      if (!file || file.length > 1024 || file.startsWith('/') || file.includes('\\') || /[\x00-\x1f]/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid skill resource path')
      const cache = cached.get(cwd), snapshot = cache && Date.now() - cache.at < 5000 ? cache.value : await scan(cwd, signal)
      const source = select(snapshot, skillId), canonical = await realpath(source.directory), target = path.join(canonical, ...file.split('/'))
      if (!withinSkillRoot(canonical, target)) throw new Error('Resource is outside the skill')
      let current = canonical
      for (const part of file.split('/')) { current = path.join(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error('Linked resources are not previewed') }
      const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const info = await handle.stat(); if (!info.isFile()) throw new Error('Choose a regular resource file')
        const buffer = Buffer.alloc(Math.min(info.size, 256 * 1024)); await handle.read(buffer, 0, buffer.length, 0)
        signal?.throwIfAborted()
        const binary = buffer.includes(0)
        return { text: binary ? 'Binary resource; it is included in a copy.' : buffer.toString('utf8'), binary, truncated: info.size > buffer.length }
      } finally { await handle.close() }
    },
    async preview(cwd, request, signal) { enabled(); return (await prepare(cwd, request, signal)).preview },
    async apply(cwd, raw: SkillCopyApply, signal) {
      enabled(); const request = applySchema.parse(raw), context = await loadContext()
      const release = await acquireLock(context.dataDir)
      const receiptDir = path.join(context.dataDir, 'receipts'), receiptPath = path.join(receiptDir, `${request.requestId}.json`)
      const canonicalCwd = await realpath(cwd)
      const requestHash = skillDigest(JSON.stringify([canonicalCwd, request.sourceId, [...request.targetIds].sort(), request.previewId, [...request.replaceIds].sort()]))
      try {
        await mkdir(receiptDir, { recursive: true, mode: 0o700 })
        if (await exists(receiptPath)) {
          const saved = JSON.parse(await readFile(receiptPath, 'utf8')) as { requestHash: string; receipt: SkillCopyReceipt }
          if (saved.requestHash !== requestHash) throw new Error('Request ID belongs to another copy operation')
          return saved.receipt
        }
        const prepared = await prepare(cwd, { sourceId: request.sourceId, targetIds: request.targetIds }, signal), { preview, bundle, source, snapshot } = prepared
        if (preview.id !== request.previewId) throw new Error('Source, destination, or account configuration changed. Preview again.')
        if (preview.targets.some(target => target.status === 'blocked')) throw new Error('Remove blocked destinations before applying')
        if (preview.targets.some(target => target.status === 'replace' && !request.replaceIds.includes(target.rootId))) throw new Error('Explicitly select replacement for every conflicting destination')
        const receipt: SkillCopyReceipt = { id: request.requestId, status: 'applying', sourceName: preview.sourceName, results: [], createdAt: Date.now() }
        const save = () => atomicJson(receiptPath, { requestHash, cwd: canonicalCwd, receipt })
        signal?.throwIfAborted(); enabled(); await save()
        try {
          for (const target of preview.targets) {
            signal?.throwIfAborted(); enabled()
            if (target.status === 'same') { receipt.results.push({ rootId: target.rootId, path: target.path, status: 'unchanged' }); continue }
            const root = snapshot.roots.find(item => item.id === target.rootId)!
            try {
              if ((await readSkillBundle(await realpath(source.directory), signal)).hash !== preview.sourceHash) throw new Error('Source changed after preview. Preview again.')
              receipt.results.push(await installCopy(bundle, root, source.skill, target, path.join(context.dataDir, 'backups', request.requestId), signal))
            } catch (error) { receipt.results.push({ rootId: target.rootId, path: target.path, status: 'failed', error: error instanceof Error ? error.message : String(error) }); throw error }
            await save()
          }
          receipt.status = 'applied'
        } catch (error) { receipt.status = receipt.results.some(item => item.status === 'copied') ? 'partial' : 'failed'; receipt.error = error instanceof Error ? error.message : String(error) }
        await save(); cached.delete(cwd); return receipt
      } finally { await release() }
    },
  }
}
export const nativeSkillsManager = createSkillsManager()
