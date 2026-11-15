import type { PlanReviewService } from '../../../lib/plugins/planReview'
import { nativePlanReview } from '../../../lib/plan-review/service'
import { isRemoteAttached, remoteJson } from '../../../lib/tui/remote'
async function request<T>(action: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (action === 'read' || action === 'messages') {
    const params = new URLSearchParams({ action, ...(body.cwd ? { cwd: String(body.cwd) } : {}), ...(body.target ? { target: JSON.stringify(body.target) } : {}) })
    return (await remoteJson<{ result: T }>(`/api/plan-review?${params}`, { signal })).result
  }
  return (await remoteJson<{ result: T }>('/api/plan-review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...body }), signal })).result
}
export const tuiPlanReview: PlanReviewService = {
  read: (cwd, target, signal) => isRemoteAttached() ? request('read', { cwd, target }, signal) : nativePlanReview.read(cwd, target, signal),
  messages: (target, signal) => isRemoteAttached() ? request('messages', { target }, signal) : nativePlanReview.messages(target, signal),
  open: (cwd, input, signal) => isRemoteAttached() ? request('open', { cwd, input }, signal) : nativePlanReview.open(cwd, input, signal),
  mutate: (cwd, input) => isRemoteAttached() ? request('mutate', { cwd, input }) : nativePlanReview.mutate(cwd, input),
  reconcile: (cwd, reviewId, deliveryId) => isRemoteAttached() ? request('reconcile', { cwd, reviewId, deliveryId }) : nativePlanReview.reconcile(cwd, reviewId, deliveryId),
  send: (cwd, input) => isRemoteAttached() ? request('send', { cwd, input }) : nativePlanReview.send(cwd, input),
}
