import type { CSSProperties } from 'react'
import type { Theme } from '@pierre/highlights'
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
import { DEFAULT_CODE_THEME_ID, type CodeThemeId } from './codeThemes'

export type CodeThemeStyle = Record<string, CSSProperties>

function withoutNoisyTokenUnderlines(style: CodeThemeStyle): CodeThemeStyle {
  const classNameStyle = style['class-name']
  if (!classNameStyle?.textDecoration && !classNameStyle?.textDecorationLine) return style

  const {
    textDecoration: _textDecoration,
    textDecorationLine: _textDecorationLine,
    ...restClassNameStyle
  } = classNameStyle

  return {
    ...style,
    'class-name': restClassNameStyle,
  }
}

const CODE_THEME_STYLES: Record<CodeThemeId, CodeThemeStyle> = {
  'atom-dark': atomDark,
  'vsc-dark-plus': vscDarkPlus,
  dracula,
  'one-dark': oneDark,
  'night-owl': nightOwl,
  nord,
  'gruvbox-dark': gruvboxDark,
  synthwave84,
  'material-oceanic': materialOceanic,
  'one-light': oneLight,
  'gh-colors': ghColors,
}

export function getCodeThemeStyle(themeId: CodeThemeId): CodeThemeStyle {
  return withoutNoisyTokenUnderlines(CODE_THEME_STYLES[themeId] ?? CODE_THEME_STYLES[DEFAULT_CODE_THEME_ID])
}

const highlightsThemes = new WeakMap<CodeThemeStyle, Theme>()
// Highlights accepts hex colors; the existing palettes also contain CSS HSL,
// RGB and a few named colors. Convert those without requiring a browser DOM.
function highlightColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.startsWith('#')) return value
  const named: Record<string, string> = { white: '#ffffff', black: '#000000', green: '#008000' }
  if (named[value]) return named[value]
  const match = /^(hsla?|rgba?)\(([^)]+)\)$/.exec(value)
  if (!match) return undefined
  const values = match[2]!.split(',').map(Number.parseFloat)
  let rgb = values.slice(0, 3)
  if (match[1]!.startsWith('hsl')) {
    const [h, s, l] = values as [number, number, number]
    const lightness = l / 100, amplitude = s / 100 * Math.min(lightness, 1 - lightness)
    rgb = [0, 8, 4].map(n => {
      const k = (n + h / 30) % 12
      return 255 * (lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
    })
  }
  if (values.length > 3) rgb.push(values[3]! * 255)
  return `#${rgb.map(n => Math.round(n).toString(16).padStart(2, '0')).join('')}`
}
/** Preserve the palettes behind persisted Prism theme IDs without asking
 * Highlights to understand Prism selectors or TextMate themes. */
export function codeStyleToHighlightsTheme(style: CodeThemeStyle): Theme {
  const cached = highlightsThemes.get(style)
  if (cached) return cached
  const scopes: Record<string, string> = {
    attribute: 'attr-name', boolean: 'boolean', comment: 'comment', constant: 'constant',
    constructor: 'class-name', function: 'function', keyword: 'keyword', namespace: 'namespace',
    number: 'number', operator: 'operator', preproc: 'important', property: 'property',
    punctuation: 'punctuation', selector: 'selector', string: 'string', 'string.regex': 'regex',
    tag: 'tag', type: 'class-name', variable: 'variable', 'diff.minus': 'deleted', 'diff.plus': 'inserted',
  }
  const syntax: NonNullable<Theme['style']['syntax']> = {}
  for (const [scope, selector] of Object.entries(scopes)) {
    const token = style[selector]
    if (token) syntax[scope] = {
      color: highlightColor(token.color),
      font_style: token.fontStyle === 'italic' ? 'italic' : 'normal',
      font_weight: token.fontWeight === 'bold' || Number(token.fontWeight) >= 600 ? 700 : 400,
    }
  }
  const root = style['pre[class*="language-"]'] ?? style['code[class*="language-"]'] ?? {}
  const theme: Theme = { name: 'Agent Viewer code palette', appearance: 'dark', style: {
    'editor.foreground': highlightColor(root.color) ?? '#cccccc',
    'editor.background': highlightColor(root.background),
    syntax,
  } }
  highlightsThemes.set(style, theme)
  return theme
}
