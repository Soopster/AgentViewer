import path from 'node:path'
import { constants } from 'node:fs'
import { open, lstat, mkdir, readFile, writeFile, readdir, rename, link, rm, chmod } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { isPluginEnabled } from '../plugins/enablement'
import type { InstructionChange, InstructionContent, InstructionFile, InstructionPreview, InstructionReceipt, InstructionsManagerService } from '../plugins/instructionsManager'
import { allowedNewRule, canonicalPath, discoverInstructions, digest, instructionsContext, type InstructionsContext } from './discovery'
const MAX_BYTES = 256 * 1024
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const changeSchema = z.strictObject({ path: z.string().min(1).max(4096), text: z.string().max(MAX_BYTES), expectedHash: hashSchema.nullable(), source: z.strictObject({ path: z.string().min(1).max(4096), hash: hashSchema }).optional() })
const requestSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
async function content(file: InstructionFile): Promise<InstructionContent> {
  let text = '', hash: string | null = null
  if (file.exists) {
    // Linked documents can be inspected, but never used as write destinations.
    const handle = await open(file.path, constants.O_RDONLY | constants.O_NONBLOCK | (file.linked ? 0 : constants.O_NOFOLLOW))
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Instruction preview requires a regular file of at most 256 KiB')
      const bytes = Buffer.alloc(MAX_BYTES + 1)
      let count = 0
      while (count < bytes.length) { const result = await handle.read(bytes, count, bytes.length - count, count); if (!result.bytesRead) break; count += result.bytesRead }
      if (count > MAX_BYTES) throw new Error('Instruction file exceeds 256 KiB')
      const raw = bytes.subarray(0, count)
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw)
      if (text.includes('\0')) throw new Error('Binary instruction files cannot be edited')
      hash = digest(raw)
    } finally { await handle.close() }
  }
  const frontmatter = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? ''
  let metadata = frontmatter
  if (frontmatter) { try { const value = parseYaml(frontmatter, { maxAliasCount: 20 }); metadata = JSON.stringify(value, null, 2) } catch (error) { metadata = `Invalid frontmatter: ${String(error)}\n${frontmatter}` } }
  const references = [...new Set([...text.matchAll(/(?:^|\s)@((?:~\/|\.\.?\/)?[\w./-]+\.md)\b/gm)].map(match => match[1]))].slice(0, 50)
  return { file, text, hash, metadata, references }
}
export function createInstructionsManager(loadContext: () => Promise<InstructionsContext> = instructionsContext): InstructionsManagerService {
  const inventory = async (cwd: string, signal?: AbortSignal) => { signal?.throwIfAborted(); const context = await loadContext(), snapshot = await discoverInstructions(cwd, context); signal?.throwIfAborted(); return { context, snapshot } }
  const resolve = async (cwd: string, input: string, signal?: AbortSignal) => {
    const { context, snapshot } = await inventory(cwd, signal), target = path.resolve(snapshot.cwd, input)
    let file = snapshot.files.find(item => item.path === target)
    if (!file) {
      file = allowedNewRule(target, snapshot) ?? undefined
      if (!file) throw new Error('Choose a known instruction file or a Markdown rule inside a discovered rules directory')
      try { const info = await lstat(target); file.exists = true; if (!info.isFile()) file.writable = false } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (await canonicalPath(target) !== target) { file.linked = true; file.writable = false }
    }
    return { context, snapshot, file }
  }
  const prepare = async (cwd: string, raw: InstructionChange, signal?: AbortSignal): Promise<InstructionPreview> => {
    const change = changeSchema.parse(raw)
    if (Buffer.byteLength(change.text, 'utf8') > MAX_BYTES || change.text.includes('\0')) throw new Error('Instructions must be UTF-8 text of at most 256 KiB')
    const { snapshot, file } = await resolve(cwd, change.path, signal)
    if (!file.writable || file.linked) throw new Error(file.note || 'Ancestor and linked instruction files are read-only')
    const before = await content(file)
    if (before.hash !== change.expectedHash) throw new Error('Instruction file changed. Refresh and review it before saving.')
    if (change.source) {
      const source = await resolve(cwd, change.source.path, signal), value = await content(source.file)
      if (source.file.path === file.path) throw new Error('Copy destination must differ from the source')
      if (value.hash !== change.source.hash || value.text !== change.text) throw new Error('Copy source changed. Refresh before copying.')
    }
    signal?.throwIfAborted()
    const normalized = { ...change, path: file.path }
    const hash = digest(JSON.stringify({ cwd: snapshot.cwd, change: normalized, file }))
    return { hash, change: normalized, file, before: before.text, status: before.hash === digest(change.text) ? 'same' : file.exists ? 'replace' : 'create', notices: [file.applies, ...(change.source ? ['Exact independent copy. Relative imports and path-specific frontmatter keep their text and may behave differently at this destination.'] : []), 'Providers may require a new turn, reload or session before changes take effect.'] }
  }
  return {
    async scan(cwd, signal) {
      const { context, snapshot } = await inventory(cwd, signal), { ruleRoots: _ruleRoots, ...result } = snapshot
      try {
        const dir = path.join(context.dataDir, 'receipts'), names = (await readdir(dir)).filter(name => name.endsWith('.json')).slice(0, 1000)
        const receipts = await Promise.all(names.map(async name => { try { return JSON.parse(await readFile(path.join(dir, name), 'utf8')) as InstructionReceipt & { cwd: string } } catch { return null } }))
        result.receipts = receipts.filter((item): item is InstructionReceipt & { cwd: string } => item !== null && item.cwd === snapshot.cwd).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.diagnostics.push(`Cannot read receipts: ${String(error)}`) }
      return result
    },
    async read(cwd, input, signal) { const { file } = await resolve(cwd, input, signal); const value = await content(file); signal?.throwIfAborted(); return value },
    preview: prepare,
    async apply(cwd, requestId, previewHash, raw, replace, signal) {
      if (!isPluginEnabled('instructions-manager')) throw new Error('Instructions Manager is disabled')
      requestSchema.parse(requestId); hashSchema.parse(previewHash)
      const change = changeSchema.parse(raw), { context, snapshot } = await inventory(cwd, signal)
      await mkdir(context.dataDir, { recursive: true, mode: 0o700 })
      const requestKey = digest(JSON.stringify([snapshot.cwd, requestId])), receiptFile = path.join(context.dataDir, 'receipts', `${requestKey}.json`)
      const replay = async () => {
        try { const saved = JSON.parse(await readFile(receiptFile, 'utf8')) as InstructionReceipt & { requestHash: string }; if (saved.requestHash !== digest(JSON.stringify([previewHash, change]))) throw new Error('Request ID already used for a different instruction change'); return saved } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
      }
      const previous = await replay(); if (previous) return previous
      const lockPath = path.join(context.dataDir, 'write.lock')
      let lock
      try { lock = await open(lockPath, 'wx', 0o600) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another instruction write is active. If a previous process stopped, inspect backups before removing write.lock.'); throw error }
      let stage: string | undefined, moved: string | undefined, destination: string | undefined
      try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, requestId, at: Date.now() }))
        const again = await replay(); if (again) return again
        const preview = await prepare(cwd, change, signal)
        if (preview.hash !== previewHash) throw new Error('Preview is stale. Prepare it again before applying.')
        if (preview.status === 'replace' && !replace) throw new Error('Confirm replacement after inspecting the preview')
        const receipt: InstructionReceipt = { requestId, previewHash, path: preview.file.path, status: preview.status === 'same' ? 'unchanged' : preview.status === 'create' ? 'created' : 'updated', createdAt: Date.now() }
        if (preview.status !== 'same') {
          destination = preview.file.path
          if (await canonicalPath(destination) !== destination) throw new Error('Destination became a linked path')
          await mkdir(path.dirname(destination), { recursive: true })
          if (await canonicalPath(destination) !== destination) throw new Error('Destination became a linked path')
          stage = path.join(path.dirname(destination), `.agent-viewer-instructions-${randomUUID()}.tmp`)
          const mode = preview.file.exists ? (await lstat(destination)).mode & 0o777 : 0o644
          await writeFile(stage, change.text, { flag: 'wx', mode }); await chmod(stage, mode)
          if (preview.file.exists) {
            const backupDirectory = path.join(context.dataDir, 'backups', requestKey)
            await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
            const backup = path.join(backupDirectory, path.basename(destination))
            await writeFile(backup, preview.before, { flag: 'wx', mode: 0o600 })
            receipt.backup = backup
            signal?.throwIfAborted()
            moved = `${stage}.previous`
            await rename(destination, moved)
            const actual = await content({ ...preview.file, path: moved })
            if (actual.hash !== change.expectedHash) throw new Error('Instruction file changed during save; previous file retained for recovery')
          }
          signal?.throwIfAborted()
          if (await canonicalPath(path.dirname(destination)) !== path.dirname(destination)) throw new Error('Destination folder changed during save')
          // Atomic no-clobber publish: an external new file cannot be overwritten.
          await link(stage, destination)
          if (moved) { await rm(moved); moved = undefined }
        }
        await mkdir(path.dirname(receiptFile), { recursive: true, mode: 0o700 })
        const receiptTemp = `${receiptFile}.${randomUUID()}.tmp`
        await writeFile(receiptTemp, JSON.stringify({ ...receipt, cwd: snapshot.cwd, requestHash: digest(JSON.stringify([previewHash, change])) }), { flag: 'wx', mode: 0o600 })
        await rename(receiptTemp, receiptFile)
        return receipt
      } catch (error) {
        if (moved && destination) {
          try { await link(moved, destination); await rm(moved); moved = undefined } catch { throw new Error(`${String(error)}. Recovery copy retained at ${moved}; destination was not overwritten.`) }
        }
        throw error
      } finally {
        if (stage) await rm(stage, { force: true }).catch(() => {})
        await lock.close(); await rm(lockPath, { force: true })
      }
    },
  }
}
export const nativeInstructionsManager = createInstructionsManager()
