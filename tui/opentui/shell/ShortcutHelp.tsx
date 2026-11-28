/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../../theme'

export type ShortcutHelpGroup = { title: string; rows: readonly (readonly [string, string])[] }

/** A bounded help layer; the owning plugin controls capture and key routing. */
export function ShortcutHelp({ title, groups, theme, width, height, scrollRef, onClose }: {
  title: string; groups: readonly ShortcutHelpGroup[]; theme: TuiThemePalette; width: number; height: number
  scrollRef: RefObject<ScrollBoxRenderable | null>; onClose: () => void
}) {
  const w = Math.max(1, Math.min(76, width - 4)), h = Math.max(1, Math.min(23, height - 4))
  return <box position="absolute" top={0} left={0} width={width} height={height} zIndex={20} onMouseDown={event => { event.stopPropagation(); onClose() }}>
    <box position="absolute" top={Math.max(0, Math.floor((height - h) / 2))} left={Math.max(0, Math.floor((width - w) / 2))} width={w} height={h} border borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" title={` ${title} `} onMouseDown={event => event.stopPropagation()}>
      <box flexShrink={0} height={1} paddingX={1} backgroundColor={theme.surface2} onMouseDown={onClose}><text fg={theme.cyan}>? / Esc close help</text></box>
      <scrollbox ref={scrollRef} flexGrow={1} minHeight={0} paddingX={1}>
        {groups.map(group => <box key={group.title} flexDirection="column" marginBottom={1} flexShrink={0}>
          <text fg={theme.cyan}>{group.title}</text>
          {group.rows.map(([keys, description]) => <box key={keys} flexDirection="row" flexShrink={0}>
            <box width={Math.min(19, Math.max(10, Math.floor(w * .3)))} flexShrink={0}><text fg={theme.text} wrapMode="word">{keys}</text></box>
            <box flexGrow={1} minWidth={0}><text fg={theme.muted} wrapMode="word">{description}</text></box>
          </box>)}
        </box>)}
      </scrollbox>
      <box height={1} flexShrink={0} paddingX={1}><text fg={theme.dim}>j/k or ↑/↓ scroll</text></box>
    </box>
  </box>
}
