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
