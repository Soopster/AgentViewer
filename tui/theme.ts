import type { ProviderSelection } from '../lib/types'

export type TuiThemeMode = 'light' | 'dark' | 'cyber'
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
  if (mode === 'dark') return DARK_THEME
  if (mode === 'cyber') return CYBER_THEME
  return LIGHT_THEME
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
