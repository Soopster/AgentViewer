/** @jsxImportSource @opentui/react */
import React from 'react'
import { getThemePalette, type TuiThemeMode } from '../../../theme'
import { type ThemeMenuGroup, THEMES, isLightThemeMode, THEME_GROUPS, filterThemeModes, themeGroupModes, THEME_LABELS, THEME_DESCRIPTIONS } from '../themes'
import { SectionFrame } from '../borders'

export function ThemeMenuOverlay({ themeMenuOpen, themeMenuOriginRef, height, themeMenuGroup, themeMenuQuery, themeMenuIndex, focusMode, setThemeMenuQuery, setThemeMenuIndex, setThemeMode, chooseTheme, themeFollowsTerminal, showBorders, toggleBorders }: {
  themeMenuOpen: boolean
  themeMenuOriginRef: React.RefObject<TuiThemeMode | null>
  height: number
  themeMenuGroup: ThemeMenuGroup
  themeMenuQuery: string
  themeMenuIndex: number
  focusMode: boolean
  setThemeMenuQuery: React.Dispatch<React.SetStateAction<string>>
  setThemeMenuIndex: React.Dispatch<React.SetStateAction<number>>
  setThemeMode: React.Dispatch<React.SetStateAction<TuiThemeMode>>
  chooseTheme: (nextTheme: TuiThemeMode) => void
  themeFollowsTerminal: boolean
  showBorders: boolean
  toggleBorders: () => void
}) {
  return (
    themeMenuOpen ? (() => {
          const originTheme = themeMenuOriginRef.current
          // Use the origin palette when it's dark; fall back to 'dark' when the
          // origin is a light theme so the overlay is always readable.
          const overlayTheme = originTheme && !isLightThemeMode(originTheme)
            ? getThemePalette(originTheme)
            : getThemePalette('dark')
          const menuHeight = Math.max(15, Math.min(height - 4, 33))
          const allGroupThemes = themeGroupModes(themeMenuGroup)
          const groupThemes = filterThemeModes(allGroupThemes, themeMenuQuery)
          const currentTheme = THEMES[themeMenuIndex]
          const localIndex = Math.max(
            currentTheme && groupThemes.includes(currentTheme) ? groupThemes.indexOf(currentTheme) : 0,
            0,
          )
          const groupOptions = groupThemes.map((mode) => ({
            name: THEME_LABELS[mode] + (mode === originTheme ? ' ✓' : ''),
            description: THEME_DESCRIPTIONS[mode],
            value: mode,
          }))
          return (
            <SectionFrame
              theme={overlayTheme}
              position="absolute"
              top={focusMode ? 1 : 3}
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
                {THEME_GROUPS.map((group, i) => (
                  <React.Fragment key={group.key}>
                    {i > 0 ? <text fg={overlayTheme.dim} wrapMode="none">  |  </text> : null}
                    <text fg={themeMenuGroup === group.key ? overlayTheme.cyan : overlayTheme.muted} wrapMode="none">{group.label}</text>
                  </React.Fragment>
                ))}
                <text fg={overlayTheme.dim} wrapMode="none">   ← →</text>
              </box>
              <box height={1} paddingX={2} paddingBottom={1} flexDirection="row">
                <text fg={overlayTheme.cyan} wrapMode="none">/ </text>
                <input
                  style={{ flexGrow: 1 }}
                  focused
                  value={themeMenuQuery}
                  placeholder="Search themes..."
                  maxLength={60}
                  onInput={(value) => {
                    setThemeMenuQuery(value)
                    const nextGroupThemes = filterThemeModes(allGroupThemes, value)
                    const target = nextGroupThemes[0]
                    if (target) {
                      setThemeMenuIndex(THEMES.indexOf(target))
                      setThemeMode(target)
                    }
                  }}
                  onSubmit={() => {
                    const target = groupThemes[localIndex] ?? groupThemes[0]
                    if (target) chooseTheme(target)
                  }}
                />
              </box>
              <box flexGrow={1} paddingX={1} paddingBottom={1}>
                {groupThemes.length === 0 ? (
                  <text fg={overlayTheme.dim} wrapMode="none">No matching themes</text>
                ) : (
                  <select
                    style={{ height: menuHeight - 9 }}
                    focused={false}
                    options={groupOptions}
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
                    onChange={(index) => {
                      const next = groupThemes[index]
                      if (next) {
                        setThemeMenuIndex(THEMES.indexOf(next))
                        setThemeMode(next)
                      }
                    }}
                    onSelect={(_, option) => {
                      const next = option?.value as TuiThemeMode | undefined
                      if (next) chooseTheme(next)
                    }}
                  />
                )}
              </box>
              <box height={1} paddingX={2} flexDirection="row">
                <text fg={overlayTheme.cyan} wrapMode="none">tab </text>
                <text fg={themeFollowsTerminal ? overlayTheme.text : overlayTheme.muted} wrapMode="none">
                  {themeFollowsTerminal ? '● terminal' : '○ terminal'}
                </text>
                <box flexDirection="row" onMouseDown={(event) => { if (event.button === 0) { event.stopPropagation(); toggleBorders() } }}>
                  <text fg={overlayTheme.cyan} wrapMode="none"> · ⌃B </text>
                  <text fg={showBorders ? overlayTheme.text : overlayTheme.muted} wrapMode="none">
                    {showBorders ? 'borders ✓' : 'borders'}
                  </text>
                </box>
              </box>
            </SectionFrame>
          )
        })() : null
  )
}
