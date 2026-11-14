/** @jsxImportSource @opentui/react */
import React, { createContext, useContext } from 'react'
import type { BoxProps } from '@opentui/react'
import type { TuiThemePalette } from '../../theme'

/**
 * Whether section frames draw a line border. When this is off the border cells
 * are painted in the theme background instead of a glyph — the sections keep
 * the same footprint and are separated by a black gutter rather than a rule.
 */
export const BordersContext = createContext(true)

export function useBordersVisible(): boolean {
  return useContext(BordersContext)
}

type SectionFrameProps = BoxProps & {
  theme: TuiThemePalette
  /** The fill behind the section's content. Defaults to `theme.surface`. */
  surface?: string
  /**
   * Whether this section holds the keyboard. With borders hidden the border
   * colour used to say so; a raised gutter carries that instead.
   */
  focused?: boolean
  children?: React.ReactNode
}

function hasVisibleBorder(border: BoxProps['border']): boolean {
  if (border === true) return true
  return Array.isArray(border) && border.length > 0
}

/**
 * A section box whose border can be swapped for a background-coloured gutter.
 *
 * The border still occupies its rows and columns, so every caller's measured
 * width/height and any content painted into the border row (`top={-1}`) keep
 * working. With borders off the outer box is filled with the theme background
 * and the real content sits in an inset surface box: the one-cell ring around
 * it reads as black spacing, not a line. A focused section lifts that ring one
 * surface shade, the borderless stand-in for the lit border colour.
 */
export function SectionFrame({ theme, surface, focused, children, ...props }: SectionFrameProps) {
  const bordersVisible = useBordersVisible()
  if (bordersVisible || !hasVisibleBorder(props.border)) {
    return <box {...props}>{children}</box>
  }
  const fill = surface ?? props.backgroundColor ?? theme.surface
  const ring = focused ? theme.surface2 : theme.bg
  return (
    <box {...props} borderColor={ring} backgroundColor={ring}>
      <box
        flexGrow={1}
        flexDirection={props.flexDirection ?? 'column'}
        overflow={props.overflow}
        backgroundColor={fill}
      >
        {children}
      </box>
    </box>
  )
}
