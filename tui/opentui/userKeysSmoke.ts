// keys.json: rebinding, unbinding, custom commands, conflicts and every refusal,
// plus that the dispatcher and the chord help follow the installed table.
import assert from 'node:assert/strict'
import { chordEntries, chordHintText, COMMAND_CHORD_MAP } from './chordHelp'
import { portableChordCommand, portableCommandChord } from './shortcutKeys'
import { installUserKeys, parseUserKeyConfig, resolveChords, shellQuoteArgv, userCommandForChordId, userKeyProblems, userKeysPath } from './userKeys'

const known = new Map([['coord-board', 'Agent Operations'], ['desk', 'Bloomberg-style desk'], ['daily-summary', 'Daily summary']])

// Defaults are untouched until something is installed.
assert.equal(portableCommandChord('a'), 'a'); assert.equal(portableChordCommand('a'), 'coord-board')

const config = parseUserKeyConfig(`{
  // comments and trailing commas are what people write
  "chords": { "x": "daily-summary", "b": null, "z": "nope", "?": "desk", "ab": "desk", },
  "commands": [
    { "key": "g", "name": "lazygit", "run": ["lazygit"] },
    { "key": "G", "name": "dupe", "run": ["x"] },
    { "key": "t", "name": "my tests", "run": ["npm", "test", "--", "it's"] },
    { "key": "q", "run": ["x"] },
    { "key": "w", "name": "empty", "run": [] },
  ],
}`)
const resolved = resolveChords(config, known)
installUserKeys(resolved)

assert.equal(portableChordCommand('x'), 'daily-summary', 'a rebound key runs its new command')
assert.equal(portableCommandChord('b'), null, 'null unbinds a built-in')
assert.equal(portableChordCommand('a'), 'coord-board', 'untouched built-ins stay')
assert.equal(portableChordCommand('g'), 'user:g'); assert.equal(userCommandForChordId('user:g')?.name, 'lazygit')
assert.equal(portableChordCommand('t'), 'user:t', 'a custom command displaces a built-in on the same key')
assert.equal(userCommandForChordId('user:G'), null)

const problems = userKeyProblems().join('\n')
assert.match(problems, /unknown command "nope"/)
assert.match(problems, /"\?" is not a bindable single key/)
assert.match(problems, /"ab" is not a bindable single key/)
assert.match(problems, /bound twice/)
assert.match(problems, /"q" needs a name/)
assert.match(problems, /"empty" needs run/)
assert.match(problems, /⌃K t was "Teammates for this conversation"; now "my tests"/, 'a displaced binding is named')

// The chord help follows the table.
const keys = chordEntries(COMMAND_CHORD_MAP).map((entry) => entry.keys)
assert.ok(keys.includes('x') && keys.includes('g') && !keys.includes('b'))
assert.match(chordHintText(COMMAND_CHORD_MAP), /g lazygit/)

// argv never becomes shell syntax.
assert.equal(shellQuoteArgv(['npm', 'test', '--', "it's", 'a b', '$(rm -rf ~)']), `npm test -- 'it'\\''s' 'a b' '$(rm -rf ~)'`)

// Refusals that must not throw.
assert.match(parseUserKeyConfig('{ nope').problems[0], /not valid JSON/)
assert.match(parseUserKeyConfig('[]').problems[0], /must be an object/)
assert.deepEqual(parseUserKeyConfig(null).problems, [])
assert.equal(userKeysPath({ AGENT_VIEWER_KEYS_FILE: '/x/keys.json' }), '/x/keys.json')
assert.equal(userKeysPath({ XDG_CONFIG_HOME: '/cfg' }), '/cfg/agent-viewer/keys.json')

installUserKeys(null)
assert.equal(portableCommandChord('b'), 'b', 'uninstalling restores the defaults')
console.log('userKeysSmoke ok')
