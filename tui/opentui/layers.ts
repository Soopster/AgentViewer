import { applyGain, applySaturation, type OptimizedBuffer } from '@opentui/core'

// Z-order for the root's modal layer.
//
// A modal here is two boxes: a full-screen scrim that dims everything behind
// it, and the panel itself. The panel MUST sit above the scrim — the whole
// surface is otherwise dimmed with the rest and reads as disabled rather than
// foregrounded, which is what a panel left at a lower index looked like.
// The two are a pair, so they are one pair of constants rather than literals
// repeated at each modal's call site.
export const MODAL_SCRIM_Z_INDEX = 69
export const MODAL_CONTENT_Z_INDEX = MODAL_SCRIM_Z_INDEX + 1

// The spaces rail and workspace tabs: above the composer window (59/60), so a
// workspace can be switched with a draft open, and below the modal scrim, which
// must dim every cell behind a modal. Full-screen popovers draw from the top row,
// so the bars drop beneath them while one is open (`under`).
export const NAVIGATION_Z_INDEX = MODAL_SCRIM_Z_INDEX - 1

// The scrim is a pass over what has been painted so far, not a colour laid on
// top of it. It runs as the scrim box's own render step, so it reaches exactly
// what sits below that box in z-order and nothing drawn after it. A translucent
// black box could only darken; this also drains the colour, so a status glyph
// behind a modal stops competing with the one inside it.
const MODAL_SCRIM_GAIN = 0.65
const MODAL_SCRIM_SATURATION = 0.35

export function paintModalScrim(buffer: OptimizedBuffer): void {
  applySaturation(buffer, undefined, MODAL_SCRIM_SATURATION)
  applyGain(buffer, MODAL_SCRIM_GAIN)
}
