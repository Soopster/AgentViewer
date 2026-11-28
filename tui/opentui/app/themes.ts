import type { PluginTuiTheme } from '../../../lib/plugins/types'
import { type TuiThemeMode, type TuiThemePalette, isTerminalPaletteLight, paletteFromSwatches, setPluginPalette } from '../../theme'

// The host ships three themes: light, dark and the terminal's own colours.
// Every other theme comes from a plugin (plugins/themes-*), registered below
// into these same lists, which are mutated in place so importers see them.
const LIGHT_MODES: TuiThemeMode[] = ['light']
const DARK_MODES: TuiThemeMode[] = ['dark']
export const OMZ_MODES: TuiThemeMode[] = []
// The terminal's own colours are light or dark depending on the terminal, so
// that theme belongs to no fixed group: it heads whichever side it is on.
export const TERMINAL_PALETTE_MODE: TuiThemeMode = 'terminal-palette'
export const THEMES: TuiThemeMode[] = [TERMINAL_PALETTE_MODE, ...LIGHT_MODES, ...DARK_MODES, ...OMZ_MODES]
export type ThemeMenuGroup = 'light' | 'dark' | 'omz'
export const THEME_GROUPS: Array<{ key: ThemeMenuGroup; label: string; themes: TuiThemeMode[]} > = [
  { key: 'light', label: 'LIGHT', themes: LIGHT_MODES },
  { key: 'dark', label: 'DARK', themes: DARK_MODES },
  { key: 'omz', label: 'OMZ', themes: OMZ_MODES },
]
export function isLightThemeMode(mode: TuiThemeMode): boolean {
  return mode === TERMINAL_PALETTE_MODE ? isTerminalPaletteLight() : LIGHT_MODES.includes(mode)
}
export function themeGroupModes(group: ThemeMenuGroup): TuiThemeMode[] {
  const themes = THEME_GROUPS.find((g) => g.key === group)?.themes ?? DARK_MODES
  return group === (isTerminalPaletteLight() ? 'light' : 'dark') ? [TERMINAL_PALETTE_MODE, ...themes] : themes
}
export function filterThemeModes(modes: TuiThemeMode[], query: string): TuiThemeMode[] {
  const q = query.trim().toLowerCase()
  if (!q) return modes
  return modes.filter((mode) => (THEME_LABELS[mode] ?? mode).toLowerCase().includes(q) || mode.toLowerCase().includes(q))
}
export const THEME_DESCRIPTIONS: Record<TuiThemeMode, string> = {
  'terminal-palette': "Your terminal's own colours",
  light: 'Crisp white background',
  dark: 'Deep navy background',
}
export const THEME_LABELS: Record<TuiThemeMode, string> = {
  'terminal-palette': 'TERMINAL',
  light: 'LIGHT',
  dark: 'DARK',
}

export type TuiPluginThemeSpec = {
  readonly id: string
  readonly label: string
  readonly category: 'dark' | 'light'
  /** The menu label; defaults to `label` in capitals. */
  readonly menuLabel?: string
} & Omit<PluginTuiTheme, 'label'>

const BUILTIN_THEME_IDS: ReadonlySet<string> = new Set(THEMES)
const PALETTE_KEYS = 19
const PLUGIN_THEME_ID = /^[a-z0-9][a-z0-9_+-]{0,99}$/
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const pluginThemeListeners = new Set<() => void>()
export function isPluginThemeId(value: unknown): value is string { return typeof value === 'string' && PLUGIN_THEME_ID.test(value) && !BUILTIN_THEME_IDS.has(value) }
export function subscribePluginThemes(listener: () => void): () => void { pluginThemeListeners.add(listener); return () => { pluginThemeListeners.delete(listener) } }
export function isRegisteredPluginTheme(id: string): boolean { return THEMES.includes(id) && !BUILTIN_THEME_IDS.has(id) }

/**
 * Menu order is by label within each group, never by registration order: which
 * plugin loaded first (or whether one was toggled) must not reshuffle the menu.
 * The lists are sorted in place, and THEMES is rebuilt to match the menu.
 */
function sortThemeMenus(): void {
  const byLabel = (a: string, b: string) => (THEME_LABELS[a] ?? a).localeCompare(THEME_LABELS[b] ?? b) || a.localeCompare(b)
  for (const list of [LIGHT_MODES, DARK_MODES, OMZ_MODES]) list.sort(byLabel)
  THEMES.splice(0, THEMES.length, TERMINAL_PALETTE_MODE, ...LIGHT_MODES, ...DARK_MODES, ...OMZ_MODES)
}

/**
 * Registers a plugin's TUI theme into the menus and palette lookup. The lists
 * are mutated in place so every importer sees the change. Returns the unregister
 * function; refuses built-in ids and anything but #rrggbb swatches.
 */
export function registerTuiPluginTheme(spec: TuiPluginThemeSpec): () => void {
  if (!PLUGIN_THEME_ID.test(spec.id)) throw new Error(`Invalid theme id "${spec.id}"`)
  if (BUILTIN_THEME_IDS.has(spec.id)) throw new Error(`Theme "${spec.id}" is built in and cannot be replaced`)
  let palette: TuiThemePalette
  if (spec.palette) {
    const colors = Object.values(spec.palette)
    if (colors.length !== PALETTE_KEYS || !colors.every(color => HEX_COLOR.test(color))) throw new Error(`Theme "${spec.id}" palette must give ${PALETTE_KEYS} #rrggbb colours`)
    palette = spec.palette
  } else if (spec.swatch) {
    const { bg, text, muted, accent, warm } = spec.swatch
    if (![bg, text, muted, accent, warm].every(color => HEX_COLOR.test(color))) throw new Error(`Theme "${spec.id}" swatches must be #rrggbb`)
    palette = paletteFromSwatches(bg, text, muted, accent, warm, spec.category === 'light')
  } else throw new Error(`Theme "${spec.id}" needs a palette or swatches`)
  setPluginPalette(spec.id, palette)
  THEME_LABELS[spec.id] = spec.menuLabel ?? spec.label.toUpperCase()
  THEME_DESCRIPTIONS[spec.id] = spec.description ?? `Plugin theme · ${spec.label}`
  const known = THEMES.includes(spec.id)
  const modes = spec.menu === 'omz' ? OMZ_MODES : spec.category === 'light' ? LIGHT_MODES : DARK_MODES
  if (!known) modes.push(spec.id)
  sortThemeMenus()
  for (const listener of pluginThemeListeners) listener()
  return () => unregisterTuiPluginTheme(spec.id)
}

export function unregisterTuiPluginTheme(id: string): void {
  if (BUILTIN_THEME_IDS.has(id) || !THEMES.includes(id)) return
  setPluginPalette(id, null)
  delete THEME_LABELS[id]
  delete THEME_DESCRIPTIONS[id]
  for (const list of [LIGHT_MODES, DARK_MODES, OMZ_MODES]) { const at = list.indexOf(id); if (at >= 0) list.splice(at, 1) }
  sortThemeMenus()
  for (const listener of pluginThemeListeners) listener()
}
