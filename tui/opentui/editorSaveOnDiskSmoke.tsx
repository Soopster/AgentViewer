/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'
import { disposeAllLspSessions } from './editorLspSession'

// Save hygiene is only worth anything if the bytes on disk change, and only
// safe if they change exactly as much as was asked for. Everything here is
// asserted by reading the file back, not by reading the screen: a buffer that
// looks trimmed and a file that is trimmed are different claims.

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-save-hygiene-'))
const filePath = join(cwd, 'main.ts')

const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(DARK_THEME.text) } })

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

let handleKey: ((key: EditorKeyEvent) => boolean) | null = null

try {
  // Trailing whitespace on a line the caret will not be on, and no final newline.
  await writeFile(filePath, 'const a = 1   \nconst b = 2', 'utf8')

  const setup = await testRender(
    <EditorPopover
      cwd={cwd}
      initialPath={filePath}
      theme={DARK_THEME}
      width={110}
      height={30}
      syntaxStyle={syntaxStyle}
      onClose={() => {}}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
      onNotice={() => {}}
      onClipboardRead={async () => ''}
      onClipboardWrite={async () => {}}
    />,
    { width: 110, height: 30 },
  )

  const settle = async (ms = 300) => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
    await act(async () => { await setup.flush() })
  }
  const press = async (key: EditorKeyEvent) => {
    await act(async () => { handleKey?.(key) })
    await settle(200)
  }
  const type = async (text: string) => {
    for (const character of text) {
      await act(async () => { handleKey?.({ name: character, sequence: character } as EditorKeyEvent) })
    }
    await settle(200)
  }
  const waitForDisk = async (predicate: (text: string) => boolean, description: string, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs
    let last = ''
    while (Date.now() < deadline) {
      last = await readFile(filePath, 'utf8')
      if (predicate(last)) return last
      await settle(100)
    }
    throw new Error(`Timed out waiting for ${description}; file holds ${JSON.stringify(last)}`)
  }
  /** Run a palette command by name, the way a user would find it. */
  const runCommand = async (query: string, label: string) => {
    await press({ name: 'p', ctrl: true, shift: true, sequence: '' } as EditorKeyEvent)
    await settle(300)
    await type(query)
    await settle(300)
    const frame = setup.captureCharFrame()
    // The list truncates long labels to its column width, so match the visible
    // prefix rather than the whole command name.
    assert(frame.includes(label), `The palette did not offer "${label}" for ${JSON.stringify(query)}:\n${frame}`)
    await press({ name: 'return', sequence: '\r' } as EditorKeyEvent)
    await settle(300)
  }

  try {
    await settle(1_500)
    await settle(1_500)
    assert(handleKey, 'The editor never published a key handler')

    // Saving with hygiene off must write the buffer through untouched — the
    // whole point of the defaults being off.
    await press({ name: 's', ctrl: true, sequence: '' } as EditorKeyEvent)
    await settle(600)
    const untouched = await readFile(filePath, 'utf8')
    assert(untouched === 'const a = 1   \nconst b = 2',
      `Saving with hygiene off rewrote the file: ${JSON.stringify(untouched)}`)

    await runCommand('trim trailing', 'Toggle Trim Trailing White')
    await runCommand('final newline', 'Toggle Final Newline')

    // A real edit, so hygiene has to preserve something as well as remove
    // things. Printable characters reach the buffer through the textarea, not
    // through handleKey — handleKey sees them first and declines — so this has
    // to go through the real input path or nothing is typed at all.
    await press({ name: 'end', ctrl: true, sequence: '' } as EditorKeyEvent)
    await act(async () => { setup.mockInput.typeText('3') })
    await settle(400)
    const typedFrame = setup.captureCharFrame()
    assert(typedFrame.includes('const b = 23'), `The edit never reached the buffer:\n${typedFrame}`)
    await press({ name: 's', ctrl: true, sequence: '' } as EditorKeyEvent)

    const cleaned = await waitForDisk(
      (text) => text.endsWith('\n') && !text.includes('   \n'),
      'the trimmed, newline-terminated file to reach disk',
    )
    assert(cleaned.startsWith('const a = 1\n'),
      `Trailing whitespace was not trimmed on save: ${JSON.stringify(cleaned)}`)
    assert(cleaned.endsWith('3\n'), `The edit or the final newline was lost: ${JSON.stringify(cleaned)}`)
    // Exactly the two changes asked for, and nothing else.
    assert(cleaned === 'const a = 1\nconst b = 23\n',
      `Save hygiene changed more than it was asked to: ${JSON.stringify(cleaned)}`)

    // The buffer must now agree with the file, or the next save reports a
    // spurious disk conflict against text the editor itself wrote.
    const frame = setup.captureCharFrame()
    assert(frame.includes('✓ saved'), `The buffer is still dirty after a hygienic save:\n${frame}`)
    assert(!frame.includes('disk changed'), `A hygienic save reported a conflict against its own write:\n${frame}`)

    // The buffer itself must hold the hygienic text, not merely the tab state:
    // `activeTab.content` is the buffer's content, an invariant the whole file
    // relies on. With hygiene switched back off, a buffer that was never
    // resynced writes its stale, untrimmed text straight back to disk — which
    // is the only way to observe the difference.
    await runCommand('trim trailing', 'Toggle Trim Trailing White')
    await runCommand('final newline', 'Toggle Final Newline')
    await press({ name: 'end', ctrl: true, sequence: '' } as EditorKeyEvent)
    await act(async () => { setup.mockInput.typeText('x') })
    await settle(400)
    await press({ name: 's', ctrl: true, sequence: '' } as EditorKeyEvent)
    const afterToggleOff = await waitForDisk(
      (text) => text.includes('x'),
      'the follow-up edit to be written with hygiene switched off',
    )
    assert(!afterToggleOff.includes('   \n'),
      `The editor kept a stale pre-hygiene buffer and wrote it back: ${JSON.stringify(afterToggleOff)}`)
    assert(afterToggleOff === 'const a = 1\nconst b = 23\nx',
      `The buffer and the file disagreed after a hygienic save: ${JSON.stringify(afterToggleOff)}`)

    console.log('Editor save-hygiene on-disk smoke passed (off by default, trims and terminates when enabled)')
  } finally {
    setup.renderer?.destroy?.()
    disposeAllLspSessions()
  }
} finally {
  await rm(cwd, { recursive: true, force: true })
}
