import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { formatTranscriptExpandedText } from '../format'
import { openTranscriptInPager, transcriptPagerCommand } from './transcriptPager'
import type { ThreadedMessage } from '../../lib/threading'

// The pager is the escape hatch from the alternate screen: the conversation is
// handed to the terminal's own tools, which cannot see anything we draw. Both
// of its failure modes are silent — a renderer left suspended is a frozen app,
// and a collapsed tool body is a search that finds nothing — so both are pinned.

const longOutput = Array.from({ length: 40 }, (_, i) => `output line ${i + 1}`).join('\n')
const messages = [
  {
    uuid: 'u1',
    role: 'user',
    timestamp: '2026-09-18T02:00:00.000Z',
    blocks: [{ type: 'text', text: 'run the tests' }],
  },
  {
    uuid: 'a1',
    role: 'assistant',
    provider: 'claude',
    timestamp: '2026-09-18T02:00:05.000Z',
    blocks: [
      { type: 'text', text: 'Running them now.' },
      {
        type: 'tool_thread',
        toolUse: { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
        result: { type: 'tool_result', tool_use_id: 't1', content: longOutput, is_error: false },
      },
    ],
  },
] as unknown as ThreadedMessage[]

const text = formatTranscriptExpandedText(messages)
assert.match(text, /── USER · 2026-09-18T02:00:00.000Z/)
assert.match(text, /run the tests/)
assert.match(text, /Running them now\./)
assert.match(text, /npm test/)
// Expanded, not previewed: the last line of a long tool result must be there.
assert.match(text, /output line 40/, 'tool output must be expanded in full')

assert.equal(transcriptPagerCommand({ VISUAL: 'code --wait', EDITOR: 'vim' }, 'darwin'), 'code --wait')
assert.equal(transcriptPagerCommand({ EDITOR: 'vim' }, 'darwin'), 'vim')
assert.equal(transcriptPagerCommand({ VISUAL: '  ', EDITOR: '' }, 'darwin'), 'less')
assert.equal(transcriptPagerCommand({}, 'win32'), 'more')

// A fake editor that records what it was handed, and proves the renderer was
// suspended while it ran.
const dir = mkdtempSync(path.join(tmpdir(), 'pager-smoke-'))
const captured = path.join(dir, 'captured.txt')
const pathLog = path.join(dir, 'path.txt')
const editor = path.join(dir, 'fake editor.sh')
writeFileSync(editor, `#!/bin/sh\ncat "$1" > "${captured}"\nprintf '%s' "$1" > "${pathLog}"\n`)
chmodSync(editor, 0o755)

const events: string[] = []
const renderer = {
  suspend: () => events.push('suspend'),
  resume: () => events.push('resume'),
}

const ok = openTranscriptInPager(renderer, text, { env: { VISUAL: `"${editor}"` } })
assert.deepEqual(ok, { ok: true, command: `"${editor}"` })
assert.deepEqual(events, ['suspend', 'resume'])
assert.equal(readFileSync(captured, 'utf8'), text, 'the editor must receive the transcript verbatim')
assert.equal(existsSync(readFileSync(pathLog, 'utf8')), false, 'the temporary transcript must be removed')

// A failing editor still resumes the renderer, and says why.
events.length = 0
const failed = openTranscriptInPager(renderer, text, { env: { EDITOR: 'false' } })
assert.equal(failed.ok, false)
assert.match(!failed.ok ? failed.error : '', /status 1/)
assert.deepEqual(events, ['suspend', 'resume'], 'a failed editor must not leave the renderer suspended')

console.log('Transcript pager smoke passed (expanded text, command resolution, suspend/resume, cleanup, failure)')
