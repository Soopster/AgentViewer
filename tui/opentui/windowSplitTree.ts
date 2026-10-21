import type { WindowLayout } from './windowLayout'

/** -1 is the reader; nonnegative slots follow the logical window order. */
export type WindowSplitNode = { slot: number } | { axis: 'x' | 'y'; ratio: number; first: WindowSplitNode; second: WindowSplitNode }
export type WindowSplitTree = { root: WindowSplitNode; keys: string[]; primary?: boolean }
export type SplitRect = { x: number; y: number; width: number; height: number }
export type SplitDivider = { path: string; axis: 'x' | 'y'; rect: SplitRect; firstExtent: number; minFirst: number; minSecond: number }
export type SplitMinimums = { paneWidth: number; paneRows: number; readerWidth: number; readerRows: number }

export function validWindowSplitTree(value: unknown): value is WindowSplitTree {
  if (!value || typeof value !== 'object') return false
  const tree = value as WindowSplitTree
  if (!Array.isArray(tree.keys) || tree.keys.length > 31 || tree.keys.some(key => typeof key !== 'string') || new Set(tree.keys).size !== tree.keys.length) return false
  const slots = new Set<number>()
  const valid = (node: WindowSplitNode, depth: number): boolean => {
    if (!node || typeof node !== 'object' || depth > 31) return false
    if ('slot' in node) {
      if (!Number.isInteger(node.slot) || node.slot < -1 || node.slot >= tree.keys.length || slots.has(node.slot)) return false
      slots.add(node.slot); return true
    }
    return (node.axis === 'x' || node.axis === 'y') && Number.isFinite(node.ratio) && node.ratio > 0 && node.ratio < 1 && valid(node.first, depth + 1) && valid(node.second, depth + 1)
  }
  return valid(tree.root, 0) && (tree.primary === false ? !slots.has(-1) && slots.size === tree.keys.length : slots.has(-1) && slots.size === tree.keys.length + 1)
}

function filterNode(node: WindowSplitNode, map: (slot: number) => number | null): WindowSplitNode | null {
  if ('slot' in node) { const slot = map(node.slot); return slot === null ? null : { slot } }
  const first = filterNode(node.first, map), second = filterNode(node.second, map)
  return first && second ? { ...node, first, second } : first ?? second
}

/** Remove closed windows and preserve the split that contains each survivor. */
export function reconcileWindowSplitTree(tree: WindowSplitTree, keys: string[], primary = tree.primary !== false): WindowSplitTree {
  if (JSON.stringify(tree.keys) === JSON.stringify(keys) && primary === (tree.primary !== false)) return tree
  // Reordering/replacing contents leaves frame geometry unchanged.
  if (tree.keys.length === keys.length && primary === (tree.primary !== false)) return { ...tree, keys }
  let root = filterNode(tree.root, slot => slot === -1 ? (primary ? -1 : null) : keys.includes(tree.keys[slot]!) ? keys.indexOf(tree.keys[slot]!) : null)
  if (primary && tree.primary === false) root = root ? { axis: 'x', ratio: 0.5, first: { slot: -1 }, second: root } : { slot: -1 }
  for (let slot = 0; slot < keys.length; slot++) if (!tree.keys.includes(keys[slot]!)) root = root ? { axis: 'x', ratio: 0.5, first: root, second: { slot } } : { slot }
  return { root: root ?? { slot: -1 }, keys, ...(primary ? {} : { primary: false }) }
}

export function splitWindowLeaf(root: WindowSplitNode, target: number, added: number, axis: 'x' | 'y'): WindowSplitNode {
  if ('slot' in root) return root.slot === target ? { axis, ratio: 0.5, first: root, second: { slot: added } } : root
  return { ...root, first: splitWindowLeaf(root.first, target, added, axis), second: splitWindowLeaf(root.second, target, added, axis) }
}

export function splitTreeFromRects(rects: Array<SplitRect & { slot: number }>): WindowSplitNode {
  if (rects.length <= 1) return { slot: rects[0]?.slot ?? -1 }
  for (const axis of ['x', 'y'] as const) {
    const extent = axis === 'x' ? 'width' : 'height'
    const start = Math.min(...rects.map(rect => rect[axis]))
    const end = Math.max(...rects.map(rect => rect[axis] + rect[extent]))
    const cuts = [...new Set(rects.map(rect => rect[axis] + rect[extent]))].sort((a, b) => a - b)
    for (const cut of cuts) {
      const first = rects.filter(rect => rect[axis] + rect[extent] <= cut)
      const second = rects.filter(rect => rect[axis] >= cut)
      if (!first.length || !second.length || first.length + second.length !== rects.length) continue
      return { axis, ratio: (cut - start) / (end - start), first: splitTreeFromRects(first), second: splitTreeFromRects(second) }
    }
  }
  return { axis: 'y', ratio: 1 / rects.length, first: { slot: rects[0]!.slot }, second: splitTreeFromRects(rects.slice(1)) }
}

