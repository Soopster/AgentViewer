import { z } from 'zod'
import { randomUUID } from 'node:crypto'

const id = z.string().min(1).max(180)
const range = z.object({ start: z.number().int().positive(), end: z.number().int().positive(), side: z.enum(['additions', 'deletions']), endSide: z.enum(['additions', 'deletions']).optional() })
const target = z.object({ filePath: z.string().min(1), hunkId: id.optional(), noteId: id.optional(), range: range.optional() })
export const reviewReadShape = { cwd: z.string().optional(), source: z.string().optional(), include_content: z.boolean().optional() }
export const reviewApplyShape = {
  cwd: z.string().optional(), source: z.string().min(1), request_id: id,
  operation: z.discriminatedUnion('type', [
    z.object({ type: z.literal('note'), revision: id, id: id.optional(), expectedVersion: z.number().int().positive().optional(), filePath: z.string().min(1), range, text: z.string().min(1).max(16000) }),
    z.object({ type: z.literal('reply'), noteId: id, text: z.string().min(1).max(16000) }),
    z.object({ type: z.literal('navigate'), viewId: id, revision: id, target }),
    z.object({ type: z.literal('decision'), hunkId: id, revision: id, status: z.enum(['approved', 'investigate', 'blocked', 'unreviewed']), rationale: z.string().max(4000).optional() }),
  ]),
}
export const reviewReloadShape = { cwd: z.string().optional(), source: z.string().min(1), view_id: id, request_id: id }
export const reviewReadDescription = 'Inspect a live Agent Viewer code review. Omit source to list comparisons and open view IDs; supply source to read hunks, notes, replies, content revision, and checklist. Content is omitted unless include_content is true. Read before commenting or navigating. Closed views are not valid navigation targets.'
export const reviewApplyDescription = 'Add an agent note, reply to a human note, mark a hunk, or explicitly navigate an open review view. Use IDs and revision from review_read and a stable request_id for retries. Notes are local review feedback, not GitHub comments. Human notes must be replied to, not edited. A navigation without appliedAt is only requested; use review_read to confirm the UI applied it. Do not move the user’s view unless requested.'
export const reviewReloadDescription = 'Refresh the Git patch for a currently open working, branch, or turn review view and return its updated revision, notes, and decisions. Read review_read first and pass the exact active view_id and a stable request_id. Closed/stale views and PR/commit comparison sources cannot be reloaded through this tool. This refreshes local Agent Viewer data; it does not change Git files or post comments.'

export function reviewReadProjection(state, includeContent = false) {
  const { receipts, ...result } = state
  return { ...result, document: { ...state.document, hunks: state.document.hunks.map(hunk => {
    if (includeContent) return hunk
    const { lines, ...summary } = hunk
    return { ...summary, oldStart: lines.find(line => line.oldLine != null)?.oldLine, newStart: lines.find(line => line.newLine != null)?.newLine }
  }) }, views: state.views.filter(view => Date.now() - view.seenAt < 15000) }
}

export function registerReviewTools(server, requestJson, cwd) {
  server.registerTool('review_read', { description: reviewReadDescription, inputSchema: reviewReadShape, annotations: { readOnlyHint: true } }, async input => {
    const query = new URLSearchParams({ cwd: input.cwd ?? cwd, ...(input.source ? { source: input.source } : {}) })
    const data = await requestJson(`/api/review?${query}`)
    return result(input.source ? reviewReadProjection(data, input.include_content) : data)
  })
  server.registerTool('review_apply', { description: reviewApplyDescription, inputSchema: reviewApplyShape }, async input => {
    const data = await requestJson('/api/review', { method: 'POST', body: JSON.stringify({
      cwd: input.cwd ?? cwd, source: input.source, requestId: input.request_id ?? randomUUID(),
      operation: { ...input.operation, ...(['note', 'reply'].includes(input.operation.type) ? { author: 'agent' } : {}) },
    }) })
    return result(reviewReadProjection(data))
  })
  server.registerTool('review_reload', { description: reviewReloadDescription, inputSchema: reviewReloadShape }, async input => {
    const effectiveCwd = input.cwd ?? cwd
    const query = new URLSearchParams({ cwd: effectiveCwd, source: input.source })
    const state = await requestJson(`/api/review?${query}`)
    const view = state.views?.find(view => view.id === input.view_id && Date.now() - view.seenAt < 15_000)
    if (!view) throw new Error('Review view is closed or no longer active. Read the open reviews again.')
    const data = await requestJson('/api/review', { method: 'POST', body: JSON.stringify({
      cwd: effectiveCwd, source: input.source, requestId: input.request_id,
      publish: { refresh: true, viewId: view.id, surface: view.surface },
    }) })
    return result(reviewReadProjection(data))
  })
}

function result(value) { return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value } }
