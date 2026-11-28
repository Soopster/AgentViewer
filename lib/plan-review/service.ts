import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { explicitPlan, latestPlan, makePlanAnchor, messageText, planApproved, planFeedback, planPendingNotes, type PlanOpen, type PlanReviewService, type PlanSource, type PlanTarget, type PlanSend, type PlanReview } from '../plugins/planReview'
import { changePlan, publishPlan, readPlan, readPlans, digest, planSourceKey } from './store'
import { planMutationSchema, planSendSchema, planSourceSchema, planTargetSchema } from './schema'
import { withProviderInstance } from '../providerInstances'
import { listViewSessionMessages, readViewSessionInfo } from '../sessionReads'
import { listPendingProviderPermissionPayloads } from '../sessionControlPlane'
import { extractPendingPermissions } from '../permissions'
import { coordinatorPermissionToken } from '../coordinatorNativePermission'
import { getRunningSession } from '../sessionRuntime'
import type { SessionMessage } from '../types'
import { isPluginEnabled } from '../plugins/enablement'
function requireEnabled() { if (!isPluginEnabled('plan-review')) throw new Error('Plan Review is disabled') }
const scoped = <T>(target: PlanTarget, run: () => Promise<T>): Promise<T> => withProviderInstance(target.providerInstanceId ?? target.provider, target.provider, run)
async function checkTarget(cwd: string, target: PlanTarget) {
  const info = await scoped(target, () => readViewSessionInfo(target.sessionId, target.provider))
  if (!info?.cwd || await realpath(info.cwd) !== await realpath(cwd)) throw new Error('Choose a session in this repository')
}
export async function resolvePlanFile(cwd: string, input: string): Promise<string> {
  const root = await realpath(cwd), file = await realpath(path.resolve(root, input)), relative = path.relative(root, file)
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) || !/\.(md|markdown|mdown)$/i.test(file)) throw new Error('Choose a Markdown file inside this repository')
  return file
}
async function pendingPlans(target: PlanTarget) {
  return scoped(target, async () => extractPendingPermissions(listPendingProviderPermissionPayloads(target.sessionId, target.provider), { sessionId: target.sessionId, provider: target.provider }).filter(item => item.toolName === 'ExitPlanMode' && item.plan?.trim()))
}
export async function discoverPlans(cwd: string, target: PlanTarget, messages: readonly SessionMessage[], signal?: AbortSignal) {
  signal?.throwIfAborted()
  const pending = await pendingPlans(target)
  signal?.throwIfAborted()
  if (pending.length) {
    const item = pending[pending.length - 1]
    await publishPlan(cwd, { kind: 'native', target, permissionId: item.id, permissionToken: coordinatorPermissionToken(item) }, item.plan!)
    return
  }
  // Never take partial streaming content as a new revision.
  if (getRunningSession(target.sessionId, target)) return
  const message = [...messages].reverse().find(item => explicitPlan(item))
  if (message) {
    const source: PlanSource = { kind: 'message', target, messageId: message.uuid, automatic: true }
    const existing = (await readPlans(cwd)).find(item => item.id === digest(planSourceKey(source)))
    // An old transcript artifact must not replace a newer native handoff after its gate disappears.
    if (existing && latestPlan(existing).source.kind === 'native' && (!message.timestamp || Date.parse(message.timestamp) <= latestPlan(existing).createdAt)) return
    await publishPlan(cwd, source, explicitPlan(message)!)
  }
}
async function openPlan(cwd: string, input: PlanOpen, signal?: AbortSignal): Promise<PlanReview> {
  requireEnabled()
  const source = planSourceSchema.parse(input.source) as PlanSource
  await checkTarget(cwd, source.target)
  signal?.throwIfAborted()
  let text: string
  if (source.kind === 'file') {
    source.path = await resolvePlanFile(cwd, source.path ?? '')
    text = await readFile(source.path, 'utf8')
  } else if (source.kind === 'native') {
    const permission = (await pendingPlans(source.target)).find(item => item.id === source.permissionId)
    if (!permission || coordinatorPermissionToken(permission) !== source.permissionToken) throw new Error('Plan approval request changed')
    text = permission.plan!
  } else {
    const messages = await scoped(source.target, () => listViewSessionMessages(source.target.sessionId, { offset: 0, tail: true, limit: 2000 }, source.target.provider))
    const message = messages.find(item => item.uuid === source.messageId && item.type === 'assistant')
    if (!message) throw new Error('Assistant message not found in the recent transcript')
    text = source.automatic ? explicitPlan(message) ?? '' : explicitPlan(message) ?? messageText(message)
  }
  signal?.throwIfAborted()
  return publishPlan(cwd, source, text)
}
export type PlanDeliveryTransport = (source: PlanSource, text: string, action: PlanSend['action'], permissionMode?: PlanSend['permissionMode']) => Promise<void>
class RefusedDelivery extends Error {}
/** Injectable transport keeps persistence/delivery tests independent of live providers. */
export async function deliverPlan(cwd: string, raw: PlanSend, transport: PlanDeliveryTransport, preflight?: (source: PlanSource, action: PlanSend['action']) => Promise<void>): Promise<PlanReview> {
  requireEnabled()
  const input = planSendSchema.parse(raw)
  const current = await readPlan(cwd, input.reviewId), revision = latestPlan(current)
  const prior = current.deliveries.find(receipt => receipt.id === input.requestId)
  if (prior) return current
  if (revision.hash !== input.revision || current.sequence !== input.sequence) throw new Error('Review changed. Refresh before sending.')
  if (input.action === 'implement' && !planApproved(current)) throw new Error('Approve this revision before implementing')
  if (input.action === 'feedback' && !planPendingNotes(current).length) throw new Error('Add feedback before requesting changes')
  if (input.action === 'implement' && revision.source.kind === 'native' && planPendingNotes(current).length) throw new Error('Native plan approval cannot include notes. Resolve addressed notes, or request changes so the agent incorporates them into a new plan first.')
  if (current.deliveries.some(item => item.revision === revision.hash && item.action === input.action && item.status !== 'failed')) throw new Error('This decision was already submitted. Check the receipt and source session before resending.')
  await preflight?.(revision.source, input.action)
  requireEnabled()
  const text = planFeedback(current, input.action)
  if (text.length > 600_000) throw new Error('Feedback is too large to send. Shorten the review notes first.')
  let ownsDelivery = false
  const reserved = await changePlan(cwd, current.id, revision.hash, input.sequence, input.requestId, review => {
    ownsDelivery = true
    review.deliveries.push({ id: input.requestId, revision: revision.hash, action: input.action, status: 'pending', text, createdAt: Date.now() })
    if (input.action === 'feedback') review.decisions.push({ revision: revision.hash, kind: 'changes-requested', createdAt: Date.now() })
  })
  // A concurrent duplicate may have won the transaction; only its owner sends.
  if (!ownsDelivery) return reserved
  let status: 'sent' | 'failed' | 'unknown' = 'sent', error: string | undefined
  try { await transport(revision.source, text, input.action, input.permissionMode) }
  catch (cause) { status = cause instanceof RefusedDelivery ? 'failed' : 'unknown'; error = cause instanceof Error ? cause.message : String(cause) }
  return changePlan(cwd, current.id, undefined, undefined, `finish:${input.requestId}`, review => {
    const receipt = review.deliveries.find(item => item.id === input.requestId)!
    receipt.status = status; receipt.error = error
  })
}
async function preflight(cwd: string, source: PlanSource) {
  await checkTarget(cwd, source.target)
  if (source.kind !== 'native' && getRunningSession(source.target.sessionId, source.target)) throw new Error('Wait for the source session to finish before sending a review decision')
  if (source.kind === 'file') {
    const text = await readFile(await resolvePlanFile(cwd, source.path!), 'utf8')
    return text
  }
  if (source.kind === 'native') {
    const pending = (await pendingPlans(source.target)).find(item => item.id === source.permissionId && coordinatorPermissionToken(item) === source.permissionToken)
    if (!pending) throw new Error('Native plan request expired or changed. Refresh the source.')
  }
}
const transport: PlanDeliveryTransport = async (source, text, action, permissionMode) => scoped(source.target, async () => {
  const { runViewSessionAction, streamViewSessionTurn } = await import('../sessionBackend')
  if (source.kind === 'native') {
    await runViewSessionAction({ sessionId: source.target.sessionId, provider: source.target.provider, body: {
      action: 'respondPermission', permissionId: source.permissionId, expectedPermissionToken: source.permissionToken,
      response: action === 'implement' ? 'once' : 'reject', ...(action === 'implement' ? { permissionMode: permissionMode ?? 'default' } : { rejectionMessage: text }),
    } })
    return
  }
  const response = await streamViewSessionTurn({ sessionId: source.target.sessionId, provider: source.target.provider, signal: new AbortController().signal, body: { message: text } })
  if (!response.ok) throw new RefusedDelivery((await response.text()).slice(0, 2000) || `Send refused (${response.status})`)
  // The accepted session turn owns its lifetime, independent of this view/request.
  const reader = response.body?.getReader()
  if (reader) void (async () => { try { while (!(await reader.read()).done) { /* keep provider generator running */ } } catch (error) { console.error('[plan-review] accepted turn stream failed', error) } finally { reader.releaseLock() } })()
})
/** Reconciliation is read-only with respect to agents. Only positive transcript evidence marks delivery sent. */
export async function reconcilePlanDelivery(cwd: string, reviewId: string, deliveryId: string, messages: readonly SessionMessage[]): Promise<PlanReview> {
  const review = await readPlan(cwd, reviewId), receipt = review.deliveries.find(item => item.id === deliveryId)
  if (!receipt) throw new Error('Delivery receipt not found')
  if (receipt.status === 'sent' || receipt.status === 'failed') return review
  const found = messages.some(message => message.type === 'user' && messageText(message).includes(receipt.text))
  return changePlan(cwd, review.id, undefined, undefined, crypto.randomUUID(), next => {
    const item = next.deliveries.find(entry => entry.id === deliveryId)!
    // A late reconcile cannot replace a known result with uncertainty.
    if (item.status === 'sent' || item.status === 'failed') return
    if (found) { item.status = 'sent'; delete item.error }
    else { item.status = 'unknown'; item.error = 'No conclusive transcript receipt. Inspect the source session; resending remains blocked.' }
  })
}
export const nativePlanReview: PlanReviewService = {
  async read(cwd, rawTarget, signal) {
    signal?.throwIfAborted()
    if (rawTarget) {
      const target = planTargetSchema.parse(rawTarget) as PlanTarget
      await checkTarget(cwd, target)
      const messages = await scoped(target, () => listViewSessionMessages(target.sessionId, { offset: 0, tail: true, limit: 200 }, target.provider))
      await discoverPlans(cwd, target, messages, signal)
    }
    signal?.throwIfAborted()
    return { reviews: await readPlans(cwd) }
  },
  async messages(rawTarget, signal) {
    const target = planTargetSchema.parse(rawTarget) as PlanTarget
    const messages = await scoped(target, () => listViewSessionMessages(target.sessionId, { offset: 0, tail: true, limit: 200 }, target.provider))
    signal?.throwIfAborted()
    return messages.filter(item => item.type === 'assistant' && messageText(item).trim()).map(item => ({ id: item.uuid, text: messageText(item) }))
  },
  open: openPlan,
  async reconcile(cwd, reviewId, deliveryId) {
    requireEnabled()
    const review = await readPlan(cwd, reviewId), receipt = review.deliveries.find(item => item.id === deliveryId)
    const revision = review.revisions.find(item => item.hash === receipt?.revision)
    if (!receipt || !revision) throw new Error('Delivery receipt not found')
    await checkTarget(cwd, revision.source.target)
    const target = revision.source.target
    const messages = await scoped(target, () => listViewSessionMessages(target.sessionId, { offset: 0, tail: true, limit: 2000 }, target.provider))
    return reconcilePlanDelivery(cwd, reviewId, deliveryId, messages)
  },
  async mutate(cwd, raw) {
    const input = planMutationSchema.parse(raw)
    // Closing/disabling may flush a previously authored draft; it never dispatches agent work.
    if (input.operation.type !== 'draft') requireEnabled()
    return changePlan(cwd, input.reviewId, input.operation.type === 'draft' ? undefined : input.revision, input.operation.type === 'draft' ? undefined : input.sequence, input.requestId, review => {
      const operation = input.operation
      if (review.deliveries.some(item => item.revision === input.revision && item.status === 'pending')) throw new Error('Decision is being delivered')
      if (operation.type === 'approve') review.decisions.push({ kind: 'approved', revision: input.revision, createdAt: Date.now() })
      else if (operation.type === 'draft') {
        if (!review.revisions.some(item => item.hash === input.revision)) throw new Error('Draft revision not found')
        review.draftVersions ??= {}
        if ((review.draftVersions[operation.owner] ?? 0) !== operation.expectedVersion) throw new Error('Draft changed in another view. Inspect the refreshed review before replacing its draft.')
        // The generation survives deletion, fencing delayed autosaves from older clients.
        review.draftVersions[operation.owner] = operation.expectedVersion + 1
        if (operation.draft) review.drafts[operation.owner] = operation.draft
        else delete review.drafts[operation.owner]
      }
      else if (operation.type === 'resolve') {
        const note = review.annotations.find(item => item.id === operation.id && item.revision === input.revision)
        if (!note) throw new Error('Annotation not found')
        note.resolved = operation.resolved
      }
      else if (operation.type === 'delete') review.annotations = review.annotations.filter(note => note.id !== operation.id || note.revision !== input.revision)
      else {
        if (operation.kind !== 'deletion' && !operation.text.trim()) throw new Error('Enter annotation text')
        if (review.annotations.some(note => note.id === operation.id)) throw new Error('Annotation already exists')
        review.annotations.push({ id: operation.id, revision: input.revision, kind: operation.kind, text: operation.text.trim(), createdAt: Date.now(), ...(operation.kind !== 'global' ? { anchor: makePlanAnchor(latestPlan(review).text, operation.start ?? -1, operation.end ?? -1) } : {}) })
      }
      // Editing feedback invalidates a previous approval of that revision.
      if (operation.type === 'annotate' || operation.type === 'delete' || operation.type === 'resolve') review.decisions = review.decisions.filter(item => item.revision !== input.revision)
    })
  },
  async send(cwd, raw) {
    return deliverPlan(cwd, raw, transport, async source => {
      const text = await preflight(cwd, source)
      if (source.kind === 'file' && text !== latestPlan(await readPlan(cwd, raw.reviewId)).text) throw new Error('Plan file changed. Open it again to review the new revision.')
    })
  },
}
/** Called by the ordinary shared settled-turn hook; never starts another turn. */
export async function captureSettledPlan(target: PlanTarget, messages: readonly SessionMessage[], signal: AbortSignal) {
  const info = await scoped(target, () => readViewSessionInfo(target.sessionId, target.provider))
  signal.throwIfAborted()
  if (info?.cwd) await discoverPlans(info.cwd, target, messages, signal)
}
