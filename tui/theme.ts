import type { ProviderSelection } from '../lib/types'

export type TuiThemeMode = 'light' | 'dark'

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
}

export const LIGHT_THEME: TuiThemePalette = {
  bg: '#f0f2fa',
  surface: '#ffffff',
  surface2: '#eaeef8',
  surface3: '#e2e8f4',
  diffAddBg: '#e7f7ef',
  diffRemoveBg: '#fdecec',
  diffMetaBg: '#edf2ff',
  border: '#cdd6ea',
  border2: '#aab8d4',
  text: '#111827',
  muted: '#4b5a78',
  dim: '#8e9ab8',
  violet: '#6352d4',
  cyan: '#0891b2',
  green: '#059669',
  red: '#dc2626',
  amber: '#b45309',
  pink: '#be185d',
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
} as const

export let THEME: TuiThemePalette = LIGHT_THEME

export function getThemePalette(mode: TuiThemeMode): TuiThemePalette {
  return mode === 'dark' ? DARK_THEME : LIGHT_THEME
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
