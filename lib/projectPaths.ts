export function normalizeProjectPath(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function sameProjectPath(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizeProjectPath(left)
  const b = normalizeProjectPath(right)
  if (!a || !b) return false
  if (a === b) return true
  if (a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) return true
  return a.split('/').pop() === b.split('/').pop()
}

export function pickCanonicalProjectPath(left: string | null | undefined, right: string | null | undefined): string {
  const a = normalizeProjectPath(left)
  const b = normalizeProjectPath(right)
  if (!a) return b
  if (!b) return a
  if (a === b) return a
  if (a.startsWith(`${b}/`)) return b
  if (b.startsWith(`${a}/`)) return a
  return a
}
