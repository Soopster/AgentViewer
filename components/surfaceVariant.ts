/**
 * Shared shell-mode plumbing for the surfaces that can render either as a
 * full-screen overlay or docked in the right panel.
 *
 * Every one of them binds window-level key handlers (j/k tree navigation,
 * Escape, refresh). That is safe for a modal overlay, which owns the whole
 * screen; docked it is not — the transcript and composer are alive beside it
 * and a bare `j` must not scroll a file tree the user is not looking at. So a
 * docked surface only answers keys while focus is somewhere inside its shell.
 */

export type SurfaceVariant = 'overlay' | 'docked'

export function isDocked(variant: SurfaceVariant | undefined): boolean {
  return variant === 'docked'
}

/** True when a docked surface should let this key event pass through to the app. */
export function shouldIgnoreDockedKey(
  variant: SurfaceVariant | undefined,
  shell: HTMLElement | null,
): boolean {
  if (variant !== 'docked') return false
  if (typeof document === 'undefined') return true
  const active = document.activeElement
  return !(shell && active instanceof Node && shell.contains(active))
}
