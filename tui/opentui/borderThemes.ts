import { BoxRenderable, type BorderCharacters, type BoxOptions, type RenderContext, type Renderable } from '@opentui/core'
import { componentCatalogue, extend } from '@opentui/react'
import type { ViewBorderTheme } from '../viewSpec'

/**
 * Window borders as one theme, chosen by the view (`borderTheme`, View Studio → Panels).
 *
 * Roughly 120 boxes ask for `borderStyle="single"`; this swaps the box
 * component itself so each of them draws the chosen theme, with no call site
 * changing. Only `single` is mapped: heavy and double borders mark focus or
 * emphasis and keep their glyphs. A box remembers the style it was asked for,
 * so returning to `square` restores it exactly.
 *
 * OpenTUI has four native styles; the rest are custom characters, all
 * single-cell box-drawing (or ASCII) glyphs so no layout moves.
 */
type NativeStyle = NonNullable<BoxOptions['borderStyle']>

const chars = (corners: string, horizontal: string, vertical: string, joins: string): BorderCharacters => {
  const [topLeft, topRight, bottomLeft, bottomRight] = [...corners] as [string, string, string, string]
  const [topT, bottomT, leftT, rightT, cross] = [...joins] as [string, string, string, string, string]
  return { topLeft, topRight, bottomLeft, bottomRight, horizontal, vertical, topT, bottomT, leftT, rightT, cross }
}

const THEME_DRAWING: Readonly<Record<ViewBorderTheme, NativeStyle | BorderCharacters>> = {
  square: 'single',
  rounded: 'rounded',
  heavy: 'heavy',
  double: 'double',
  mixed: chars('╒╕╘╛', '═', '│', '╤╧╞╡╪'),
  dashed: chars('┌┐└┘', '┄', '┆', '┬┴├┤┼'),
  'heavy-dashed': chars('┏┓┗┛', '┅', '┇', '┳┻┣┫╋'),
  dotted: chars('╭╮╰╯', '┈', '┊', '┬┴├┤┼'),
  ascii: chars('++++', '-', '|', '+++++'),
}

let current: ViewBorderTheme = 'square'

class ThemedBoxRenderable extends BoxRenderable {
  private askedBorderStyle: NativeStyle | undefined
  private themedChars: BorderCharacters | undefined

  constructor(ctx: RenderContext, options: BoxOptions) {
    super(ctx, options)
    this.askedBorderStyle = options.borderStyle
    this.applyBorderTheme()
  }

  override get borderStyle(): NativeStyle {
    return super.borderStyle
  }

  override set borderStyle(value: NativeStyle) {
    this.askedBorderStyle = value
    this.applyBorderTheme()
  }

  /** Re-derives the drawn border after the theme moved. */
  applyBorderTheme(): void {
    const asked = this.askedBorderStyle
    const drawing = asked === 'single' ? THEME_DRAWING[current] : asked
    if (drawing === undefined) return
    if (typeof drawing === 'string') {
      // OpenTUI ignores a style equal to the current one, so a theme's custom
      // characters are dropped explicitly rather than by re-setting `single`.
      if (this.themedChars) this.customBorderChars = undefined
      if (drawing !== super.borderStyle) super.borderStyle = drawing
      this.themedChars = undefined
      return
    }
    if (this.themedChars === drawing) return
    if (super.borderStyle !== 'single') super.borderStyle = 'single'
    this.customBorderChars = drawing
    this.themedChars = drawing
  }
}

// Registered at import: the catalogue is read when a box is created, so this
// must run before the first render.
extend({ box: ThemedBoxRenderable })
void componentCatalogue

export function borderTheme(): ViewBorderTheme {
  return current
}

function syncTree(node: Renderable): void {
  if (node instanceof ThemedBoxRenderable) node.applyBorderTheme()
  for (const child of node.getChildren()) syncTree(child)
}

/** Switches the theme and restyles every box already on screen. */
export function setBorderTheme(next: ViewBorderTheme, root?: Renderable | null): void {
  if (current === next) return
  current = next
  if (root) syncTree(root)
}
