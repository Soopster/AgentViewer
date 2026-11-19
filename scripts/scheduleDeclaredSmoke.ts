import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.AGENT_VIEWER_SCHEDULES_DIR = mkdtempSync(path.join(os.tmpdir(), 'schedules-declared-'))
const { syncDeclaredSchedules } = await import('../lib/schedules/declared')
const { readScheduleState, updateScheduleState } = await import('../lib/schedules/store')
const { createSchedule, setScheduleEnabled } = await import('../lib/schedules/service')

const spec = (id: string) => ({
  id, name: `Digest ${id}`, trigger: { kind: 'cron' as const, expression: '0 9 * * 1-5', timeZone: 'UTC' },
  action: { kind: 'new-session' as const, provider: 'claude', cwd: '/tmp' }, prompt: 'digest',
})
const user = createSchedule({ name: 'mine', trigger: { kind: 'every', amount: 1, unit: 'h' }, action: { kind: 'new-session', provider: 'claude', cwd: '/tmp' }, prompt: 'x' })

assert.deepEqual(syncDeclaredSchedules([{ id: 'cos', schedules: [spec('morning'), spec('eod')] }]).added.sort(), ['cos:eod', 'cos:morning'])
assert.ok(readScheduleState().schedules.filter(s => s.source).every(s => s.enabled === false), 'a declared schedule starts off')

// The user turns one on and edits it; a later sync must not undo either.
setScheduleEnabled('cos:morning', true)
updateScheduleState(state => { state.schedules.find(s => s.id === 'cos:morning')!.prompt = 'my words' })
assert.deepEqual(syncDeclaredSchedules([{ id: 'cos', schedules: [spec('morning'), spec('eod')] }]), { added: [], removed: [] })
const morning = readScheduleState().schedules.find(s => s.id === 'cos:morning')!
assert.equal(morning.enabled, true)
assert.equal(morning.prompt, 'my words')

// A schedule the plugin stopped declaring goes; the user's own never does.
assert.deepEqual(syncDeclaredSchedules([{ id: 'cos', schedules: [spec('morning')] }]).removed, ['cos:eod'])
assert.deepEqual(syncDeclaredSchedules([]).removed, ['cos:morning'])
assert.deepEqual(readScheduleState().schedules.map(s => s.id), [user.id])
console.log('scheduleDeclaredSmoke ok')
