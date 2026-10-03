// Reading other machines' Coordinator teams for the TUI's rail — herdr's one
// agent list across machines. Machines are added with `agent-viewer machines
// add` (lib/machines.mjs holds the store); this is the read side.
//
// A machine that is slow or down must never hold up the local list (herdr
// #4234, "keep local usable when remote machines stall"), so every read has a
// deadline and a failure is reported on that machine's row rather than thrown.
import type { ProtocolRun, ProtocolRunSnapshot } from '../agentProtocol'
import { machineHeaders, readMachines, type StoredMachine } from '../machines.mjs'
import { subscribeProtocolRunChangesAt } from './remote'

export type WatchedMachine = Pick<StoredMachine, 'name' | 'baseUrl' | 'credential'>
export type MachineRoster = {
  name: string
  baseUrl: string
  runs: ProtocolRun[]
  snapshots: Map<string, ProtocolRunSnapshot>
  /** Why this machine could not be read; its last good roster is kept beside it. */
  error: string | null
}

export const MACHINE_READ_TIMEOUT_MS = 4_000

export function listWatchedMachines(): WatchedMachine[] {
  return readMachines().map(({ name, baseUrl, credential }) => ({ name, baseUrl, credential }))
}

async function machineJson<T>(machine: WatchedMachine, route: string, deadline: AbortSignal): Promise<T> {
  const response = await fetch(`${machine.baseUrl}${route}`, { headers: machineHeaders(machine), signal: deadline })
  if (response.status === 401 || response.status === 403) {
    throw new Error('credential revoked or expired · re-add it with `agent-viewer machines`')
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.json() as T
}

export async function readMachineRoster(machine: WatchedMachine, limit: number, timeoutMs = MACHINE_READ_TIMEOUT_MS): Promise<MachineRoster> {
  const deadline = AbortSignal.timeout(timeoutMs)
  try {
    const { runs } = await machineJson<{ runs: ProtocolRun[] }>(machine, `/api/agent-protocol/runs?limit=${limit}`, deadline)
    const loaded = await Promise.all(runs.map((run) =>
      machineJson<ProtocolRunSnapshot>(machine, `/api/agent-protocol/runs/${encodeURIComponent(run.id)}`, deadline).catch(() => null)))
    return {
      name: machine.name,
      baseUrl: machine.baseUrl,
      runs,
      snapshots: new Map(loaded.flatMap((snapshot) => snapshot ? [[snapshot.run.id, snapshot] as const] : [])),
      error: null,
    }
  } catch (error) {
    const reason = deadline.aborted ? `unreachable · no answer in ${Math.round(timeoutMs / 1000)}s`
      : error instanceof Error && /credential/.test(error.message) ? error.message
      : `unreachable · ${error instanceof Error ? error.message : String(error)}`
    return { name: machine.name, baseUrl: machine.baseUrl, runs: [], snapshots: new Map(), error: reason }
  }
}

/** Push refreshes for one machine; any change (or a reconnect) means re-read it. */
export function subscribeMachineRunChanges(machine: WatchedMachine, onChange: () => void): () => void {
  return subscribeProtocolRunChangesAt(machine.baseUrl, machineHeaders(machine), () => onChange(), onChange)
}
