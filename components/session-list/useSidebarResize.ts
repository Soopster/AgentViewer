'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

export function useSidebarResize(sidebarWidth: number, applyWidth: (width: number) => void, setSidebarWidth: (width: number) => void) {
  const [resizing, setResizing] = useState(false)
  const resizeFrameRef = useRef<number | null>(null)
  const resizeWidthRef = useRef(sidebarWidth)

  useEffect(() => {
    resizeWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  useEffect(() => {
    if (!resizing) return
    const onMove = (e: MouseEvent) => {
      const next = Math.max(220, Math.min(640, e.clientX))
      resizeWidthRef.current = next
      if (resizeFrameRef.current != null) return
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null
        applyWidth(resizeWidthRef.current)
      })
    }
    const onUp = () => {
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
      setSidebarWidth(resizeWidthRef.current)
      setResizing(false)
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [applyWidth, resizing, setSidebarWidth])

  const startResize = useCallback((clientX: number) => {
    resizeWidthRef.current = Math.max(220, Math.min(640, clientX))
    setResizing(true)
  }, [])
  const resetWidth = useCallback(() => {
    resizeWidthRef.current = 290
    applyWidth(290)
    setSidebarWidth(290)
  }, [applyWidth, setSidebarWidth])
  return { resizing, startResize, resetWidth }
}
