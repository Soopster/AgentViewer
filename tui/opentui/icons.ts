import type { ViewIconSet } from '../viewSpec'

// Nerd Fonts v3. Keep these BMP glyphs single-cell in both OpenTUI width modes.
export const NERD_FONT_ICONS = {
  repository: '\uf126',
  session: '\uf075',
  'new-session': '\uf067',
  files: '\uf07c',
  processes: '\uf120',
  'index-search': '\uf002',
  editor: '\uf044',
  'pull-requests': '\uea64',
  github: '\uf09b',
  checkpoints: '\uf017',
  analytics: '\uf080',
  attention: '\uf071',
  commands: '\uf0c9',
  waiting: '\uf252',
  updated: '\uf021',
  success: '\uf00c',
  error: '\uf00d',
  system: '\uf05a',
  'powerline-end': '\ue0b0',
} as const

export function tuiIcon(iconSet: ViewIconSet | undefined, name: keyof typeof NERD_FONT_ICONS, fallback: string): string {
  return iconSet === 'nerd-font' || iconSet === 'powerline' ? NERD_FONT_ICONS[name] : fallback
}
