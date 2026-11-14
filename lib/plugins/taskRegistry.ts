import type { ThreadedMessage } from '../threading'
import {
  buildTaskRegistry,
  buildTaskRegistryFromCodexPlan,
  buildTaskRegistryFromTodos,
  type CodexPlanStep,
  type OpenCodeTodo,
  type TaskRegistry,
} from '../taskRegistry'

/** A live snapshot replaces its persisted message; new live events follow history. */
export function mergeTaskMessages(persisted: readonly ThreadedMessage[], live: readonly ThreadedMessage[]): ThreadedMessage[] {
  if (live.length === 0) return [...persisted]
  const liveById = new Map(live.map(message => [message.uuid, message]))
  const persistedIds = new Set(persisted.map(message => message.uuid))
  return [
    ...persisted.map(message => liveById.get(message.uuid) ?? message),
    ...[...liveById.values()].filter(message => !persistedIds.has(message.uuid)),
  ]
}

export function buildPluginTaskRegistry({ persisted, live = [], todos, plan }: {
  readonly persisted: readonly ThreadedMessage[]
  readonly live?: readonly ThreadedMessage[]
  readonly todos?: readonly OpenCodeTodo[]
  readonly plan?: readonly CodexPlanStep[]
}): TaskRegistry {
  const registry = buildTaskRegistry(mergeTaskMessages(persisted, live))
  if (todos?.length) {
    for (const [id, task] of buildTaskRegistryFromTodos([...todos])) registry.set(id, task)
  }
  if (plan?.length) {
    for (const [id, task] of buildTaskRegistryFromCodexPlan([...plan])) registry.set(id, task)
  }
  return registry
}
