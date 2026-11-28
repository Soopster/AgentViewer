import { sanitizeLabel, type TurnCheckpoint } from './checkpoints'

/** A checkpoint is taken as a turn is submitted and the provider stamps the prompt moments later. */
export const REWIND_CHECKPOINT_WINDOW_MS = 120_000

/**
 * The checkpoint snapshotted just before `prompt`'s turn — the file state a
 * rewind to that prompt should return to. Matched on session, label (the
 * prompt's first line) and time: a prompt like "continue" repeats, and picking
 * by label alone would restore the files of a different turn, which looks like
 * success. Returns null rather than guess — an unmatched rewind leaves files
 * alone, which is recoverable, where a wrong restore is not.
 */
export function checkpointForPrompt(
  checkpoints: readonly TurnCheckpoint[],
  prompt: { sessionId: string; text: string; timestamp?: string },
): TurnCheckpoint | null {
  const at = prompt.timestamp ? Date.parse(prompt.timestamp) : NaN
  if (!Number.isFinite(at)) return null
  const label = sanitizeLabel(prompt.text)
  let best: TurnCheckpoint | null = null
  let bestDelta = Infinity
  for (const checkpoint of checkpoints) {
    if (checkpoint.sessionId !== prompt.sessionId || checkpoint.label !== label) continue
    const delta = Math.abs(checkpoint.createdAt - at)
    if (delta <= REWIND_CHECKPOINT_WINDOW_MS && delta < bestDelta) {
      best = checkpoint
      bestDelta = delta
    }
  }
  return best
}
