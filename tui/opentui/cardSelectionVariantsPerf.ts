import assert from 'node:assert/strict'
import React from 'react'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CardSelectionVariants } from './cardSelectionVariants'
// @ts-expect-error Bun-only diagnostic API
import { heapStats } from 'bun:jsc'

// Isolated allocation probe, not a frame-time benchmark. A card has dozens of
// stable props; the old implementation copied them into three JSX elements.
const variant = process.argv[2]
if (!variant) {
  for (const mode of ['eager', 'lazy']) {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), mode], { encoding: 'utf8' })
    assert.equal(child.status, 0, child.stderr)
    process.stdout.write(child.stdout)
  }
} else {
  const count = 10000
  const props = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`prop${i}`, `value${i}`]))
  const gc = () => (globalThis as unknown as { Bun: { gc(sync: boolean): void } }).Bun.gc(true)
  const roots = globalThis as unknown as { selectionProbe?: unknown }
  gc()
  const before = heapStats().heapSize
  const started = performance.now()
  let created = 0
  const entries = Array.from({ length: count }, (_, i) => {
    const render = (hasCursor: boolean, isSelected: boolean) => {
      created++
      return React.createElement('card', { ...props, cardKey: String(i), hasCursor, isSelected })
    }
    return variant === 'lazy'
      ? new CardSelectionVariants(String(i), render)
      : { cardKey: String(i), idle: render(false, false), selected: render(false, true), focused: render(true, true) }
  })
  const visible = entries.map((entry, i) => i === 100 ? entry.focused : entry.idle)
  roots.selectionProbe = { entries, visible }
  const durationMs = performance.now() - started
  gc()
  const retainedBytes = heapStats().heapSize - before
  for (let i = 0; i < visible.length; i++) {
    assert.equal(visible[i].props.cardKey, String(i))
    assert.equal(visible[i].props.hasCursor, i === 100)
    assert.equal(visible[i].props.isSelected, i === 100)
    assert.strictEqual(visible[i], i === 100 ? entries[i].focused : entries[i].idle)
  }
  assert.equal(created, count * (variant === 'lazy' ? 1 : 3))
  console.log(JSON.stringify({ benchmark: 'card-selection-retention', variant, count, created, durationMs, retainedBytes }))
  delete roots.selectionProbe
}
