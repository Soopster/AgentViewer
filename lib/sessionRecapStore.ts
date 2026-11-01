// Session recaps — local persistence.
//
// One flat JSON file under .agent-viewer-data/. The web daemon, the TUI's main
// isolate and its transcript worker all read it (the worker decorates session
// rows) while the daemon or main isolate writes it, so — like the inbox — the
// cache is checked against the file's mtime rather than held for the process
// lifetime. The file also carries the feature's own switch: recaps send
// transcript text to a model, so they are off until someone turns them on.

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readPluginSettingsFile } from './plugins/settingsFile'
import { sanitizeSessionRecap, sessionRecapKey, type SessionRecap } from './sessionRecap'
import type { AgentProvider } from './types'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const RECAPS_FILE = path.join(DATA_DIR, 'session-recaps.json')
const MAX_RECAPS = 500

export type SessionRecapTarget = {
  provider: AgentProvider
  providerInstanceId?: string
  sessionId: string
}

type RecapFile = {
  version: 1
  enabled: boolean
  recaps: Record<string, SessionRecap>
}

let readPromise: Promise<RecapFile> | null = null
let cachedMtimeMs: number | null = null
let writeChain: Promise<void> = Promise.resolve()

async function fileMtimeMs(): Promise<number | null> {
  try {
    return (await stat(RECAPS_FILE)).mtimeMs
  } catch {
    return null
  }
}

async function readRecapFile(): Promise<RecapFile> {
  try {
    const parsed = JSON.parse(await readFile(RECAPS_FILE, 'utf8')) as Partial<RecapFile>
    if (parsed.version === 1) {
      const recaps: Record<string, SessionRecap> = {}
      if (parsed.recaps && typeof parsed.recaps === 'object') {
        for (const [key, value] of Object.entries(parsed.recaps)) {
          const recap = sanitizeSessionRecap(value)
          if (recap) recaps[key] = recap
        }
      }
      return { version: 1, enabled: parsed.enabled === true, recaps }
    }
  } catch { /* first run or a partially written optional file */ }
  return { version: 1, enabled: false, recaps: {} }
}

async function currentFile(): Promise<RecapFile> {
  await writeChain
  const mtime = await fileMtimeMs()
  if (!readPromise || mtime !== cachedMtimeMs) {
    cachedMtimeMs = mtime
    readPromise = readRecapFile()
  }
  return readPromise
}

/** Serialize read-modify-write so two updates in one process cannot lose each other. */
function mutate(change: (file: RecapFile) => void): Promise<void> {
  const next = writeChain.then(async () => {
    const mtime = await fileMtimeMs()
    if (!readPromise || mtime !== cachedMtimeMs) readPromise = readRecapFile()
    const file = await readPromise
    change(file)
    readPromise = Promise.resolve(file)
    await mkdir(DATA_DIR, { recursive: true })
    const temp = `${RECAPS_FILE}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(file, null, 2), 'utf8')
    await rename(temp, RECAPS_FILE)
    cachedMtimeMs = await fileMtimeMs()
  })
  writeChain = next.catch((error) => {
    console.error('[session-recaps] Failed to save:', error)
  })
  return writeChain
}

/** The recaps plugin's id: turning it off in the plugin manager turns recaps off, whatever the switch says. */
const RECAPS_PLUGIN_ID = 'recaps'

/** The switch, unless the plugin is off. Both halves live on disk, so every process agrees. */
export async function readSessionRecapsEnabled(): Promise<boolean> {
  if (readPluginSettingsFile().disabled.includes(RECAPS_PLUGIN_ID)) return false
  return (await currentFile()).enabled
}

export async function setSessionRecapsEnabled(enabled: boolean): Promise<boolean> {
  await mutate((file) => { file.enabled = enabled })
  return enabled
}

export async function readSessionRecap(target: SessionRecapTarget): Promise<SessionRecap | null> {
  const file = await currentFile()
  return file.recaps[sessionRecapKey(target.provider, target.providerInstanceId, target.sessionId)] ?? null
}

/** Every recap by key, for decorating a session list in one read. */
export async function readSessionRecaps(): Promise<Record<string, SessionRecap>> {
  return (await currentFile()).recaps
}

export async function writeSessionRecap(target: SessionRecapTarget, recap: SessionRecap): Promise<void> {
  await mutate((file) => {
    file.recaps[sessionRecapKey(target.provider, target.providerInstanceId, target.sessionId)] = recap
    const keys = Object.keys(file.recaps)
    if (keys.length > MAX_RECAPS) {
      // Oldest first: a recap for a session nobody has touched in weeks is the cheapest to regenerate.
      keys
        .sort((a, b) => Date.parse(file.recaps[a].at) - Date.parse(file.recaps[b].at))
        .slice(0, keys.length - MAX_RECAPS)
        .forEach((key) => { delete file.recaps[key] })
    }
  })
}

export async function removeSessionRecap(target: SessionRecapTarget): Promise<boolean> {
  const key = sessionRecapKey(target.provider, target.providerInstanceId, target.sessionId)
  const file = await currentFile()
  if (!(key in file.recaps)) return false
  await mutate((next) => { delete next.recaps[key] })
  return true
}
