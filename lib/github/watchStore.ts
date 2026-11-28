// The pull requests being watched, one per session. Read and written by the web
// daemon, a TUI and their routes, so — as the schedules store does — every
// operation is a read-modify-write on disk, replaced by rename.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentProvider, LinkedPullRequest, ProviderInstanceId } from '../types'
import { sessionInboxKey } from '../sessionInbox'
import type { PrWatchEvent, PrWatchSnapshot } from './watch'

export type PrWatch = {
  key: string
  provider: AgentProvider
  sessionId: string
  providerInstanceId?: ProviderInstanceId
  pr: LinkedPullRequest
  cwd: string
  startedAt: number
  checkedAt?: number
  /** Absent until the first successful read, which is the baseline and wakes nobody. */
  snapshot?: PrWatchSnapshot
  /** Seen but not yet delivered: the session was busy. */
  pending: PrWatchEvent[]
  wakes: number
  commentWakes: number
  failedReads: number
  error?: string
}

export type PrWatchTarget = { provider: AgentProvider; sessionId: string; providerInstanceId?: ProviderInstanceId }

const dataDir = () => process.env.AGENT_VIEWER_PR_WATCH_DIR ?? path.join(process.cwd(), '.agent-viewer-data')
export const prWatchFile = () => path.join(dataDir(), 'pr-watches.json')

export function readPrWatches(): PrWatch[] {
  try {
    const parsed = JSON.parse(readFileSync(prWatchFile(), 'utf8')) as { version?: number; watches?: PrWatch[] }
    return parsed.version === 1 && Array.isArray(parsed.watches) ? parsed.watches : []
  } catch { return [] }
}

export function updatePrWatches(mutate: (watches: PrWatch[]) => PrWatch[]): PrWatch[] {
  const watches = mutate(readPrWatches())
  const file = prWatchFile()
  mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify({ version: 1, watches }, null, 2), { encoding: 'utf8', mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, file)
  return watches
}

export const prWatchKey = (target: PrWatchTarget) => sessionInboxKey(target.provider, target.sessionId, target.providerInstanceId)

export function findPrWatch(target: PrWatchTarget): PrWatch | null {
  return readPrWatches().find(watch => watch.key === prWatchKey(target)) ?? null
}

export function startPrWatch(target: PrWatchTarget, pr: LinkedPullRequest, cwd: string): PrWatch {
  const watch: PrWatch = { key: prWatchKey(target), provider: target.provider, sessionId: target.sessionId, providerInstanceId: target.providerInstanceId, pr, cwd, startedAt: Date.now(), pending: [], wakes: 0, commentWakes: 0, failedReads: 0 }
  updatePrWatches(watches => [...watches.filter(entry => entry.key !== watch.key), watch])
  return watch
}

export function stopPrWatch(target: PrWatchTarget): void {
  const key = prWatchKey(target)
  updatePrWatches(watches => watches.filter(watch => watch.key !== key))
}
