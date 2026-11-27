/** @jsxImportSource @opentui/react */
// TUI entry for the theme picker: loaded the first time the menu opens.
import { useEffect, useRef, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import {
  OMZ_MODES, SectionFrame, THEMES, THEME_DESCRIPTIONS, THEME_GROUPS, THEME_LABELS, filterThemeModes, getThemePalette, isLightThemeMode,
  themeGroupModes, type ThemeMenuGroup,
} from '../../../tui/opentui/shell/sdkThemes'

const groupOf = (mode: string): ThemeMenuGroup => (isLightThemeMode(mode) ? 'light' : OMZ_MODES.includes(mode) ? 'omz' : 'dark')

function ThemePicker({ services, height, registerKeys }: TuiPluginViewProps) {
  const themes = services.themes!
  const origin = themes.origin
  const [group, setGroup] = useState<ThemeMenuGroup>(() => groupOf(origin ?? themes.mode))
  const [query, setQuery] = useState('')
  // Keys arrive faster than renders: the handler reads what is current, not what it closed over.
  const latest = useRef({ themes, group, query })
  latest.current = { themes, group, query }

  // Turning "follow terminal" on moves the theme to the terminal's side; show that side.
  const wasFollowing = useRef(themes.following)
  useEffect(() => {
    if (themes.following && !wasFollowing.current) setGroup(groupOf(themes.mode))
    wasFollowing.current = themes.following
  }, [themes.following, themes.mode])

  useEffect(() => {
    registerKeys((key) => {
      const { themes: service, group: currentGroup, query: currentQuery } = latest.current
      const visible = () => filterThemeModes(themeGroupModes(latest.current.group), latest.current.query)
      if (key.name === 'left' || key.name === 'right') {
        const at = THEME_GROUPS.findIndex((entry) => entry.key === currentGroup)
        const next = THEME_GROUPS[key.name === 'left' ? Math.max(at - 1, 0) : Math.min(at + 1, THEME_GROUPS.length - 1)]!.key
        setGroup(next)
        const inGroup = filterThemeModes(themeGroupModes(next), currentQuery)
        const target = service.origin && inGroup.includes(service.origin) ? service.origin : inGroup[0]
        if (target) service.preview(target)
        return true
      }
      if (key.name === 'up' || key.name === 'down') {
        const inGroup = visible()
        if (!inGroup.length) return true
        const at = inGroup.indexOf(service.mode)
        const next = key.name === 'up' ? Math.max((at < 0 ? 0 : at) - 1, 0) : Math.min((at < 0 ? -1 : at) + 1, inGroup.length - 1)
        const target = inGroup[next]
        if (target) service.preview(target)
        return true
      }
      if (key.name === 'return') {
        const inGroup = visible()
        const target = inGroup.includes(service.mode) ? service.mode : inGroup[0]
        if (target) service.choose(target)
        return true
      }
      if (key.name === 'escape') { service.cancel(); return true }
      if (key.name === 'tab') { service.toggleFollow(); return true }
      if (key.ctrl && key.name === 'b') { service.toggleBorders(); return true }
      // Anything else (typing, ⌃C) is not the menu's: the search field and the host take it.
      return false
    })
    return () => registerKeys(null)
  }, [registerKeys])

  // The menu keeps the origin's palette while it previews, so it does not flicker with each arrow; a light origin gets the dark one so it stays readable.
  const overlayTheme = origin && !isLightThemeMode(origin) ? getThemePalette(origin) : getThemePalette('dark')
  const menuHeight = Math.max(16, Math.min(height - 4, 34))
  const allInGroup = themeGroupModes(group)
  const inGroup = filterThemeModes(allInGroup, query)
  const localIndex = Math.max(inGroup.includes(themes.mode) ? inGroup.indexOf(themes.mode) : 0, 0)
  const options = inGroup.map((mode) => ({ name: THEME_LABELS[mode] + (mode === origin ? ' ✓' : ''), description: THEME_DESCRIPTIONS[mode], value: mode }))
  return (
    <SectionFrame
      theme={overlayTheme}
      position="absolute"
      top={3}
      right={2}
      width={36}
      height={menuHeight}
      border
      borderStyle="single"
      borderColor={overlayTheme.border2}
      backgroundColor={overlayTheme.surface}
      zIndex={20}
      flexDirection="column"
    >
      <box paddingX={2} paddingBottom={1} flexDirection="row">
        {THEME_GROUPS.map((entry, index) => (
          <box key={entry.key} flexDirection="row">
            {index > 0 ? <text fg={overlayTheme.dim} wrapMode="none">  |  </text> : null}
            <text fg={group === entry.key ? overlayTheme.cyan : overlayTheme.muted} wrapMode="none">{entry.label}</text>
          </box>
        ))}
        <text fg={overlayTheme.dim} wrapMode="none">   ← →</text>
      </box>
      <box height={1} paddingX={2} paddingBottom={1} flexDirection="row">
        <text fg={overlayTheme.cyan} wrapMode="none">/ </text>
        <input
          style={{ flexGrow: 1 }}
          focused
          value={query}
          placeholder="Search themes..."
          maxLength={60}
          onInput={(value) => {
            setQuery(value)
            const target = filterThemeModes(allInGroup, value)[0]
            if (target) themes.preview(target)
          }}
          onSubmit={() => {
            const target = inGroup[localIndex] ?? inGroup[0]
            if (target) themes.choose(target)
          }}
        />
      </box>
      <box flexGrow={1} paddingX={1} paddingBottom={1}>
        {inGroup.length === 0 ? (
          <text fg={overlayTheme.dim} wrapMode="none">No matching themes</text>
        ) : (
          <select
            style={{ height: menuHeight - 10 }}
            focused={false}
            options={options}
            selectedIndex={localIndex}
            selectedBackgroundColor={overlayTheme.surface3}
            selectedTextColor={overlayTheme.text}
            textColor={overlayTheme.muted}
            descriptionColor={overlayTheme.dim}
            selectedDescriptionColor={overlayTheme.cyan}
            backgroundColor={overlayTheme.surface}
            focusedBackgroundColor={overlayTheme.surface}
            showScrollIndicator={false}
            showDescription={false}
            itemSpacing={0}
            onChange={(index) => { const next = inGroup[index]; if (next) themes.preview(next) }}
            onSelect={(_, option) => { const next = option?.value as string | undefined; if (next) themes.choose(next) }}
          />
        )}
      </box>
      <box height={1} paddingX={2} flexDirection="row">
        <text fg={overlayTheme.cyan} wrapMode="none">tab </text>
        <text fg={themes.following ? overlayTheme.text : overlayTheme.muted} wrapMode="none">{themes.following ? '● terminal' : '○ terminal'}</text>
        <box flexDirection="row" onMouseDown={(event) => { if (event.button === 0) { event.stopPropagation(); themes.toggleBorders() } }}>
          <text fg={overlayTheme.cyan} wrapMode="none"> · ⌃B </text>
          <text fg={themes.showBorders ? overlayTheme.text : overlayTheme.muted} wrapMode="none">{themes.showBorders ? 'borders ✓' : 'borders'}</text>
        </box>
      </box>
    </SectionFrame>
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'theme-picker',
  views: { 'theme-picker': ThemePicker },
}
