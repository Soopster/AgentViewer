import type { WindowDirection } from './windowLayout'

export type WindowControlAction =
  | 'move-workspace' | 'focus' | 'manage' | 'zoom' | 'resize' | 'swap' | 'tab' | 'detach' | 'float' | 'close'
  | 'layout' | 'split-columns' | 'split-rows' | 'shrink' | 'grow' | 'reader-shrink' | 'reader-grow'
  | 'row-shrink' | 'row-grow' | 'equalize' | 'undo' | 'menu'

export type WindowControlContext = { floating: boolean; tabbed: boolean; canTab: boolean; zoomed: boolean }
export const WINDOW_CONTROL_ACTIONS: ReadonlyArray<{
  id: WindowControlAction; label: string; keys?: string; resize?: true
  available?: (context: WindowControlContext) => boolean
}> = [
  { id: 'focus', label: 'Focus window' },
  { id: 'move-workspace', label: 'Move to workspace…' },
  { id: 'manage', label: 'Manage windows', keys: '⌃K w' },
  { id: 'zoom', label: 'Zoom / restore', keys: 'm', available: c => !c.floating },
  { id: 'resize', label: 'Resize…', available: c => !c.floating && !c.zoomed },
  { id: 'swap', label: 'Swap direction…', available: c => !c.floating && !c.zoomed },
  { id: 'tab', label: 'Tab with previous window', available: c => c.canTab },
  { id: 'detach', label: 'Detach shown tab', available: c => c.tabbed },
  { id: 'float', label: 'Float / dock' },
  { id: 'layout', label: 'Window layout…' },
  { id: 'split-columns', label: 'Split this window right', available: c => !c.floating },
  { id: 'split-rows', label: 'Split this window below', available: c => !c.floating },
  { id: 'close', label: 'Close window' },
  { id: 'shrink', label: 'Shrink focused pane', keys: '[', resize: true },
  { id: 'grow', label: 'Grow focused pane', keys: ']', resize: true },
  { id: 'reader-shrink', label: 'Shrink focused pane', keys: '<', resize: true },
  { id: 'reader-grow', label: 'Grow focused pane', keys: '>', resize: true },
  { id: 'row-shrink', label: 'Shrink grid top row', keys: '-', resize: true },
  { id: 'row-grow', label: 'Grow grid top row', keys: '+', resize: true },
  { id: 'equalize', label: 'Equalize sizes', keys: '=', resize: true },
  { id: 'undo', label: 'Undo window change', keys: 'u' },
  { id: 'menu', label: 'Window menu', keys: 'space' },
]

export const WINDOW_MENU_ACTIONS: readonly WindowControlAction[] = [
  'focus', 'manage', 'split-columns', 'split-rows', 'zoom', 'resize', 'swap', 'tab', 'detach', 'float', 'move-workspace', 'layout', 'close',
]
export const WINDOW_RESIZE_ACTIONS: readonly WindowControlAction[] = ['shrink', 'grow', 'reader-shrink', 'reader-grow', 'row-shrink', 'row-grow', 'equalize']
export const WINDOW_MANAGEMENT_HINT = 'arrows focus · shift+arrows swap · tab/1–9 select'
export const WINDOW_MANAGEMENT_ACTION_HINT = WINDOW_CONTROL_ACTIONS
  .filter(action => action.keys && !['manage', 'row-shrink', 'row-grow', 'reader-shrink', 'reader-grow'].includes(action.id))
  .map(action => `${action.keys} ${action.label.toLowerCase()}`).join(' · ')

type ControlKey = { name: string; sequence: string; ctrl: boolean; shift: boolean; option?: boolean; meta?: boolean }
export function windowManagementKey(key: ControlKey):
  | { kind: 'exit' } | { kind: 'select'; number: number } | { kind: 'cycle'; direction: 1 | -1 }
  | { kind: 'direction'; direction: WindowDirection; swap: boolean } | { kind: 'action'; action: WindowControlAction } | null {
  if (key.name === 'escape' || key.name === 'return' || (key.ctrl && ['c', 'g'].includes(key.name))) return { kind: 'exit' }
  if (key.ctrl || key.option || key.meta) return null
  if (['left', 'right', 'up', 'down'].includes(key.name)) return { kind: 'direction', direction: key.name as WindowDirection, swap: key.shift }
  if (key.name === 'tab') return { kind: 'cycle', direction: key.shift ? -1 : 1 }
  if (/^[0-9]$/.test(key.sequence)) return { kind: 'select', number: Number(key.sequence) }
  const action = WINDOW_CONTROL_ACTIONS.find(action => action.keys === key.sequence || action.keys === key.name)
  return action ? { kind: 'action', action: action.id } : null
}

export type ControlWindow = {
  key: string; number: number; title: string; focused: boolean
  rect: { x: number; y: number; width: number; height: number }
}
