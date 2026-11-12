// Session alerts: tell the user when a session they walked away from needs them or has finished.
// Transition-based, never level-based: the first observation is a baseline (launching the TUI, or a
// poll that finds a turn already running, replays nothing), and a "finished" needs a turn that ran
// long enough to be worth interrupting for.
export type SessionActivity = 'needs-input' | 'running' | 'waiting'
export type SessionAlertKind = 'needs-input' | 'finished'
export type SessionAlert = { key: string; kind: SessionAlertKind }
export type SessionAlertMode = 'off' | 'in-app' | 'desktop'

/** A turn shorter than this finishing is not news. */
export const MIN_RUN_FOR_FINISHED_MS = 15_000

export function createSessionAlertTracker(minRunMs = MIN_RUN_FOR_FINISHED_MS) {
  let previous: ReadonlyMap<string, SessionActivity> | null = null
  const runningSince = new Map<string, number>()
  return {
    observe(activity: ReadonlyMap<string, SessionActivity>, now: number): SessionAlert[] {
      const alerts: SessionAlert[] = []
      if (previous) {
        for (const key of new Set([...previous.keys(), ...activity.keys()])) {
          const before = previous.get(key)
          const after = activity.get(key)
          if (after === 'needs-input' && before !== 'needs-input') {
            runningSince.delete(key)
            alerts.push({ key, kind: 'needs-input' })
          } else if (before === 'running' && after !== 'running' && after !== 'needs-input') {
            const since = runningSince.get(key)
            runningSince.delete(key)
            if (since !== undefined && now - since >= minRunMs) alerts.push({ key, kind: 'finished' })
          }
          if (after === 'running' && before !== 'running') runningSince.set(key, now)
        }
      } else {
        for (const [key, state] of activity) if (state === 'running') runningSince.set(key, now)
      }
      previous = activity
      return alerts
    },
  }
}

/** Where an alert goes. A desktop notification is for a terminal known to be blurred; the in-app
 * notice is for a user who is here but looking at another session. */
export function sessionAlertDelivery(mode: SessionAlertMode, viewing: boolean, terminalFocused: boolean | null): { notice: boolean; desktop: boolean } {
  if (mode === 'off') return { notice: false, desktop: false }
  return {
    desktop: mode === 'desktop' && terminalFocused === false,
    notice: !viewing && terminalFocused !== false,
  }
}

export function sessionAlertText(kind: SessionAlertKind, title: string): { title: string; body: string } {
  return kind === 'needs-input'
    ? { title: 'needs you', body: `${title} is waiting for your answer or approval` }
    : { title: 'finished', body: `${title} finished its turn` }
}
