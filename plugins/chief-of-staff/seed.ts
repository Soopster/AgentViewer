/**
 * The request `/cos <request>` hands to the panel. A command cannot pass input to a surface, so the
 * handler leaves it here and the panel takes it as it opens (or is told, if already open).
 */
let pending: string | null = null
const listeners = new Set<(request: string) => void>()

export function seedChiefOfStaffRequest(request: string): void {
  const text = request.trim()
  if (!text) return
  if (listeners.size) { pending = null; for (const listener of listeners) listener(text) } else pending = text
}

export function takeChiefOfStaffRequest(): string | null {
  const value = pending
  pending = null
  return value
}

export function subscribeChiefOfStaffRequest(listener: (request: string) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
