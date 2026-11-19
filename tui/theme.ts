import type { ProviderSelection } from '../lib/types'

/** The themes the host ships (light, dark, and the terminal's own); every other theme is contributed by a plugin (plugins/themes-*). */
export type BuiltinTuiThemeMode = 'terminal-palette' | 'light' | 'dark'

/** A built-in or a plugin-registered theme id. */
export type TuiThemeMode = string

export type TuiDensity = 'comfortable' | 'balanced' | 'dense'
export type TuiTranscriptView = 'conversation' | 'full' | 'continue' | 'stream' | 'agents' | 'chat' | 'transcript' | 'scrollback' | 'codex' | 'claude-code' | 'copilot' | 'opencode' | 'engineering'

export type TuiThemePalette = {
  bg: string
  surface: string
  surface2: string
  surface3: string
  diffAddBg: string
  diffRemoveBg: string
  diffMetaBg: string
  border: string
  border2: string
  text: string
  muted: string
  dim: string
  violet: string
  cyan: string
  green: string
  red: string
  amber: string
  pink: string
  userBg: string
}

function mixHex(from: string, to: string, amount: number): string {
  const channel = (hex: string, offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16)
  const mixed = [1, 3, 5].map((offset) => Math.round(
    channel(from, offset) + (channel(to, offset) - channel(from, offset)) * amount,
  ))
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function swatchTheme(
  bg: string,
  text: string,
  muted: string,
  accent: string,
  warm: string,
  light = false,
): TuiThemePalette {
  return {
    bg,
    surface: mixHex(bg, light ? '#ffffff' : text, light ? 0.5 : 0.04),
    surface2: mixHex(bg, text, light ? 0.05 : 0.08),
    surface3: mixHex(bg, text, light ? 0.1 : 0.14),
    diffAddBg: mixHex(bg, '#2f9e62', light ? 0.1 : 0.2),
    diffRemoveBg: mixHex(bg, '#d14d52', light ? 0.1 : 0.2),
    diffMetaBg: mixHex(bg, accent, light ? 0.1 : 0.18),
    border: mixHex(bg, text, light ? 0.14 : 0.18),
    border2: accent,
    text,
    muted,
    dim: mixHex(bg, muted, light ? 0.58 : 0.68),
    violet: accent,
    cyan: mixHex(accent, text, 0.2),
    green: mixHex(warm, '#2bb673', 0.42),
    red: mixHex(accent, '#ef4444', 0.5),
    amber: warm,
    pink: mixHex(accent, '#ec4899', 0.38),
    userBg: mixHex(bg, accent, light ? 0.12 : 0.24),
  }
}

export const LIGHT_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#ffffff',
  surface2: '#f7f8fb',
  surface3: '#eef2f7',
  diffAddBg: '#e7f7ef',
  diffRemoveBg: '#fdecec',
  diffMetaBg: '#edf2ff',
  border: '#000000',
  border2: '#000000',
  text: '#111827',
  muted: '#4b5a78',
  dim: '#8e9ab8',
  violet: '#6352d4',
  cyan: '#0891b2',
  green: '#059669',
  red: '#dc2626',
  amber: '#b45309',
  pink: '#be185d',
  userBg: '#dbeafe',
} as const

export const DARK_THEME: TuiThemePalette = {
  bg: '#11112b',
  surface: '#1a1a3a',
  surface2: '#24244a',
  surface3: '#2b2b57',
  diffAddBg: '#163428',
  diffRemoveBg: '#43212a',
  diffMetaBg: '#203055',
  border: '#32326a',
  border2: '#5f6aa4',
  text: '#eef2ff',
  muted: '#b7c0e8',
  dim: '#7c86b5',
  violet: '#8b80f0',
  cyan: '#38d9f5',
  green: '#2dd4a0',
  red: '#f05050',
  amber: '#eaaf40',
  pink: '#f472b6',
  userBg: '#1e3a5f',
} as const

