export type CodeThemeId =
  | 'atom-dark'
  | 'vsc-dark-plus'
  | 'dracula'
  | 'one-dark'
  | 'night-owl'
  | 'nord'
  | 'gruvbox-dark'
  | 'synthwave84'
  | 'material-oceanic'
  | 'one-light'
  | 'gh-colors'

export type CodeTheme = {
  id: CodeThemeId
  label: string
  dark: boolean
}

export const CODE_THEMES: CodeTheme[] = [
  { id: 'atom-dark',        label: 'Atom Dark',        dark: true  },
  { id: 'vsc-dark-plus',    label: 'VS Code Dark+',    dark: true  },
  { id: 'dracula',          label: 'Dracula',          dark: true  },
  { id: 'one-dark',         label: 'One Dark',         dark: true  },
  { id: 'night-owl',        label: 'Night Owl',        dark: true  },
  { id: 'nord',             label: 'Nord',             dark: true  },
  { id: 'gruvbox-dark',     label: 'Gruvbox Dark',     dark: true  },
  { id: 'synthwave84',      label: 'Synthwave 84',     dark: true  },
  { id: 'material-oceanic', label: 'Material Oceanic', dark: true  },
  { id: 'one-light',        label: 'One Light',        dark: false },
  { id: 'gh-colors',        label: 'GitHub',           dark: false },
]

export const DEFAULT_CODE_THEME_ID: CodeThemeId = 'atom-dark'
export const STORAGE_KEY = 'code-theme'
