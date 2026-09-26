// TUI preferences share one file (.agent-viewer-data/tui.json). Both defects
// pinned here were silent: two quick toggles erased one another, and a torn
// write read back as `{}` so the next save wiped every preference.
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'tui-state-'))
const originalCwd = process.cwd()
process.chdir(root)
try {
  const tui = await import('../lib/tuiState')
  const dir = path.join(root, '.agent-viewer-data')

  // Different preferences written back to back, unawaited, as key handlers do.
  await Promise.all([
    tui.setConfiguredTuiTabsEnabled(false),
    tui.setConfiguredTuiDiffLayout('split'),
    tui.setConfiguredTuiTeammateNotifications('in-app'),
    tui.setConfiguredTuiTeammateNotifications('off'),
    tui.setConfiguredTuiTranscriptWidth('full'),
  ])
  assert.equal(await tui.getConfiguredTuiTabsEnabled(), false, 'an earlier toggle survives later ones')
  assert.equal(await tui.getConfiguredTuiDiffLayout(), 'split')
  assert.equal(await tui.getConfiguredTuiTranscriptWidth(), 'full')
  assert.equal(await tui.getConfiguredTuiTeammateNotifications(), 'off', 'the last choice of one setting wins')
  tui.setConfiguredTuiThemeSync('paper')
  assert.equal(await tui.getConfiguredTuiDiffLayout(), 'split', 'the synchronous theme writer merges too')
  assert.equal(readdirSync(dir).filter(name => name.endsWith('.tmp')).length, 0, 'no temporary files are left behind')

  writeFileSync(path.join(dir, 'tui.json'), '{"theme":"paper","tabsEnabled":fal')
  await tui.setConfiguredTuiDensity('dense')
  const backups = readdirSync(dir).filter(name => name.startsWith('tui.json.unreadable-'))
  assert.equal(backups.length, 1, 'an unreadable preferences file is preserved before replacement')
  assert.equal(readFileSync(path.join(dir, backups[0]), 'utf8'), '{"theme":"paper","tabsEnabled":fal')
  JSON.parse(readFileSync(path.join(dir, 'tui.json'), 'utf8'))

  console.log('TUI state: concurrent toggles keep every change, sync writer merges, atomic writes, unreadable file backed up passed')
} finally {
  process.chdir(originalCwd)
  rmSync(root, { recursive: true, force: true })
}
