// Screen → agent state, on captured-shape fixtures. A rule that matches too much
// fails silently (a prompt reading "esc to cancel" would mark an agent blocked), so
// the negatives matter as much as the positives.
import assert from 'node:assert/strict'
import { classifyAnyAgent, classifyScreen, CLAUDE_MANIFEST, CODEX_MANIFEST, explainScreen, manifestForProgram } from '../lib/terminalAgentDetect.mjs'

const screen = (text: string, title?: string) => ({ lines: text.split('\n'), title })

const claudeIdle = screen(`⏺ Done.\n\n──────────────────────────\n│ ❯ \n──────────────────────────\n  ? for shortcuts`)
assert.equal(classifyScreen(CLAUDE_MANIFEST, claudeIdle).state, 'idle')

const claudeWorking = screen(`⏺ Reading files\n\n✻ Pondering… (12s · ↓ 300 tokens)\n\n──────────────────────────\n│ ❯ \n──────────────────────────\n  esc to interrupt`)
assert.equal(classifyScreen(CLAUDE_MANIFEST, claudeWorking).state, 'working', 'a live turn outranks the visible prompt box')
assert.equal(classifyScreen(CLAUDE_MANIFEST, screen('x', '⠋ my task')).state, 'working', 'spinner in the title')

const claudeForm = screen(`some output\n──────────────────────────\n Which option?\n Enter to select · ↑/↓ to navigate · Esc to cancel`)
assert.equal(classifyScreen(CLAUDE_MANIFEST, claudeForm).state, 'blocked')

const claudePermission = screen(`⏺ Bash(rm -rf build)\n\n Bash command\n   rm -rf build\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No`)
assert.equal(classifyScreen(CLAUDE_MANIFEST, claudePermission).state, 'blocked')

// The user typing "esc to cancel" into the prompt box above the rule is not a blocked form.
const impersonation = screen(`⏺ Done.\n──────────────────────────\n│ ❯ the footer says esc to cancel and enter to confirm\n──────────────────────────`)
assert.notEqual(classifyScreen(CLAUDE_MANIFEST, impersonation).state, 'blocked')

const pager = screen(`...\n Showing detailed transcript · ctrl+o to toggle`)
const pagerDetection = classifyScreen(CLAUDE_MANIFEST, pager)
assert.equal(pagerDetection.keepState, true)

assert.equal(classifyScreen(CODEX_MANIFEST, screen('x', 'Action Required')).state, 'blocked')
assert.equal(classifyScreen(CODEX_MANIFEST, screen('Working (3s • esc to interrupt)\n› ')).state, 'working')
assert.equal(classifyScreen(CODEX_MANIFEST, screen('done\n› Ask Codex')).state, 'idle')
assert.equal(classifyScreen(CODEX_MANIFEST, screen('Would you like to run the following command?\n 1. Yes')).state, 'blocked')

// A plain shell is nothing.
assert.equal(classifyAnyAgent(screen('~/src $ ls\nREADME.md\n~/src $ ')), null)
assert.equal(classifyAnyAgent(claudeForm)?.agent, 'claude')
assert.equal(classifyAnyAgent(screen('Working (3s • esc to interrupt)\n› '))?.agent, 'codex')
assert.equal(classifyScreen(CLAUDE_MANIFEST, screen('nothing here')).state, 'unknown')

// Explain lists every match, best first, and its winner agrees with classify.
const explained = explainScreen(CLAUDE_MANIFEST, claudeWorking)
assert.equal(explained.winner.ruleId, explained.matched[0].id)
assert.ok(explained.matched.length >= 2)

assert.equal(manifestForProgram('/usr/local/bin/claude')?.id, 'claude')
assert.equal(manifestForProgram('codex.exe')?.id, 'codex')
assert.equal(manifestForProgram('vim'), null)
console.log('terminalAgentDetectSmoke ok')
