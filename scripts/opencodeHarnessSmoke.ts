import assert from 'node:assert/strict'
import type { Event as OpenCodeEvent } from '@opencode-ai/sdk'
import {
  enqueueOpenCodeHarnessEvent,
  normalizeOpenCodeHarnessEvent,
  type OpenCodeHarnessQueuedEvent,
} from '../lib/opencodeHarness'
import { openCodeMessagesSignature } from '../lib/opencodeMapper'
import {
  isOpenCodeAssistantStreamEnvelope,
  openCodeStreamEnvelope,
  type OpenCodeMessageRole,
} from '../lib/opencodeStreamEvents'

function partUpdated(text: string, partID = 'part'): OpenCodeEvent {
  return {
    type: 'message.part.updated',
    properties: {
      part: {
        id: partID,
        sessionID: 'session',
        messageID: 'message',
        type: 'text',
        text,
      },
    },
  } as OpenCodeEvent
}

function enqueue(
  queue: OpenCodeHarnessQueuedEvent[],
  event: OpenCodeEvent,
  directory = '/repo',
): void {
  enqueueOpenCodeHarnessEvent(queue, event, directory)
}

function partDelta(delta: string, field = 'text'): OpenCodeEvent {
  return {
    type: 'message.part.delta',
    properties: {
      sessionID: 'session',
      messageID: 'message',
      partID: 'part',
      field,
      delta,
    },
  } as unknown as OpenCodeEvent
}

{
  const roles = new Map<string, OpenCodeMessageRole>()
  openCodeStreamEnvelope({
    type: 'message.updated',
    properties: {
      info: { id: 'user-message', sessionID: 'session', role: 'user' },
    },
  } as OpenCodeEvent, roles)
  const userPart = openCodeStreamEnvelope({
    type: 'message.part.updated',
    properties: {
      part: {
        id: 'user-part',
        sessionID: 'session',
        messageID: 'user-message',
        type: 'text',
        text: 'Any commits outstanding?',
      },
    },
  } as OpenCodeEvent, roles)
  assert.equal(userPart.messageRole, 'user')
  assert.equal(isOpenCodeAssistantStreamEnvelope(userPart), false, 'submitted user text must not become live assistant output')

  openCodeStreamEnvelope({
    type: 'message.updated',
    properties: {
      info: { id: 'assistant-message', sessionID: 'session', role: 'assistant' },
    },
  } as OpenCodeEvent, roles)
  const assistantDelta = openCodeStreamEnvelope({
    type: 'message.part.delta',
    properties: {
      sessionID: 'session',
      messageID: 'assistant-message',
      partID: 'assistant-part',
      field: 'text',
      delta: 'No outstanding commits.',
    },
  } as unknown as OpenCodeEvent, roles)
  assert.equal(assistantDelta.messageRole, 'assistant')
  assert.equal(isOpenCodeAssistantStreamEnvelope(assistantDelta), true)
}

{
  const asked = normalizeOpenCodeHarnessEvent({
    type: 'permission.asked',
    properties: {
      id: 'permission',
      sessionID: 'session',
      permission: 'bash',
      patterns: ['npm test'],
      always: ['npm *'],
      metadata: { command: 'npm test' },
      tool: { messageID: 'message', callID: 'call' },
    },
  } as unknown as OpenCodeEvent)
  assert.deepEqual(asked, {
    type: 'permission.updated',
    properties: {
      id: 'permission',
      type: 'bash',
      pattern: ['npm test'],
      sessionID: 'session',
      messageID: 'message',
      callID: 'call',
      title: 'Permission: bash',
      metadata: { command: 'npm test' },
      time: { created: (asked as Extract<OpenCodeEvent, { type: 'permission.updated' }>).properties.time.created },
    },
  })

  const replied = normalizeOpenCodeHarnessEvent({
    type: 'permission.replied',
    properties: { sessionID: 'session', requestID: 'permission', reply: 'once' },
  } as unknown as OpenCodeEvent)
  assert.deepEqual(replied, {
    type: 'permission.replied',
    properties: { sessionID: 'session', permissionID: 'permission', response: 'once' },
  })
}

