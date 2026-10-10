import assert from 'node:assert/strict'
import { buildThreadedMessages, computeTurnDurationsMs, stripToolCallBlocks } from '../../lib/threading'
import type { SessionMessage } from '../../lib/types'
import { buildTranscriptTaskContext, ensureTuiMermaidRenderer, formatTranscriptCard, formatTranscriptCards, reformatTranscriptCardDensity } from '../format'
import type { TuiDensity } from '../theme'

// Real formatting oracle across repeated density changes: expanded code/text,
// ANSI/whitespace, thinking, Mermaid, insight, and mixed tool/text cards.
const texts = [
  '', '  \u001b[31mfirst\u001b[0m  \n\n second\t\nlast ',
  Array.from({ length: 30 }, (_, i) => `Line ${i} with unicode 日本語 ●`).join('\n'),
  'intro\n```typescript\nconst value = 1\n```\nend',
  '★ Insight ─────────────────────────────────────\nExplanation\n─────────────────────────────────────────────',
  'diagram\n```mermaid\ngraph TD\n A --> B\n```\nend',
]
const raw: SessionMessage[] = texts.flatMap((text, i): SessionMessage[] => [
  { uuid: `density-u${i}`, session_id: 'density-smoke', type: 'user', parent_tool_use_id: null,
    timestamp: new Date(Date.UTC(2026, 0, 1) + i * 10000).toISOString(), message: { role: 'user', content: text } },
  { uuid: `density-a${i}`, session_id: 'density-smoke', type: 'assistant', parent_tool_use_id: null,
    timestamp: new Date(Date.UTC(2026, 0, 1) + i * 10000 + 2000).toISOString(),
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: text }, { type: 'text', text }] } },
  { uuid: `density-t${i}`, session_id: 'density-smoke', type: 'assistant', parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'text', text },
      { type: 'tool_use', id: `density-tool${i}`, name: 'Bash', input: { command: 'echo parity' } }] } },
  { uuid: `density-r${i}`, session_id: 'density-smoke', type: 'user', parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `density-tool${i}`, content: text }] } },
])
await ensureTuiMermaidRenderer()
const threaded = buildThreadedMessages(raw)
const { activeForms, taskRegistry } = buildTranscriptTaskContext(threaded)
const durations = computeTurnDurationsMs(threaded)
const densities: TuiDensity[] = ['dense', 'comfortable', 'balanced', 'comfortable', 'dense', 'balanced']
let comparisons = 0
for (const message of threaded) {
  const duration = durations.get(message.uuid)
  let previous = formatTranscriptCard(message, 'balanced', activeForms, taskRegistry, duration)
  for (const density of densities) {
    const next = reformatTranscriptCardDensity(message, density, previous, activeForms, taskRegistry)
    assert.deepEqual(next, formatTranscriptCard(message, density, activeForms, taskRegistry, duration))
    assert.equal(next.expandedLines, previous.expandedLines, 'expanded lines shared between densities')
    assert.equal(next.codeBlocks, previous.codeBlocks, 'code blocks shared between densities')
    if (previous.autoFold || previous.hasMermaidDiagrams) assert.equal(next, previous)
    previous = next
    comparisons++
  }
}
// Exercise cache validation in the actual worker as well: TaskList depends on
// transcript-wide updates, and a changed timestamp must refresh duration data.
const worker = new Worker(new URL('./threadingWorker.ts', import.meta.url).href)
let id = 0
const taskMessages = (name: string, input: Record<string, unknown>, result: string): SessionMessage[] => [
  { uuid: `task-${name}-use`, session_id: 'density-smoke', type: 'assistant', parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: `tool-${name}`, name, input }] } },
  { uuid: `task-${name}-result`, session_id: 'density-smoke', type: 'user', parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tool-${name}`, content: result }] } },
]
try {
  for (const updated of [false, true]) {
    const messages = raw.map((message, index) => updated && index === 1
      ? { ...message, timestamp: new Date(Date.UTC(2026, 0, 1) + 4000).toISOString() }
      : message)
    messages.push(...taskMessages('TaskList', {}, JSON.stringify({ tasks: [{ id: '1', subject: 'Check density', status: 'in_progress' }] })))
    if (updated) messages.push(...taskMessages('TaskUpdate', { taskId: '1', activeForm: 'Checking updated density' }, '{"success":true}'))
    const nextThreaded = buildThreadedMessages(messages)
    for (const showToolCalls of [true, false]) {
      for (const density of densities) {
        const reply = await new Promise<{ ok: boolean; error?: string; transcriptCards: unknown }>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Density worker smoke timed out')), 30000)
          worker.onmessage = (event) => { clearTimeout(timeout); resolve(event.data) }
          worker.onerror = (event) => { clearTimeout(timeout); reject(new Error(event.message)) }
          worker.postMessage({ kind: 'format', id: ++id, session: { provider: 'codex', sessionId: 'density-smoke' }, threaded: nextThreaded, density, showToolCalls })
        })
        assert.equal(reply.ok, true, reply.error ?? 'Worker density formatting failed')
        assert.deepEqual(reply.transcriptCards, formatTranscriptCards(showToolCalls ? nextThreaded : stripToolCallBlocks(nextThreaded), density))
        comparisons++
      }
    }
  }
} finally {
  worker.terminate()
}
console.log(JSON.stringify({ smoke: 'worker-density-retention', comparisons, byteIdentical: true, sharedExpandedContent: true, taskContextAndDurationRefreshed: true }))
