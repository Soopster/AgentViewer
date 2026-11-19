// How a captured sample reads on screen. A sample is a call's input and result, kept redacted; shown as raw
// compact JSON it is a wall of text, so it is laid out the way a person scans it: the input as aligned
// key/value rows, the result pretty-printed (JSON) or wrapped behind a gutter (text), long values wrapped with
// a hanging indent so a continuation lines up under its value, and anything long cut with a count of what was
// left out. Pure, so the Web and the terminal show the same thing.
import type { ShapeSample } from './shapes'

export type SampleTone = 'label' | 'key' | 'value' | 'muted' | 'bad' | 'dim'
export type SampleLine = { readonly parts: readonly (readonly [text: string, tone: SampleTone])[] }
export const SAMPLE_VIEW_LIMITS = Object.freeze({ keyColumn: 18, valueChars: 240, jsonLines: 28, textLines: 14, minWidth: 24 })

/** `text` broken at spaces into lines of at most `width`; a token longer than that is split. The first line starts at `first`, the rest at `rest`. */
export function wrapWithIndent(text: string, width: number, first = 0, rest = first): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ' '.repeat(out.length ? rest : first)
    let empty = true
    const flush = () => { out.push(line.trimEnd()); line = ' '.repeat(rest); empty = true }
    for (let word of paragraph.split(/ +/).filter(Boolean)) {
      while (line.length + (empty ? 0 : 1) + word.length > width) {
        if (!empty) { flush(); continue }
        const room = Math.max(1, width - line.length)
        line += word.slice(0, room); word = word.slice(room); flush()
      }
      line += (empty ? '' : ' ') + word; empty = false
    }
    out.push(line.trimEnd())
  }
  return out.length ? out : [' '.repeat(first)]
}

const scalar = (value: unknown): string => {
  const text = typeof value === 'string' ? value : value === undefined ? '' : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
  return text.length > SAMPLE_VIEW_LIMITS.valueChars ? `${text.slice(0, SAMPLE_VIEW_LIMITS.valueChars - 1)}…` : text
}

/** The input as rows of [key, value]: one per argument, values kept short. */
export function inputRows(input: Readonly<Record<string, unknown>>): [string, string][] {
  return Object.entries(input).map(([key, value]) => [key, scalar(value)])
}

export type ResultView = { readonly kind: 'none' | 'json' | 'text'; readonly text: string; readonly error: boolean }
/** The result as what to draw: pretty JSON when it parses (the stored sample is valid JSON by construction), else the text. */
export function resultView(sample: ShapeSample): ResultView {
  if (!sample.result) return { kind: 'none', text: '', error: false }
  const raw = sample.result.text
  if (/^\s*[[{]/.test(raw)) { try { return { kind: 'json', text: JSON.stringify(JSON.parse(raw), null, 2), error: sample.result.isError } } catch { /* not JSON */ } }
  return { kind: 'text', text: raw, error: sample.result.isError }
}

/** A sample as lines for a terminal pane `width` columns wide. */
export function sampleLines(sample: ShapeSample, index: number, total: number, width: number): SampleLine[] {
  const L = SAMPLE_VIEW_LIMITS
  const w = Math.max(L.minWidth, width)
  const lines: SampleLine[] = [{ parts: [[total > 1 ? `Sample ${index + 1} of ${total}` : 'Sample', 'label']] }]
  const rows = inputRows(sample.input)
  lines.push({ parts: [['Input', 'muted']] })
  if (!rows.length) lines.push({ parts: [['  (no arguments)', 'dim']] })
  const keyWidth = Math.min(L.keyColumn, Math.max(...rows.map(([key]) => key.length), 0))
  for (const [key, value] of rows) {
    const shownKey = key.length > keyWidth ? `${key.slice(0, keyWidth - 1)}…` : key
    const wrapped = wrapWithIndent(value, w - 2 - keyWidth - 2, 0, 0)
    wrapped.forEach((piece, i) => lines.push({ parts: [[`  ${i === 0 ? shownKey.padEnd(keyWidth) : ''.padEnd(keyWidth)}  `, 'key'], [piece, 'value']] }))
  }
  const result = resultView(sample)
  lines.push({ parts: [[result.kind === 'none' ? 'Result' : result.error ? 'Result · error' : 'Result', result.error ? 'bad' : 'muted']] })
  if (result.kind === 'none') { lines.push({ parts: [['  (the call had not finished: no result kept)', 'dim']] }); return lines }
  const body = result.kind === 'json'
    ? result.text.split('\n').flatMap(line => { const indent = line.length - line.trimStart().length; return wrapWithIndent(line.trimStart(), w - 4 - indent, indent, indent + 2) })
    : wrapWithIndent(result.text, w - 4)
  const cap = result.kind === 'json' ? L.jsonLines : L.textLines
  const tone: SampleTone = result.error ? 'bad' : 'value'
  for (const piece of body.slice(0, cap)) lines.push({ parts: [['  │ ', result.error ? 'bad' : 'dim'], [piece, tone]] })
  if (body.length > cap) lines.push({ parts: [[`  │ … ${body.length - cap} more line${body.length - cap === 1 ? '' : 's'}`, 'dim']] })
  return lines
}
