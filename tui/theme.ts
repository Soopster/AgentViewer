import type { ProviderSelection } from '../lib/types'

export type TuiThemeMode =
  | 'light'
  | 'paper'
  | 'solarized-light'
  | 'dark'
  | 'solarized-dark'
  | 'nord'
  | 'cyber'
export type TuiDensity = 'comfortable' | 'balanced' | 'dense'
export type TuiTranscriptView = 'conversation' | 'full'

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

export const PAPER_THEME: TuiThemePalette = {
  bg: '#fafafa',
  surface: '#ffffff',
  surface2: '#f2f2f2',
  surface3: '#e6e6e6',
  diffAddBg: '#e8f5ec',
  diffRemoveBg: '#fbeaea',
  diffMetaBg: '#eef2fa',
  border: '#c7c7c7',
  border2: '#1c1c1c',
  text: '#1a1a1a',
  muted: '#555555',
  dim: '#8a8a8a',
  violet: '#6d28d9',
  cyan: '#0e7490',
  green: '#166534',
  red: '#b91c1c',
  amber: '#92400e',
  pink: '#9d174d',
  userBg: '#e5e7eb',
} as const

export const SOLARIZED_LIGHT_THEME: TuiThemePalette = {
  bg: '#fdf6e3',
  surface: '#fdf6e3',
  surface2: '#eee8d5',
  surface3: '#e3dcc4',
  diffAddBg: '#e8efcf',
  diffRemoveBg: '#f5d9d4',
  diffMetaBg: '#e1e6d8',
  border: '#93a1a1',
  border2: '#586e75',
  text: '#073642',
  muted: '#586e75',
  dim: '#93a1a1',
  violet: '#6c71c4',
  cyan: '#2aa198',
  green: '#859900',
  red: '#dc322f',
  amber: '#b58900',
  pink: '#d33682',
  userBg: '#e1ecc8',
} as const

export const SOLARIZED_DARK_THEME: TuiThemePalette = {
  bg: '#002b36',
  surface: '#073642',
  surface2: '#0e4550',
  surface3: '#125460',
  diffAddBg: '#113c2a',
  diffRemoveBg: '#4a1e21',
  diffMetaBg: '#10394a',
  border: '#586e75',
  border2: '#93a1a1',
  text: '#eee8d5',
  muted: '#93a1a1',
  dim: '#657b83',
  violet: '#6c71c4',
  cyan: '#2aa198',
  green: '#859900',
  red: '#dc322f',
  amber: '#b58900',
  pink: '#d33682',
  userBg: '#0b4a58',
} as const

export const NORD_THEME: TuiThemePalette = {
  bg: '#2e3440',
  surface: '#3b4252',
  surface2: '#434c5e',
  surface3: '#4c566a',
  diffAddBg: '#2f4739',
  diffRemoveBg: '#4b353c',
  diffMetaBg: '#3e4a60',
  border: '#4c566a',
  border2: '#88c0d0',
  text: '#eceff4',
  muted: '#d8dee9',
  dim: '#7b869e',
  violet: '#b48ead',
  cyan: '#88c0d0',
  green: '#a3be8c',
  red: '#bf616a',
  amber: '#ebcb8b',
  pink: '#b48ead',
  userBg: '#3b506b',
} as const

export const CYBER_THEME: TuiThemePalette = {
  bg: '#191532',
  surface: '#211c43',
  surface2: '#2a2550',
  surface3: '#352f63',
  diffAddBg: '#183c2c',
  diffRemoveBg: '#4a2030',
  diffMetaBg: '#2a2550',
  border: '#5d4f81',
  border2: '#ffb454',
  text: '#f4ead5',
  muted: '#d0c3a8',
  dim: '#9f95bd',
  violet: '#c792ea',
  cyan: '#7dcfff',
  green: '#a6e22e',
  red: '#ff6b81',
  amber: '#ffb454',
  pink: '#ff8ad6',
  userBg: '#1a2f60',
} as const

export let THEME: TuiThemePalette = LIGHT_THEME

export function getThemePalette(mode: TuiThemeMode): TuiThemePalette {
  switch (mode) {
    case 'dark': return DARK_THEME
    case 'cyber': return CYBER_THEME
    case 'paper': return PAPER_THEME
    case 'solarized-light': return SOLARIZED_LIGHT_THEME
    case 'solarized-dark': return SOLARIZED_DARK_THEME
    case 'nord': return NORD_THEME
    default: return LIGHT_THEME
  }
}

export function setActiveTheme(mode: TuiThemeMode): void {
  THEME = getThemePalette(mode)
}

function providerAccents(theme: TuiThemePalette): Record<ProviderSelection, string> {
  return {
    claude: theme.amber,
    codex: theme.cyan,
    opencode: theme.green,
    copilot: theme.violet,
    pi: theme.pink,
    all: theme.green,
  }
}

export function getProviderAccent(provider: ProviderSelection): string {
  return providerAccents(THEME)[provider] ?? THEME.violet
}
