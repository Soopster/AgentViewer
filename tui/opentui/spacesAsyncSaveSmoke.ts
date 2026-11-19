// The timed save runs off the render thread, but must land, must keep the
// previous generation as a backup, and must never overwrite a newer
// synchronous flush (exit, leaving a workspace) with older data.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SpacesController } from './spacesStore'

const root = mkdtempSync(path.join(tmpdir(), 'agent-viewer-spaces-async-'))
const controller = new SpacesController(root)
const runtime = controller.runtime(controller.activeWorkspace()!)
const file = (controller as unknown as { file: string }).file
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

runtime.get('draft:a', '', true)
runtime.set('draft:a', 'first')
await wait(700)
assert.ok(existsSync(file), 'the timed save wrote the state')
assert.ok(readFileSync(file, 'utf8').includes('first'), 'the timed save carries the draft')

runtime.set('draft:a', 'second')
await wait(700)
assert.ok(readFileSync(`${file}.bak`, 'utf8').includes('first'), 'the previous generation is kept as the backup')
assert.ok(readFileSync(file, 'utf8').includes('second'))

// A synchronous flush while a timed save is pending or in flight is the newer truth.
runtime.set('draft:a', 'third')
await wait(360) // the timed save has started
runtime.set('draft:a', 'fourth')
controller.flush()
await wait(700)
assert.ok(readFileSync(file, 'utf8').includes('fourth'), 'an older in-flight save did not land over the synchronous flush')
console.log('spacesAsyncSaveSmoke: ok')
process.exit(0)
