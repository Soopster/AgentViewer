import { useCallback, useEffect, useRef, useState } from 'react'

const COLLAPSED_PANE_KEY = 'agentViewer:messagePaneCollapsed'

/** Browser presentation state stays independent of sessions and transcript data. */
export function useReaderPresentation(canMaximize: boolean) {
  // Match server markup; browser preferences are restored after hydration.
  const [paneCollapsed, setPaneCollapsed] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const fullscreenRef = useRef(false)
  const isMaximized = maximized && canMaximize

  useEffect(() => {
    try { setPaneCollapsed(window.localStorage.getItem(COLLAPSED_PANE_KEY) === '1') }
    catch { /* restricted storage keeps the expanded default */ }
  }, [])

  const togglePane = useCallback(() => {
    const next = !paneCollapsed
    setPaneCollapsed(next)
    try { window.localStorage.setItem(COLLAPSED_PANE_KEY, next ? '1' : '0') }
    catch { /* presentation still works without storage */ }
  }, [paneCollapsed])

  const toggleMaximized = useCallback(() => {
    if (!canMaximize) return
    if (maximized && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    setMaximized(current => !current)
    setPaneCollapsed(false)
  }, [maximized, canMaximize])

  const enterFullscreen = useCallback(() => {
    if (!canMaximize) return
    setMaximized(true)
    setPaneCollapsed(false)
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return
    // Keep application focus mode when the browser/webview rejects fullscreen.
    void document.documentElement.requestFullscreen().catch(() => {})
  }, [canMaximize])

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement !== null
      if (!active && fullscreenRef.current) setMaximized(false)
      fullscreenRef.current = active
      setFullscreen(active)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    if (!isMaximized) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setMaximized(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMaximized])

  return { paneCollapsed, maximized: isMaximized, fullscreen, togglePane, toggleMaximized, enterFullscreen }
}
