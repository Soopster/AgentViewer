// A provider returning successfully is not evidence that its assigned work
// advanced. Pace repeated unchanged board states without failing or releasing
// a legitimate task that spans multiple model turns.
export function createCoordinatorTurnPacing({ baseMs = 1_000, maxMs = 30_000 } = {}) {
  let previous = null
  let repeats = 0
  const fingerprint = (actionable) => actionable ? JSON.stringify(actionable) : null
  return {
    observe(actionable) {
      const current = fingerprint(actionable)
      repeats = current !== null && current === previous ? repeats + 1 : 0
      previous = current
      // Mail and reply requests remain immediately actionable. Older daemons
      // without a digest retain their existing behavior.
      if (!current || actionable.inboxCount > 0 || actionable.replyRequiredCount > 0
        || actionable.urgentCount > 0 || repeats < 2) return 0
      return Math.min(maxMs, baseMs * 2 ** Math.min(repeats - 2, 10))
    },
    changed(actionable) {
      return fingerprint(actionable) !== previous
    },
  }
}
