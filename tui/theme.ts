import type { ProviderSelection } from '../lib/types'

export type TuiThemeMode =
  | 'light'
  | 'paper'
  | 'solarized-light'
  | 'github-light'
  | 'gruvbox-light'
  | 'catppuccin-latte'
  | 'rose-pine-dawn'
  | 'ayu-light'
  | 'one-light'
  | 'everforest-light'
  | 'tokyo-night-day'
  | 'quiet-light'
  | 'horizon-light'
  | 'flexoki-light'
  | 'nord-light'
  | 'vitesse-light'
  | 'iceberg-light'
  | 'material-lighter'
  | 'min-light'
  | 'alabaster'
  | 'light-owl'
  | 'papercolor-light'
  | 'tomorrow'
  | 'imessage'
  | 'dark'
  | 'solarized-dark'
  | 'nord'
  | 'gruvbox-dark'
  | 'dracula'
  | 'tokyo-night'
  | 'catppuccin-mocha'
  | 'one-dark'
  | 'monokai'
  | 'kanagawa'
  | 'everforest-dark'
  | 'obsidian'
  | 'github-dark'
  | 'ayu-dark'
  | 'rose-pine'
  | 'synthwave'
  | 'palenight'
  | 'night-owl'
  | 'flexoki-dark'
  | 'cobalt'
  | 'vitesse-dark'
  | 'iceberg'
  | 'zenburn'
  | 'material-darker'
  | 'claude-code'
  | 'oceanic-next'
  | 'papercolor-dark'
  | 'snazzy'
  | 'tomorrow-night'
  | 'ethereal'
  | 'hackerman'
  | 'lumon'
  | 'matte-black'
  | 'miasma'
  | 'osaka-jade'
  | 'retro-82'
  | 'ristretto'
  | 'vantablack'
  | 'white'
  | 'stripe'
  | 'claude-cream'
  | 'supabase'
  | 'posthog'
  | 'replicate'
  | 'notion'
  | 'figma'
  | 'miro'
  | 'apple'
  | 'nike'
  | 'pinterest'
  | 'playstation'
  | 'nvidia'
  | 'mongodb'
  | 'slack'
  | 'slack-dark'
  | 'cohere'
  | 'mistral'
  | 'cursor'
  | 'airbnb'
  | 'intercom'
  | 'linear'
  | 'sentry'
  | 'raycast'
  | 'framer'
  | 'ferrari'
  | 'resend'
  | 'cyber'
export type TuiDensity = 'comfortable' | 'balanced' | 'dense'
export type TuiTranscriptView = 'conversation' | 'full' | 'continue' | 'stream' | 'agents'

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

export const GITHUB_LIGHT_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#ffffff',
  surface2: '#f6f8fa',
  surface3: '#eaeef2',
  diffAddBg: '#dafbe1',
  diffRemoveBg: '#ffebe9',
  diffMetaBg: '#ddf4ff',
  border: '#d0d7de',
  border2: '#1f2328',
  text: '#1f2328',
  muted: '#57606a',
  dim: '#8c959f',
  violet: '#8250df',
  cyan: '#0969da',
  green: '#1a7f37',
  red: '#cf222e',
  amber: '#9a6700',
  pink: '#bf3989',
  userBg: '#ddf4ff',
} as const

export const GRUVBOX_LIGHT_THEME: TuiThemePalette = {
  bg: '#fbf1c7',
  surface: '#f9f5d7',
  surface2: '#ebdbb2',
  surface3: '#d5c4a1',
  diffAddBg: '#d8e4bc',
  diffRemoveBg: '#f1cdc4',
  diffMetaBg: '#d8e1cf',
  border: '#bdae93',
  border2: '#3c3836',
  text: '#3c3836',
  muted: '#665c54',
  dim: '#928374',
  violet: '#8f3f71',
  cyan: '#427b58',
  green: '#79740e',
  red: '#9d0006',
  amber: '#b57614',
  pink: '#d3869b',
  userBg: '#ebdbb2',
} as const

export const GRUVBOX_DARK_THEME: TuiThemePalette = {
  bg: '#282828',
  surface: '#32302f',
  surface2: '#3c3836',
  surface3: '#504945',
  diffAddBg: '#3a4a1e',
  diffRemoveBg: '#5a2626',
  diffMetaBg: '#2f3f57',
  border: '#504945',
  border2: '#a89984',
  text: '#ebdbb2',
  muted: '#d5c4a1',
  dim: '#928374',
  violet: '#d3869b',
  cyan: '#8ec07c',
  green: '#b8bb26',
  red: '#fb4934',
  amber: '#fabd2f',
  pink: '#d3869b',
  userBg: '#3c4758',
} as const

