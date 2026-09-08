/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'
import { formatEditorSize, MAX_EDITOR_BUFFER_CHARS, prepareEditorBuffer } from './editorLargeFile'

// A file bigger than the edit buffer used to be refused outright, so the one
// thing the editor could still usefully do with it — let someone read it — was
// not possible either. It now opens read-only. The dangerous half is the other
// direction: a buffer holding part of a file must never be written back, or
// saving replaces the file with whatever fitted.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// --- what goes in the buffer ------------------------------------------------

const small = 'line one\nline two\n'
const smallPrepared = prepareEditorBuffer(small)
assert(smallPrepared.content === small && !smallPrepared.truncated,
  'A small file must arrive whole and unflagged')

// CRLF is normalized first, so the count is of what the buffer will hold.
assert(prepareEditorBuffer('a\r\nb\r\n').content === 'a\nb\n', 'Line endings must be normalized before measuring')

const line = `${'x'.repeat(79)}\n`
const big = line.repeat(Math.ceil((MAX_EDITOR_BUFFER_CHARS * 1.4) / 80))
const bigPrepared = prepareEditorBuffer(big)
assert(bigPrepared.truncated, 'A file over the limit must be reported as truncated')
assert(bigPrepared.content.length <= MAX_EDITOR_BUFFER_CHARS,
  `The prepared buffer must fit: ${bigPrepared.content.length}`)
assert(bigPrepared.totalChars === big.length, 'The full size must be reported, not the truncated one')
// Cut on a line boundary, so the last line on screen is a real line.
assert(bigPrepared.content.endsWith('\n'), 'A truncated buffer must end at a line boundary')
assert(big.startsWith(bigPrepared.content), 'A truncated buffer must be a prefix of the file')

// A single line longer than the whole limit has no boundary to cut on; a hard
// cut still beats nothing to read.
const minified = 'y'.repeat(MAX_EDITOR_BUFFER_CHARS + 5_000)
const minifiedPrepared = prepareEditorBuffer(minified)
assert(minifiedPrepared.truncated && minifiedPrepared.content.length === MAX_EDITOR_BUFFER_CHARS,
  `A single over-long line must still be cut to the limit: ${minifiedPrepared.content.length}`)

// A banner comment followed by one enormous line — the shape of every minified
// file. Honouring the only line boundary in it showed 212 bytes of a real 1 MB
// file, because that newline sits at the top. Verified against
// plotly-basic-2.35.2.min.js in a real checkout.
const banner = '/* minified */\n'
const minifiedWithBanner = banner + 'z'.repeat(MAX_EDITOR_BUFFER_CHARS + 50_000)
const bannerPrepared = prepareEditorBuffer(minifiedWithBanner)
assert(bannerPrepared.content.length > MAX_EDITOR_BUFFER_CHARS * 0.9,
  `A line boundary near the top must not be preferred over a full buffer: held ${bannerPrepared.content.length}`)
assert(minifiedWithBanner.startsWith(bannerPrepared.content), 'The hard cut must still be a prefix')

// A boundary close to the limit is still worth using.
const tidy = `${'a'.repeat(99)}\n`.repeat(Math.ceil((MAX_EDITOR_BUFFER_CHARS * 1.2) / 100))
assert(prepareEditorBuffer(tidy).content.endsWith('\n'),
  'A line boundary near the limit must still be honoured')

// The limit is counted in characters, the unit the buffer uses. Measured in
// bytes, this file would look like ~3x its real size and be refused.
const cjk = '漢'.repeat(600_000)
assert(Buffer.byteLength(cjk) > MAX_EDITOR_BUFFER_CHARS, 'the fixture must exceed the limit in bytes')
assert(!prepareEditorBuffer(cjk).truncated,
  'A file that fits in characters must not be refused for its byte length')

assert(formatEditorSize(512) === '512 B' && formatEditorSize(2048) === '2 KB' && formatEditorSize(1024 * 1024 * 3) === '3.0 MB',
  'Sizes must be readable')

console.log('Editor large-file buffer preparation smoke passed')

// --- opening one for real ---------------------------------------------------

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-large-'))
const largePath = join(cwd, 'huge.txt')
const originalBytes = big

