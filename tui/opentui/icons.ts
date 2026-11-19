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
  prompt: '\uf054',
  model: '\uf2db',
  effort: '\uf0e7',
  folder: '\uf07b',
  layout: '\uf00a',
  expand: '\uf065',
  restore: '\uf066',
  detach: '\uf08e',
  dock: '\uf2d2',
  dropdown: '\uf0d7',
  pin: '\uf08d',
  'pin-outline': '\uf006',
  'more': '\uf141',
  sort: '\uf0dc',
  popup: '\uf2d0',
  'powerline-end': '\ue0b0',
  'powerline-start': '\ue0b2',
  'bubble-start': '\ue0b6',
  'bubble-end': '\ue0b4',
} as const

export function tuiIcon(iconSet: ViewIconSet | undefined, name: keyof typeof NERD_FONT_ICONS, fallback: string): string {
  return iconSet === 'nerd-font' || iconSet === 'powerline' ? NERD_FONT_ICONS[name] : fallback
}

const CONTROL_ICONS: Readonly<Partial<Record<string, keyof typeof NERD_FONT_ICONS>>> = {
  '×': 'error', '≡': 'commands', '⊞': 'layout', '⊠': 'layout',
  '↗': 'expand', '⤢': 'expand', '▣': 'expand', '▭': 'restore',
  '⧉': 'detach', '⇥': 'dock', '▾': 'dropdown', '+': 'new-session',
  '★': 'pin', '☆': 'pin-outline', '✓': 'success', '⋯': 'more',
}

/** Only translate a control's leading decoration, leaving its text and key hints intact. */
export function tuiControlLabel(iconSet: ViewIconSet, label: string): string {
  if (iconSet === 'standard') return label
  return label.replace(/^(\s*)(\S)(?=\s|$)/, (prefix, spaces: string, glyph: string) => {
    const name = CONTROL_ICONS[glyph]
    return name ? spaces + tuiIcon(iconSet, name, glyph) : prefix
  })
}
