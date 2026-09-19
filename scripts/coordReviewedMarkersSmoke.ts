// Reviewed-result markers (lib/tui/coordinatorReviewed.ts). Herdr #4125:
// saved state that cannot be loaded is preserved before replacement, and left
// untouched when it cannot be preserved. The failure this pins is silent — an
// unreadable file reads as "nothing reviewed" and the next write destroys it.
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'coord-reviewed-'))
const originalCwd = process.cwd()
process.chdir(root)
try {
  const markers = await import('../lib/tui/coordinatorReviewed')
  const dir = path.join(root, '.agent-viewer-data', 'coordinator-reviewed-v1')
  const file = (scope: string) => path.join(dir, `${createHash('sha256').update(scope).digest('hex')}.json`)

  markers.writeCoordinatorReviewed('a', ['r1'])
  markers.writeCoordinatorReviewed('a', ['r2'])
  assert.deepEqual(markers.readCoordinatorReviewed('a'), ['r1', 'r2'], 'writes merge')

  mkdirSync(dir, { recursive: true })
  writeFileSync(file('b'), '{"scope":"b","reviewed":["r1"')
  assert.deepEqual(markers.readCoordinatorReviewed('b'), [], 'unreadable markers read as nothing reviewed, never an error')
  markers.writeCoordinatorReviewed('b', ['r9'])
  const backups = readdirSync(path.join(dir, 'backups'))
  assert.equal(backups.length, 1, 'the unreadable file was preserved before replacement')
  assert.equal(readFileSync(path.join(dir, 'backups', backups[0]), 'utf8'), '{"scope":"b","reviewed":["r1"', 'the backup holds the original bytes')
  assert.deepEqual(markers.readCoordinatorReviewed('b'), ['r9'])

  if (process.getuid?.() !== 0) {
    writeFileSync(file('c'), 'not json')
    chmodSync(path.join(dir, 'backups'), 0o500)
    markers.writeCoordinatorReviewed('c', ['r1'])
    chmodSync(path.join(dir, 'backups'), 0o700)
    assert.equal(readFileSync(file('c'), 'utf8'), 'not json', 'state that cannot be backed up is left untouched')
  }
  console.log('Coordinator reviewed markers: merge, unreadable-as-empty, backup before replacement, untouched when backup fails passed')
} finally {
  process.chdir(originalCwd)
  rmSync(root, { recursive: true, force: true })
}
