import type { Theme, ThemedToken } from '@pierre/highlights'

export type CodeToken = Pick<ThemedToken, 'content' | 'offset' | 'color' | 'fontStyle'> & { scope?: string }
export type CodeHighlight = { lines: CodeToken[][]; foreground?: string; background?: string }

const SCOPE_THEME: Theme = { name: 'Agent Viewer scopes', appearance: 'dark', cssVariables: true, style: {} }
const ALIASES: Record<string, string> = {
  typescriptreact: 'tsx', javascriptreact: 'jsx', shell: 'bash', shellscript: 'bash', zsh: 'bash',
  docker: 'dockerfile', cs: 'csharp', ps1: 'powershell', text: 'text', txt: 'text',
}
export function normalizeHighlightLanguage(language: string): string {
  const name = language.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return ALIASES[name] ?? name
}

let runtime: Promise<typeof import('@pierre/highlights')> | undefined
/** Lazy, renderer-independent tokens. Null asks the caller to use its existing
 * fallback for unsupported languages or unavailable WebAssembly. */
export async function highlightCode(source: string, language: string, theme: Theme = SCOPE_THEME): Promise<CodeHighlight | null> {
  try {
    const api = await (runtime ??= import('@pierre/highlights'))
    const lang = normalizeHighlightLanguage(language)
    if (!api.isSupportedLanguage(lang)) return null
    const result = api.codeToTokens(source, { lang, theme })
    let start = 0
    const lines = result.tokens.map(line => {
      const tokens: CodeToken[] = line.map(token => ({
        content: token.content, offset: token.offset, color: token.color, fontStyle: token.fontStyle,
        scope: token.color?.match(/^var\(--hls-([\w-]+)\)$/)?.[1]?.replaceAll('-', '.'),
      }))
      const end = source.indexOf('\n', start)
      // Highlights omits CR in CRLF; retaining it keeps copy/reassembly exact.
      if (end >= 0 && end > start && source[end - 1] === '\r') tokens.push({ content: '\r', offset: end - 1 })
      start = end < 0 ? source.length : end + 1
      return tokens
    })
    return {
      foreground: result.fg, background: result.bg, lines,
    }
  } catch { return null }
}
