import type { TuiTranscriptCard, TuiTranscriptCardLine } from '../../format'
import type { TuiPierreDiffView } from '../pierreDiffView'

export const PIERRE_DIFF_CACHE = new WeakMap<TuiTranscriptCard, {
  isExpanded: boolean
  value: TuiPierreDiffView | null
}>()
export function extractDiffText(lines: TuiTranscriptCardLine[]): string | null {
  const diffLines = lines
    .filter((line) => {
      if (line.tone === 'diff_add' || line.tone === 'diff_remove') return true
      if (line.tone === 'diff_meta') {
        const t = line.text
        return t.startsWith('@@') || t.startsWith('--- ') || t.startsWith('+++ ')
          || t.startsWith('diff --git') || t.startsWith('index ')
      }
      return false
    })
    .map((line) => line.text)
  return diffLines.length > 0 ? diffLines.join('\n') : null
}
