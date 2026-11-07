/** @jsxImportSource @opentui/react */
import React from 'react'
import { TextAttributes } from '@opentui/core'
import type { TuiDensity, TuiThemePalette } from '../../theme'
import { fitText } from '../textLayout'
import { mixHexColor } from './transcriptStyle'

export function sidebarActionRows(density: TuiDensity): number {
  return density === 'comfortable' ? 5 : density === 'balanced' ? 3 : 1
}

/** Shared navigation chrome for the standard and Engineering session rails. */
export function SidebarNewSession({ theme, width, density, onPress }: {
  theme: TuiThemePalette; width: number; density: TuiDensity; onPress: () => void
}) {
  return <box height={sidebarActionRows(density)} flexShrink={0} paddingX={1} paddingY={density === 'dense' ? 0 : 1}>
    <box id="sidebar-new-session" height={density === 'comfortable' ? 3 : 1} width={Math.min(22, width - 4)} paddingX={2} paddingY={density === 'comfortable' ? 1 : 0}
      backgroundColor={mixHexColor(theme.cyan, theme.surface, 0.2) ?? theme.surface3}
      onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); onPress() } }}>
      <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none" selectable={false}>{fitText('+ New session', Math.min(18, width - 8))}</text>
    </box>
  </box>
}

export function SidebarHeading({ theme, width, text, prefixWidth, badge, accent, onPress }: {
  theme: TuiThemePalette; width: number; text: string; prefixWidth: number; badge: string; accent: string; onPress?: () => void
}) {
  return <box position="absolute" top={-1} left={1} width={Math.min(text.trimEnd().length + 2, width - 4)} height={1} paddingX={1}
    flexDirection="row" backgroundColor={theme.surface} overflow="hidden"
    onMouseDown={event => { if (event.button === 0 && onPress) { event.stopPropagation(); onPress() } }}>
    <text fg={theme.cyan} bg={theme.surface} wrapMode="none">{text.trimEnd()}</text>
    <box id="sidebar-provider-badge" position="absolute" top={0} left={prefixWidth + 1} width={badge.length} minWidth={badge.length} maxWidth={badge.length} height={1} overflow="hidden" backgroundColor={accent}>
      <text width={badge.length} minWidth={badge.length} maxWidth={badge.length} fg={theme.bg} attributes={TextAttributes.BOLD} wrapMode="none">{badge}</text>
    </box>
  </box>
}

export function SidebarGroupHeading({ id, label, count, width, dateGroup, disclosure, first, selected = false, density, theme, onPress }: {
  id: string; label: string; count: number; width: number; dateGroup?: boolean; disclosure: string; first: boolean; selected?: boolean
  density: TuiDensity; theme: TuiThemePalette; onPress?: () => void
}) {
  const countLabel = `${count}`
  const headingWidth = Math.max(width - (dateGroup ? 3 : 2), 1)
  return <box id={id} paddingX={1} paddingLeft={dateGroup ? 2 : 1} marginTop={density === 'dense' || first ? 0 : 1}
    flexDirection="row" height={1} flexShrink={0} backgroundColor={selected ? theme.surface3 : theme.surface}
    onMouseDown={event => { if (event.button === 0 && onPress) { event.stopPropagation(); onPress() } }}>
    <text fg={selected ? theme.text : dateGroup ? theme.dim : theme.muted} attributes={dateGroup ? undefined : TextAttributes.BOLD} wrapMode="none" selectable={false}>
      {fitText(`${disclosure}${label}`, Math.max(headingWidth - countLabel.length - 1, 1))}
    </text>
    <text fg={theme.dim} wrapMode="none" selectable={false}>{` ${countLabel}`}</text>
  </box>
}
