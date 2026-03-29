import type { CSSProperties } from 'react'
import atomDark from 'react-syntax-highlighter/dist/esm/styles/prism/atom-dark'
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus'
import dracula from 'react-syntax-highlighter/dist/esm/styles/prism/dracula'
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark'
import nightOwl from 'react-syntax-highlighter/dist/esm/styles/prism/night-owl'
import nord from 'react-syntax-highlighter/dist/esm/styles/prism/nord'
import gruvboxDark from 'react-syntax-highlighter/dist/esm/styles/prism/gruvbox-dark'
import synthwave84 from 'react-syntax-highlighter/dist/esm/styles/prism/synthwave84'
import materialOceanic from 'react-syntax-highlighter/dist/esm/styles/prism/material-oceanic'
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'
import ghColors from 'react-syntax-highlighter/dist/esm/styles/prism/ghcolors'

export type CodeThemeStyle = Record<string, CSSProperties>

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
  style: CodeThemeStyle
  dark: boolean
}

export const CODE_THEMES: CodeTheme[] = [
  { id: 'atom-dark',        label: 'Atom Dark',        style: atomDark,        dark: true  },
  { id: 'vsc-dark-plus',    label: 'VS Code Dark+',    style: vscDarkPlus,     dark: true  },
  { id: 'dracula',          label: 'Dracula',          style: dracula,         dark: true  },
  { id: 'one-dark',         label: 'One Dark',         style: oneDark,         dark: true  },
  { id: 'night-owl',        label: 'Night Owl',        style: nightOwl,        dark: true  },
  { id: 'nord',             label: 'Nord',             style: nord,            dark: true  },
  { id: 'gruvbox-dark',     label: 'Gruvbox Dark',     style: gruvboxDark,     dark: true  },
  { id: 'synthwave84',      label: 'Synthwave 84',     style: synthwave84,     dark: true  },
  { id: 'material-oceanic', label: 'Material Oceanic', style: materialOceanic, dark: true  },
  { id: 'one-light',        label: 'One Light',        style: oneLight,        dark: false },
  { id: 'gh-colors',        label: 'GitHub',           style: ghColors,        dark: false },
]

export const DEFAULT_CODE_THEME_ID: CodeThemeId = 'atom-dark'
export const STORAGE_KEY = 'code-theme'
