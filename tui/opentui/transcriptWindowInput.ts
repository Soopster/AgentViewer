import { isCtrlKey, isCtrlShiftKey, isShiftedKey, type ShortcutKeyEvent } from './shortcutKeys'

type Action = 'search' | 'unread' | 'resume' | 'focusReader' | 'toggleAll' | 'toggleExpanded'
  | 'copy' | 'bookmark' | 'reply' | 'compose' | 'thinking' | 'open' | 'tab' | 'close'
  | 'git' | 'diagnostics' | 'coordination' | 'interrupt' | 'swallow'
export type TranscriptWindowCommand =
  | { type: 'action'; action: Action }
  | { type: 'scroll'; rows: number }
  | { type: 'moveCursor'; delta: number }
  | { type: 'edge'; edge: 'first' | 'last' }
  | { type: 'searchStep' | 'conversationJump' | 'technicalJump' | 'bookmarkJump' | 'stripStep'; direction: 1 | -1 }

export function isTranscriptLocalKey(key: Pick<ShortcutKeyEvent, 'name' | 'ctrl' | 'shift' | 'meta'>, sequence: string): boolean {
  if (key.meta) return false
  if (key.ctrl) return key.name === 'd' || key.name === 'u'
  if (['up', 'down', 'pageup', 'pagedown', 'home', 'end', 'return'].includes(key.name)) return true
  return sequence.length === 1 && 'jkgGefumbQyYs()[]{}/'.includes(sequence)
}

/** The focused transcript's key policy, independent of app state setters and
 * provider effects. A command is consumed once; null hands it to global input.
 * The caller resolves window controls, dialogs, composer and diff capture first. */
export function transcriptWindowCommand(key: ShortcutKeyEvent, context: {
  selected: boolean; hasSession: boolean; searchMatches: boolean; fleetPaging: boolean
  scrollback: boolean; pageRows: number; cardPageRows: number; primaryFrame: boolean
  scrollStep: (direction: 1 | -1) => number
}): TranscriptWindowCommand | null {
  const sequence = key.sequence || ''
  const letter = key.ctrl || key.meta ? '' : sequence
  const action = (name: Action): TranscriptWindowCommand => ({ type: 'action', action: name })
  const fleetKey = context.fleetPaging && (letter === '{' || letter === '}' || isShiftedKey(key, '[') || isShiftedKey(key, ']'))
  if (context.hasSession && context.selected && !fleetKey) {
    if (letter === '/') return action('search')
    if (context.searchMatches && (letter === 'n' || letter === 'N')) return { type: 'searchStep', direction: letter === 'n' ? 1 : -1 }
    if (letter === '(' || letter === ')') return { type: 'conversationJump', direction: letter === '(' ? -1 : 1 }
    if (letter === '{' || letter === '}') return { type: 'technicalJump', direction: letter === '{' ? -1 : 1 }
    if (letter === '[' || letter === ']') return { type: 'bookmarkJump', direction: letter === '[' ? -1 : 1 }
    if (letter === 'u') return action('unread')
    if (letter === 'm') return action('resume')
  }
  if (key.name === 'escape') return action('focusReader')
  if (context.scrollback && !key.shift) {
    const rows = isCtrlKey(key, 'd') ? Math.ceil(context.pageRows / 2)
      : isCtrlKey(key, 'u') ? -Math.ceil(context.pageRows / 2)
      : letter === 'j' || key.name === 'down' ? context.scrollStep(1)
      : letter === 'k' || key.name === 'up' ? -context.scrollStep(-1)
      : key.name === 'pagedown' ? context.pageRows : key.name === 'pageup' ? -context.pageRows : 0
    if (rows !== 0) return { type: 'scroll', rows }
    if (key.name === 'return' || letter === 'e') return action('toggleAll')
  }
  if (letter === 'j' || key.name === 'down') return { type: 'moveCursor', delta: 1 }
  if (letter === 'k' || key.name === 'up') return { type: 'moveCursor', delta: -1 }
  if (isCtrlKey(key, 'd') || key.name === 'pagedown') return { type: 'moveCursor', delta: context.cardPageRows }
  if (isCtrlKey(key, 'u') || key.name === 'pageup') return { type: 'moveCursor', delta: -context.cardPageRows }
  if (letter === 'G' || letter === 'f') return { type: 'edge', edge: 'last' }
  if (letter === 'g') return { type: 'edge', edge: 'first' }
  if (letter === 'e') return action('toggleExpanded')
  if (letter === 'y') return action('copy')
  if (letter === 'b') return action('bookmark')
  if (isShiftedKey(key, 'q')) return action('reply')
  if (letter === 'c') return action('compose')
  if (letter === 'i') return action('thinking')
  if (key.name === 'return') return action('open')
  if (key.name === 'tab') return action('tab')
  if (key.name === 'w' && !key.ctrl && !key.shift && !key.meta && context.hasSession) return action('close')
  if (!context.primaryFrame && !key.ctrl && !key.shift && (key.name === 'left' || key.name === 'right')) return { type: 'stripStep', direction: key.name === 'left' ? -1 : 1 }
  // ⌃⇧G is pull requests (a global plugin binding); only a plain ⌃G is Git.
  if (isCtrlKey(key, 'g') && !key.shift) return action('git')
  if (letter === 'D') return action('diagnostics')
  if (isCtrlShiftKey(key, 'a')) return action('coordination')
  if (isCtrlKey(key, 'c')) return action('interrupt')
  return isTranscriptLocalKey(key, sequence) && !fleetKey ? action('swallow') : null
}
