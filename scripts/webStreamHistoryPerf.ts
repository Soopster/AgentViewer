import assert from 'node:assert/strict'
import { createStreamHistoryMetadataBuilder, type StreamHistoryRow } from '../lib/streamHistoryMetadata'
import { messageToCopyText as toText } from '../lib/threadedMessageText'

// Previous production derivation, retained as the semantic and timing baseline.
function baseline(rows: readonly StreamHistoryRow[]) {
  return rows.map((row, index) => {
    const normalized = toText(row.message).replace(/\s+/g, ' ').trim()
    const firstTool = row.message.blocks.find(block => block.type === 'tool_thread')
    return {
      key: row.key, messageId: row.message.uuid, index, role: row.message.role,
      title: normalized.slice(0, 92) || row.previewBadge || `${row.message.role} message`,
      detail: normalized.length > 92 ? normalized.slice(92, 280).trim() : '',
      meta: firstTool?.type === 'tool_thread' ? firstTool.toolUse.name : `Turn ${index + 1} · ${row.message.role}`,
    }
  })
}

function measure(operation: () => unknown) {
  for (let i = 0; i < 5; i++) operation()
  const samples = []
  for (let i = 0; i < 30; i++) {
    const start = performance.now()
    operation()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return { p50Ms: samples[15], p95Ms: samples[28] }
}

for (const size of [100, 1_000, 10_000]) {
  for (const kind of ['text', 'tool'] as const) {
    const rows: StreamHistoryRow[] = Array.from({ length: size }, (_, i) => ({
      key: `row-${i}`,
      message: {
        uuid: `message-${i}`, role: i % 3 === 0 ? 'user' : 'assistant',
        blocks: kind === 'text'
          ? [{ type: 'text', text: `Message ${i}\n  ${'content  with\n whitespace '.repeat(80)}` }]
          : [{ type: 'tool_thread', toolUse: { type: 'tool_use', id: `tool-${i}`, name: 'Bash', input: { command: `echo ${i}` } }, result: { type: 'tool_result', tool_use_id: `tool-${i}`, content: 'large tool output\n'.repeat(500) } }],
      },
    }))
    let formatted = 0
    const build = createStreamHistoryMetadataBuilder(message => { formatted++; return toText(message) })
    assert.deepEqual(build(rows), baseline(rows))
    assert.equal(formatted, size)
    assert.deepEqual(build(rows.filter((_, i) => i % 2 === 0).reverse()), baseline(rows.filter((_, i) => i % 2 === 0).reverse()))
    assert.equal(formatted, size, 'filtering and reordering should reuse previews but refresh indices')
    const changed = [...rows]
    changed[size - 1] = { ...rows[size - 1], message: { ...rows[size - 1].message, blocks: [{ type: 'text', text: 'updated live content' }] } }
    assert.deepEqual(build(changed), baseline(changed))
    assert.equal(formatted, size + 1, 'replacement with the same UUID must refresh its preview')
    const before = measure(() => baseline(changed))
    const after = measure(() => build(changed))
    console.log(JSON.stringify({ workload: 'stream-history-stable-prefix', kind, rows: size, before, after, p95Speedup: before.p95Ms / after.p95Ms }))
    const coldAfter = measure(() => createStreamHistoryMetadataBuilder(toText)(changed))
    console.log(JSON.stringify({ workload: 'stream-history-cold', kind, rows: size, before, after: coldAfter, p95Speedup: before.p95Ms / coldAfter.p95Ms }))
    let tick = 0
    const liveFrames = Array.from({ length: 70 }, (_, i) => ({
      ...rows[size - 1],
      message: { ...rows[size - 1].message, blocks: [{ type: 'text' as const, text: `streaming token ${i}` }] },
    }))
    const nextFrame = () => {
      changed[size - 1] = liveFrames[tick++ % liveFrames.length]
      return changed
    }
    const liveBefore = measure(() => baseline(nextFrame()))
    const formattedBefore = formatted
    const liveAfter = measure(() => build(nextFrame()))
    assert.equal(formatted - formattedBefore, 35, 'each measured/warmup frame should format only its new live message')
    console.log(JSON.stringify({ workload: 'stream-history-live-update', kind, rows: size, before: liveBefore, after: liveAfter, p95Speedup: liveBefore.p95Ms / liveAfter.p95Ms }))
  }
}

const empty: StreamHistoryRow = { key: 'empty', previewBadge: 'queued', message: { uuid: 'empty', role: 'assistant', blocks: [] } }
const build = createStreamHistoryMetadataBuilder(toText)
assert.deepEqual(build([empty]), baseline([empty]))
assert.deepEqual(build([{ ...empty, previewBadge: 'sending' }]), baseline([{ ...empty, previewBadge: 'sending' }]))
assert.deepEqual(build([]), [])
for (const text of [
  '', '  \n\t ', ' a\n\t b ', 'x'.repeat(91) + '  y',
  'x'.repeat(279) + '\n y', 'x'.repeat(280) + ' tail',
  '\u00a0\ufeff hello \u2028 world \u3000', '😀 '.repeat(150),
  ' '.repeat(100_000) + 'after whitespace',
]) {
  const row = { ...empty, message: { ...empty.message, blocks: [{ type: 'text' as const, text }] } }
  assert.deepEqual(build([row]), baseline([row]), `preview must match the original normalizer: ${text.slice(0, 30)}`)
}
console.log('Stream history preview parity and invalidation checks passed')