function minimum(node: WindowSplitNode, limits: SplitMinimums): { width: number; height: number } {
  if ('slot' in node) return node.slot === -1 ? { width: limits.readerWidth, height: limits.readerRows } : { width: limits.paneWidth, height: limits.paneRows }
  const first = minimum(node.first, limits), second = minimum(node.second, limits)
  return node.axis === 'x' ? { width: first.width + second.width, height: Math.max(first.height, second.height) } : { width: Math.max(first.width, second.width), height: first.height + second.height }
}

export function computeWindowSplitTree(tree: WindowSplitTree, width: number, height: number, limits: SplitMinimums) {
  let visibleCount = tree.keys.length
  let root = tree.root
  const minimumVisible = tree.primary === false && tree.keys.length ? 1 : 0
  while (visibleCount > minimumVisible) {
    root = filterNode(tree.root, slot => slot < visibleCount ? slot : null) ?? { slot: -1 }
    const min = minimum(root, limits)
    if (min.width <= width && min.height <= height) break
    visibleCount--
  }
  if (visibleCount === minimumVisible) root = filterNode(tree.root, slot => slot < visibleCount ? slot : null) ?? { slot: tree.primary === false ? 0 : -1 }
  const rects = new Map<number, SplitRect>()
  const dividers: SplitDivider[] = []
  const visit = (node: WindowSplitNode, rect: SplitRect, path: string) => {
    if ('slot' in node) { rects.set(node.slot, rect); return }
    const firstMin = minimum(node.first, limits), secondMin = minimum(node.second, limits)
    const extent = node.axis === 'x' ? rect.width : rect.height
    const minFirst = node.axis === 'x' ? firstMin.width : firstMin.height
    const minSecond = node.axis === 'x' ? secondMin.width : secondMin.height
    const firstExtent = Math.max(minFirst, Math.min(extent - minSecond, Math.round(extent * node.ratio)))
    dividers.push({ path, axis: node.axis, rect, firstExtent, minFirst, minSecond })
    visit(node.first, { ...rect, ...(node.axis === 'x' ? { width: firstExtent } : { height: firstExtent }) }, `${path}0`)
    visit(node.second, { ...rect, ...(node.axis === 'x' ? { x: rect.x + firstExtent, width: extent - firstExtent } : { y: rect.y + firstExtent, height: extent - firstExtent }) }, `${path}1`)
  }
  visit(root, { x: 0, y: 0, width, height }, '')
  const reader = rects.get(-1) ?? { x: 0, y: 0, width: 0, height: 0 }
  const panes = Array.from({ length: visibleCount }, (_, slot) => rects.get(slot)!)
  const layout: WindowLayout = { arrangement: 'split', visibleCount, reader, panes, secondary: null, topPanes: 0, groups: [] }
  return { layout, rects, dividers }
}

export function updateSplitRatio(root: WindowSplitNode, path: string, ratio: number): WindowSplitNode {
  if ('slot' in root) return root
  if (!path) return { ...root, ratio: Math.max(0.01, Math.min(0.99, ratio)) }
  return path[0] === '0' ? { ...root, first: updateSplitRatio(root.first, path.slice(1), ratio) } : { ...root, second: updateSplitRatio(root.second, path.slice(1), ratio) }
}

export function splitPath(root: WindowSplitNode, slot: number): string | null {
  if ('slot' in root) return root.slot === slot ? '' : null
  const first = splitPath(root.first, slot), second = splitPath(root.second, slot)
  return first !== null ? `0${first}` : second !== null ? `1${second}` : null
}

export function evenWindowSplitTree(root: WindowSplitNode): WindowSplitNode {
  return 'slot' in root ? root : { ...root, ratio: 0.5, first: evenWindowSplitTree(root.first), second: evenWindowSplitTree(root.second) }
}

export function rotateWindowSplitTree(root: WindowSplitNode, path: string): WindowSplitNode {
  if ('slot' in root) return root
  if (!path) return { ...root, axis: root.axis === 'x' ? 'y' : 'x' }
  return path[0] === '0' ? { ...root, first: rotateWindowSplitTree(root.first, path.slice(1)) } : { ...root, second: rotateWindowSplitTree(root.second, path.slice(1)) }
}