export let THEME: TuiThemePalette = LIGHT_THEME

/** The colours a terminal reports for itself: its 16 ANSI slots and its default pair. */
export type TerminalReportedColors = {
  palette: Array<string | null>
  defaultForeground: string | null
  defaultBackground: string | null
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const reported = (value: string | null | undefined) => (value && HEX_COLOR.test(value) ? value.toLowerCase() : null)

function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/**
 * A theme made of the terminal's own colours, so the TUI looks like the rest
 * of the terminal rather than like a theme chosen to match it. The ANSI slots
 * carry the accents (red is slot 1 in every scheme, which is what makes this
 * work at all); the surfaces are mixed from the default pair, because a scheme
 * has no colours for raised panels. A slot the terminal did not report falls
 * back to the built-in theme of the same lightness, and a terminal that
 * reports no background at all has no theme to build: null.
 */
export function terminalPaletteTheme(colors: TerminalReportedColors): TuiThemePalette | null {
  const slot = (index: number) => reported(colors.palette[index])
  const bg = reported(colors.defaultBackground) ?? slot(0)
  if (!bg) return null
  const light = relativeLuminance(bg) > 0.4
  const base = light ? LIGHT_THEME : DARK_THEME
  const text = reported(colors.defaultForeground) ?? slot(light ? 0 : 15) ?? base.text
  const accent = slot(4) ?? base.violet
  const theme = swatchTheme(bg, text, mixHex(text, bg, 0.35), accent, slot(3) ?? base.amber, light)
  return {
    ...theme,
    red: slot(1) ?? base.red,
    green: slot(2) ?? base.green,
    violet: slot(5) ?? base.violet,
    cyan: slot(6) ?? base.cyan,
    pink: slot(13) ?? slot(5) ?? base.pink,
  }
}

let terminalTheme: TuiThemePalette | null = null

/** Installs what the terminal reported; null until it has answered. */
export function setTerminalPaletteTheme(theme: TuiThemePalette | null): void {
  terminalTheme = theme
}

export function isTerminalPaletteLight(): boolean {
  return terminalTheme !== null && relativeLuminance(terminalTheme.bg) > 0.4
}

const pluginPalettes = new Map<string, { palette: TuiThemePalette }>()
/** The registry that owns plugin themes is tui/opentui/app/themes.ts; this holds only the palettes getThemePalette resolves. */
export function setPluginPalette(id: string, palette: TuiThemePalette | null): void {
  if (palette) pluginPalettes.set(id, { palette })
  else pluginPalettes.delete(id)
}
/** The full palette every generated theme derives from five swatches. */
export function paletteFromSwatches(bg: string, text: string, muted: string, accent: string, warm: string, light: boolean): TuiThemePalette {
  return swatchTheme(bg, text, muted, accent, warm, light)
}

export function getThemePalette(mode: TuiThemeMode): TuiThemePalette {
  switch (mode) {
    // Until the terminal answers there is nothing of its own to show.
    case 'terminal-palette': return terminalTheme ?? DARK_THEME
    case 'dark': return DARK_THEME
    case 'light': return LIGHT_THEME
    // A plugin's theme, or the light default while its plugin is off or has not loaded yet.
    default: return pluginPalettes.get(mode)?.palette ?? LIGHT_THEME
  }
}

export function setActiveTheme(mode: TuiThemeMode): void {
  THEME = getThemePalette(mode)
}

function providerAccents(theme: TuiThemePalette): Partial<Record<ProviderSelection, string>> {
  return {
    claude: theme.amber,
    codex: theme.cyan,
    opencode: theme.green,
    copilot: theme.violet,
    pi: theme.pink,
    lmstudio: theme.red,
    'claude-acp': theme.amber,
    'codex-acp': theme.cyan,
    acp: theme.green,
    all: theme.green,
  }
}

export function getProviderAccent(provider: ProviderSelection): string {
  return providerAccents(THEME)[provider] ?? THEME.violet
}
