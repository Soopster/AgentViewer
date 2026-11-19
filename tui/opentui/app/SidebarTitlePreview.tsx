/** @jsxImportSource @opentui/react */
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useKeyboard, type BoxProps } from '@opentui/react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../../theme'
import { layoutDiffText } from '../gitDiffText'

type TitleDetail = { key: string; title: string; width: number }
const PreviewContext = createContext({
  hover: (_detail: TitleDetail | null) => {},
  select: (_detail: TitleDetail | null, _key: string) => {},
})
const sameTitle = (left: TitleDetail | null, right: TitleDetail | null) => left?.key === right?.key && left?.title === right?.title && left?.width === right?.width

/** The shared rail owns full-title inspection; cached rows only report hover and selection. */
export function SidebarTitlePreview({ theme, width, height, enabled, children }: {
  theme: TuiThemePalette; width: number; height: number; enabled: boolean; children: React.ReactNode
}) {
  const [hovered, setHovered] = useState<TitleDetail | null>(null)
  const [selected, setSelected] = useState<TitleDetail | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scroll = useRef<ScrollBoxRenderable | null>(null)
  const clearExit = useCallback(() => { if (exitTimer.current) clearTimeout(exitTimer.current) }, [])
  useEffect(() => clearExit, [clearExit])
  const hover = useCallback((detail: TitleDetail | null) => {
    clearExit()
    if (detail) { setHovered(previous => sameTitle(previous, detail) ? previous : detail); setDismissed(null) }
    else exitTimer.current = setTimeout(() => setHovered(null), 150)
  }, [clearExit])
  const select = useCallback((detail: TitleDetail | null, key: string) => {
    setSelected(previous => detail ? sameTitle(previous, detail) ? previous : detail : previous?.key === key ? null : previous)
  }, [])
  const context = React.useMemo(() => ({ hover, select }), [hover, select])
  const detail = hovered ?? selected
  const visible = enabled && detail && detail.key !== dismissed && layoutDiffText(detail.title, Math.max(1, detail.width), 4, true).length > 1
  const lines = visible ? layoutDiffText(detail.title, Math.max(1, width - 4), 4, true).map(line => line.map(span => span.text).join('')) : []
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0 }, [detail?.key, visible])
  useEffect(() => { if (!enabled) { clearExit(); setHovered(null) } }, [enabled, clearExit])
  useKeyboard(key => {
    if (!visible) return
    if (key.name === 'escape') { setDismissed(detail.key); setHovered(null) }
    else if (key.name === 'pageup' || key.name === 'pagedown') scroll.current?.scrollBy(key.name === 'pageup' ? -3 : 3)
    else return
    key.preventDefault(); key.stopPropagation()
  })
  return <PreviewContext.Provider value={context}>
    {children}
    {visible ? <box id="sidebar-title-detail" position="absolute" bottom={0} left={0} width={width - 2}
      height={Math.max(3, Math.min(lines.length + 2, 8, height - 7))} border borderColor={theme.cyan} backgroundColor={theme.surface} zIndex={20}
      onMouseOver={clearExit} onMouseOut={() => hover(null)}>
      <scrollbox ref={scroll} flexGrow={1} minHeight={0}><text fg={theme.text} wrapMode="none">{lines.join('\n')}</text></scrollbox>
    </box> : null}
  </PreviewContext.Provider>
}

export function SidebarSessionRow({ preview, selected, ...props }: BoxProps & { preview: TitleDetail; selected: boolean }) {
  const context = useContext(PreviewContext)
  useLayoutEffect(() => {
    if (!selected) return
    context.select(preview, preview.key)
    return () => context.select(null, preview.key)
  }, [context.select, selected, preview.key, preview.title, preview.width])
  return <box {...props} onMouseOver={() => context.hover(preview)} onMouseOut={() => context.hover(null)} />
}
