import type { TuiTranscriptWidth } from '../../lib/tuiState'

/** Reading keeps a stable left edge; review can still use the entire pane. */
export function cycleTranscriptWidth(width: TuiTranscriptWidth): TuiTranscriptWidth {
  return width === 'readable' ? 'centered' : width === 'centered' ? 'full' : 'readable'
}

export function transcriptMeasure(available: number, width: TuiTranscriptWidth): number {
  return width === 'full' ? available : Math.min(available, width === 'readable' ? 112 : 144)
}

/** A project name is enough in the dock; the expanded composer retains cwd. */
export function composerProjectLabel(cwd: string): string {
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.at(-1) ?? cwd
}
