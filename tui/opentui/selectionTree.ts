import type { BaseRenderable } from '@opentui/core'

export type SelectionColors = {
  selectionBg: string
  selectionFg: string
}

type SelectionColorTarget = BaseRenderable & {
  selectionBg?: string
  selectionFg?: string
}

export function applySelectionColorsToTree(root: BaseRenderable | null, colors: SelectionColors): void {
  if (!root) return
  const stack: BaseRenderable[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if ('selectionBg' in node) {
      const target = node as SelectionColorTarget
      target.selectionBg = colors.selectionBg
      target.selectionFg = colors.selectionFg
    }
    for (const child of node.getChildren()) {
      stack.push(child)
    }
  }
}

