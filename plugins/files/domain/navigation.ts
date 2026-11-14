// File destinations are resolved lexically, like the file API's path.resolve.
// Keep Windows paths usable when the Web client itself runs on another OS.
export function fileNavigationTarget(cwd: string, path?: string): { path: string | null; directory: string } {
  if (!path) return { path: null, directory: cwd }
  const normalized = path.replace(/\\/g, '/')
  const source = /^(?:\/|[A-Za-z]:\/)/.test(normalized) ? normalized : `${cwd.replace(/\\/g, '/')}/${normalized}`
  const prefix = source.startsWith('//') ? '//' : source.startsWith('/') ? '/' : source.slice(0, 3)
  const parts: string[] = []
  for (const segment of source.slice(prefix.length).split('/')) {
    if (segment === '..') parts.pop()
    else if (segment && segment !== '.') parts.push(segment)
  }
  const full = prefix + parts.join('/')
  const slash = full.lastIndexOf('/')
  return { path: full, directory: slash < prefix.length ? prefix : full.slice(0, slash) }
}
