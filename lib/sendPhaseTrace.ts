// Send-path phase timings (checkpoint, first-use imports) reported to whichever
// host cares. lib/ must not import tui/, so the TUI metrics logger registers a
// sink here; with no sink every call is a no-op.

export type SendPhase = 'checkpoint' | 'import-coordination' | 'import-send-path'

type Sink = (phase: SendPhase, durationMs: number) => void

let sink: Sink | null = null

export function setSendPhaseSink(next: Sink | null): void {
  sink = next
}

export function noteSendPhase(phase: SendPhase, startedAt: number): void {
  sink?.(phase, performance.now() - startedAt)
}

/** Resolves like `promise`, reporting how long it took to settle. */
export function timeSendPhase<T>(phase: SendPhase, promise: Promise<T>): Promise<T> {
  if (!sink) return promise
  const startedAt = performance.now()
  const report = () => noteSendPhase(phase, startedAt)
  promise.then(report, report)
  return promise
}
