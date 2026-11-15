import { z } from 'zod'
import { isAgentProvider } from '../provider'
const short = z.string().min(1).max(512)
export const planTargetSchema = z.strictObject({ provider: z.string().refine(isAgentProvider), providerInstanceId: short.optional(), sessionId: short })
export const planSourceSchema = z.strictObject({ kind: z.enum(['message', 'file', 'native']), target: planTargetSchema, messageId: short.optional(), path: z.string().min(1).max(4096).optional(), automatic: z.boolean().optional(), permissionId: short.optional(), permissionToken: short.optional() })
const kind = z.enum(['comment', 'deletion', 'global', 'label'])
const position = z.number().int().min(0).max(500_000)
const draft = z.strictObject({ text: z.string().max(20_000), start: position, end: position, kind })
const base = { reviewId: short, revision: short, sequence: z.number().int().min(0), requestId: short }
export const planMutationSchema = z.strictObject({ ...base, operation: z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('annotate'), id: short, kind, text: z.string().max(20_000), start: position.optional(), end: position.optional() }),
  z.strictObject({ type: z.literal('delete'), id: short }),
  z.strictObject({ type: z.literal('resolve'), id: short, resolved: z.boolean() }),
  z.strictObject({ type: z.literal('draft'), owner: short.refine(value => !['__proto__', 'constructor', 'prototype'].includes(value)), draft: draft.nullable(), expectedVersion: z.number().int().min(0).default(0) }),
  z.strictObject({ type: z.literal('approve') }),
]) })
export const planSendSchema = z.strictObject({ ...base, action: z.enum(['feedback', 'implement']), permissionMode: z.enum(['default', 'acceptEdits']).optional() })
