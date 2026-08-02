import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const LEDGER_VERSION = 1
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

function publicTask(record, resultType = 'complete') {
  return {
    resultType,
    taskId: record.taskId,
    status: record.status,
    ...(record.statusMessage ? { statusMessage: record.statusMessage } : {}),
    createdAt: record.createdAt,
    lastUpdatedAt: record.lastUpdatedAt,
    ttlMs: record.ttlMs,
    ...(record.pollIntervalMs ? { pollIntervalMs: record.pollIntervalMs } : {}),
    ...(record.status === 'input_required' ? { inputRequests: record.inputRequests ?? {} } : {}),
    ...(record.status === 'completed' ? { result: record.result } : {}),
    ...(record.status === 'failed' ? { error: record.error } : {}),
  }
}

export class DurableMcpTaskStore {
  constructor(filePath) {
    this.filePath = filePath
    this.tasks = new Map()
    this.loaded = false
    this.mutation = Promise.resolve()
  }

  async load() {
    if (this.loaded) return this
    try {
      const ledger = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (ledger?.version !== LEDGER_VERSION || !Array.isArray(ledger.tasks)) {
        throw new Error(`Unsupported MCP task ledger version or shape`)
      }
      for (const task of ledger.tasks) {
        if (task?.taskId && typeof task.taskId === 'string') this.tasks.set(task.taskId, task)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new Error(`Cannot read MCP task ledger at ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.loaded = true
    await this.pruneExpired()
    return this
  }

  async create({ operation, statusMessage, ttlMs, pollIntervalMs }) {
    return this.mutate(() => {
      const now = new Date().toISOString()
      const record = {
        taskId: randomUUID(),
        status: 'working',
        statusMessage,
        createdAt: now,
        lastUpdatedAt: now,
        ttlMs,
        pollIntervalMs,
        operation,
      }
      this.tasks.set(record.taskId, record)
      return { record, value: publicTask(record, 'task') }
    })
  }

  async get(taskId) {
    await this.load()
    const record = this.tasks.get(taskId)
    return record ? publicTask(record) : null
  }

  async getRecord(taskId) {
    await this.load()
    return this.tasks.get(taskId) ?? null
  }

  async activeRecords() {
    await this.load()
    return [...this.tasks.values()].filter((task) => !TERMINAL_STATUSES.has(task.status))
  }

  async findActive(predicate) {
    return (await this.activeRecords()).find(predicate) ?? null
  }

  async update(taskId, update) {
    return this.mutate(() => {
      const current = this.tasks.get(taskId)
      if (!current) return { value: null }
      const patch = typeof update === 'function' ? update(current) : update
      if (!patch) return { value: publicTask(current) }
      const record = {
        ...current,
        ...patch,
        taskId: current.taskId,
        createdAt: current.createdAt,
        lastUpdatedAt: new Date().toISOString(),
      }
      this.tasks.set(taskId, record)
      return { record, value: publicTask(record) }
    })
  }

  async requestCancellation(taskId) {
    return this.update(taskId, (task) => {
      if (TERMINAL_STATUSES.has(task.status)) return null
      return {
        status: 'cancelled',
        statusMessage: 'Cancellation requested by the MCP client.',
        cancelRequestedAt: new Date().toISOString(),
        inputRequests: undefined,
      }
    })
  }

  async pruneExpired() {
    if (!this.loaded) return
    let changed = false
    const now = Date.now()
    for (const [taskId, task] of this.tasks) {
      if (task.ttlMs !== null
        && Number.isFinite(task.ttlMs)
        && Date.parse(task.createdAt) + task.ttlMs < now) {
        this.tasks.delete(taskId)
        changed = true
      }
    }
    if (changed) await this.persist()
  }

  async mutate(callback) {
    const run = this.mutation.catch(() => {}).then(async () => {
      await this.load()
      const outcome = callback()
      if (outcome?.record) await this.persist()
      return outcome?.value ?? null
    })
    this.mutation = run.then(() => undefined, () => undefined)
    return run
  }

  async persist() {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    const ledger = `${JSON.stringify({
      version: LEDGER_VERSION,
      tasks: [...this.tasks.values()],
    }, null, 2)}\n`
    await writeFile(temporary, ledger, { mode: 0o600 })
    await rename(temporary, this.filePath)
    await chmod(this.filePath, 0o600)
  }
}

export function taskSeed(record) {
  return publicTask(record, 'task')
}

export function isTerminalMcpTask(record) {
  return TERMINAL_STATUSES.has(record?.status)
}
