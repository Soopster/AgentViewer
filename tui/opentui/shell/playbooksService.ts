import type { PluginPlaybookService } from '../../../lib/plugins/playbooks'
import { listTuiRunPlaybooks, readTuiRunPlaybook, writeTuiRunPlaybook, deleteTuiRunPlaybook } from '../../../lib/tui/service'

async function scoped<T>(signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted()
  const result = await action()
  signal?.throwIfAborted()
  return result
}

export const tuiPlaybooks: PluginPlaybookService = {
  list: (cwd, signal) => scoped(signal, () => listTuiRunPlaybooks(cwd)),
  read: (cwd, name, signal) => scoped(signal, () => readTuiRunPlaybook(cwd, name)),
  write: (cwd, playbook, previousName, signal) => scoped(signal, () => writeTuiRunPlaybook(cwd, playbook, previousName)),
  remove: (cwd, name, signal) => scoped(signal, () => deleteTuiRunPlaybook(cwd, name)),
}