export const DRACULA_THEME: TuiThemePalette = {
  bg: '#282a36',
  surface: '#343746',
  surface2: '#3f4254',
  surface3: '#4b4d5e',
  diffAddBg: '#254a34',
  diffRemoveBg: '#5a2633',
  diffMetaBg: '#2c3459',
  border: '#44475a',
  border2: '#bd93f9',
  text: '#f8f8f2',
  muted: '#c4c6d6',
  dim: '#6272a4',
  violet: '#bd93f9',
  cyan: '#8be9fd',
  green: '#50fa7b',
  red: '#ff5555',
  amber: '#ffb86c',
  pink: '#ff79c6',
  userBg: '#44475a',
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

export const CATPPUCCIN_LATTE_THEME: TuiThemePalette = {
  bg: '#eff1f5',
  surface: '#e6e9ef',
  surface2: '#dce0e8',
  surface3: '#ccd0da',
  diffAddBg: '#dbe9d4',
  diffRemoveBg: '#f3d5d4',
  diffMetaBg: '#d6e0f5',
  border: '#bcc0cc',
  border2: '#4c4f69',
  text: '#4c4f69',
  muted: '#6c6f85',
  dim: '#9ca0b0',
  violet: '#8839ef',
  cyan: '#209fb5',
  green: '#40a02b',
  red: '#d20f39',
  amber: '#df8e1d',
  pink: '#ea76cb',
  userBg: '#bcc0cc',
} as const

export const ROSE_PINE_DAWN_THEME: TuiThemePalette = {
  bg: '#faf4ed',
  surface: '#fffaf3',
  surface2: '#f2e9e1',
  surface3: '#dfdad9',
  diffAddBg: '#e5ecd7',
  diffRemoveBg: '#f5d9d4',
  diffMetaBg: '#e1e3ee',
  border: '#cecacd',
  border2: '#575279',
  text: '#575279',
  muted: '#797593',
  dim: '#9893a5',
  violet: '#907aa9',
  cyan: '#56949f',
  green: '#286983',
  red: '#b4637a',
  amber: '#ea9d34',
  pink: '#d7827e',
  userBg: '#dfdad9',
} as const

export const TOKYO_NIGHT_THEME: TuiThemePalette = {
  bg: '#1a1b26',
  surface: '#24283b',
  surface2: '#2f334d',
  surface3: '#414868',
  diffAddBg: '#273c39',
  diffRemoveBg: '#462a3a',
  diffMetaBg: '#283457',
  border: '#414868',
  border2: '#7aa2f7',
  text: '#c0caf5',
  muted: '#a9b1d6',
  dim: '#565f89',
  violet: '#bb9af7',
  cyan: '#7dcfff',
  green: '#9ece6a',
  red: '#f7768e',
  amber: '#e0af68',
  pink: '#ff9e64',
  userBg: '#283457',
} as const

export const CATPPUCCIN_MOCHA_THEME: TuiThemePalette = {
  bg: '#1e1e2e',
  surface: '#262638',
  surface2: '#313244',
  surface3: '#45475a',
  diffAddBg: '#2d4332',
  diffRemoveBg: '#4b2d38',
  diffMetaBg: '#2c3159',
  border: '#45475a',
  border2: '#cba6f7',
  text: '#cdd6f4',
  muted: '#bac2de',
  dim: '#6c7086',
  violet: '#cba6f7',
  cyan: '#89dceb',
  green: '#a6e3a1',
  red: '#f38ba8',
  amber: '#f9e2af',
  pink: '#f5c2e7',
  userBg: '#313244',
} as const

export const OBSIDIAN_THEME: TuiThemePalette = {
  bg: '#000000',
  surface: '#0a0a0a',
  surface2: '#141414',
  surface3: '#1f1f1f',
  diffAddBg: '#0e2a1a',
  diffRemoveBg: '#2c0f15',
  diffMetaBg: '#101a2a',
  border: '#2b2b2b',
  border2: '#454545',
  text: '#e6e6e6',
  muted: '#9a9a9a',
  dim: '#6b6b6b',
  violet: '#a78bfa',
  cyan: '#67e8f9',
  green: '#4ade80',
  red: '#f87171',
  amber: '#fbbf24',
  pink: '#f472b6',
  userBg: '#111111',
} as const

export const IMESSAGE_THEME: TuiThemePalette = {
  bg: '#f2f2f7',
  surface: '#ffffff',
  surface2: '#f2f2f7',
  surface3: '#e5e5ea',
  diffAddBg: '#e4f7e8',
  diffRemoveBg: '#ffe3e0',
  diffMetaBg: '#e5edff',
  border: '#c7c7cc',
  border2: '#1c1c1e',
  text: '#1c1c1e',
  muted: '#48484a',
  dim: '#8e8e93',
  violet: '#007aff',
  cyan: '#34c759',
  green: '#34c759',
  red: '#ff3b30',
  amber: '#ff9500',
  pink: '#ff2d55',
  userBg: '#007aff',
} as const

export const AYU_LIGHT_THEME: TuiThemePalette = {
  bg: '#fafafa',
  surface: '#f8f9fa',
  surface2: '#f0f0f0',
  surface3: '#e7e8e9',
  diffAddBg: '#e3f0d6',
  diffRemoveBg: '#fbdada',
  diffMetaBg: '#dde9f4',
  border: '#d9d7ce',
  border2: '#5c6773',
  text: '#5c6773',
  muted: '#828c99',
  dim: '#abb0b6',
  violet: '#a37acc',
  cyan: '#4cbf99',
  green: '#86b300',
  red: '#f07171',
  amber: '#f29718',
  pink: '#ff9940',
  userBg: '#e6effa',
} as const

export const ONE_LIGHT_THEME: TuiThemePalette = {
  bg: '#fafafa',
  surface: '#ffffff',
  surface2: '#f0f0f0',
  surface3: '#e5e5e6',
  diffAddBg: '#e1f1dd',
  diffRemoveBg: '#fbdcdc',
  diffMetaBg: '#dce7f5',
  border: '#d3d3d3',
  border2: '#383a42',
  text: '#383a42',
  muted: '#696c77',
  dim: '#a0a1a7',
  violet: '#a626a4',
  cyan: '#0184bc',
  green: '#50a14f',
  red: '#e45649',
  amber: '#c18401',
  pink: '#e45649',
  userBg: '#e5ebf1',
} as const

export const EVERFOREST_LIGHT_THEME: TuiThemePalette = {
  bg: '#fdf6e3',
  surface: '#f4f0d9',
  surface2: '#efebd4',
  surface3: '#e6e2cc',
  diffAddBg: '#dfe7c7',
  diffRemoveBg: '#f4dad3',
  diffMetaBg: '#dde6d8',
  border: '#bdc3af',
  border2: '#5c6a72',
  text: '#5c6a72',
  muted: '#829181',
  dim: '#a6b0a0',
  violet: '#df69ba',
  cyan: '#35a77c',
  green: '#8da101',
  red: '#f85552',
  amber: '#dfa000',
  pink: '#df69ba',
  userBg: '#e1e8d0',
} as const

export const ONE_DARK_THEME: TuiThemePalette = {
  bg: '#21252b',
  surface: '#282c34',
  surface2: '#2c313a',
  surface3: '#3e4451',
  diffAddBg: '#2c3e2e',
  diffRemoveBg: '#4a2a2a',
  diffMetaBg: '#2a3448',
  border: '#3e4451',
  border2: '#61afef',
  text: '#abb2bf',
  muted: '#9da5b4',
  dim: '#5c6370',
  violet: '#c678dd',
  cyan: '#56b6c2',
  green: '#98c379',
  red: '#e06c75',
  amber: '#e5c07b',
  pink: '#c678dd',
  userBg: '#2f3545',
} as const

export const MONOKAI_THEME: TuiThemePalette = {
  bg: '#272822',
  surface: '#2c2d27',
  surface2: '#34352f',
  surface3: '#49483e',
  diffAddBg: '#374d2c',
  diffRemoveBg: '#5a2c2c',
  diffMetaBg: '#2f3c4a',
  border: '#3e3d32',
  border2: '#a6e22e',
  text: '#f8f8f2',
  muted: '#cfcfc2',
  dim: '#75715e',
  violet: '#ae81ff',
  cyan: '#66d9ef',
  green: '#a6e22e',
  red: '#f92672',
  amber: '#fd971f',
  pink: '#f92672',
  userBg: '#3e3d32',
} as const

export const KANAGAWA_THEME: TuiThemePalette = {
  bg: '#1f1f28',
  surface: '#23232e',
  surface2: '#2a2a37',
  surface3: '#363646',
  diffAddBg: '#2b3328',
  diffRemoveBg: '#43242b',
  diffMetaBg: '#252535',
  border: '#363646',
  border2: '#7e9cd8',
  text: '#dcd7ba',
  muted: '#c8c093',
  dim: '#727169',
  violet: '#957fb8',
  cyan: '#7fb4ca',
  green: '#98bb6c',
  red: '#e46876',
  amber: '#ffa066',
  pink: '#d27e99',
  userBg: '#2d4f67',
} as const

export const EVERFOREST_DARK_THEME: TuiThemePalette = {
  bg: '#2d353b',
  surface: '#30393f',
  surface2: '#343f44',
  surface3: '#3d484d',
  diffAddBg: '#3a4b33',
  diffRemoveBg: '#4e2f2f',
  diffMetaBg: '#2e3c4a',
  border: '#3d484d',
  border2: '#a7c080',
  text: '#d3c6aa',
  muted: '#9da9a0',
  dim: '#859289',
  violet: '#d699b6',
  cyan: '#83c092',
  green: '#a7c080',
  red: '#e67e80',
  amber: '#dbbc7f',
  pink: '#d699b6',
  userBg: '#384d54',
} as const

export const TOKYO_NIGHT_DAY_THEME: TuiThemePalette = {
  bg: '#e1e2e7',
  surface: '#d0d5e3',
  surface2: '#c4c8da',
  surface3: '#a8aecb',
  diffAddBg: '#d4e4d0',
  diffRemoveBg: '#f3d4dc',
  diffMetaBg: '#cfddf5',
  border: '#a8aecb',
  border2: '#2e7de9',
  text: '#3760bf',
  muted: '#6172b0',
  dim: '#848cb5',
  violet: '#9854f1',
  cyan: '#007197',
  green: '#587539',
  red: '#f52a65',
  amber: '#8c6c3e',
  pink: '#9854f1',
  userBg: '#cfddf5',
} as const

export const QUIET_LIGHT_THEME: TuiThemePalette = {
  bg: '#f5f5f5',
  surface: '#ffffff',
  surface2: '#eef1f5',
  surface3: '#d3d9e5',
  diffAddBg: '#dbe8d0',
  diffRemoveBg: '#f5d6d4',
  diffMetaBg: '#dce6f1',
  border: '#c7d1dd',
  border2: '#333333',
  text: '#333333',
  muted: '#676867',
  dim: '#aaaaaa',
  violet: '#7a3e9d',
  cyan: '#4b83cd',
  green: '#448c27',
  red: '#aa3731',
  amber: '#a67f59',
  pink: '#7a3e9d',
  userBg: '#e3ecf6',
} as const

export const HORIZON_LIGHT_THEME: TuiThemePalette = {
  bg: '#fdf0ed',
  surface: '#fadad1',
  surface2: '#f6c9bf',
  surface3: '#e7aca3',
  diffAddBg: '#e2ead3',
  diffRemoveBg: '#f7cdd0',
  diffMetaBg: '#e6dde9',
  border: '#e7aca3',
  border2: '#403c64',
  text: '#403c64',
  muted: '#6c5f80',
  dim: '#a79da7',
  violet: '#da103f',
  cyan: '#1d8991',
  green: '#1eb980',
  red: '#f43e5c',
  amber: '#f9c859',
  pink: '#f43e5c',
  userBg: '#f6c9bf',
} as const

export const GITHUB_DARK_THEME: TuiThemePalette = {
  bg: '#0d1117',
  surface: '#161b22',
  surface2: '#21262d',
  surface3: '#30363d',
  diffAddBg: '#1a3324',
  diffRemoveBg: '#3d1f24',
  diffMetaBg: '#1f2d4a',
  border: '#30363d',
  border2: '#58a6ff',
  text: '#e6edf3',
  muted: '#7d8590',
  dim: '#484f58',
  violet: '#bc8cff',
  cyan: '#39c5cf',
  green: '#3fb950',
  red: '#f85149',
  amber: '#d29922',
  pink: '#db61a2',
  userBg: '#1f2d4a',
} as const

export const AYU_DARK_THEME: TuiThemePalette = {
  bg: '#0a0e14',
  surface: '#10151c',
  surface2: '#1f2430',
  surface3: '#273747',
  diffAddBg: '#1c3320',
  diffRemoveBg: '#3d1f24',
  diffMetaBg: '#1f2d44',
  border: '#253340',
  border2: '#ffb454',
  text: '#b3b1ad',
  muted: '#828c99',
  dim: '#626a73',
  violet: '#d2a6ff',
  cyan: '#39bae6',
  green: '#aad94c',
  red: '#f07178',
  amber: '#ffb454',
  pink: '#ff8f40',
  userBg: '#1f3048',
} as const

export const ROSE_PINE_THEME: TuiThemePalette = {
  bg: '#191724',
  surface: '#1f1d2e',
  surface2: '#26233a',
  surface3: '#393552',
  diffAddBg: '#1f3a35',
  diffRemoveBg: '#3f2234',
  diffMetaBg: '#2a2845',
  border: '#403d52',
  border2: '#c4a7e7',
  text: '#e0def4',
  muted: '#908caa',
  dim: '#6e6a86',
  violet: '#c4a7e7',
  cyan: '#9ccfd8',
  green: '#31748f',
  red: '#eb6f92',
  amber: '#f6c177',
  pink: '#ebbcba',
  userBg: '#2a3e4d',
} as const

export const SYNTHWAVE_THEME: TuiThemePalette = {
  bg: '#241b2f',
  surface: '#262335',
  surface2: '#34294f',
  surface3: '#463465',
  diffAddBg: '#244d3e',
  diffRemoveBg: '#4a2030',
  diffMetaBg: '#34294f',
  border: '#463465',
  border2: '#f97e72',
  text: '#f8f8f2',
  muted: '#b4bbcb',
  dim: '#8e8ea3',
  violet: '#a583f0',
  cyan: '#03edf9',
  green: '#72f1b8',
  red: '#fe4450',
  amber: '#ffcc99',
  pink: '#ff7edb',
  userBg: '#34294f',
} as const

export const PALENIGHT_THEME: TuiThemePalette = {
  bg: '#292d3e',
  surface: '#2d3143',
  surface2: '#34374a',
  surface3: '#444267',
  diffAddBg: '#2a4435',
  diffRemoveBg: '#4a2a33',
  diffMetaBg: '#2a3353',
  border: '#444267',
  border2: '#82aaff',
  text: '#a6accd',
  muted: '#8b93b1',
  dim: '#676e95',
  violet: '#c792ea',
  cyan: '#89ddff',
  green: '#c3e88d',
  red: '#f07178',
  amber: '#ffcb6b',
  pink: '#f78c6c',
  userBg: '#2a3353',
} as const

export const NIGHT_OWL_THEME: TuiThemePalette = {
  bg: '#011627',
  surface: '#0b253a',
  surface2: '#1d3b53',
  surface3: '#234e6e',
  diffAddBg: '#1c3a28',
  diffRemoveBg: '#3f2530',
  diffMetaBg: '#1f3b5c',
  border: '#1d3b53',
  border2: '#7fdbca',
  text: '#d6deeb',
  muted: '#8badc1',
  dim: '#5f7e97',
  violet: '#c792ea',
  cyan: '#7fdbca',
  green: '#addb67',
  red: '#ef5350',
  amber: '#ecc48d',
  pink: '#ff869a',
  userBg: '#1f3b5c',
} as const

export const FLEXOKI_LIGHT_THEME: TuiThemePalette = {
  bg: '#fffcf0',
  surface: '#f9f5e7',
  surface2: '#f2eecf',
  surface3: '#e6dfbf',
  diffAddBg: '#e2ecd0',
  diffRemoveBg: '#f4d8d3',
  diffMetaBg: '#dfe9ee',
  border: '#d8d0bf',
  border2: '#100f0f',
  text: '#100f0f',
  muted: '#6f6e69',
  dim: '#b7b5ac',
  violet: '#5e409d',
  cyan: '#24837b',
  green: '#66800b',
  red: '#af3029',
  amber: '#ad8301',
  pink: '#ce5d97',
  userBg: '#e6dfbf',
} as const

export const NORD_LIGHT_THEME: TuiThemePalette = {
  bg: '#eceff4',
  surface: '#f8fafc',
  surface2: '#e5e9f0',
  surface3: '#d8dee9',
  diffAddBg: '#dfead8',
  diffRemoveBg: '#efdadd',
  diffMetaBg: '#dce8f1',
  border: '#c8d0dc',
  border2: '#4c566a',
  text: '#2e3440',
  muted: '#4c566a',
  dim: '#7b8798',
  violet: '#5e81ac',
  cyan: '#5e99a8',
  green: '#4f7f4f',
  red: '#bf616a',
  amber: '#b7791f',
  pink: '#b45d8f',
  userBg: '#d8dee9',
} as const

export const VITESSE_LIGHT_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#f8f8f8',
  surface2: '#eeeeee',
  surface3: '#e4e4e4',
  diffAddBg: '#e1ecd9',
  diffRemoveBg: '#f2dddd',
  diffMetaBg: '#dfe8ee',
  border: '#d7d7d7',
  border2: '#393a34',
  text: '#393a34',
  muted: '#62645a',
  dim: '#a0a39a',
  violet: '#9b4d96',
  cyan: '#1c6b77',
  green: '#59873a',
  red: '#ab5959',
  amber: '#b07d48',
  pink: '#a65e2b',
  userBg: '#e4e4e4',
} as const

