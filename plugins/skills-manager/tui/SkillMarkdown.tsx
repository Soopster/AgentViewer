/** @jsxImportSource @opentui/react */
import { useMemo } from 'react'
import { useRenderer } from '@opentui/react'
import { RGBA, SyntaxStyle } from '@opentui/core'
import { displayHighlightClient } from '../../../tui/opentui/shell/sdkHighlight'
import type { TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'

export function SkillMarkdown({ text, width, theme, syntaxStyle }: { text: string; width: number; theme: TuiPluginViewProps['theme']; syntaxStyle: SyntaxStyle | null }) {
  const renderer = useRenderer()
  const style = useMemo(() => syntaxStyle ?? SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex(theme.text) },
    'markup.heading': { fg: RGBA.fromHex(theme.cyan), bold: true },
    'markup.strong': { fg: RGBA.fromHex(theme.text), bold: true },
    'markup.italic': { fg: RGBA.fromHex(theme.text), italic: true },
    'markup.raw': { fg: RGBA.fromHex(theme.cyan) },
    'markup.link': { fg: RGBA.fromHex(theme.cyan) },
    'markup.quote': { fg: RGBA.fromHex(theme.dim), italic: true },
  }, renderer.nativeScene), [syntaxStyle, renderer, theme])
  // Frontmatter is metadata, not a setext heading or a pair of thematic breaks.
  const metadata = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/)
  const body = metadata ? text.slice(metadata[0].length) : text
  return <box flexDirection="column" width={width}>
    {metadata ? <box flexDirection="column" marginBottom={1} backgroundColor={theme.surface2} paddingX={1}>
      <text fg={theme.cyan}>Skill metadata</text>
      <text fg={theme.dim} wrapMode="word">{metadata[1]}</text>
    </box> : null}
    <markdown content={body} syntaxStyle={style} treeSitterClient={displayHighlightClient} fg={theme.text} width={width} streaming={false} conceal tableOptions={{ widthMode: 'content', borders: true, borderColor: theme.border, selectable: true }} />
  </box>
}
