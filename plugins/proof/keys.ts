/** Resolve view-local keys; the host still owns focus and global precedence. */
type Key = { name: string; sequence: string; ctrl: boolean; shift: boolean; meta?: boolean; option?: boolean }
export type ProofKeyAction = 'save' | 'discard' | 'up' | 'down' | 'toggle' | 'inspect' | 'run' | 'cancel' | 'scripts' | 'edit' | 'fix' | 'expand' | 'refresh' | 'older' | 'newer' | 'next' | 'previous' | 'close'
const NORMAL: Record<string, ProofKeyAction> = { escape: 'close', down: 'down', j: 'down', up: 'up', k: 'up', space: 'toggle', return: 'inspect', r: 'run', c: 'cancel', s: 'scripts', e: 'edit', f: 'fix', a: 'expand', g: 'refresh', '[': 'older', ']': 'newer', n: 'next', p: 'previous' }
const PICKER: Record<string, ProofKeyAction> = { escape: 'discard', down: 'down', up: 'up', space: 'toggle', return: 'save' }
export function proofKeyAction(key: Key, mode: 'normal' | 'editor' | 'picker'): ProofKeyAction | null {
  if (mode === 'editor') {
    if (key.ctrl && key.name === 's') return 'save'
    return key.name === 'escape' ? 'discard' : null
  }
  if (key.ctrl || key.meta || key.option) return null
  const bindings = mode === 'picker' ? PICKER : NORMAL
  return bindings[key.name] ?? bindings[key.sequence] ?? null
}
