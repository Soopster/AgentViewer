import type { CSSProperties, ReactElement } from 'react'
import { Fragment } from 'react'
import { highlightCode, type CodeHighlight } from '@/lib/codeHighlight'
import { codeStyleToHighlightsTheme, type CodeThemeStyle } from '@/lib/codeThemeStyles'

type Options = {
  children: string; language?: string; style: CodeThemeStyle; customStyle?: CSSProperties
  showLineNumbers?: boolean; startingLineNumber?: number; wrapLongLines?: boolean
  codeTagProps?: { style?: CSSProperties }; lineNumberStyle?: CSSProperties
}

export async function renderCodeHighlight(options: Options): Promise<ReactElement | null> {
  const result = await highlightCode(options.children, options.language ?? '', codeStyleToHighlightsTheme(options.style))
  if (!result) {
    const { renderPrismHighlight } = await import('./prismCodeHighlight')
    return renderPrismHighlight(options)
  }
  return codeElement(options, result)
}

/** Reserve the same gutter and geometry while asynchronous tokens load. */
export function plainCodeHighlight(options: Options): ReactElement {
  return codeElement(options, { lines: options.children.split('\n').map(content => [{ content, offset: 0 }]) })
}

function codeElement(options: Options, result: CodeHighlight): ReactElement {
  const root = options.style['pre[class*="language-"]']
  return <pre style={{ ...root, ...options.customStyle,
    color: result.foreground ?? root?.color, background: result.background ?? root?.background, whiteSpace: 'pre' }}>
    <code style={{ fontFamily: 'inherit', ...options.codeTagProps?.style }}>
      {result.lines.map((line, index) => <Fragment key={index}>
        {index > 0 ? '\n' : null}
        {options.showLineNumbers ? <span aria-hidden="true" style={{ display: 'inline-block', ...options.lineNumberStyle }}>{(options.startingLineNumber ?? 1) + index}</span> : null}
        {line.map((token, i) => <span key={i} style={{ color: token.color,
          fontStyle: token.fontStyle && token.fontStyle & 1 ? 'italic' : undefined,
          fontWeight: token.fontStyle && token.fontStyle & 2 ? 'bold' : undefined }}>{token.content}</span>)}
      </Fragment>)}
    </code>
  </pre>
}
