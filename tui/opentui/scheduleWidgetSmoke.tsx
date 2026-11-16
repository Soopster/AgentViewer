/** @jsxImportSource @opentui/react */
// The corner "next run" widget: shows the soonest enabled schedule, nothing otherwise.
import assert from 'node:assert/strict'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { nextRunLine, nextScheduledRun } from '../../lib/schedules/describe'
import { widgets } from '../../plugins/schedules/tui/widget'
import type { Schedule } from '../../lib/schedules/types'

const now = 1_000_000
const make = (name: string, enabled: boolean, nextRunAt?: number) => ({ id: name, name, enabled, nextRunAt } as unknown as Schedule)
assert.equal(nextScheduledRun([]), null)
assert.equal(nextScheduledRun([make('off', false, now + 1000)]), null, 'a paused schedule is not next')
assert.equal(nextScheduledRun([make('nodate', true)]), null, 'no next time, nothing to show')
const soon = nextScheduledRun([make('late', true, now + 3_600_000), make('soon', true, now + 600_000), make('off', false, now + 1000)])!
assert.equal(soon.schedule.name, 'soon')
assert.equal(soon.others, 1)
assert.equal(nextRunLine(soon, now), 'soon in 10m (+1)')
assert.equal(nextRunLine({ schedule: make('x', true, now - 5), others: 0 }, now), 'x is due')

const Widget = widgets.widgets['next-run'] as any
let list: Schedule[] = []
const services = { schedules: { list: async () => list } }
const render = async () => {
  const setup = await testRender(<Widget services={services} theme={DARK_THEME} width={50} height={10} slot="corner" />, { width: 50, height: 5 })
  await act(async () => { await new Promise(r => setTimeout(r, 80)); await setup.flush() })
  await setup.renderOnce()
  const screen = setup.captureCharFrame()
  setup.renderer.destroy?.()
  return screen
}
assert(!(await render()).includes('⏱'), 'no schedules, no widget')
list = [make('Standup', true, Date.now() + 12 * 60_000), make('Later', true, Date.now() + 3 * 3_600_000)]
const screen = await render()
assert(screen.includes('⏱ Standup in 12m (+1)'), `the soonest schedule is named:\n${screen}`)
console.log('scheduleWidgetSmoke ok')
process.exit(0)