export const FLEXOKI_DARK_THEME: TuiThemePalette = {
  bg: '#100f0f',
  surface: '#1c1b1a',
  surface2: '#282726',
  surface3: '#343331',
  diffAddBg: '#26351e',
  diffRemoveBg: '#3d211f',
  diffMetaBg: '#1f2d34',
  border: '#403e3c',
  border2: '#cecdc3',
  text: '#cecdc3',
  muted: '#878580',
  dim: '#575653',
  violet: '#a699d0',
  cyan: '#3aa99f',
  green: '#879a39',
  red: '#d14d41',
  amber: '#d0a215',
  pink: '#ce5d97',
  userBg: '#24312f',
} as const

export const COBALT_THEME: TuiThemePalette = {
  bg: '#002240',
  surface: '#002b4f',
  surface2: '#053761',
  surface3: '#124568',
  diffAddBg: '#124728',
  diffRemoveBg: '#5a2234',
  diffMetaBg: '#0a416e',
  border: '#1b557c',
  border2: '#ffc600',
  text: '#ffffff',
  muted: '#b7d4ea',
  dim: '#6f9fc1',
  violet: '#ff9d00',
  cyan: '#00c8ff',
  green: '#3ad900',
  red: '#ff628c',
  amber: '#ffc600',
  pink: '#ff80e1',
  userBg: '#0a416e',
} as const

