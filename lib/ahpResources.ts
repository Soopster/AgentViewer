import { createHash, randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import {
  constants,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AhpErrorCodes, JsonRpcErrorCodes } from '@microsoft/agent-host-protocol'

type Params = Record<string, unknown>
type AccessMode = 'read' | 'write'

type Grant = {
  root: string
  read: boolean
  write: boolean
}

type ResourceWatch = {
  channel: string
  root: string
  recursive: boolean
  includes?: { items: string[] }
  excludes?: { items: string[] }
  watcher?: FSWatcher
  subscribed: boolean
  known: Map<string, string>
  pending: Map<string, 'added' | 'updated' | 'deleted'>
  flushTimer?: ReturnType<typeof setTimeout>
  pollTimer?: ReturnType<typeof setInterval>
  polling?: boolean
}

type EmitAction = (channel: string, action: Record<string, unknown>) => void

export class AhpResourceError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
  }
}

const writeQueues = new Map<string, Promise<void>>()

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function bool(value: unknown): boolean {
  return value === true
}

function requireRootChannel(params: Params): void {
  if (params.channel !== 'ahp-root://') {
    throw new AhpResourceError(JsonRpcErrorCodes.InvalidParams, 'channel must be ahp-root://')
  }
}

function requireFileUri(value: unknown, field = 'uri'): string {
  const uri = text(value)
  if (!uri) throw new AhpResourceError(JsonRpcErrorCodes.InvalidParams, `${field} is required`)
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw new AhpResourceError(JsonRpcErrorCodes.InvalidParams, `${field} must be a valid URI`)
  }
  if (parsed.protocol !== 'file:') {
    throw new AhpResourceError(AhpErrorCodes.PermissionDenied, `Only file: resources are available: ${uri}`)
  }
  try {
    return fileURLToPath(parsed)
  } catch {
    throw new AhpResourceError(JsonRpcErrorCodes.InvalidParams, `${field} is not a valid file URI`)
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function nearestExistingParent(candidate: string): Promise<string> {
  let current = candidate
  for (;;) {
    try {
      return await realpath(current)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

async function canonicalAllowedRoots(roots: string[]): Promise<string[]> {
  const canonical = await Promise.all(roots.map((root) => realpath(path.resolve(root)).catch(() => undefined)))
  return [...new Set(canonical.filter((root): root is string => Boolean(root)))]
}

async function resolveAllowedPath(
  roots: string[],
  value: unknown,
  options: { field?: string; mustExist?: boolean; followFinalSymlink?: boolean } = {},
): Promise<{ requested: string; canonical?: string }> {
  const requested = path.resolve(requireFileUri(value, options.field))
  const allowedRoots = await canonicalAllowedRoots(roots)
  if (!allowedRoots.some((root) => isWithin(root, requested))) {
    throw new AhpResourceError(AhpErrorCodes.PermissionDenied, 'Resource is outside the AHP host roots')
  }
  try {
    const canonical = options.followFinalSymlink === false
      ? path.join(await realpath(path.dirname(requested)), path.basename(requested))
      : await realpath(requested)
    if (!allowedRoots.some((root) => isWithin(root, canonical))) {
      throw new AhpResourceError(AhpErrorCodes.PermissionDenied, 'Resource resolves outside the AHP host roots')
    }
    return { requested, canonical }
  } catch (error) {
    if (error instanceof AhpResourceError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw mapFsError(error)
    if (options.mustExist !== false) {
      throw new AhpResourceError(AhpErrorCodes.NotFound, `Resource not found: ${pathToFileURL(requested).href}`)
    }
    const parent = await nearestExistingParent(path.dirname(requested)).catch((parentError) => {
      throw mapFsError(parentError)
    })
    if (!allowedRoots.some((root) => isWithin(root, parent))) {
      throw new AhpResourceError(AhpErrorCodes.PermissionDenied, 'Resource parent resolves outside the AHP host roots')
    }
    return { requested }
  }
}

function mapFsError(error: unknown): AhpResourceError {
  if (error instanceof AhpResourceError) return error
  const value = error as NodeJS.ErrnoException
  switch (value.code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return new AhpResourceError(AhpErrorCodes.NotFound, value.message)
    case 'EEXIST':
    case 'ENOTEMPTY':
      return new AhpResourceError(AhpErrorCodes.AlreadyExists, value.message)
    case 'EACCES':
    case 'EPERM':
      return new AhpResourceError(AhpErrorCodes.PermissionDenied, value.message)
    default:
      return new AhpResourceError(JsonRpcErrorCodes.InternalError, value.message || 'Filesystem operation failed')
  }
}

function contentType(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase()
  return ({
    '.css': 'text/css',
    '.csv': 'text/csv',
    '.gif': 'image/gif',
    '.html': 'text/html',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.txt': 'text/plain',
    '.webp': 'image/webp',
    '.xml': 'application/xml',
  } as Record<string, string>)[extension]
}

function etag(size: number, mtimeMs: number): string {
  const digest = createHash('sha256').update(`${size}:${mtimeMs}`).digest('hex').slice(0, 16)
  return `W/"${size}-${digest}"`
}

function decodeData(params: Params): Buffer {
  const data = text(params.data)
  if (params.encoding === 'base64') {
    const normalized = data.replace(/\s/g, '')
    if (
      normalized.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
    ) {
      throw new AhpResourceError(JsonRpcErrorCodes.InvalidParams, 'data is not valid base64')
    }
    return Buffer.from(normalized, 'base64')
  }
  if (params.encoding === 'utf-8') return Buffer.from(data, 'utf8')
  throw new AhpResourceError(JsonRpcErrorCodes.InvalidParams, 'encoding must be base64 or utf-8')
}

async function withWriteQueue<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const prior = writeQueues.get(filePath) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const queued = prior.then(() => current)
  writeQueues.set(filePath, queued)
  await prior
  try {
    return await operation()
  } finally {
    release()
    if (writeQueues.get(filePath) === queued) writeQueues.delete(filePath)
  }
}

async function assertNotAllowedRoot(roots: string[], filePath: string): Promise<void> {
  const allowedRoots = await canonicalAllowedRoots(roots)
  if (allowedRoots.includes(path.resolve(filePath))) {
    throw new AhpResourceError(AhpErrorCodes.PermissionDenied, 'An AHP host root cannot be replaced or deleted')
  }
}

async function resourceRead(access: AhpResourceAccess, params: Params): Promise<Record<string, unknown>> {
  requireRootChannel(params)
  const target = await access.authorize(params.uri, 'read')
  const data = await readFile(target.canonical!).catch((error) => { throw mapFsError(error) })
  const encoding = params.encoding === 'utf-8' ? 'utf-8' : 'base64'
  return {
    data: data.toString(encoding === 'utf-8' ? 'utf8' : 'base64'),
    encoding,
    ...(contentType(target.canonical!) ? { contentType: contentType(target.canonical!) } : {}),
  }
}

async function resourceList(access: AhpResourceAccess, params: Params): Promise<Record<string, unknown>> {
  requireRootChannel(params)
  const target = await access.authorize(params.uri, 'read')
  const entries = await readdir(target.canonical!, { withFileTypes: true }).catch((error) => { throw mapFsError(error) })
  return {
    entries: entries
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

async function resourceResolve(access: AhpResourceAccess, params: Params): Promise<Record<string, unknown>> {
  requireRootChannel(params)
  const follow = params.followSymlinks !== false
  const target = await access.authorize(params.uri, 'read', { followFinalSymlink: follow })
  const info = await (follow ? stat(target.requested) : lstat(target.requested)).catch((error) => { throw mapFsError(error) })
  const type = info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : 'file'
  return {
    uri: pathToFileURL(follow ? target.canonical! : target.requested).href,
    type,
    ...(!info.isDirectory() ? { size: info.size } : {}),
    mtime: info.mtime.toISOString(),
    ctime: info.birthtime.toISOString(),
    ...(!info.isDirectory() && contentType(target.requested) ? { contentType: contentType(target.requested) } : {}),
    etag: etag(info.size, info.mtimeMs),
  }
}

async function resourceWrite(access: AhpResourceAccess, params: Params): Promise<Record<string, never>> {
  requireRootChannel(params)
  const target = await access.authorize(params.uri, 'write', { mustExist: false })
  const incoming = decodeData(params)
  const mode = text(params.mode) || 'truncate'
  if (!['truncate', 'append', 'insert'].includes(mode)) {
    throw new AhpResourceError(JsonRpcErrorCodes.InvalidParams, 'mode must be truncate, append, or insert')
  }
  const position = params.position === undefined ? 0 : Number(params.position)
  if (!Number.isSafeInteger(position) || position < 0) {
    throw new AhpResourceError(JsonRpcErrorCodes.InvalidParams, 'position must be a non-negative integer')
  }
  return withWriteQueue(target.requested, async () => {
    let existing = Buffer.alloc(0)
    let exists = true
    try {
      existing = await readFile(target.requested)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') exists = false
      else throw mapFsError(error)
    }
    if (bool(params.createOnly) && exists) {
      throw new AhpResourceError(AhpErrorCodes.AlreadyExists, 'Resource already exists')
    }
    if (params.ifMatch !== undefined) {
      if (!exists) throw new AhpResourceError(AhpErrorCodes.Conflict, 'Resource no longer exists')
      const info = await stat(target.requested)
      if (text(params.ifMatch) !== etag(info.size, info.mtimeMs)) {
        throw new AhpResourceError(AhpErrorCodes.Conflict, 'Resource etag does not match')
      }
    }
    if (position > existing.length) {
      throw new AhpResourceError(JsonRpcErrorCodes.InvalidParams, 'position exceeds the current file size')
    }
    const next = mode === 'truncate'
      ? Buffer.concat([existing.subarray(0, position), incoming])
      : mode === 'append'
        ? Buffer.concat([
            existing.subarray(0, existing.length - position),
            incoming,
            existing.subarray(existing.length - position),
          ])
        : Buffer.concat([existing.subarray(0, position), incoming, existing.subarray(position)])
    await writeFile(target.requested, next, { flag: bool(params.createOnly) ? 'wx' : 'w' })
    return {}
  })
}

async function resourceMkdir(access: AhpResourceAccess, params: Params): Promise<Record<string, never>> {
  requireRootChannel(params)
  const target = await access.authorize(params.uri, 'write', { mustExist: false, followFinalSymlink: false })
  try {
    await mkdir(target.requested, { recursive: true })
    return {}
  } catch (error) {
    throw mapFsError(error)
  }
}

async function resourceDelete(access: AhpResourceAccess, params: Params): Promise<Record<string, never>> {
  requireRootChannel(params)
  const target = await access.authorize(params.uri, 'write', { followFinalSymlink: false })
  try {
    await assertNotAllowedRoot(await access.allowedRoots(), target.requested)
    const info = await lstat(target.requested)
    if (info.isDirectory()) await rm(target.requested, { recursive: bool(params.recursive), force: false })
    else await unlink(target.requested)
    return {}
  } catch (error) {
    throw mapFsError(error)
  }
}

async function resourceCopy(access: AhpResourceAccess, params: Params): Promise<Record<string, never>> {
  requireRootChannel(params)
  const source = await access.authorize(params.source, 'read', { field: 'source' })
  const destination = await access.authorize(params.destination, 'write', { field: 'destination', mustExist: false, followFinalSymlink: false })
  try {
    if (path.resolve(source.canonical!) === path.resolve(destination.requested)) {
      throw new AhpResourceError(AhpErrorCodes.Conflict, 'Source and destination must differ')
    }
    const sourceInfo = await stat(source.canonical!)
    if (sourceInfo.isDirectory() && isWithin(source.canonical!, destination.requested)) {
      throw new AhpResourceError(AhpErrorCodes.Conflict, 'A directory cannot be copied into itself')
    }
    const destinationInfo = await lstat(destination.requested).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (destinationInfo && bool(params.failIfExists)) {
      throw new AhpResourceError(AhpErrorCodes.AlreadyExists, 'Destination already exists')
    }
    if (destinationInfo) {
      await assertNotAllowedRoot(await access.allowedRoots(), destination.requested)
      await rm(destination.requested, { recursive: true, force: false })
    }
    if (sourceInfo.isDirectory()) {
      await cp(source.canonical!, destination.requested, {
        recursive: true,
        force: false,
      })
    } else {
      await copyFile(source.canonical!, destination.requested, constants.COPYFILE_EXCL)
    }
    return {}
  } catch (error) {
    throw mapFsError(error)
  }
}

async function resourceMove(access: AhpResourceAccess, params: Params): Promise<Record<string, never>> {
  requireRootChannel(params)
  const source = await access.authorize(params.source, 'write', { field: 'source', followFinalSymlink: false })
  const destination = await access.authorize(params.destination, 'write', { field: 'destination', mustExist: false, followFinalSymlink: false })
  try {
    const roots = await access.allowedRoots()
    await assertNotAllowedRoot(roots, source.requested)
    await assertNotAllowedRoot(roots, destination.requested)
    if (path.resolve(source.requested) === path.resolve(destination.requested)) {
      throw new AhpResourceError(AhpErrorCodes.Conflict, 'Source and destination must differ')
    }
    const sourceInfo = await lstat(source.requested)
    if (sourceInfo.isDirectory() && isWithin(source.requested, destination.requested)) {
      throw new AhpResourceError(AhpErrorCodes.Conflict, 'A directory cannot be moved into itself')
    }
    const destinationExists = await lstat(destination.requested).then(() => true, () => false)
    if (destinationExists && bool(params.failIfExists)) {
      throw new AhpResourceError(AhpErrorCodes.AlreadyExists, 'Destination already exists')
    }
    if (destinationExists) await rm(destination.requested, { recursive: true, force: false })
    await rename(source.requested, destination.requested)
    return {}
  } catch (error) {
    throw mapFsError(error)
  }
}

function patternItems(value: unknown): string[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const items = (value as Record<string, unknown>).items
  if (!Array.isArray(items)) return undefined
  return items.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function globRegex(pattern: string): RegExp {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!
    if (char === '*' && pattern[index + 1] === '*') {
      source += '.*'
      index += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[\\^$+?.()|[\]{}]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`)
}

function matchesWatch(watchValue: ResourceWatch, relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/')
  const includes = watchValue.includes?.items
  const excludes = watchValue.excludes?.items
  if (includes?.length && !includes.some((pattern) => globRegex(pattern).test(normalized))) return false
  if (excludes?.some((pattern) => globRegex(pattern).test(normalized))) return false
  return true
}

async function collectKnown(root: string, recursive: boolean): Promise<Map<string, string>> {
  const known = new Map<string, string>()
  const remember = async (absolute: string): Promise<void> => {
    const info = await lstat(absolute)
    known.set(absolute, `${info.size}:${info.mtimeMs}:${info.mode}`)
  }
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      await remember(absolute)
      if (recursive && entry.isDirectory()) await visit(absolute)
    }
  }
  const info = await stat(root)
  if (info.isDirectory()) await visit(root)
  else await remember(root)
  return known
}

export class AhpResourceAccess {
  private readonly grants: Grant[] = []
  private readonly watches = new Map<string, ResourceWatch>()

  constructor(
    private readonly rootsSource: string[] | (() => Promise<string[]>),
    private readonly emitAction: EmitAction,
  ) {
  }

  async allowedRoots(): Promise<string[]> {
    const roots = typeof this.rootsSource === 'function'
      ? await this.rootsSource()
      : this.rootsSource
    return canonicalAllowedRoots(roots)
  }

  async authorize(
    uri: unknown,
    mode: AccessMode,
    options: { field?: string; mustExist?: boolean; followFinalSymlink?: boolean } = {},
  ): Promise<{ requested: string; canonical?: string }> {
    const roots = await this.allowedRoots()
    const target = await resolveAllowedPath(roots, uri, options)
    const canonicalGrants = await Promise.all(this.grants.map(async (grant) => ({
      ...grant,
      root: await realpath(grant.root).catch(() => path.resolve(grant.root)),
    })))
    const effective = target.canonical ?? target.requested
    const allowed = canonicalGrants.some((grant) => (
      isWithin(grant.root, effective) && (mode === 'read' ? grant.read : grant.write)
    ))
    if (!allowed) {
      throw new AhpResourceError(
        AhpErrorCodes.PermissionDenied,
        `The AHP client has not been granted ${mode} access to this resource`,
        {
          request: {
            channel: 'ahp-root://',
            uri: text(uri),
            [mode]: true,
          },
        },
      )
    }
    return target
  }

  async handle(method: string, params: Params): Promise<Record<string, unknown>> {
    switch (method) {
      case 'resourceRead': return resourceRead(this, params)
      case 'resourceWrite': {
        const result = await resourceWrite(this, params)
        await this.notifyKnownWatches(params.uri, 'updated')
        return result
      }
      case 'resourceList': return resourceList(this, params)
      case 'resourceCopy': {
        const result = await resourceCopy(this, params)
        await this.notifyKnownWatches(params.destination, 'added')
        return result
      }
      case 'resourceDelete': {
        const result = await resourceDelete(this, params)
        await this.notifyKnownWatches(params.uri, 'deleted')
        return result
      }
      case 'resourceMove': {
        const result = await resourceMove(this, params)
        await this.notifyKnownWatches(params.source, 'deleted')
        await this.notifyKnownWatches(params.destination, 'added')
        return result
      }
      case 'resourceResolve': return resourceResolve(this, params)
      case 'resourceMkdir': {
        const result = await resourceMkdir(this, params)
        await this.notifyKnownWatches(params.uri, 'added')
        return result
      }
      case 'resourceRequest': return this.resourceRequest(params)
      case 'createResourceWatch': return this.createResourceWatch(params)
      default:
        throw new AhpResourceError(JsonRpcErrorCodes.MethodNotFound, `Unsupported resource method: ${method}`)
    }
  }

  snapshot(channel: string, fromSeq: number): Record<string, unknown> | null {
    const watchValue = this.watches.get(channel)
    if (!watchValue) return null
    return {
      resource: channel,
      state: {
        root: pathToFileURL(watchValue.root).href,
        recursive: watchValue.recursive,
        ...(watchValue.includes ? { includes: watchValue.includes } : {}),
        ...(watchValue.excludes ? { excludes: watchValue.excludes } : {}),
      },
      fromSeq,
    }
  }

  subscribe(channel: string, fromSeq: number): Record<string, unknown> | null {
    const watchValue = this.watches.get(channel)
    if (!watchValue) return null
    if (watchValue.subscribed) return this.snapshot(channel, fromSeq)
    watchValue.subscribed = true
    try {
      watchValue.watcher = watch(watchValue.root, { recursive: watchValue.recursive }, (eventType, filename) => {
        const changedPath = filename
          ? path.resolve(watchValue.root, filename.toString())
          : watchValue.root
        const relative = path.relative(watchValue.root, changedPath) || path.basename(changedPath)
        if (!matchesWatch(watchValue, relative)) return
        void lstat(changedPath).then(
          () => {
            const type = watchValue.known.has(changedPath) ? 'updated' : 'added'
            watchValue.known.set(changedPath, `event:${Date.now()}`)
            this.queueWatchChange(watchValue, changedPath, type)
          },
          () => {
            watchValue.known.delete(changedPath)
            this.queueWatchChange(watchValue, changedPath, eventType === 'change' ? 'updated' : 'deleted')
          },
        )
      })
    } catch {
      // Polling below is the portable fallback for platforms that do not
      // support recursive fs.watch.
    }
    watchValue.pollTimer = setInterval(() => {
      void this.reconcileWatch(watchValue)
    }, 100)
    return this.snapshot(channel, fromSeq)
  }

  unsubscribe(channel: string): void {
    const watchValue = this.watches.get(channel)
    if (!watchValue) return
    watchValue.watcher?.close()
    if (watchValue.flushTimer) clearTimeout(watchValue.flushTimer)
    if (watchValue.pollTimer) clearInterval(watchValue.pollTimer)
    this.watches.delete(channel)
  }

  close(): void {
    for (const channel of [...this.watches.keys()]) this.unsubscribe(channel)
  }

  private async resourceRequest(params: Params): Promise<Record<string, never>> {
    requireRootChannel(params)
    const target = await resolveAllowedPath(await this.allowedRoots(), params.uri, { mustExist: false })
    const needsRead = params.read !== false || params.write !== true
    const needsWrite = params.write === true
    this.grants.push({
      root: target.canonical ?? target.requested,
      read: needsRead,
      write: needsWrite,
    })
    return {}
  }

  private async createResourceWatch(params: Params): Promise<{ channel: string }> {
    requireRootChannel(params)
    const target = await this.authorize(params.uri, 'read')
    const channel = `ahp-resource-watch:/${randomUUID()}`
    this.watches.set(channel, {
      channel,
      root: target.canonical!,
      recursive: bool(params.recursive),
      ...(patternItems(params.includes) ? { includes: { items: patternItems(params.includes)! } } : {}),
      ...(patternItems(params.excludes) ? { excludes: { items: patternItems(params.excludes)! } } : {}),
      subscribed: false,
      known: await collectKnown(target.canonical!, bool(params.recursive)),
      pending: new Map(),
    })
    return { channel }
  }

  private queueWatchChange(
    watchValue: ResourceWatch,
    changedPath: string,
    type: 'added' | 'updated' | 'deleted',
  ): void {
    watchValue.pending.set(pathToFileURL(changedPath).href, type)
    if (watchValue.flushTimer) return
    watchValue.flushTimer = setTimeout(() => {
      watchValue.flushTimer = undefined
      const items = [...watchValue.pending].map(([uri, changeType]) => ({ uri, type: changeType }))
      watchValue.pending.clear()
      if (items.length) {
        this.emitAction(watchValue.channel, {
          type: 'resourceWatch/changed',
          changes: { items },
        })
      }
    }, 25)
  }

  private async reconcileWatch(watchValue: ResourceWatch): Promise<void> {
    if (watchValue.polling || !this.watches.has(watchValue.channel)) return
    watchValue.polling = true
    try {
      const current = await collectKnown(watchValue.root, watchValue.recursive)
      for (const [changedPath, fingerprint] of current) {
        const prior = watchValue.known.get(changedPath)
        const relative = path.relative(watchValue.root, changedPath) || path.basename(changedPath)
        if (prior !== fingerprint && matchesWatch(watchValue, relative)) {
          this.queueWatchChange(watchValue, changedPath, prior === undefined ? 'added' : 'updated')
        }
      }
      for (const changedPath of watchValue.known.keys()) {
        const relative = path.relative(watchValue.root, changedPath) || path.basename(changedPath)
        if (!current.has(changedPath) && matchesWatch(watchValue, relative)) {
          this.queueWatchChange(watchValue, changedPath, 'deleted')
        }
      }
      watchValue.known = current
    } catch {
      // Native events remain active; transient scan failures are retried.
    } finally {
      watchValue.polling = false
    }
  }

  private async notifyKnownWatches(value: unknown, type: 'added' | 'updated' | 'deleted'): Promise<void> {
    let changedPath: string
    try {
      const requested = path.resolve(requireFileUri(value))
      changedPath = await realpath(requested).catch(async () =>
        path.join(await nearestExistingParent(path.dirname(requested)), path.basename(requested)))
    } catch {
      return
    }
    for (const watchValue of this.watches.values()) {
      if (!watchValue.subscribed || !isWithin(watchValue.root, changedPath)) continue
      const relative = path.relative(watchValue.root, changedPath) || path.basename(changedPath)
      if (!watchValue.recursive && path.dirname(changedPath) !== watchValue.root && changedPath !== watchValue.root) continue
      if (!matchesWatch(watchValue, relative)) continue
      if (type === 'deleted') watchValue.known.delete(changedPath)
      else watchValue.known.set(changedPath, `mutation:${Date.now()}`)
      this.queueWatchChange(watchValue, changedPath, type)
    }
  }
}

export function isAhpResourceCommand(method: string): boolean {
  return [
    'resourceRead',
    'resourceWrite',
    'resourceList',
    'resourceCopy',
    'resourceDelete',
    'resourceMove',
    'resourceResolve',
    'resourceMkdir',
    'resourceRequest',
    'createResourceWatch',
  ].includes(method)
}
