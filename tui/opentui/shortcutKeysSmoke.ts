import assert from 'node:assert/strict'
import { parseKeypress } from '@opentui/core'
import {
  isAltKey,
  isCtrlKey,
  isCtrlShiftKey,
  isShiftedKey,
  portableCommandChord,
} from './shortcutKeys'

function parse(sequence: string) {
  const key = parseKeypress(sequence, { useKittyKeyboard: true })
  assert.ok(key, `Expected OpenTUI to parse ${JSON.stringify(sequence)}`)
  return key
}

const rawShiftA = parse('A')
assert.equal(isShiftedKey(rawShiftA, 'A'), true)

const rawCtrlA = parse('\x01')
assert.equal(isCtrlKey(rawCtrlA, 'a'), true)
assert.equal(isCtrlShiftKey(rawCtrlA, 'a'), false, 'raw Ctrl+A must not impersonate Ctrl+Shift+A')

const kittyCtrlShiftA = parse('\x1b[97;6u')
assert.equal(isCtrlShiftKey(kittyCtrlShiftA, 'a'), true)

const modifyOtherKeysCtrlShiftA = parse('\x1b[27;6;97~')
assert.equal(isCtrlShiftKey(modifyOtherKeysCtrlShiftA, 'a'), true)

const rawAltM = parse('\x1bm')
assert.equal(rawAltM.meta, true)
assert.equal(rawAltM.option, false)
assert.equal(isAltKey(rawAltM, 'm'), true, 'raw Alt must work when OpenTUI reports it as meta')

assert.equal(portableCommandChord('A'), 'a')
assert.equal(portableCommandChord('g'), 'g')
assert.equal(portableCommandChord('x'), null)

console.log('OpenTUI cross-platform shortcut parsing smoke passed')