export const VITESSE_DARK_THEME: TuiThemePalette = {
  bg: '#121212',
  surface: '#1b1b1b',
  surface2: '#222222',
  surface3: '#2f2f2f',
  diffAddBg: '#263623',
  diffRemoveBg: '#3e2525',
  diffMetaBg: '#263334',
  border: '#393939',
  border2: '#dbd7ca',
  text: '#dbd7ca',
  muted: '#b8b4a8',
  dim: '#73706a',
  violet: '#bd976a',
  cyan: '#4d9375',
  green: '#80a665',
  red: '#cb7676',
  amber: '#c98a7d',
  pink: '#d4976c',
  userBg: '#24312f',
} as const

export const ICEBERG_THEME: TuiThemePalette = {
  bg: '#161821',
  surface: '#1e2132',
  surface2: '#232634',
  surface3: '#2e313f',
  diffAddBg: '#2a3a2e',
  diffRemoveBg: '#4a2a30',
  diffMetaBg: '#233048',
  border: '#2e313f',
  border2: '#84a0c6',
  text: '#c6c8d1',
  muted: '#9aa1b3',
  dim: '#6b7089',
  violet: '#a093c7',
  cyan: '#89b8c2',
  green: '#b4be82',
  red: '#e27878',
  amber: '#e2a478',
  pink: '#d2869c',
  userBg: '#2c3a52',
} as const

export const ICEBERG_LIGHT_THEME: TuiThemePalette = {
  bg: '#e8e9ec',
  surface: '#dcdfe7',
  surface2: '#d2d5e0',
  surface3: '#c6cad3',
  diffAddBg: '#d8e5cf',
  diffRemoveBg: '#f0d4d4',
  diffMetaBg: '#d2dceb',
  border: '#c6cad3',
  border2: '#33374c',
  text: '#33374c',
  muted: '#555a78',
  dim: '#8389a3',
  violet: '#7759b4',
  cyan: '#3f83a6',
  green: '#668e3d',
  red: '#cc517a',
  amber: '#c57339',
  pink: '#cc517a',
  userBg: '#cad0de',
} as const

export const ZENBURN_THEME: TuiThemePalette = {
  bg: '#3f3f3f',
  surface: '#454545',
  surface2: '#4f4f4f',
  surface3: '#5e5e5e',
  diffAddBg: '#475a3f',
  diffRemoveBg: '#5a3838',
  diffMetaBg: '#3a4858',
  border: '#5e5e5e',
  border2: '#dcdccc',
  text: '#dcdccc',
  muted: '#c0c0a0',
  dim: '#7f9f7f',
  violet: '#dc8cc3',
  cyan: '#93e0e3',
  green: '#afd787',
  red: '#cc9393',
  amber: '#f0dfaf',
  pink: '#dc8cc3',
  userBg: '#5e7560',
} as const

export const MATERIAL_DARKER_THEME: TuiThemePalette = {
  bg: '#212121',
  surface: '#272727',
  surface2: '#2a2a2a',
  surface3: '#353535',
  diffAddBg: '#2c4632',
  diffRemoveBg: '#4a2a32',
  diffMetaBg: '#2c3142',
  border: '#353535',
  border2: '#c792ea',
  text: '#eeffff',
  muted: '#b2ccd6',
  dim: '#545454',
  violet: '#c792ea',
  cyan: '#89ddff',
  green: '#c3e88d',
  red: '#ff5370',
  amber: '#ffcb6b',
  pink: '#f07178',
  userBg: '#2c3142',
} as const

export const MATERIAL_LIGHTER_THEME: TuiThemePalette = {
  bg: '#fafafa',
  surface: '#ffffff',
  surface2: '#f5f5f5',
  surface3: '#eeeeee',
  diffAddBg: '#dceec0',
  diffRemoveBg: '#f5d6d4',
  diffMetaBg: '#e1ecf6',
  border: '#e5e5e5',
  border2: '#4a5c69',
  text: '#4a5c69',
  muted: '#7c8a98',
  dim: '#aabfc9',
  violet: '#7c4dff',
  cyan: '#39adb5',
  green: '#91b859',
  red: '#e53935',
  amber: '#f6a434',
  pink: '#d81b60',
  userBg: '#d3e1e8',
} as const

export const MIN_LIGHT_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#ffffff',
  surface2: '#f7f7f7',
  surface3: '#ededed',
  diffAddBg: '#e2eed5',
  diffRemoveBg: '#f5d4d4',
  diffMetaBg: '#dde7f5',
  border: '#e5e5e5',
  border2: '#2d2d2d',
  text: '#2d2d2d',
  muted: '#777777',
  dim: '#aaaaaa',
  violet: '#a626a4',
  cyan: '#0184bc',
  green: '#50a14f',
  red: '#e45649',
  amber: '#c18401',
  pink: '#a626a4',
  userBg: '#f0f0f0',
} as const

export const ALABASTER_THEME: TuiThemePalette = {
  bg: '#f7f7f7',
  surface: '#ffffff',
  surface2: '#f0f0f0',
  surface3: '#e0e0e0',
  diffAddBg: '#e3f0de',
  diffRemoveBg: '#f3dfdd',
  diffMetaBg: '#e0eafe',
  border: '#d7d7d7',
  border2: '#007acc',
  text: '#000000',
  muted: '#777777',
  dim: '#aaaaaa',
  violet: '#7a3e9d',
  cyan: '#007acc',
  green: '#448c27',
  red: '#aa3731',
  amber: '#b06a00',
  pink: '#7a3e9d',
  userBg: '#bfdbfe',
} as const

export const LIGHT_OWL_THEME: TuiThemePalette = {
  bg: '#f6f6f6',
  surface: '#fbfbfb',
  surface2: '#f0f0f0',
  surface3: '#e0e7ea',
  diffAddBg: '#d9f1e8',
  diffRemoveBg: '#f9dddd',
  diffMetaBg: '#d3e8f8',
  border: '#d9d9d9',
  border2: '#2aa298',
  text: '#403f53',
  muted: '#65737e',
  dim: '#93a1a1',
  violet: '#994cc3',
  cyan: '#2aa298',
  green: '#08916a',
  red: '#de3d3b',
  amber: '#daaa01',
  pink: '#d6438a',
  userBg: '#d3e8f8',
} as const

export const PAPERCOLOR_LIGHT_THEME: TuiThemePalette = {
  bg: '#eeeeee',
  surface: '#f7f7f7',
  surface2: '#dedede',
  surface3: '#c4c4c4',
  diffAddBg: '#dcebdc',
  diffRemoveBg: '#f1dada',
  diffMetaBg: '#d7e5ec',
  border: '#c4c4c4',
  border2: '#444444',
  text: '#5e5e5e',
  muted: '#6b6b6b',
  dim: '#858585',
  violet: '#8700af',
  cyan: '#0087af',
  green: '#008700',
  red: '#d70000',
  amber: '#d75f00',
  pink: '#af0000',
  userBg: '#d7e5ec',
} as const

export const TOMORROW_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#ffffff',
  surface2: '#f2f2f2',
  surface3: '#e0e0e0',
  diffAddBg: '#e4ecd6',
  diffRemoveBg: '#f3dddd',
  diffMetaBg: '#dce6f2',
  border: '#c5c8c6',
  border2: '#373b41',
  text: '#373b41',
  muted: '#969896',
  dim: '#b4b7b4',
  violet: '#8959a8',
  cyan: '#3e999f',
  green: '#718c00',
  red: '#c82829',
  amber: '#b58900',
  pink: '#a3685a',
  userBg: '#dce6f2',
} as const

export const OCEANIC_NEXT_THEME: TuiThemePalette = {
  bg: '#1b2b34',
  surface: '#243640',
  surface2: '#343d46',
  surface3: '#4f5b66',
  diffAddBg: '#2c4536',
  diffRemoveBg: '#4a2f34',
  diffMetaBg: '#293e54',
  border: '#4f5b66',
  border2: '#a7adba',
  text: '#c0c5ce',
  muted: '#a7adba',
  dim: '#65737e',
  violet: '#c594c5',
  cyan: '#5fb3b3',
  green: '#99c794',
  red: '#ec5f67',
  amber: '#fac863',
  pink: '#c594c5',
  userBg: '#293e54',
} as const

