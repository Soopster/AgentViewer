// Goals of the Coordinator runs behind the rail's chats, so a row can say what the run is for.
// Outside the root like teamAttentionStore: it grows by the runs the list names and commits only when a goal arrives.
import { readTuiCoordinatorRunGoals } from '../../lib/tui/service'

let goals: ReadonlyMap<string, string> = new Map()
const asked = new Set<string>()
const listeners = new Set<() => void>()

export const getCoordinatorRunGoals = () => goals
export function subscribeCoordinatorRunGoals(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Reads each run id once; ids the ledger does not know are not asked again. */
export async function requestCoordinatorRunGoals(runIds: readonly string[]): Promise<void> {
  const missing = runIds.filter(id => !asked.has(id))
  if (missing.length === 0) return
  for (const id of missing) asked.add(id)
  const found = await readTuiCoordinatorRunGoals(missing).catch(() => null)
  if (!found) { for (const id of missing) asked.delete(id); return }
  const entries = Object.entries(found)
  if (entries.length === 0) return
  goals = new Map([...goals, ...entries])
  for (const listener of listeners) listener()
}
