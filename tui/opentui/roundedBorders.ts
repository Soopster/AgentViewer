import { BoxRenderable, type BoxOptions, type RenderContext, type Renderable } from '@opentui/core'
import { componentCatalogue, extend } from '@opentui/react'

/**
 * Rounded window borders as one switch.
 *
 * Roughly 120 boxes ask for `borderStyle="single"`; this swaps the box
 * component itself so each of them draws `rounded` while the switch is on,
 * with no call site changing. Only `single` is mapped: heavy and double borders
 * mark focus or emphasis and keep their glyphs. A box remembers the style it
 * was asked for, so turning the switch off restores it exactly.
 */
let enabled = false
const listeners = new Set<() => void>()

type BorderStyle = NonNullable<BoxOptions['borderStyle']>

function effectiveStyle(asked: BorderStyle | undefined): BorderStyle | undefined {
  return enabled && asked === 'single' ? 'rounded' : asked
}

class RoundableBoxRenderable extends BoxRenderable {
  private askedBorderStyle: BorderStyle | undefined

  constructor(ctx: RenderContext, options: BoxOptions) {
    super(ctx, { ...options, borderStyle: effectiveStyle(options.borderStyle) })
    this.askedBorderStyle = options.borderStyle
  }

  override get borderStyle(): BorderStyle {
    return super.borderStyle
  }

  override set borderStyle(value: BorderStyle) {
    this.askedBorderStyle = value
    super.borderStyle = effectiveStyle(value) ?? value
  }

  /** Re-derives the drawn style after the switch moved. */
  syncRoundedBorder(): void {
    const next = effectiveStyle(this.askedBorderStyle)
    if (next && next !== super.borderStyle) super.borderStyle = next
  }
}

// Registered at import: the catalogue is read when a box is created, so this
// must run before the first render.
extend({ box: RoundableBoxRenderable })
void componentCatalogue

export function roundedBordersEnabled(): boolean {
  return enabled
}

export function subscribeRoundedBorders(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function syncTree(node: Renderable): void {
  if (node instanceof RoundableBoxRenderable) node.syncRoundedBorder()
  for (const child of node.getChildren()) syncTree(child)
}

/** Flips the switch and restyles every box already on screen. */
export function setRoundedBorders(next: boolean, root?: Renderable | null): void {
  if (enabled === next) return
  enabled = next
  if (root) syncTree(root)
  for (const listener of listeners) listener()
}