export const PAPERCOLOR_DARK_THEME: TuiThemePalette = {
  bg: '#1c1c1c',
  surface: '#292929',
  surface2: '#363636',
  surface3: '#424242',
  diffAddBg: '#29402f',
  diffRemoveBg: '#482b37',
  diffMetaBg: '#293b47',
  border: '#585858',
  border2: '#b8b8b8',
  text: '#b8b8b8',
  muted: '#9e9e9e',
  dim: '#808080',
  violet: '#af87d7',
  cyan: '#00afaf',
  green: '#5faf5f',
  red: '#ff5faf',
  amber: '#ffaf00',
  pink: '#af005f',
  userBg: '#293b47',
} as const

export const SNAZZY_THEME: TuiThemePalette = {
  bg: '#1e1f29',
  surface: '#282a36',
  surface2: '#2d303d',
  surface3: '#3b3f50',
  diffAddBg: '#243f35',
  diffRemoveBg: '#472c36',
  diffMetaBg: '#28394c',
  border: '#3a3d4d',
  border2: '#6c7394',
  text: '#eff0eb',
  muted: '#b0b2bd',
  dim: '#747784',
  violet: '#ff6ac1',
  cyan: '#9aedfe',
  green: '#5af78e',
  red: '#ff5c57',
  amber: '#f3f99d',
  pink: '#ff6ac1',
  userBg: '#26394d',
} as const

export const TOMORROW_NIGHT_THEME: TuiThemePalette = {
  bg: '#1d1f21',
  surface: '#242629',
  surface2: '#282a2e',
  surface3: '#373b41',
  diffAddBg: '#303c2d',
  diffRemoveBg: '#442d2f',
  diffMetaBg: '#2a3542',
  border: '#373b41',
  border2: '#b4b7b4',
  text: '#c5c8c6',
  muted: '#b4b7b4',
  dim: '#969896',
  violet: '#b294bb',
  cyan: '#8abeb7',
  green: '#b5bd68',
  red: '#cc6666',
  amber: '#f0c674',
  pink: '#b294bb',
  userBg: '#2a3542',
} as const

export const ETHEREAL_THEME: TuiThemePalette = {
  bg: '#060B1E',
  surface: '#0c1330',
  surface2: '#162045',
  surface3: '#1f2a58',
  diffAddBg: '#1e3a2c',
  diffRemoveBg: '#3e202a',
  diffMetaBg: '#1f2a58',
  border: '#3C486D',
  border2: '#7d82d9',
  text: '#ffcead',
  muted: '#dfeaf0',
  dim: '#6d7db6',
  violet: '#c2c4f0',
  cyan: '#a3bfd1',
  green: '#92a593',
  red: '#ED5B5A',
  amber: '#E9BB4F',
  pink: '#c89dc1',
  userBg: '#1f2a58',
} as const

export const HACKERMAN_THEME: TuiThemePalette = {
  bg: '#0B0C16',
  surface: '#13142a',
  surface2: '#1c1e3e',
  surface3: '#272956',
  diffAddBg: '#1a3a25',
  diffRemoveBg: '#3a1f2a',
  diffMetaBg: '#1f2a58',
  border: '#3E4058',
  border2: '#82FB9C',
  text: '#ddf7ff',
  muted: '#c4d2ed',
  dim: '#6a6e95',
  violet: '#cddbf4',
  cyan: '#7cf8f7',
  green: '#50f872',
  red: '#ff5c8a',
  amber: '#a4ffec',
  pink: '#85ff9d',
  userBg: '#272956',
} as const

export const LUMON_THEME: TuiThemePalette = {
  bg: '#16242d',
  surface: '#1c2f3a',
  surface2: '#243b4a',
  surface3: '#2d4860',
  diffAddBg: '#1f3a2a',
  diffRemoveBg: '#3a1f2a',
  diffMetaBg: '#1f3a55',
  border: '#2d4860',
  border2: '#f2fcff',
  text: '#d6e2ee',
  muted: '#b1d8ee',
  dim: '#304860',
  violet: '#73a6cb',
  cyan: '#8bc9eb',
  green: '#5e95bc',
  red: '#d35f5f',
  amber: '#6fa4c9',
  pink: '#9dcae5',
  userBg: '#2d4860',
} as const

export const CLAUDE_CODE_THEME: TuiThemePalette = {
  bg: '#0d0e0e',
  surface: '#141515',
  surface2: '#202222',
  surface3: '#2a3438',
  diffAddBg: '#18251a',
  diffRemoveBg: '#2b1917',
  diffMetaBg: '#112a32',
  border: '#303333',
  border2: '#4f8998',
  text: '#d6d3cc',
  muted: '#aaa69d',
  dim: '#71736e',
  violet: '#b7a36a',
  cyan: '#69aebe',
  green: '#8ea65a',
  red: '#d06d5f',
  amber: '#c69a52',
  pink: '#b98275',
  userBg: '#202222',
} as const

export const MATTE_BLACK_THEME: TuiThemePalette = {
  bg: '#121212',
  surface: '#1a1a1a',
  surface2: '#242424',
  surface3: '#303030',
  diffAddBg: '#1f3a25',
  diffRemoveBg: '#3a1f1f',
  diffMetaBg: '#1f2a3a',
  border: '#333333',
  border2: '#e68e0d',
  text: '#bebebe',
  muted: '#a0a0a0',
  dim: '#8a8a8d',
  violet: '#f59e0b',
  cyan: '#bebebe',
  green: '#FFC107',
  red: '#D35F5F',
  amber: '#e68e0d',
  pink: '#B91C1C',
  userBg: '#2a2a2a',
} as const

export const MIASMA_THEME: TuiThemePalette = {
  bg: '#222222',
  surface: '#2a2a2a',
  surface2: '#333333',
  surface3: '#3d3d3d',
  diffAddBg: '#2a3a25',
  diffRemoveBg: '#3a2a25',
  diffMetaBg: '#2a2f3d',
  border: '#3d3d3d',
  border2: '#78824b',
  text: '#c2c2b0',
  muted: '#d7c483',
  dim: '#666666',
  violet: '#bb7744',
  cyan: '#c9a554',
  green: '#5f875f',
  red: '#b06060',
  amber: '#b36d43',
  pink: '#bb7744',
  userBg: '#383830',
} as const

export const OSAKA_JADE_THEME: TuiThemePalette = {
  bg: '#111c18',
  surface: '#192821',
  surface2: '#23372B',
  surface3: '#2d4538',
  diffAddBg: '#244530',
  diffRemoveBg: '#3a232a',
  diffMetaBg: '#1f3540',
  border: '#23372B',
  border2: '#509475',
  text: '#C1C497',
  muted: '#97a587',
  dim: '#53685B',
  violet: '#75bbb3',
  cyan: '#2DD5B7',
  green: '#549e6a',
  red: '#FF5345',
  amber: '#E5C736',
  pink: '#D2689C',
  userBg: '#2d4538',
} as const

export const RETRO_82_THEME: TuiThemePalette = {
  bg: '#05182e',
  surface: '#0d2440',
  surface2: '#163152',
  surface3: '#1f3d62',
  diffAddBg: '#1a3a30',
  diffRemoveBg: '#3a2820',
  diffMetaBg: '#1f3a55',
  border: '#303442',
  border2: '#faa968',
  text: '#f6dcac',
  muted: '#a7c9c6',
  dim: '#134e5a',
  violet: '#3f8f8a',
  cyan: '#028391',
  green: '#8cbfb8',
  red: '#f85525',
  amber: '#faa968',
  pink: '#e97b3c',
  userBg: '#1f3d62',
} as const

export const RISTRETTO_THEME: TuiThemePalette = {
  bg: '#2c2525',
  surface: '#352e2e',
  surface2: '#403838',
  surface3: '#4a4040',
  diffAddBg: '#2f3a25',
  diffRemoveBg: '#3a2a30',
  diffMetaBg: '#2a2f4a',
  border: '#72696a',
  border2: '#f38d70',
  text: '#e6d9db',
  muted: '#c3b7b8',
  dim: '#948a8b',
  violet: '#a8a9eb',
  cyan: '#85dacc',
  green: '#adda78',
  red: '#fd6883',
  amber: '#f9cc6c',
  pink: '#f38d70',
  userBg: '#4a3838',
} as const

