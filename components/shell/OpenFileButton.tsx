'use client'
import { useSyncExternalStore, type MouseEvent } from 'react'
import { hasFileOpenRoute, routeFileOpen, subscribeFileOpenRoute } from '../../lib/plugins/openInIde'

/** Is something installed to open files (the Open in IDE plugin)? */
export function useFileOpenAvailable(): boolean {
  return useSyncExternalStore(subscribeFileOpenRoute, hasFileOpenRoute, () => false)
}

/** Opens a file path in the person's editor. Drawn only while a route is installed. */
export function OpenFileButton({ path, line, cwd, title }: { path: string; line?: number | null; cwd?: string | null; title?: string }) {
  const available = useFileOpenAvailable()
  if (!available || !path) return null
  const open = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    routeFileOpen({ path, line: line ?? null, cwd: cwd ?? null })
  }
  const label = title ?? `Open ${path}${line ? `:${line}` : ''} in your editor`
  return <button type="button" onClick={open} title={label} aria-label={label} className="av-open-file"
    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, lineHeight: 1, color: 'var(--text-3)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 5px', cursor: 'pointer', flexShrink: 0 }}>↗</button>
}
