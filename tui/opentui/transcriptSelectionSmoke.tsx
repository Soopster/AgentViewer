/** @jsxImportSource @opentui/react */
import React from 'react'
import {
  selectTranscriptCardVariants,
  shouldRenderStandaloneAgentToolCard,
  transcriptCursorScrollTargetKey,
  type TranscriptCardSelectionVariants,
} from './App'
import type { TuiTranscriptCard } from '../format'

function makeVariants(count: number): TranscriptCardSelectionVariants[] {
  return Array.from({ length: count }, (_, index) => ({
    cardKey: `card-${index}`,
    idle: <box id={`idle-${index}`} />,
    selected: <box id={`selected-${index}`} />,
    focused: <box id={`focused-${index}`} />,
  }))
}

function changedReferences(before: React.ReactNode[], after: React.ReactNode[]): number {
  let count = 0
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] !== after[index]) count += 1
  }
  return count
}

// Match the production reader mount budget. Moving the cursor must preserve
// element identity for every card except the old and new selection; changing
// pane focus must change only the selected card. These invariants are the
// performance win and also prevent wrappers/conditional rows from sneaking
// back into the transcript layout.
const variants = makeVariants(240)
const first = selectTranscriptCardVariants(variants, 'card-100', true)
const moved = selectTranscriptCardVariants(variants, 'card-101', true)
const blurred = selectTranscriptCardVariants(variants, 'card-101', false)

const moveChanges = changedReferences(first, moved)
if (moveChanges !== 2) {
  throw new Error(`Cursor movement replaced ${moveChanges} card elements; expected exactly 2`)
}

const focusChanges = changedReferences(moved, blurred)
if (focusChanges !== 1) {
  throw new Error(`Focus movement replaced ${focusChanges} card elements; expected exactly 1`)
}

if (moved[101] !== variants[101]?.focused || blurred[101] !== variants[101]?.selected) {
  throw new Error('Selection variants did not preserve the original focused/selected states')
}

const splitVariants = makeVariants(80)
const splitBefore = selectTranscriptCardVariants(splitVariants, 'card-10', true)
const splitAfter = selectTranscriptCardVariants(splitVariants, 'card-11', true)
const splitChanges = changedReferences(splitBefore, splitAfter)
if (splitChanges !== 2) {
  throw new Error(`Split cursor movement replaced ${splitChanges} card elements; expected exactly 2`)
}

const standaloneToolCard = {
  key: 'tool:one',
  category: 'technical',
} as TuiTranscriptCard
const standaloneDiffCard = {
  key: 'diff:one',
  category: 'diff',
} as TuiTranscriptCard
const groupedToolCard = {
  key: 'agents-tools:tool:one:tool:two:2',
  category: 'technical',
} as TuiTranscriptCard
const conversationCard = {
  key: 'assistant:one',
  category: 'conversation',
} as TuiTranscriptCard

if (!shouldRenderStandaloneAgentToolCard(standaloneToolCard, 'agents', 'centered')) {
  throw new Error('Centered Agents view did not keep a single tool call on its native card surface')
}
if (!shouldRenderStandaloneAgentToolCard(standaloneDiffCard, 'agents', 'centered')) {
  throw new Error('Centered Agents view did not keep a single file change on its native card surface')
}
if (shouldRenderStandaloneAgentToolCard(groupedToolCard, 'agents', 'centered')) {
  throw new Error('Centered Agents view unwrapped a real multi-tool group')
}
if (shouldRenderStandaloneAgentToolCard(standaloneToolCard, 'agents', 'full')) {
  throw new Error('Wide Agents view lost its agent-group presentation')
}
if (shouldRenderStandaloneAgentToolCard(standaloneToolCard, 'stream', 'centered')) {
  throw new Error('Stream view incorrectly adopted the centered Agents exception')
}
if (shouldRenderStandaloneAgentToolCard(conversationCard, 'agents', 'centered')) {
  throw new Error('Centered Agents view treated prose as a standalone tool card')
}

if (transcriptCursorScrollTargetKey('group:one', 'tool:two', true) !== 'tool:two') {
  throw new Error('Nested tool navigation did not override tail-follow with the selected child target')
}
if (transcriptCursorScrollTargetKey('group:one', 'tool:three', false) !== 'tool:three') {
  throw new Error('Detached nested tool navigation did not select the child scroll target')
}
if (transcriptCursorScrollTargetKey('card:one', null, false) !== 'card:one') {
  throw new Error('Detached transcript navigation lost the outer card scroll target')
}
if (transcriptCursorScrollTargetKey('card:one', null, true) !== null) {
  throw new Error('Ordinary tail-follow unexpectedly requested an outer card reveal')
}

console.log('Transcript selection identity, centered single-tool rendering, and nested reveal smoke passed')
