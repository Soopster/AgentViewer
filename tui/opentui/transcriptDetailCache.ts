import type { TuiSessionDetail } from '../../lib/tui/service'
import { mainTranscriptBudget, type SessionCacheBudget } from './sessionCacheBudget'
import { transcriptPayloadBytes } from './transcriptPayloadSize'

/** Legacy view-cache API, backed by the same session ownership budget as the
 * delivery layer. Eviction releases every view/loader representation together. */
export class TranscriptDetailCache extends Map<string, TuiSessionDetail> {
  constructor(private budget: SessionCacheBudget = mainTranscriptBudget, private capacity = 8) {
    super()
    budget.register(this)
  }
  override set(key: string, detail: TuiSessionDetail): this {
    super.delete(key)
    super.set(key, detail)
    this.budget.touch(key, detail.estimatedRetainedBytes ?? transcriptPayloadBytes(detail))
    this.budget.trim()
    for (const old of this.keys()) {
      if (this.size <= this.capacity) break
      if (!this.budget.isPinned(old)) super.delete(old)
    }
    return this
  }
  evictSession(key: string) { super.delete(key) }
}
