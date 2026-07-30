/** @jsxImportSource @opentui/react */
import React from 'react'
import {
  selectTranscriptCardVariants,
  type TranscriptCardSelectionVariants,
} from './App'

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

console.log('Transcript selection identity smoke passed: reader 238/240 and split 78/80 elements reused per cursor move')
