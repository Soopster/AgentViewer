import { z } from 'zod'

const id = z.string().min(1).max(180)
const filePath = z.string().min(1).max(4096)
const text = z.string().trim().min(1).max(16000)
const author = z.enum(['user', 'agent'])
const version = z.number().int().positive()
export const reviewRangeSchema = z.object({
  start: z.number().int().positive(), end: z.number().int().positive(),
  side: z.enum(['additions', 'deletions']).default('additions'),
  endSide: z.enum(['additions', 'deletions']).optional(),
})
export const reviewTargetSchema = z.object({ filePath, hunkId: id.optional(), noteId: id.optional(), range: reviewRangeSchema.optional() })
export const reviewOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('note'), revision: id, id: id.optional(), expectedVersion: version.optional(), filePath, range: reviewRangeSchema, text, author }),
  z.object({ type: z.literal('reply'), noteId: id, text, author }),
  z.object({ type: z.literal('resolve'), noteId: id, resolved: z.boolean(), expectedVersion: version }),
  z.object({ type: z.literal('delete'), noteId: id, expectedVersion: version }),
  z.object({ type: z.literal('decision'), hunkId: id, status: z.enum(['approved', 'investigate', 'blocked', 'unreviewed']), rationale: z.string().max(4000).optional(), revision: id }),
  z.object({ type: z.literal('navigate'), viewId: id, target: reviewTargetSchema, revision: id }),
  z.object({ type: z.literal('ack'), viewId: id, navigationId: id }),
])
export const reviewSourceSchema = z.string().regex(/^(working|branch|turn:[0-9a-f]{7,64}|pr:[1-9][0-9]*|snapshot:[a-zA-Z0-9_-]{1,160})$/)
export const reviewRequestSchema = z.object({
  cwd: filePath, source: reviewSourceSchema, requestId: id,
  operation: reviewOperationSchema.optional(),
  publish: z.object({ patch: z.string().max(12 * 1024 * 1024).optional(), refresh: z.boolean().optional(), viewId: id, surface: z.string().min(1).max(80), close: z.boolean().optional() }).optional(),
}).refine(value => !!value.operation !== !!value.publish, 'Supply exactly one operation or publication')