export const VANTABLACK_THEME: TuiThemePalette = {
  bg: '#000000',
  surface: '#050505',
  surface2: '#0d0d0d',
  surface3: '#1a1a1a',
  diffAddBg: '#1a2a1a',
  diffRemoveBg: '#2a1a1a',
  diffMetaBg: '#1a1a2a',
  border: '#2a2a2a',
  border2: '#8d8d8d',
  text: '#ffffff',
  muted: '#cecece',
  dim: '#5c5c5c',
  violet: '#b0b0b0',
  cyan: '#ececec',
  green: '#b6b6b6',
  red: '#a4a4a4',
  amber: '#cecece',
  pink: '#9b9b9b',
  userBg: '#1a1a1a',
} as const

export const WHITE_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#fafafa',
  surface2: '#f0f0f0',
  surface3: '#e5e5e5',
  diffAddBg: '#e5f0e0',
  diffRemoveBg: '#f0e0e0',
  diffMetaBg: '#e0e5f0',
  border: '#c0c0c0',
  border2: '#1a1a1a',
  text: '#000000',
  muted: '#3a3a3a',
  dim: '#9a9a9a',
  violet: '#1a1a1a',
  cyan: '#3e3e3e',
  green: '#3a3a3a',
  red: '#2a2a2a',
  amber: '#4a4a4a',
  pink: '#2e2e2e',
  userBg: '#f0f0f0',
} as const

export const STRIPE_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#f6f9fc',
  surface2: '#eef2f7',
  surface3: '#dde6f0',
  diffAddBg: '#dceee2',
  diffRemoveBg: '#fbdce5',
  diffMetaBg: '#dde7f6',
  border: '#e3e8ee',
  border2: '#a8c3de',
  text: '#0d253d',
  muted: '#273951',
  dim: '#64748d',
  violet: '#533afd',
  cyan: '#003770',
  green: '#00875a',
  red: '#ea2261',
  amber: '#9b6829',
  pink: '#f96bee',
  userBg: '#dde6f0',
} as const

export const CLAUDE_CREAM_THEME: TuiThemePalette = {
  bg: '#faf9f5',
  surface: '#f5f0e8',
  surface2: '#efe9de',
  surface3: '#e8e0d2',
  diffAddBg: '#dde9d4',
  diffRemoveBg: '#f0d6d2',
  diffMetaBg: '#e0e3e8',
  border: '#e6dfd8',
  border2: '#cc785c',
  text: '#141413',
  muted: '#3d3d3a',
  dim: '#6c6a64',
  violet: '#cc785c',
  cyan: '#5db8a6',
  green: '#5db872',
  red: '#c64545',
  amber: '#d4a017',
  pink: '#e8a55a',
  userBg: '#e8e0d2',
} as const

export const SUPABASE_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#fafafa',
  surface2: '#ededed',
  surface3: '#d4d4d4',
  diffAddBg: '#d8efe2',
  diffRemoveBg: '#fcd8d4',
  diffMetaBg: '#dde3f4',
  border: '#dfdfdf',
  border2: '#c7c7c7',
  text: '#171717',
  muted: '#707070',
  dim: '#9a9a9a',
  violet: '#6b01c2',
  cyan: '#054cff',
  green: '#3ecf8e',
  red: '#ff2201',
  amber: '#d99500',
  pink: '#c7007e',
  userBg: '#eddbf9',
} as const

export const POSTHOG_THEME: TuiThemePalette = {
  bg: '#eeefe9',
  surface: '#fcfcfa',
  surface2: '#ffffff',
  surface3: '#e5e7e0',
  diffAddBg: '#d9eddf',
  diffRemoveBg: '#f7d6d3',
  diffMetaBg: '#dde7f4',
  border: '#bfc1b7',
  border2: '#6c6e63',
  text: '#23251d',
  muted: '#4d4f46',
  dim: '#6c6e63',
  violet: '#7c44a6',
  cyan: '#1078a3',
  green: '#2c8c66',
  red: '#cd4239',
  amber: '#f7a501',
  pink: '#dceaf6',
  userBg: '#dceaf6',
} as const

export const REPLICATE_THEME: TuiThemePalette = {
  bg: '#f9f7f3',
  surface: '#f3f0e8',
  surface2: '#ffffff',
  surface3: '#ebe6df',
  diffAddBg: '#dde9d4',
  diffRemoveBg: '#f5d4cc',
  diffMetaBg: '#e0e3e8',
  border: '#d6d2c8',
  border2: '#202020',
  text: '#202020',
  muted: '#3a3a3a',
  dim: '#646464',
  violet: '#ea2804',
  cyan: '#ff6a3d',
  green: '#2b9a66',
  red: '#ea2804',
  amber: '#ff6a3d',
  pink: '#f4a8a0',
  userBg: '#ebe6df',
} as const

export const NOTION_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#fafaf9',
  surface2: '#f6f5f4',
  surface3: '#f0eeec',
  diffAddBg: '#d9f3e1',
  diffRemoveBg: '#fde0ec',
  diffMetaBg: '#dcecfa',
  border: '#e5e3df',
  border2: '#c8c4be',
  text: '#1a1a1a',
  muted: '#37352f',
  dim: '#5d5b54',
  violet: '#5645d4',
  cyan: '#0075de',
  green: '#1aae39',
  red: '#e03131',
  amber: '#dd5b00',
  pink: '#ff64c8',
  userBg: '#e6e0f5',
} as const

export const FIGMA_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#f7f7f5',
  surface2: '#f1f1f1',
  surface3: '#e6e6e6',
  diffAddBg: '#dceeb1',
  diffRemoveBg: '#efd4d4',
  diffMetaBg: '#dde1f0',
  border: '#e6e6e6',
  border2: '#1f1d3d',
  text: '#000000',
  muted: '#1f1d3d',
  dim: '#666666',
  violet: '#c5b0f4',
  cyan: '#1f1d3d',
  green: '#1ea64a',
  red: '#ff3d8b',
  amber: '#f5a623',
  pink: '#efd4d4',
  userBg: '#e0d6f5',
} as const

export const MIRO_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#fafbfc',
  surface2: '#f7f8fa',
  surface3: '#fff8e0',
  diffAddBg: '#d4eede',
  diffRemoveBg: '#fbd4d4',
  diffMetaBg: '#dee5fa',
  border: '#e0e2e8',
  border2: '#c7cad5',
  text: '#1c1c1e',
  muted: '#555a6a',
  dim: '#6b6f7e',
  violet: '#4262ff',
  cyan: '#0fbcb0',
  green: '#00b473',
  red: '#ff9999',
  amber: '#ffd02f',
  pink: '#ffd8f4',
  userBg: '#e1e8f5',
} as const

export const APPLE_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#fafafc',
  surface2: '#f5f5f7',
  surface3: '#f0f0f0',
  diffAddBg: '#daf3e0',
  diffRemoveBg: '#ffd9d6',
  diffMetaBg: '#dde9fa',
  border: '#e0e0e0',
  border2: '#d2d2d7',
  text: '#1d1d1f',
  muted: '#333333',
  dim: '#7a7a7a',
  violet: '#0066cc',
  cyan: '#0071e3',
  green: '#34c759',
  red: '#ff3b30',
  amber: '#ff9500',
  pink: '#ff2d55',
  userBg: '#e6f0fc',
} as const

export const NIKE_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#f5f5f5',
  surface2: '#ebebeb',
  surface3: '#cacacb',
  diffAddBg: '#d4ecdc',
  diffRemoveBg: '#fbd0d2',
  diffMetaBg: '#dce5fa',
  border: '#cacacb',
  border2: '#111111',
  text: '#111111',
  muted: '#39393b',
  dim: '#707072',
  violet: '#1151ff',
  cyan: '#0a7281',
  green: '#007d48',
  red: '#d30005',
  amber: '#f5a623',
  pink: '#ed1aa0',
  userBg: '#dee6fa',
} as const

