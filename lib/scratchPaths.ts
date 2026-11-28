/** Client-safe half of lib/scratchSessions.ts: no Node imports. */
export const SCRATCH_PROJECT_LABEL = 'Scratch'
const SCRATCH_MARKER = '/.agent-viewer-data/scratch/'

/** Whether `cwd` is a directory made for a scratch chat. */
export function isScratchDir(cwd: string | undefined | null): boolean {
  if (!cwd) return false
  const normalized = cwd.replace(/\\/g, '/')
  const at = normalized.indexOf(SCRATCH_MARKER)
  return at >= 0 && normalized.length > at + SCRATCH_MARKER.length
}

/** The directory every scratch chat is filed under, for grouping. */
export function scratchGroupDir(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/')
  return normalized.slice(0, normalized.indexOf(SCRATCH_MARKER) + SCRATCH_MARKER.length - 1)
}
