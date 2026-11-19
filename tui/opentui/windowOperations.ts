import type { WindowArrangement, WindowDropZone } from './windowLayout'
import type { SplitPaneOrientation } from './splitPaneState'
import type { WindowLayoutAction } from './WindowLayoutPicker'

export type WindowArrangementState = {
  arrangement: WindowArrangement
  orientation: SplitPaneOrientation
  readerLast: boolean
  count: number
}

export function planWindowArrangement(action: Exclude<WindowLayoutAction, 'fullscreen'>, current: WindowArrangementState, available: number): WindowArrangementState {
  const keep = Math.min(Math.max(current.count, 1), 2)
  const plan = (arrangement: WindowArrangement, orientation: SplitPaneOrientation, readerLast: boolean, wanted: number) => ({
    arrangement, orientation, readerLast, count: Math.min(wanted, available),
  })
  switch (action) {
    case 'fill': return { ...current, count: 0 }
    case 'reader-left': return plan('split', 'columns', false, keep)
    case 'reader-right': return plan('split', 'columns', true, keep)
    case 'reader-top': return plan('split', 'rows', false, keep)
    case 'reader-bottom': return plan('split', 'rows', true, keep)
    case 'two': return plan('split', 'columns', false, 1)
    case 'main-stack': return plan('main-stack', current.orientation, false, Math.max(2, Math.min(current.count, 3)))
    case 'grid': return plan('grid', current.orientation, false, 3)
    case 'grid-six': return plan('grid', current.orientation, false, 5)
  }
}

export type WindowSessionDrop =
  | { kind: 'replace'; index: number }
  | { kind: 'insert'; index: number; edge: WindowDropZone }
  | { kind: 'edge'; zone: Exclude<WindowDropZone, 'center'> }

export function planWindowSessionDrop(current: WindowArrangementState & { pins: string[] }, key: string, drop: WindowSessionDrop): (WindowArrangementState & { pins: string[] }) | null {
  const max = current.arrangement === 'split' ? 2 : 5
  const existing = current.pins.indexOf(key)
  if (drop.kind === 'replace') {
    if (drop.index < 0 || drop.index >= current.pins.length) return null
    const pins = [...current.pins]
    const displaced = pins[drop.index]!
    pins[drop.index] = key
    if (existing >= 0 && existing !== drop.index) pins[existing] = displaced
    return { ...current, pins }
  }
  if (drop.kind === 'insert') {
    if (existing < 0 && current.count >= max) return null
    const anchor = current.pins[drop.index]
    if (!anchor) return null
    if (anchor === key) return current
    const pins = current.pins.filter((pin) => pin !== key)
    const at = pins.indexOf(anchor) + (drop.edge === 'right' || drop.edge === 'bottom' ? 1 : 0)
    pins.splice(at, 0, key)
    return { ...current, pins, count: Math.min(current.count + (existing < 0 ? 1 : 0), max) }
  }
  const arranged = current.arrangement !== 'split' && current.count > 0
  const sideways = drop.zone === 'left' || drop.zone === 'right'
  const count = arranged ? Math.min(current.count + (existing < 0 ? 1 : 0), max) : Math.min(Math.max(current.count, 1), 2)
  return {
    ...current,
    arrangement: arranged ? current.arrangement : 'split',
    orientation: arranged ? current.orientation : sideways ? 'columns' : 'rows',
    readerLast: arranged ? (sideways ? drop.zone === 'left' : current.readerLast) : drop.zone === 'left' || drop.zone === 'top',
    count,
    pins: [key, ...current.pins.filter((pin) => pin !== key)].slice(0, count),
  }
}
