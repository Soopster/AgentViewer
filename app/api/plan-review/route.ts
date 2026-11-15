import { NextResponse } from 'next/server'
import { nativePlanReview } from '@/lib/plan-review/service'
import { planTargetSchema, planSourceSchema, planMutationSchema, planSendSchema } from '@/lib/plan-review/schema'
import type { PlanTarget, PlanSource } from '@/lib/plugins/planReview'
import { isPluginEnabled, applyPluginSettings } from '@/lib/plugins/enablement'
import { readPluginSettingsFile } from '@/lib/plugins/settingsFile'
export const runtime = 'nodejs'
function failure(cause: unknown) { return NextResponse.json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 }) }
async function execute(body: Record<string, unknown>, signal: AbortSignal) {
  try {
    applyPluginSettings(readPluginSettingsFile())
    const draftFlush = body.action === 'mutate' && (body.input as { operation?: { type?: unknown } } | undefined)?.operation?.type === 'draft'
    if (!isPluginEnabled('plan-review') && !draftFlush) return NextResponse.json({ error: 'Plan Review is disabled' }, { status: 409 })
    let result: unknown
    if (body.action === 'messages') result = await nativePlanReview.messages(planTargetSchema.parse(body.target) as PlanTarget, signal)
    else {
      if (typeof body.cwd !== 'string' || !body.cwd || body.cwd.length > 4096) throw new Error('Repository cwd is required')
      if (body.action === 'read') result = await nativePlanReview.read(body.cwd, body.target ? planTargetSchema.parse(body.target) as PlanTarget : undefined, signal)
      else if (body.action === 'open') result = await nativePlanReview.open(body.cwd, { source: planSourceSchema.parse((body.input as { source?: unknown } | undefined)?.source) as PlanSource }, signal)
      else if (body.action === 'mutate') result = await nativePlanReview.mutate(body.cwd, planMutationSchema.parse(body.input))
      else if (body.action === 'reconcile' && typeof body.reviewId === 'string' && typeof body.deliveryId === 'string') result = await nativePlanReview.reconcile(body.cwd, body.reviewId, body.deliveryId)
      else if (body.action === 'send') result = await nativePlanReview.send(body.cwd, planSendSchema.parse(body.input))
      else throw new Error('Unknown Plan Review operation')
    }
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (cause) { return failure(cause) }
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, action = params.get('action') ?? 'read'
    if (action !== 'read' && action !== 'messages') throw new Error('Unknown read operation')
    return execute({ action, cwd: params.get('cwd'), target: params.has('target') ? JSON.parse(params.get('target')!) : undefined }, request.signal)
  } catch (cause) { return failure(cause) }
}
export async function POST(request: Request) {
  try { return execute(await request.json(), request.signal) }
  catch (cause) { return failure(cause) }
}
