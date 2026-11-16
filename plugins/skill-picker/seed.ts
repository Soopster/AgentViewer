/**
 * The search text `/skill <words>` hands to the picker. A command cannot pass input to a surface,
 * so the handler leaves it here and the picker takes it when it opens (or, if it is already open,
 * when it is told). Module state shared by the command and the view (one bundle).
 */
let pending: string | null = null
const listeners = new Set<() => void>()

export function seedSkillQuery(query: string): void {
  pending = query.trim() || null
  if (pending) for (const listener of listeners) listener()
}

export function takeSkillQuery(): string | null {
  const value = pending
  pending = null
  return value
}

export function subscribeSkillQuery(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
