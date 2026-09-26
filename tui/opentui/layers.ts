// Z-order for the root's modal layer.
//
// A modal here is two boxes: a full-screen scrim that dims everything behind
// it, and the panel itself. The panel MUST sit above the scrim — the whole
// surface is otherwise painted through 35% black and reads as disabled rather
// than foregrounded, which is what a panel left at a lower index looked like.
// The two are a pair, so they are one pair of constants rather than literals
// repeated at each modal's call site.
export const MODAL_SCRIM_Z_INDEX = 69
export const MODAL_CONTENT_Z_INDEX = MODAL_SCRIM_Z_INDEX + 1