/** Move an existing leaf, or add a new one, beside the chosen leaf. */
export function placeWindowSplit(tree: WindowSplitTree, movingKey: string, anchorKey: string | null, edge: 'left' | 'right' | 'top' | 'bottom'): WindowSplitTree | null {
  if (movingKey === anchorKey) return null
  const existing = tree.keys.indexOf(movingKey)
  const anchor = anchorKey === null ? -1 : tree.keys.indexOf(anchorKey)
  if (anchorKey !== null && anchor < 0) return null
  const keys = existing < 0 ? [...tree.keys, movingKey] : [...tree.keys]
  if (keys.length > 31) return null
  const added = existing < 0 ? keys.length - 1 : existing
  const root = filterNode(tree.root, slot => slot === existing && existing >= 0 ? null : slot)
  if (!root) return null
  const before = edge === 'left' || edge === 'top'
  const axis = edge === 'left' || edge === 'right' ? 'x' : 'y'
  const insert = (node: WindowSplitNode): WindowSplitNode => {
    if ('slot' in node) return node.slot === anchor ? { axis, ratio: 0.5, first: before ? { slot: added } : node, second: before ? node : { slot: added } } : node
    return { ...node, first: insert(node.first), second: insert(node.second) }
  }
  return { ...tree, root: insert(root), keys }
}

/** Collapse the former main transcript frame; every remaining frame is an ordinary pane. */
export function removePrimaryWindow(tree: WindowSplitTree): WindowSplitTree | null {
  if (!tree.keys.length) return null
  return reconcileWindowSplitTree(tree, tree.keys, false)
}

/** Reuse the former transcript frame for any ordinary window (including a tab group). */
export function replacePrimaryWindow(tree: WindowSplitTree, key: string): WindowSplitTree {
  const existing = tree.keys.indexOf(key)
  const keys = existing < 0 ? [...tree.keys, key] : [...tree.keys]
  const slot = existing < 0 ? keys.length - 1 : existing
  const root = filterNode(tree.root, old => old === -1 ? slot : old === existing && existing >= 0 ? null : old)!
  return { primary: false, keys, root }
}

export function arrangePaneTree(keys: string[], primary: boolean, style: 'columns' | 'rows' | 'grid' | 'stack', focused = primary ? -1 : 0): WindowSplitTree | null {
  const slots = [...(primary ? [-1] : []), ...keys.map((_, index) => index)]
  if (!slots.length) return null
  const row = (items: number[], axis: 'x' | 'y'): WindowSplitNode => items.length === 1 ? { slot: items[0]! } : { axis, ratio: 1 / items.length, first: { slot: items[0]! }, second: row(items.slice(1), axis) }
  let root: WindowSplitNode
  if (style === 'stack' && slots.length > 1) {
    const lead = slots.includes(focused) ? focused : slots[0]!
    root = { axis: 'x', ratio: 0.5, first: { slot: lead }, second: row(slots.filter(slot => slot !== lead), 'y') }
  } else if (style === 'grid' && slots.length > 2) {
    const half = Math.ceil(slots.length / 2)
    root = { axis: 'y', ratio: 0.5, first: row(slots.slice(0, half), 'x'), second: row(slots.slice(half), 'x') }
  } else root = row(slots, style === 'rows' ? 'y' : 'x')
  return { keys, root, ...(primary ? {} : { primary: false }) }
}

export function movePaneToEdge(tree: WindowSplitTree, slot: number, edge: 'left' | 'right' | 'top' | 'bottom'): WindowSplitTree {
  const remaining = filterNode(tree.root, existing => existing === slot ? null : existing)
  if (!remaining) return tree
  const before = edge === 'left' || edge === 'top'
  return { ...tree, root: { axis: edge === 'left' || edge === 'right' ? 'x' : 'y', ratio: 0.5, first: before ? { slot } : remaining, second: before ? remaining : { slot } } }
}

export function placePaneSlot(tree: WindowSplitTree, moving: number, anchor: number, edge: 'left' | 'right' | 'top' | 'bottom'): WindowSplitTree {
  if (moving === anchor) return movePaneToEdge(tree, moving, edge)
  const root = filterNode(tree.root, slot => slot === moving ? null : slot)
  if (!root) return tree
  const before = edge === 'left' || edge === 'top'
  const insert = (node: WindowSplitNode): WindowSplitNode => 'slot' in node ? node.slot === anchor ? { axis: edge === 'left' || edge === 'right' ? 'x' : 'y', ratio: 0.5, first: before ? { slot: moving } : node, second: before ? node : { slot: moving } } : node : { ...node, first: insert(node.first), second: insert(node.second) }
  return { ...tree, root: insert(root) }
}

export function swapPaneSlots(tree: WindowSplitTree, a: number, b: number): WindowSplitTree {
  const swap = (node: WindowSplitNode): WindowSplitNode => 'slot' in node ? { slot: node.slot === a ? b : node.slot === b ? a : node.slot } : { ...node, first: swap(node.first), second: swap(node.second) }
  return { ...tree, root: swap(tree.root) }
}