export const PINTEREST_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#fbfbf9',
  surface2: '#f6f6f3',
  surface3: '#e5e5e0',
  diffAddBg: '#c7f0da',
  diffRemoveBg: '#fbd0d6',
  diffMetaBg: '#dee3fa',
  border: '#dadad3',
  border2: '#c8c8c1',
  text: '#000000',
  muted: '#33332e',
  dim: '#62625b',
  violet: '#7e238b',
  cyan: '#435ee5',
  green: '#2b9a66',
  red: '#e60023',
  amber: '#f5a623',
  pink: '#c7f0da',
  userBg: '#f0e3f3',
} as const

export const PLAYSTATION_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#f5f7fa',
  surface2: '#f3f3f3',
  surface3: '#e9eef4',
  diffAddBg: '#d4ecdc',
  diffRemoveBg: '#fbd0d8',
  diffMetaBg: '#dde9f5',
  border: '#e1e6ee',
  border2: '#0070d1',
  text: '#000000',
  muted: '#1f2024',
  dim: '#6b6b6b',
  violet: '#0070d1',
  cyan: '#53b1ff',
  green: '#2b9a66',
  red: '#c81b3a',
  amber: '#ffce21',
  pink: '#d53b00',
  userBg: '#dceaf6',
} as const

export const NVIDIA_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#f7f7f7',
  surface2: '#efefef',
  surface3: '#cccccc',
  diffAddBg: '#dceea0',
  diffRemoveBg: '#fbd0d0',
  diffMetaBg: '#dce0ed',
  border: '#cccccc',
  border2: '#5e5e5e',
  text: '#000000',
  muted: '#1a1a1a',
  dim: '#757575',
  violet: '#952fc6',
  cyan: '#0046a4',
  green: '#76b900',
  red: '#e52020',
  amber: '#df6500',
  pink: '#f9d4ff',
  userBg: '#dcedb8',
} as const

export const MONGODB_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#f9fbfa',
  surface2: '#f4f7f6',
  surface3: '#e3fcef',
  diffAddBg: '#c3f0d2',
  diffRemoveBg: '#f6d6d2',
  diffMetaBg: '#dee0ee',
  border: '#e1e5e8',
  border2: '#c1ccd6',
  text: '#001e2b',
  muted: '#3d4f5b',
  dim: '#5c6c7a',
  violet: '#7b3ff2',
  cyan: '#3d4f9f',
  green: '#00684a',
  red: '#d63a30',
  amber: '#946f3f',
  pink: '#f06bb8',
  userBg: '#c3f0d2',
} as const

export const SLACK_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#f4ede4',
  surface2: '#f9f0ff',
  surface3: '#f0e6f5',
  diffAddBg: '#d4eedc',
  diffRemoveBg: '#fbd5cc',
  diffMetaBg: '#dee3f0',
  border: '#e6e6e6',
  border2: '#4a154b',
  text: '#1d1d1d',
  muted: '#4a154b',
  dim: '#696969',
  violet: '#4a154b',
  cyan: '#1264a3',
  green: '#007a5a',
  red: '#cc4117',
  amber: '#ecb22e',
  pink: '#e01e5a',
  userBg: '#f9f0ff',
} as const

export const SLACK_DARK_THEME: TuiThemePalette = {
  bg: '#1a1d21',
  surface: '#222529',
  surface2: '#2a2d31',
  surface3: '#35373b',
  diffAddBg: '#1f3a32',
  diffRemoveBg: '#48262f',
  diffMetaBg: '#24364a',
  border: '#35373b',
  border2: '#7c3085',
  text: '#d1d2d3',
  muted: '#ababad',
  dim: '#7b7d80',
  violet: '#d49ce8',
  cyan: '#36c5f0',
  green: '#2eb67d',
  red: '#e01e5a',
  amber: '#ecb22e',
  pink: '#e891b2',
  userBg: '#3a2340',
} as const

export const COHERE_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#eeece7',
  surface2: '#edfce9',
  surface3: '#f1f5ff',
  diffAddBg: '#d9eedf',
  diffRemoveBg: '#f7d4d4',
  diffMetaBg: '#dde5f5',
  border: '#d9d9dd',
  border2: '#75758a',
  text: '#212121',
  muted: '#616161',
  dim: '#93939f',
  violet: '#ff7759',
  cyan: '#1863dc',
  green: '#003c33',
  red: '#b30000',
  amber: '#ffad9b',
  pink: '#9b60aa',
  userBg: '#f1f5ff',
} as const

export const MISTRAL_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#fafafa',
  surface2: '#fff8e0',
  surface3: '#fffaeb',
  diffAddBg: '#dceec0',
  diffRemoveBg: '#fbd4cc',
  diffMetaBg: '#dde2f0',
  border: '#e5e5e5',
  border2: '#c7c7c7',
  text: '#1f1f1f',
  muted: '#4a4a4a',
  dim: '#6a6a6a',
  violet: '#fa520f',
  cyan: '#ffb83e',
  green: '#2b9a66',
  red: '#cc3a05',
  amber: '#ff8105',
  pink: '#ffd06a',
  userBg: '#fff0c2',
} as const

export const CURSOR_THEME: TuiThemePalette = {
  bg: '#f7f7f4',
  surface: '#fafaf7',
  surface2: '#ffffff',
  surface3: '#e6e5e0',
  diffAddBg: '#dde9d4',
  diffRemoveBg: '#f5d4d8',
  diffMetaBg: '#dde3eb',
  border: '#e6e5e0',
  border2: '#cfcdc4',
  text: '#26251e',
  muted: '#5a5852',
  dim: '#807d72',
  violet: '#c0a8dd',
  cyan: '#9fbbe0',
  green: '#1f8a65',
  red: '#cf2d56',
  amber: '#c08532',
  pink: '#dfa88f',
  userBg: '#e6e5e0',
} as const

export const AIRBNB_THEME: TuiThemePalette = {
  bg: '#ffffff',
  surface: '#f7f7f7',
  surface2: '#f2f2f2',
  surface3: '#ebebeb',
  diffAddBg: '#d4ecdc',
  diffRemoveBg: '#ffe0e6',
  diffMetaBg: '#dde7fa',
  border: '#dddddd',
  border2: '#c1c1c1',
  text: '#222222',
  muted: '#3f3f3f',
  dim: '#6a6a6a',
  violet: '#460479',
  cyan: '#428bff',
  green: '#2b9a66',
  red: '#ff385c',
  amber: '#f5a623',
  pink: '#92174d',
  userBg: '#ebe5f0',
} as const

export const INTERCOM_THEME: TuiThemePalette = {
  bg: '#f5f1ec',
  surface: '#ffffff',
  surface2: '#ebe7e1',
  surface3: '#d3cec6',
  diffAddBg: '#d4ecdc',
  diffRemoveBg: '#fbd6d6',
  diffMetaBg: '#dde0fa',
  border: '#d3cec6',
  border2: '#111111',
  text: '#111111',
  muted: '#626260',
  dim: '#7b7b78',
  violet: '#0007cb',
  cyan: '#03b2cb',
  green: '#0bdf50',
  red: '#c41c1c',
  amber: '#fe4c02',
  pink: '#ff2067',
  userBg: '#dde0fa',
} as const

export const LINEAR_THEME: TuiThemePalette = {
  bg: '#010102',
  surface: '#0f1011',
  surface2: '#141516',
  surface3: '#18191a',
  diffAddBg: '#0f2a18',
  diffRemoveBg: '#2a1218',
  diffMetaBg: '#15193a',
  border: '#23252a',
  border2: '#34343a',
  text: '#f7f8f8',
  muted: '#d0d6e0',
  dim: '#8a8f98',
  violet: '#5e6ad2',
  cyan: '#828fff',
  green: '#27a644',
  red: '#ff4f64',
  amber: '#f5a623',
  pink: '#7a7fad',
  userBg: '#1c2040',
} as const

