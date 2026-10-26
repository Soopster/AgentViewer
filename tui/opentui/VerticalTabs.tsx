/** @jsxImportSource @opentui/react */
import { memo, useEffect, useRef, useState } from 'react'
import { LayoutEvents, type MouseEvent, type ScrollBoxRenderable, type TabSelectOption } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import type { TuiThemePalette } from '../theme'
import { fitText } from './textLayout'

const FRAMES = ['◐', '◓', '◑', '◒']

export function verticalTabRailWidth(available: number, enabled: boolean): number {
  // Retain a usable pane on small terminals; the saved preference stays vertical.
  return enabled && available >= 80 ? Math.min(30, Math.floor(available / 4)) : 0
}

export const VerticalTabs = memo(function VerticalTabs({ options, activeIndex, running, width, height, theme, onClose, onHorizontal, onPress, onDrag, onRelease }: {
  options: TabSelectOption[]
  activeIndex: number
  running: ReadonlySet<string>
  width: number
  height: number
  theme: TuiThemePalette
  onClose: (index: number) => void
  onHorizontal: () => void
  onPress: (index: number, event: MouseEvent) => void
  onDrag: (event: MouseEvent) => void
  onRelease: (event: MouseEvent) => void
}) {
  const scroll = useRef<ScrollBoxRenderable>(null)
  const renderer = useRenderer()
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!running.size) return
    const timer = setInterval(() => setFrame(value => (value + 1) % FRAMES.length), 120)
    return () => clearInterval(timer)
  }, [running.size])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const reveal = () => {
      const list = scroll.current
      const row = list?.findDescendantById(`vertical-tab:${activeIndex}`)
      if (!list || !row || list.viewport.height < 1 || row.y - list.content.y !== activeIndex) return
      renderer.root.off(LayoutEvents.LAYOUT_CHANGED, afterLayout)
      list.scrollChildIntoView(`vertical-tab:${activeIndex}`)
    }
    const afterLayout = () => { clearTimeout(timer); timer = setTimeout(reveal, 0) }
    renderer.root.on(LayoutEvents.LAYOUT_CHANGED, afterLayout)
    timer = setTimeout(reveal, 0)
    return () => { clearTimeout(timer); renderer.root.off(LayoutEvents.LAYOUT_CHANGED, afterLayout) }
  }, [activeIndex, options.length, height, renderer])
  return <box id="vertical-tabs" width={width} height={height} flexShrink={0} flexDirection="column" border={['right']} borderColor={theme.border2} backgroundColor={theme.surface}>
    <box height={1} flexShrink={0} flexDirection="row" paddingX={1}>
      <text fg={theme.dim} wrapMode="none">Tabs</text>
      <box flexGrow={1} />
      <box id="vertical-tabs-horizontal" width={3} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); onHorizontal() } }}><text fg={theme.cyan} selectable={false}> ⇄ </text></box>
    </box>
    <scrollbox id="vertical-tabs-scroll" ref={scroll} height={Math.max(height - 1, 1)} scrollY viewportCulling>
      {options.map((option, index) => {
        const active = index === activeIndex
        const busy = running.has(String(option.value))
        const label = option.name.slice(0, -2).trimEnd()
        return <box id={`vertical-tab:${index}`} key={String(option.value)} height={1} flexShrink={0} width={width - 1} flexDirection="row" backgroundColor={active ? theme.surface3 : theme.surface}
          onMouseDown={event => onPress(index, event)} onMouseDrag={onDrag} onMouseUp={onRelease}>
          <text fg={active ? theme.cyan : theme.dim} width={2} selectable={false}>{active ? '▸ ' : '  '}</text>
          <box width={Math.max(width - 6, 1)}>
            <text fg={active ? theme.cyan : theme.text} wrapMode="none" selectable={false}>{fitText(`${busy ? `${FRAMES[frame]} ` : ''}${label}`, Math.max(width - 6, 1))}</text>
          </box>
          <box id={`vertical-tab-close:${index}`} width={3} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); onClose(index) } }}>
            <text fg={active ? theme.cyan : theme.dim} selectable={false}> × </text>
          </box>
        </box>
      })}
    </scrollbox>
  </box>
})
