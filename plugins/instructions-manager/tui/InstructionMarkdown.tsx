/** @jsxImportSource @opentui/react */
import { useMemo } from 'react'
import { RGBA, SyntaxStyle } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import { displayHighlightClient } from '../../../tui/opentui/shell/sdkHighlight'
import type { TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
export function InstructionMarkdown({ text, width, theme, syntaxStyle }: { text: string; width: number; theme: TuiPluginViewProps['theme']; syntaxStyle: SyntaxStyle | null }) {
  const renderer = useRenderer()
  const style = useMemo(() => syntaxStyle ?? SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(theme.text) }, 'markup.heading': { fg: RGBA.fromHex(theme.cyan), bold: true }, 'markup.strong': { fg: RGBA.fromHex(theme.text), bold: true }, 'markup.raw': { fg: RGBA.fromHex(theme.cyan) } }, renderer.nativeScene), [syntaxStyle, theme, renderer])
  const metadata = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  return <box flexDirection="column" width={width}>{metadata ? <><text fg={theme.cyan}>Rule metadata</text><text fg={theme.dim} wrapMode="word">{metadata[1]}</text></> : null}<markdown content={metadata ? text.slice(metadata[0].length) : text} syntaxStyle={style} treeSitterClient={displayHighlightClient} fg={theme.text} width={width} streaming={false} conceal /></box>
}
