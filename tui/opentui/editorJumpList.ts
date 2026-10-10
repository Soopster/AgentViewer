/**
 * The editor's back/forward navigation stack.
 *
 * "Go back" was previously a bare array that `pop()`ed: every step backwards
 * destroyed the place it came from, so there was nothing to go forward to and
 * a jump taken by mistake could not be undone. That is the one property an
 * engineer reflexively relies on — chase a definition three files deep, then
 * walk back out and in again.
 *
 * The rules here are the ones every editor implements, and each exists because
 * its absence is visible:
 *
 * - Going back moves the current position onto the forward stack, so back and
 *   forward are inverses rather than one being lossy.
 * - A *new* jump clears the forward stack. Keeping it would offer a "forward"
 *   into a branch of history the user already left, which lands somewhere they
 *   never asked for.
 * - Consecutive entries for the same path and line are collapsed. Without it,
 *   opening the same file twice in a row makes "back" a no-op that has to be
 *   pressed twice.
 */

export type EditorJumpEntry = {
  path: string
  line: number
  character: number
}

export type EditorJumpList = {
  back: EditorJumpEntry[]
  forward: EditorJumpEntry[]
}

export const EDITOR_JUMP_LIST_LIMIT = 100

export function createEditorJumpList(): EditorJumpList {
  return { back: [], forward: [] }
}

function sameSpot(left: EditorJumpEntry | undefined, right: EditorJumpEntry): boolean {
  return left != null && left.path === right.path && left.line === right.line
}

function push(stack: EditorJumpEntry[], entry: EditorJumpEntry): void {
  if (sameSpot(stack[stack.length - 1], entry)) return
  stack.push(entry)
  if (stack.length > EDITOR_JUMP_LIST_LIMIT) stack.shift()
}

/** Record the place a jump is leaving from. Invalidates the forward stack. */
export function recordEditorJump(list: EditorJumpList, from: EditorJumpEntry): void {
  push(list.back, from)
  list.forward.length = 0
}

/**
 * Step backwards. `current` is where the caret is now and becomes the forward
 * entry — passing null (no file open) simply means there is nothing to come
 * forward to.
 */
export function editorJumpBackward(
  list: EditorJumpList,
  current: EditorJumpEntry | null,
): EditorJumpEntry | null {
  const target = list.back.pop()
  if (!target) return null
  if (current) push(list.forward, current)
  return target
}

/** Step forwards, putting the position left behind back on the back stack. */
export function editorJumpForward(
  list: EditorJumpList,
  current: EditorJumpEntry | null,
): EditorJumpEntry | null {
  const target = list.forward.pop()
  if (!target) return null
  if (current) push(list.back, current)
  return target
}

/**
 * Forget every entry for a path. A file deleted or renamed out from under the
 * editor must not stay reachable through history — going "back" into it either
 * fails or, worse, recreates a stale buffer.
 */
export function forgetEditorJumpPath(list: EditorJumpList, path: string): void {
  list.back = list.back.filter((entry) => entry.path !== path)
  list.forward = list.forward.filter((entry) => entry.path !== path)
}
