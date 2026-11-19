// What a person does to cards, counted where it happens and reported in bulk. A fold or an expand is
// counted in memory and sent at most every FLUSH_MS, so a keystroke or a click never posts an event;
// plugins hear it as the `ui.interaction` runtime event (counts by action and tool, never content).
// Browser-safe: the sink is installed by the renderer.
export type UiInteractionAction = 'expand' | 'fold' | 'toggle' | 'view-switch'
export type UiInteractionTarget = { readonly provider: string; readonly providerInstanceId?: string; readonly sessionId: string }
export type UiInteractionReport = { readonly target: UiInteractionTarget; readonly action: UiInteractionAction; readonly subject: string; readonly count: number }
export type UiInteractionSink = (reports: readonly UiInteractionReport[]) => void | Promise<void>

export const UI_INTERACTION_FLUSH_MS = 30_000
export const UI_INTERACTION_SUBJECT = /^[A-Za-z0-9_.:-]{1,200}$/
const MAX_KEYS = 200

type Pending = { target: UiInteractionTarget; action: UiInteractionAction; subject: string; count: number }
let sink: UiInteractionSink | null = null
const pending = new Map<string, Pending>()
let timer: ReturnType<typeof setTimeout> | null = null

export function setUiInteractionSink(next: UiInteractionSink | null): void { sink = next }

export function flushUiInteractions(): void {
  if (timer) { clearTimeout(timer); timer = null }
  if (!pending.size || !sink) { pending.clear(); return }
  const reports = [...pending.values()].map(({ target, action, subject, count }) => ({ target, action, subject, count }))
  pending.clear()
  try { void Promise.resolve(sink(reports)).catch(() => { /* telemetry must never surface */ }) } catch { /* same */ }
}

/** Count one interaction. Free and synchronous; reporting is deferred and batched. */
export function reportUiInteraction(action: UiInteractionAction, subject: string, source: { readonly provider?: string; readonly providerInstanceId?: string; readonly sessionId: string } | undefined | null): void {
  // A session with no known provider cannot be named in an event, so it is not reported.
  if (!sink || !source?.provider || !UI_INTERACTION_SUBJECT.test(subject)) return
  const target: UiInteractionTarget = { provider: source.provider, ...(source.providerInstanceId ? { providerInstanceId: source.providerInstanceId } : {}), sessionId: source.sessionId }
  const key = `${target.provider}@${target.providerInstanceId ?? ''}:${target.sessionId}|${action}|${subject}`
  const entry = pending.get(key)
  if (entry) entry.count += 1
  else if (pending.size < MAX_KEYS) pending.set(key, { target: { ...target }, action, subject, count: 1 })
  if (!timer) { timer = setTimeout(flushUiInteractions, UI_INTERACTION_FLUSH_MS); (timer as { unref?: () => void }).unref?.() }
}
