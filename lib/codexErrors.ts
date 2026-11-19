export function isCodexMissingRolloutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return (
    /no rollout found for thread id/i.test(message) ||
    /thread not found:/i.test(message) ||
    // A fresh thread can be known to the creating app-server but not yet
    // loaded in the transcript worker's separate app-server connection.
    /thread not loaded:/i.test(message) ||
    /thread .+ is not materialized yet/i.test(message) ||
    /includeTurns is unavailable before first user message/i.test(message)
  )
}

export function isCodexActiveWriterError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /thread .+ already has an active writer/i.test(message)
}

