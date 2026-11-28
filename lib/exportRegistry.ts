// How a tool call or a block is written into an exported HTML conversation
// (lib/export.ts). The exporter registers its own renderers here the way a
// plugin would, so a card or block type is a registration, not a switch case.
// A later registration for a key wins; unregistering restores the previous.
import type { ThreadedBlock, ToolThread } from './threading'

type Renderer<T> = (value: T) => string
type Stack<T> = { id: number; render: Renderer<T> }[]

function createRegistry<T>() {
  const entries = new Map<string, Stack<T>>()
  let nextId = 0
  return {
    register(keys: readonly string[], render: Renderer<T>): () => void {
      const id = nextId++
      for (const key of keys) entries.set(key, [...(entries.get(key) ?? []), { id, render }])
      return () => {
        for (const key of keys) {
          const rest = (entries.get(key) ?? []).filter(entry => entry.id !== id)
          if (rest.length) entries.set(key, rest); else entries.delete(key)
        }
      }
    },
    resolve(key: string): Renderer<T> | null {
      const stack = entries.get(key)
      return stack?.length ? stack[stack.length - 1]!.render : null
    },
  }
}

const toolRenderers = createRegistry<ToolThread>()
const blockRenderers = createRegistry<ThreadedBlock>()

/** Registers how the exporter draws these tool calls (by tool name). */
export const registerExportToolCard = toolRenderers.register
export const resolveExportToolCard = toolRenderers.resolve
/** Registers how the exporter draws these block types (by `block.type`). */
export const registerExportBlock = blockRenderers.register
export const resolveExportBlock = blockRenderers.resolve
