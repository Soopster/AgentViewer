// The host's own palette commands. They register here by group (./palette/*) the
// way a plugin registers a command, so the palette dispatches by lookup instead of
// one switch over every id. The newest registration for an id wins and
// unregistering restores the previous one, which lets a plugin or a mod take over
// or wrap a built-in action.
import type { ExecuteCommandPaletteContext } from './commandPalette'

/** Values the palette computes once before dispatch and shares with every handler. */
export type HostCommandLocals = {
  persistPreference: (write: () => Promise<unknown>) => Promise<unknown>
  focusedSession: import('../../../../lib/types').Session | null
}
export type HostCommandHandler = (ctx: ExecuteCommandPaletteContext, id: string, locals: HostCommandLocals) => void

type Entry = { readonly id: number; readonly handler: HostCommandHandler }
const handlers = new Map<string, Entry[]>()
let nextId = 0

export function registerHostCommand(ids: readonly string[], handler: HostCommandHandler): () => void {
  const entryId = nextId++
  for (const id of ids) handlers.set(id, [...(handlers.get(id) ?? []), { id: entryId, handler }])
  return () => {
    for (const id of ids) {
      const rest = (handlers.get(id) ?? []).filter(entry => entry.id !== entryId)
      if (rest.length) handlers.set(id, rest); else handlers.delete(id)
    }
  }
}

export function resolveHostCommand(id: string): HostCommandHandler | null {
  const stack = handlers.get(id)
  return stack?.length ? stack[stack.length - 1]!.handler : null
}

/** Every id with a host handler (for tests: each palette command must resolve to something). */
export function hostCommandIds(): string[] { return [...handlers.keys()] }
