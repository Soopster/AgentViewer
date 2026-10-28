// Bound a provider RPC so a hung call surfaces as a retryable error instead of
// a request that never returns.
//
// Verified by reliabilityTimeoutSmoke.ts (without needing real Claude/Codex
// credentials or a custom-model deployment): a hung composer RPC times out at
// its bound, and the resulting message is classified as auto-retryable by
// isTransientSendError. Both properties are what every call site added for
// composer reliability depends on — changing the message text here can silently
// turn a retryable failure into a fatal one.

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      (timer as { unref: () => void }).unref()
    }
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) clearTimeout(timer)
  })
}

