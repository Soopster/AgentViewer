import { TextRenderable, type CliRenderer } from '@opentui/core'

/** Append readable assistant text while leaving the interactive TUI pinned. */
export function appendAssistantReplyToScrollback(renderer: CliRenderer, text: string): void {
  const content = text.trim()
  if (!content) return

  renderer.writeToScrollback(({ width, renderContext }) => {
    const root = new TextRenderable(renderContext, {
      content,
      width,
      wrapMode: 'word',
    })
    return {
      root,
      width,
      height: Math.max(root.virtualLineCount, 1),
      startOnNewLine: true,
      trailingNewline: true,
    }
  })
}