let keyHandler: ((key: EditorKeyEvent) => boolean) | null = null
const notices: Array<{ kind: 'info' | 'error'; message: string }> = []
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(DARK_THEME.text) } })

try {
  await writeFile(largePath, originalBytes, 'utf8')

  const setup = await testRender(
    <EditorPopover
      cwd={cwd}
      initialPath={largePath}
      theme={DARK_THEME}
      width={120}
      height={30}
      syntaxStyle={syntaxStyle}
      onClose={() => {}}
      onKeyHandlerReady={(handler) => { keyHandler = handler }}
      onNotice={(kind, message) => { notices.push({ kind, message }) }}
      onClipboardRead={async () => ''}
      onClipboardWrite={async () => {}}
    />,
    { width: 120, height: 30 },
  )

  const settle = async (ms = 400) => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
    await act(async () => { await setup.flush() })
  }
  const waitForFrame = async (predicate: (rendered: string) => boolean, description: string, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const frame = setup.captureCharFrame()
      if (predicate(frame)) return frame
      await settle(150)
    }
    throw new Error(`Timed out waiting for ${description}:\n${setup.captureCharFrame()}`)
  }

  try {
    // It opens at all — this used to be an error and a closed tab.
    const opened = await waitForFrame((frame) => frame.includes('huge.txt'), 'the large file to open')
    assert(opened.includes('huge.txt'), 'unreachable')
    assert(!opened.includes('did not fit the editor buffer'),
      `The large file was refused instead of opened read-only:\n${opened}`)

    // And says what it is showing, persistently, not just in a passing message.
    const labelled = await waitForFrame((frame) => frame.includes('read-only'), 'the read-only label')
    assert(/first .* of .*MB/.test(labelled), `The status bar must say how much of the file is shown:\n${labelled}`)

    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable
    assert(editor.plainText.length > 0 && big.startsWith(editor.plainText),
      'The buffer must hold a prefix of the real file')

    // Typing must not reach the buffer: saving is refused, so an edit could
    // only ever be lost — and a dirty truncated buffer would be snapshotted by
    // recovery and later offered back as if it were the file.
    const before = editor.plainText.length
    const handleKey = keyHandler as ((key: EditorKeyEvent) => boolean) | null
    assert(handleKey, 'The editor never published a key handler')
    const consumed = handleKey({ name: 'z', sequence: 'z' } as EditorKeyEvent)
    await settle(200)
    assert(consumed, 'A printable key must be consumed rather than passed to a read-only buffer')
    await act(async () => { setup.mockInput.typeText('zzz') })
    await settle(300)
    assert(editor.plainText.length === before,
      `A read-only buffer was edited: ${before} → ${editor.plainText.length}`)

    // Saving must refuse, and must not touch the file.
    await act(async () => { handleKey({ name: 's', ctrl: true, sequence: '' } as EditorKeyEvent) })
    await settle(600)
    const onDisk = await readFile(largePath, 'utf8')
    assert(onDisk === originalBytes,
      `Saving a read-only buffer rewrote the file: ${onDisk.length} of ${originalBytes.length} characters survived`)
    // The file surviving is not proof the guard ran: an unrelated safety net —
    // the disk-conflict check, which sees the full file where the buffer holds
    // a prefix — refuses the write too. Verified: without the guard, the file
    // still survives. So the reason has to be asserted, not just the outcome.
    assert(notices.some((notice) => notice.kind === 'error' && notice.message.includes('read-only')),
      `Saving was not refused for being read-only: ${JSON.stringify(notices)}`)
    const afterSave = setup.captureCharFrame()
    assert(afterSave.includes('read-only'), `The read-only state must survive an attempted save:\n${afterSave}`)

    console.log('Editor large-file open smoke passed (opens read-only, refuses edits and saves)')
    // Let the restore pass settle before the renderer goes away: tearing the
    // edit buffer down underneath a pending read throws "EditBuffer is
    // destroyed" and fails a smoke that has already passed.
    await settle(300)
  } finally {
    setup.renderer?.destroy?.()
  }
} finally {
  await rm(cwd, { recursive: true, force: true })
}
process.exit(0)