export const SENTRY_THEME: TuiThemePalette = {
  bg: '#150f23',
  surface: '#1f1633',
  surface2: '#2a1f44',
  surface3: '#362d59',
  diffAddBg: '#1f3325',
  diffRemoveBg: '#3a1e2c',
  diffMetaBg: '#2a234d',
  border: '#362d59',
  border2: '#6a5fc1',
  text: '#ffffff',
  muted: '#bdb8c0',
  dim: '#79628c',
  violet: '#6a5fc1',
  cyan: '#9dc1f5',
  green: '#c2ef4e',
  red: '#ff5c8a',
  amber: '#f5a623',
  pink: '#fa7faa',
  userBg: '#2c2058',
} as const

export const RAYCAST_THEME: TuiThemePalette = {
  bg: '#07080a',
  surface: '#0d0d0d',
  surface2: '#101111',
  surface3: '#121212',
  diffAddBg: '#1a3325',
  diffRemoveBg: '#3a1f1f',
  diffMetaBg: '#1a2538',
  border: '#242728',
  border2: '#434345',
  text: '#f4f4f6',
  muted: '#cdcdcd',
  dim: '#9c9c9d',
  violet: '#57c1ff',
  cyan: '#57c1ff',
  green: '#59d499',
  red: '#ff6161',
  amber: '#ffc533',
  pink: '#ff5757',
  userBg: '#1a2a3a',
} as const

export const FRAMER_THEME: TuiThemePalette = {
  bg: '#090909',
  surface: '#141414',
  surface2: '#1c1c1c',
  surface3: '#262626',
  diffAddBg: '#163025',
  diffRemoveBg: '#3a1f28',
  diffMetaBg: '#1d1d3a',
  border: '#262626',
  border2: '#6a4cf5',
  text: '#ffffff',
  muted: '#cbcbcb',
  dim: '#999999',
  violet: '#6a4cf5',
  cyan: '#0099ff',
  green: '#22c55e',
  red: '#ff5577',
  amber: '#ff7a3d',
  pink: '#d44df0',
  userBg: '#1f1840',
} as const

export const FERRARI_THEME: TuiThemePalette = {
  bg: '#181818',
  surface: '#303030',
  surface2: '#3a3a3a',
  surface3: '#424242',
  diffAddBg: '#1f3a25',
  diffRemoveBg: '#3a1e1e',
  diffMetaBg: '#1f2c3a',
  border: '#303030',
  border2: '#da291c',
  text: '#ffffff',
  muted: '#969696',
  dim: '#666666',
  violet: '#da291c',
  cyan: '#4c98b9',
  green: '#03904a',
  red: '#f13a2c',
  amber: '#f6e500',
  pink: '#fff200',
  userBg: '#3a1c1c',
} as const

export const RESEND_THEME: TuiThemePalette = {
  bg: '#000000',
  surface: '#06060a',
  surface2: '#0a0a0c',
  surface3: '#101012',
  diffAddBg: '#0e2a1a',
  diffRemoveBg: '#2a1018',
  diffMetaBg: '#15203a',
  border: '#1a1a1e',
  border2: '#2c2c2e',
  text: '#fcfdff',
  muted: '#a1a4a5',
  dim: '#888e90',
  violet: '#ff801f',
  cyan: '#3b9eff',
  green: '#11ff99',
  red: '#ff2047',
  amber: '#ffc53d',
  pink: '#ff801f',
  userBg: '#1a1a2a',
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
    case 'github-light': return GITHUB_LIGHT_THEME
    case 'gruvbox-light': return GRUVBOX_LIGHT_THEME
    case 'gruvbox-dark': return GRUVBOX_DARK_THEME
    case 'dracula': return DRACULA_THEME
    case 'catppuccin-latte': return CATPPUCCIN_LATTE_THEME
    case 'rose-pine-dawn': return ROSE_PINE_DAWN_THEME
    case 'ayu-light': return AYU_LIGHT_THEME
    case 'one-light': return ONE_LIGHT_THEME
    case 'everforest-light': return EVERFOREST_LIGHT_THEME
    case 'imessage': return IMESSAGE_THEME
    case 'tokyo-night': return TOKYO_NIGHT_THEME
    case 'catppuccin-mocha': return CATPPUCCIN_MOCHA_THEME
    case 'one-dark': return ONE_DARK_THEME
    case 'monokai': return MONOKAI_THEME
    case 'kanagawa': return KANAGAWA_THEME
    case 'everforest-dark': return EVERFOREST_DARK_THEME
    case 'obsidian': return OBSIDIAN_THEME
    case 'tokyo-night-day': return TOKYO_NIGHT_DAY_THEME
    case 'quiet-light': return QUIET_LIGHT_THEME
    case 'horizon-light': return HORIZON_LIGHT_THEME
    case 'flexoki-light': return FLEXOKI_LIGHT_THEME
    case 'nord-light': return NORD_LIGHT_THEME
    case 'vitesse-light': return VITESSE_LIGHT_THEME
    case 'github-dark': return GITHUB_DARK_THEME
    case 'ayu-dark': return AYU_DARK_THEME
    case 'rose-pine': return ROSE_PINE_THEME
    case 'synthwave': return SYNTHWAVE_THEME
    case 'palenight': return PALENIGHT_THEME
    case 'night-owl': return NIGHT_OWL_THEME
    case 'flexoki-dark': return FLEXOKI_DARK_THEME
    case 'cobalt': return COBALT_THEME
    case 'vitesse-dark': return VITESSE_DARK_THEME
    case 'iceberg': return ICEBERG_THEME
    case 'iceberg-light': return ICEBERG_LIGHT_THEME
    case 'zenburn': return ZENBURN_THEME
    case 'material-darker': return MATERIAL_DARKER_THEME
    case 'claude-code': return CLAUDE_CODE_THEME
    case 'material-lighter': return MATERIAL_LIGHTER_THEME
    case 'min-light': return MIN_LIGHT_THEME
    case 'alabaster': return ALABASTER_THEME
    case 'light-owl': return LIGHT_OWL_THEME
    case 'papercolor-light': return PAPERCOLOR_LIGHT_THEME
    case 'tomorrow': return TOMORROW_THEME
    case 'oceanic-next': return OCEANIC_NEXT_THEME
    case 'papercolor-dark': return PAPERCOLOR_DARK_THEME
    case 'snazzy': return SNAZZY_THEME
    case 'tomorrow-night': return TOMORROW_NIGHT_THEME
    case 'ethereal': return ETHEREAL_THEME
    case 'hackerman': return HACKERMAN_THEME
    case 'lumon': return LUMON_THEME
    case 'matte-black': return MATTE_BLACK_THEME
    case 'miasma': return MIASMA_THEME
    case 'osaka-jade': return OSAKA_JADE_THEME
    case 'retro-82': return RETRO_82_THEME
    case 'ristretto': return RISTRETTO_THEME
    case 'vantablack': return VANTABLACK_THEME
    case 'white': return WHITE_THEME
    case 'stripe': return STRIPE_THEME
    case 'claude-cream': return CLAUDE_CREAM_THEME
    case 'supabase': return SUPABASE_THEME
    case 'posthog': return POSTHOG_THEME
    case 'replicate': return REPLICATE_THEME
    case 'notion': return NOTION_THEME
    case 'figma': return FIGMA_THEME
    case 'miro': return MIRO_THEME
    case 'apple': return APPLE_THEME
    case 'nike': return NIKE_THEME
    case 'pinterest': return PINTEREST_THEME
    case 'playstation': return PLAYSTATION_THEME
    case 'nvidia': return NVIDIA_THEME
    case 'mongodb': return MONGODB_THEME
    case 'slack': return SLACK_THEME
    case 'slack-dark': return SLACK_DARK_THEME
    case 'cohere': return COHERE_THEME
    case 'mistral': return MISTRAL_THEME
    case 'cursor': return CURSOR_THEME
    case 'airbnb': return AIRBNB_THEME
    case 'intercom': return INTERCOM_THEME
    case 'linear': return LINEAR_THEME
    case 'sentry': return SENTRY_THEME
    case 'raycast': return RAYCAST_THEME
    case 'framer': return FRAMER_THEME
    case 'ferrari': return FERRARI_THEME
    case 'resend': return RESEND_THEME
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
