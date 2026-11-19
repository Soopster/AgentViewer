import { useEffect, useState } from 'react'
import type { ProtocolRunSnapshot } from '../../lib/agentProtocol'
import { readTuiProtocolRun } from '../../lib/tui/service'

/** Only an explicitly watched run is polled; this feed never acknowledges mail. */
export function useCoordinatorWorkspace(initial: ProtocolRunSnapshot | null, restoredRunId: string | null): ProtocolRunSnapshot | null {
  const [observed, setObserved] = useState<ProtocolRunSnapshot | null>(initial)
  const runId = restoredRunId ?? initial?.run.id
  useEffect(() => {
    setObserved(initial?.run.id === runId ? initial : null)
    if (!runId) return
    let disposed = false
    let pending = false
    let signature = JSON.stringify(initial)
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const next = await readTuiProtocolRun(runId)
        if (disposed || !next || next.run.id !== runId) return
        const nextSignature = JSON.stringify(next)
        if (nextSignature !== signature) { signature = nextSignature; setObserved(next) }
      } catch { /* Keep the last confirmed gates on transient read failures. */ }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 5000)
    return () => { disposed = true; clearInterval(timer) }
  }, [initial, runId])
  return observed?.run.id === runId ? observed : initial?.run.id === runId ? initial : null
}