{
  const queue: OpenCodeHarnessQueuedEvent[] = []
  enqueue(queue, partUpdated('a'))
  enqueue(queue, partUpdated('ab'))
  assert.equal(queue.length, 1, 'adjacent cumulative part snapshots should coalesce')
  const event = queue[0]?.event
  assert.equal(
    event?.type === 'message.part.updated' && event.properties.part.type === 'text'
      ? event.properties.part.text
      : undefined,
    'ab',
  )
}

{
  const queue: OpenCodeHarnessQueuedEvent[] = []
  enqueue(queue, partDelta('hello '))
  enqueue(queue, partDelta('world'))
  assert.equal(queue.length, 1, 'adjacent deltas for one field should merge within a frame')
  const properties = (queue[0]?.event as unknown as { properties?: { delta?: string } }).properties
  assert.equal(properties?.delta, 'hello world')

  enqueue(queue, {
    type: 'session.status',
    properties: { sessionID: 'session', status: { type: 'busy' } },
  } as OpenCodeEvent)
  enqueue(queue, partDelta('after barrier'))
  assert.deepEqual(
    queue.map((item) => item.event.type),
    ['message.part.delta', 'session.status', 'message.part.delta'],
    'status changes must remain a delta coalescing barrier',
  )
}

{
  const message = (text: string, status: 'running' | 'completed') => [{
    info: {
      id: 'message',
      sessionID: 'session',
      role: 'assistant',
      time: { created: 1 },
      parentID: 'parent',
      modelID: 'model',
      providerID: 'provider',
      mode: 'build',
      agent: 'build',
      path: { cwd: '/repo', root: '/repo' },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [{
      id: 'part',
      sessionID: 'session',
      messageID: 'message',
      type: 'text',
      text,
      ...(status === 'completed' ? { time: { start: 1, end: 2 } } : {}),
    }],
  }]
  const partial = message('hello', 'running')
  const complete = message('hello world', 'completed')
  assert.notEqual(
    openCodeMessagesSignature(partial as Parameters<typeof openCodeMessagesSignature>[0]),
    openCodeMessagesSignature(complete as Parameters<typeof openCodeMessagesSignature>[0]),
    'mutable tail content must invalidate the mapped transcript cache',
  )
}

{
  const queue: OpenCodeHarnessQueuedEvent[] = []
  enqueue(queue, partUpdated('old'))
  enqueue(queue, {
    type: 'message.removed',
    properties: { sessionID: 'session', messageID: 'message' },
  } as OpenCodeEvent)
  enqueue(queue, partUpdated('new'))
  assert.deepEqual(
    queue.map((item) => item.event.type),
    ['message.part.updated', 'message.removed', 'message.part.updated'],
    'message removal must be a coalescing barrier',
  )
}

{
  const queue: OpenCodeHarnessQueuedEvent[] = []
  enqueue(queue, {
    type: 'session.status',
    properties: {
      sessionID: 'session',
      status: { type: 'retry', attempt: 1, message: 'retrying', next: 1 },
    },
  } as OpenCodeEvent)
  enqueue(queue, {
    type: 'session.status',
    properties: { sessionID: 'session', status: { type: 'busy' } },
  } as OpenCodeEvent)
  assert.equal(queue.length, 2, 'edge-triggered session statuses must not coalesce')
}

{
  const queue: OpenCodeHarnessQueuedEvent[] = []
  enqueue(queue, partUpdated('repo-a'), '/repo-a')
  enqueue(queue, partUpdated('repo-b'), '/repo-b')
  assert.equal(queue.length, 2, 'different directory streams must never coalesce')
}

console.log('opencode harness smoke passed')
