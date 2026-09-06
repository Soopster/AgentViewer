import assert from 'node:assert/strict'
import type { TuiSessionDetail } from '../../lib/tui/service'
import type { TuiTranscriptCard } from '../format'
import { attachedTranscriptCardsForVariant } from './sessionDetailWorkerClient'
import { shouldPrewarmTuiRuntime } from './sessionPrewarm'

assert.equal(shouldPrewarmTuiRuntime('claude', false, false), false)
assert.equal(shouldPrewarmTuiRuntime('claude', false, true), true)
assert.equal(shouldPrewarmTuiRuntime('claude', true, false), true)
assert.equal(shouldPrewarmTuiRuntime('codex', false, false), true)
assert.equal(shouldPrewarmTuiRuntime('codex', true, false), false)
assert.equal(shouldPrewarmTuiRuntime('pi', true, false), true)

const cards = [{} as TuiTranscriptCard]
const detail = {
  info: null,
  rawMessages: [],
  threadedMessages: [],
  transcriptCards: cards,
  transcriptCardsDensity: 'comfortable',
  transcriptCardsShowToolCalls: true,
  contextUsage: null,
} satisfies TuiSessionDetail
assert.equal(attachedTranscriptCardsForVariant(detail, 'comfortable', true), cards)
assert.equal(attachedTranscriptCardsForVariant(detail, 'dense', true), null)
assert.equal(attachedTranscriptCardsForVariant(detail, 'comfortable', false), null)

console.log('Session open policy smoke passed')
