/** @jsxImportSource @opentui/react */
// What's new in the TUI: the list/detail workspace, the files each change touched,
// selection that survives a refresh, and one pane at a time on a narrow panel.
import React from 'react'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { WhatsNewPopover } from '../../plugins/whats-new/tui/WhatsNewPopover'
import { buildWhatsNew, type WhatsNewCommit } from '../../lib/whatsNew'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).getTime()
const commit = (sha: string, subject: string, when: number, files: WhatsNewCommit['files'], body = ''): WhatsNewCommit => ({ sha, subject, body, author: 'me', timestampMs: when, tags: [], files })
const fixture = () => buildWhatsNew([
  commit('aaaaaaa1', 'Add the gallery', at(15), [{ path: 'plugins/adaptive-ui/tui/Gallery.tsx', added: 120, removed: 4 }, { path: 'lib/adaptiveUi/shapes.ts', added: 30, removed: 0 }, { path: 'lib/a/very/deeply/nested/directory/structure/that/goes/on/LongFileNameForClipping.ts', added: 9, removed: 345 }, ...Array.from({ length: 40 }, (_, i) => ({ path: `lib/gen/g${i}.ts`, added: 1, removed: 1 }))], 'People could not find recipes.'),
  commit('bbbbbbb2', 'Fix a label', at(15, 9), [{ path: 'components/Label.tsx', added: 1, removed: 1 }]),
  commit('ccccccc3', 'Add live mods', at(14), [{ path: 'lib/mods/live.ts', added: 80, removed: 0 }]),
  commit('ddddddd4', 'Add a deliberately very long highlight title that cannot fit on one list row ENDMARK', at(14, 8), [{ path: 'lib/long.ts', added: 5, removed: 0 }]),
])

async function run(size: { width: number; height: number }) {
  let keys: (key: any) => boolean | void = () => false
  const read = async () => fixture()
  const t = await testRender(
    <WhatsNewPopover theme={DARK_THEME as any} accentColor="#7aa2f7" width={size.width} height={size.height} docked read={read} onClose={() => { closed++ }} onNotice={() => {}} onKeyHandlerReady={(h) => { keys = h }} onCopy={(text) => { copied = text }} />,
    size,
  )
  const press = async (name: string, sequence = name) => { await act(async () => { keys({ name, sequence, ctrl: false, shift: false }); await new Promise((r) => setTimeout(r, 30)) }); await t.flush?.() }
  const frame = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 60)) }); await t.renderOnce(); return t.captureCharFrame() }
  return { t, press, frame }
}
let closed = 0
const closedCount = (): number => closed
let copied = ''

// ── Wide: the first revision is selected and shows its aggregated files ─────
{
  const { t, press, frame } = await run({ width: 120, height: 30 })
  let screen = await frame()
  assert(screen.includes('2 days · 4 commits read'), 'the header counts what was read')
  assert(screen.includes('Sun, Nov 15, 2026') && screen.includes('Sat, Nov 14, 2026'), 'every revision is a row')
  assert(screen.includes('Gallery.tsx') && screen.includes('+120') && screen.includes('−4'), 'the first revision lists its files with line counts')
  assert(screen.includes('−345') && screen.includes('+120'), 'a row is never clipped into the scrollbar: both counts stay whole')
  assert(screen.includes('ENDMARK'), 'a long list label wraps instead of truncating')
  assert(screen.includes('structure/that/goes/') && screen.includes('  on/'), 'a long folder wraps under its file instead of truncating')
  assert(screen.indexOf('Gallery.tsx') < screen.indexOf('Label.tsx'), 'the largest change is listed first')

  await press('j')
  screen = await frame()
  assert(screen.includes('People could not find recipes.'), 'a highlight shows why it was made')
  assert(screen.includes('adaptive-ui · aaaaaaa'), 'a highlight names its area and commit')
  assert(!screen.includes('Label.tsx'), 'a highlight lists only its own files')

  await press('c')
  assert(copied.includes('### Files changed') && copied.includes('plugins/adaptive-ui/tui/Gallery.tsx (+120 −4)'), 'c copies the selected change with its files')

  await press('?', '?')
  screen = await frame()
  assert(screen.includes('Esc / ? close help') || screen.includes('? / Esc close help'), 'help opens')
  await press('j')
  assert(closedCount() === 0, 'keys go to help while it is open')
  await press('escape')
  assert(closedCount() === 0, 'Escape closes help before the view')
  await press('escape')
  assert(closedCount() === 1, 'Escape then closes the view')
  t.renderer.destroy?.()
}

// ── Narrow: one pane at a time, with a way back ─────────────────────────────
{
  const { t, press, frame } = await run({ width: 70, height: 26 })
  let screen = await frame()
  assert(screen.includes('Add the gallery') && !screen.includes('Gallery.tsx'), 'narrow shows the list alone')
  await press('j')
  await press('return')
  screen = await frame()
  assert(screen.includes('−345'), 'counts stay whole on a narrow panel too')
  assert(screen.includes('← all revisions') && screen.includes('Gallery.tsx'), 'Enter opens the detail with a way back')
  assert(!screen.includes('Add live mods'), 'the list is hidden while the detail is open')
  const before = closedCount()
  await press('escape')
  screen = await frame()
  assert(closedCount() === before && screen.includes('Add live mods'), 'Escape returns to the list instead of closing')
  t.renderer.destroy?.()
}

console.log("What's new lists revisions, shows each change's files, and stays usable on a narrow panel.")
process.exit(0)
