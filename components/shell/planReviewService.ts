import type { PlanReviewService } from '../../lib/plugins/planReview'
async function request<T>(action: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const reading = action === 'read' || action === 'messages'
  const params = new URLSearchParams({ action, ...(body.cwd ? { cwd: String(body.cwd) } : {}), ...(body.target ? { target: JSON.stringify(body.target) } : {}) })
  const response = await fetch(reading ? `/api/plan-review?${params}` : '/api/plan-review', reading ? { signal } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...body }), signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Plan Review request failed')
  return data.result
}
export const webPlanReview: PlanReviewService = {
  read: (cwd, target, signal) => request('read', { cwd, target }, signal),
  messages: (target, signal) => request('messages', { target }, signal),
  open: (cwd, input, signal) => request('open', { cwd, input }, signal),
  mutate: (cwd, input) => request('mutate', { cwd, input }),
  send: (cwd, input) => request('send', { cwd, input }),
  reconcile: (cwd, reviewId, deliveryId) => request('reconcile', { cwd, reviewId, deliveryId }),
}
