// Terminal colours in a tool's output. `sanitizeLine` strips the escapes so the
// text is always safe to lay out; this keeps what they said alongside it. The
// runs are semantic (palette names, not colours) because the TUI's theme can
// change after a transcript is formatted.
import { ansiRuns, hasAnsiStyle, loadAnsiHighlighter } from '../../lib/ansiOutput'
import type { ThreadedBlock } from '../../lib/threading'
import { extractResultText } from './tools'
import { sanitizeLine } from './text'
import type { TuiTranscriptCardLine } from './types'

function resultTexts(blocks: readonly ThreadedBlock[]): string[] {
  const texts: string[] = []
  for (const block of blocks) {
    if (block.type === 'tool_thread' && block.result) {
      const text = extractResultText(block.result.content)
      if (hasAnsiStyle(text)) texts.push(text)
    } else if (block.type === 'bash_output' && hasAnsiStyle(block.stdout)) texts.push(block.stdout)
  }
  return texts
}

/** True when formatting these blocks would use coloured output, so a caller can
 *  skip loading the highlighter for the overwhelming majority of transcripts. */
export function blocksNeedTuiAnsi(blocks: readonly ThreadedBlock[]): boolean {
  return resultTexts(blocks).length > 0
}

/** Loads Highlights if it is not loaded yet. Failure is swallowed: lines then keep
 *  their plain text, which is what they showed before. */
export async function ensureTuiAnsiHighlighter(): Promise<void> {
  await loadAnsiHighlighter()
}

/** Attach colour runs to the lines whose text is a visible line of a coloured result. */
export function attachTuiAnsiRuns(lines: TuiTranscriptCardLine[], blocks: readonly ThreadedBlock[]): void {
  const texts = resultTexts(blocks)
  if (texts.length === 0) return
  const byText = new Map<string, NonNullable<TuiTranscriptCardLine['runs']>>()
  for (const text of texts) {
    const styled = ansiRuns(text, 'semantic')
    if (!styled) return
    for (const runs of styled) {
      if (!runs.some(run => run.color || run.background || run.bold || run.italic || run.underline || run.strike)) continue
      const key = sanitizeLine(runs.map(run => run.text).join('')).trimEnd()
      if (key && !byText.has(key)) byText.set(key, runs)
    }
  }
  if (byText.size === 0) return
  for (const entry of lines) {
    if (entry.tone === 'tool' || entry.tone === 'result_error') continue
    const runs = byText.get(entry.text)
    if (runs) entry.runs = runs
  }
}
