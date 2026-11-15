import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { explicitPlan, latestPlan, makePlanAnchor, restorePlanAnchor, planFeedback, planApproved, planNotes, planRevisionDiff, planSourceOffsets, type PlanTarget, type PlanSource, type PlanSend } from '../lib/plugins/planReview'
import { publishPlan, readPlan, readPlans } from '../lib/plan-review/store'
import { nativePlanReview, deliverPlan, resolvePlanFile, reconcilePlanDelivery } from '../lib/plan-review/service'
import type { SessionMessage } from '../lib/types'
const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'plan-review-'))), cwd = path.join(temp, 'repo')
process.env.AGENT_VIEWER_PLAN_REVIEW_DIR = path.join(temp, 'data')
await mkdir(cwd)
const target: PlanTarget = { provider: 'codex', providerInstanceId: 'work', sessionId: 'same-id' }
const source: PlanSource = { kind: 'message', target, messageId: 'm1', automatic: true }
const text = '# Ship safely\n\nKeep the API.\nAdd tests.\n'
let calls = 0
const mutate = (review: Awaited<ReturnType<typeof publishPlan>>, operation: Parameters<typeof nativePlanReview.mutate>[1]['operation']) => nativePlanReview.mutate(cwd, { reviewId: review.id, revision: latestPlan(review).hash, sequence: review.sequence, requestId: crypto.randomUUID(), operation })
const input = (review: Awaited<ReturnType<typeof publishPlan>>, action: PlanSend['action']): PlanSend => ({ reviewId: review.id, revision: latestPlan(review).hash, sequence: review.sequence, requestId: crypto.randomUUID(), action })
try {
  await writeFile(path.join(cwd, 'plan.markdown'), '# File plan')
  await writeFile(path.join(temp, 'outside.md'), '# Outside')
  assert.equal(await resolvePlanFile(cwd, 'plan.markdown'), path.join(cwd, 'plan.markdown'))
  await assert.rejects(resolvePlanFile(cwd, '../outside.md'), /inside this repository/)
  await symlink(path.join(temp, 'outside.md'), path.join(cwd, 'escape.md'))
  await assert.rejects(resolvePlanFile(cwd, 'escape.md'), /inside this repository/)
  const message = (body: string): SessionMessage => ({ type: 'assistant', uuid: 'm', session_id: 's', parent_tool_use_id: null, message: { role: 'assistant', content: body } })
  assert.equal(explicitPlan(message('## Plan\nordinary prose')), null)
  assert.equal(explicitPlan(message('<proposed_plan>incomplete')), null)
  assert.equal(explicitPlan(message('<proposed_plan>\n# A\n</proposed_plan>')), '# A')
  assert.equal(explicitPlan({ ...message('## Plan\n# B'), planArtifact: true }), '# B')
  assert.deepEqual(planSourceOffsets('a &amp; b', 'a & b', 10), [10, 11, 12, 17, 18, 19])
  assert.equal(explicitPlan({ ...message('<proposed_plan>\n# Partial\n</proposed_plan>'), ephemeral: true }), null)
  assert.equal(explicitPlan(message('```xml\n<proposed_plan>\n# Example\n</proposed_plan>\n```')), null)
  assert.equal(explicitPlan(message('<proposed_plan>\n# Actual\n```xml\n</proposed_plan>\n```\n</proposed_plan>')), '# Actual\n```xml\n</proposed_plan>\n```')
  const anchor = makePlanAnchor(text, text.indexOf('Add'), text.indexOf('Add') + 'Add tests.'.length)
  assert.equal(restorePlanAnchor(anchor, `Intro\n${text}`).line, 5)
  assert.equal(restorePlanAnchor(anchor, '# Gone').status, 'unmatched')
  const repeated = makePlanAnchor('duplicate duplicate', 0, 9)
  assert.equal(restorePlanAnchor({ ...repeated, prefix: '', suffix: '' }, 'duplicate duplicate').status, 'unmatched')
  assert.throws(() => makePlanAnchor(text, 0, 0))
  assert(planRevisionDiff('a\nb\nc', 'a\nd\nc').includes('- b\n+ d'))
  let review = await publishPlan(cwd, source, text)
  assert.equal((await publishPlan(cwd, source, text)).sequence, review.sequence, 'polls do not duplicate a revision')
  assert.notEqual((await publishPlan(cwd, { ...source, target: { ...target, providerInstanceId: 'personal' } }, text)).id, review.id, 'provider accounts are isolated')
  review = await mutate(review, { type: 'annotate', id: 'note1', kind: 'comment', text: 'Test failures too', start: anchor.start, end: anchor.end })
  review = await mutate(review, { type: 'draft', owner: `editor:${latestPlan(review).hash}`, draft: { text: 'Keep this draft', kind: 'global', start: 0, end: 0 } })
  assert((await readPlan(cwd, review.id)).drafts[`editor:${latestPlan(review).hash}`].text.includes('Keep this'))
  const draftOwner = `editor:${latestPlan(review).hash}`
  const staleDraft = { ...review }
  review = await mutate(review, { type: 'draft', owner: draftOwner, draft: null, expectedVersion: review.draftVersions![draftOwner] })
  await assert.rejects(mutate(staleDraft, { type: 'draft', owner: draftOwner, draft: { text: 'Late autosave', kind: 'global', start: 0, end: 0 }, expectedVersion: staleDraft.draftVersions![draftOwner] }), /Draft changed/)
  assert(!review.drafts[draftOwner], 'a deleted draft cannot be resurrected by an older generation')

  await assert.rejects(mutate({ ...review, sequence: 0 }, { type: 'approve' }), /Review changed/)
  review = await mutate(review, { type: 'approve' })
  assert(planApproved(review))
  assert.equal(calls, 0, 'approval never invokes a provider')
  const oldHash = latestPlan(review).hash
  review = await publishPlan(cwd, { ...source, messageId: 'm2' }, `Intro\n${text}`)
  assert(!planApproved(review), 'new revision needs its own approval')
  assert.equal(review.revisions.length, 2)
  assert.equal(planNotes(review)[0].anchor?.line, 5)
  assert(review.annotations.some(note => note.revision === oldHash))
  assert(!review.drafts[`editor:${latestPlan(review).hash}`], 'a draft is never silently retargeted to another revision')
  review = await nativePlanReview.mutate(cwd, { reviewId: review.id, revision: oldHash, sequence: 0, requestId: crypto.randomUUID(), operation: { type: 'draft', owner: `editor:${oldHash}`, expectedVersion: review.draftVersions![`editor:${oldHash}`], draft: { text: 'Original revision draft', kind: 'global', start: 0, end: 0 } } })
  assert.equal(review.drafts[`editor:${oldHash}`].text, 'Original revision draft')

  review = await publishPlan(cwd, source, '# Changed\nNo tests remain.')
  assert.equal(planNotes(review)[0].anchor?.status, 'unmatched')
  assert(planFeedback(review, 'feedback').includes('selection no longer matched'))
  await assert.rejects(deliverPlan(cwd, input(review, 'implement'), async () => { calls++ }), /Approve/)
  review = await mutate(review, { type: 'approve' })
  const send = input(review, 'implement')
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const delivery = async () => { calls++; await held }
  const first = deliverPlan(cwd, send, delivery)
  await new Promise(resolve => setTimeout(resolve, 20))
  await deliverPlan(cwd, send, delivery)
  assert.equal(calls, 1, 'same id cannot deliver twice')
  release(); review = await first
  assert.equal(review.deliveries.at(-1)?.status, 'sent')
  await deliverPlan(cwd, send, delivery)
  assert.equal(calls, 1)
  await assert.rejects(deliverPlan(cwd, input(review, 'implement'), delivery), /already submitted/)
  review = await publishPlan(cwd, source, '# Revision 4\nTry again')
  review = await mutate(review, { type: 'annotate', id: 'global', kind: 'global', text: 'Needs tests' })
  const failed = await deliverPlan(cwd, input(review, 'feedback'), async () => { throw new Error('Connection lost after submission') })
  assert.equal(failed.deliveries.at(-1)?.status, 'unknown')
  await assert.rejects(deliverPlan(cwd, input(failed, 'feedback'), delivery), /already submitted/)
  const reconciled = await reconcilePlanDelivery(cwd, failed.id, failed.deliveries.at(-1)!.id, [{ ...message(failed.deliveries.at(-1)!.text), type: 'user' }])
  assert.equal(reconciled.deliveries.at(-1)?.status, 'sent')
  assert.equal(calls, 1, 'reconciliation never sends anything')
  const route = await import('../app/api/plan-review/route')
  const response = await route.POST(new Request('http://localhost/api/plan-review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'read', cwd }) }))
  assert.equal(response.status, 200)
  assert((await response.json()).result.reviews.length >= 2)
  const nativeSource: PlanSource = { kind: 'native', target: { ...target, sessionId: 'native', provider: 'claude' }, permissionId: 'p1', permissionToken: 'token' }
  let native = await publishPlan(cwd, nativeSource, text)
  native = await mutate(native, { type: 'annotate', id: 'native-note', kind: 'global', text: 'Add another check' })
  native = await mutate(native, { type: 'approve' })
  await assert.rejects(deliverPlan(cwd, input(native, 'implement'), delivery), /cannot include notes/)
  native = await mutate(native, { type: 'resolve', id: 'native-note', resolved: true })
  native = await mutate(native, { type: 'approve' })
  assert.equal(planFeedback(native, 'implement').includes('Add another check'), false)
  await assert.rejects(deliverPlan(cwd, input(native, 'implement'), delivery, async () => { throw new Error('Native plan request expired') }), /expired/)
  assert.equal((await readPlan(cwd, native.id)).deliveries.length, 0)
  assert((await readPlans(cwd)).length >= 3)
  console.log('Plan Review: PASS (explicit discovery, account isolation, transactional persistence, stale writes, anchoring, revisions, drafts, approvals, idempotent delivery, uncertain delivery, native gates)')
} finally { await rm(temp, { recursive: true, force: true }) }
