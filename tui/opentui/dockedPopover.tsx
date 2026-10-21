/** @jsxImportSource @opentui/react */
// A popover's frame, as a modal or docked in a window (popoverWindows.ts).
//
// Modal, it floats over the screen with its own border and title. Docked, it
// fills the box it is given and draws neither: the window frame around it
// supplies the border, the title and the window controls, and a second frame
// inside the first would cost two rows and two columns for nothing.
import type { TuiThemePalette } from '../theme'
import { WindowButton } from './WindowButton'

export type PopoverRect = { top: number; left: number; width: number; height: number }

/** Props for a popover's root box: positioned and layered as a modal, plain when docked. */
export function popoverRootProps(docked: boolean, rect: PopoverRect, zIndex: number) {
  return docked
    ? { width: rect.width, height: rect.height }
    : { position: 'absolute' as const, top: rect.top, left: rect.left, width: rect.width, height: rect.height, zIndex }
}

/** Rows and columns the popover's own border takes: none when docked. */
export function popoverFrameCells(docked: boolean): number {
  return docked ? 0 : 2
}

/** The `⧉ window` title button that breaks a modal popover out into a window. */
export function PopoverDetachButton({ theme, onPress }: { theme: TuiThemePalette; onPress: () => void }) {
  return (
    <box position="absolute" top={-1} right={2} height={1} flexDirection="row" zIndex={3}>
      <WindowButton id="popover-detach" label=" ⧉ window " theme={theme} onPress={onPress} />
    </box>
  )
}
