// Terminal output keeps its colours. A command run under a PTY or with
// FORCE_COLOR returns SGR sequences; shown raw they are `␛[31m` noise, and
// stripped they lose the red of a failing test. Highlights' `ansi` language
// tokenizes them against a theme's `terminal.ansi.*` palette, which is the same
// one the rest of the code views use.
import type { ThemedToken } from '@pierre/highlights'

export type AnsiRun = {
  text: string
  color?: string
  background?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
}
export type AnsiAppearance = 'light' | 'dark'

// Anything that sets a style. Cursor movement and `ESC[K` carry no colour, so
// output holding only those is stripped rather than tokenized.
const SGR = /\x1b\[[0-9;:]*m/
// CSI sequences (any final byte), OSC ending in BEL or ST, and short escapes.
const ESCAPES = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[ -/]*[0-~])/g

export function hasAnsiStyle(text: string): boolean {
  return text.includes('\x1b') && SGR.test(text)
}

export function stripAnsi(text: string): string {
  return text.includes('\x1b') ? text.replace(ESCAPES, '') : text
}

type Runtime = { api: typeof import('@pierre/highlights'); light: import('@pierre/highlights').Theme; dark: import('@pierre/highlights').Theme }
let runtime: Runtime | undefined
let loading: Promise<Runtime | null> | undefined

/** Load Highlights once. Callers render plain text until it resolves (or forever,
 * where WebAssembly is unavailable), so the output is never blocked on it. */
export function loadAnsiHighlighter(): Promise<boolean> {
  loading ??= Promise.all([import('@pierre/highlights'), import('@pierre/highlights/themes')])
    .then(([api, themes]) => (runtime = { api, light: themes.pierreLight, dark: themes.pierreDark }))
    .catch(() => null)
  return loading.then(loaded => loaded != null)
}

/** True once `ansiRuns` can answer synchronously. */
export function ansiHighlighterReady(): boolean {
  return runtime != null
}

/** Styled runs per line, or null when the highlighter is not loaded or fails.
 * Default-coloured text carries no colour so the surface keeps its own. */
export function ansiRuns(text: string, appearance: AnsiAppearance): AnsiRun[][] | null {
  if (!runtime) return null
  try {
    const theme = appearance === 'light' ? runtime.light : runtime.dark
    const result = runtime.api.codeToTokens(text, { lang: 'ansi', theme })
    return result.tokens.map(line => line.map(token => toRun(token, result.fg)))
  } catch {
    return null
  }
}

function toRun(token: ThemedToken, defaultColor: string | undefined): AnsiRun {
  const flags = token.fontStyle ?? 0
  const run: AnsiRun = { text: token.content }
  if (token.color && token.color !== defaultColor) run.color = token.color
  if (token.bgColor) run.background = token.bgColor
  if (flags & 2) run.bold = true
  if (flags & 1) run.italic = true
  if (flags & 4) run.underline = true
  if (flags & 8) run.strike = true
  return run
}
