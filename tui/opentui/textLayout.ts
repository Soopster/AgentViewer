// Small text helpers shared by the root and the surfaces extracted out of it.
// They were private to App.tsx; a surface that renders its own rows needs the
// same padding and truncation rules or it will not line up with the rest.

/** Pad to `width`, or truncate with an ellipsis so the row never wraps. */
export function fitText(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length <= width) return value.padEnd(width, ' ')
  if (width === 1) return value.slice(0, 1)
  return `${value.slice(0, width - 1)}…`
}

/** Join the non-empty parts with the separator used across every meta line. */
export function joinMeta(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join('  ·  ')
}
