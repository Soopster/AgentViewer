import assert from 'node:assert/strict'
import { createTipScheduler, TIP_COOLDOWN_MS, type TipClock } from '../plugins/tips/model'
import { listFeatureTips } from '../plugins/tips/catalog'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS } from '../lib/plugins/enablement'
import { listComposerAccessories, createComposerAccessoryController } from '../lib/plugins/composerHost'
import { manifest } from '../plugins/tips/manifest'
import { manifest as goals } from '../plugins/goals/manifest'
import type { ComposerTurnContext } from '../lib/plugins/composer'
import { sessionIdentityKey } from '../lib/sessionIdentity'

function fixture(random = 0) {
  let now = 1_000_000, draws = 0, next = 0
  const timers = new Map<number, { at: number; callback: () => void }>()
  const clock: TipClock = {
    now: () => now, random: () => { draws++; return random },
    schedule(callback, delay) { const id = ++next; timers.set(id, { at: now + delay, callback }); return () => { timers.delete(id) } },
  }
  return {
    scheduler: createTipScheduler(clock),
    turn: (id: string, overrides: Partial<ComposerTurnContext> = {}): ComposerTurnContext => ({ id, startedAt: now, running: true, needsAttention: false, ...overrides }),
    draws: () => draws,
    tick(ms: number) {
      const end = now + ms
      for (;;) {
        const task = [...timers.entries()].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!task) break
        now = task[1].at; timers.delete(task[0]); task[1].callback()
      }
      now = end
    },
  }
}
const tips = [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }]
{
  const f = fixture(), turn = f.turn('one')
  let notifications = 0
  const off = f.scheduler.subscribe(() => { notifications++ })
  f.scheduler.update(turn, true, tips)
  for (let n = 0; n < 10; n++) f.scheduler.update({ ...turn }, true, tips)
  assert.equal(f.draws(), 1, 'poll updates must not reroll')
  f.tick(7999); assert.equal(f.scheduler.getSnapshot(), null)
  f.tick(1); assert.equal(f.scheduler.getSnapshot()?.id, 'a')
  f.tick(19999); assert.ok(f.scheduler.getSnapshot())
  f.tick(1); assert.equal(f.scheduler.getSnapshot(), null)
  f.scheduler.update(f.turn('cooldown'), true, tips); f.tick(8000)
  assert.equal(f.scheduler.getSnapshot(), null)
  f.tick(TIP_COOLDOWN_MS)
  f.scheduler.update(f.turn('two'), true, tips); f.tick(8000)
  assert.equal(f.scheduler.getSnapshot()?.id, 'b', 'rotate before repeating')
  f.tick(TIP_COOLDOWN_MS)
  f.scheduler.update(f.turn('three'), true, tips); f.tick(8000)
  assert.equal(f.scheduler.getSnapshot()?.id, 'a', 'new shuffled cycle')
  assert.equal(notifications, 5); off(); f.scheduler.cancel()
}
for (const random of [.25, .99]) {
  const f = fixture(random)
  f.scheduler.update(f.turn('skip'), true, tips); f.tick(9000)
  assert.equal(f.scheduler.getSnapshot(), null)
}
for (const reason of ['hidden', 'attention', 'settled', 'switch', 'disable', 'empty'] as const) {
  for (const alreadyVisible of [false, true]) {
    const f = fixture(), turn = f.turn('original')
    f.scheduler.update(turn, true, tips)
    if (alreadyVisible) { f.tick(8000); assert.ok(f.scheduler.getSnapshot()) }
    if (reason === 'disable') f.scheduler.cancel()
    else if (reason === 'switch') f.scheduler.update(f.turn('other', { needsAttention: true }), true, tips)
    else f.scheduler.update({ ...turn, needsAttention: reason === 'attention', running: reason !== 'settled' }, reason !== 'hidden', reason === 'empty' ? [] : tips)
    assert.equal(f.scheduler.getSnapshot(), null, reason)
    f.tick(9000)
    f.scheduler.update(turn, true, tips); f.tick(8000)
    assert.equal(f.scheduler.getSnapshot(), null, `${reason} must not replay`)
  }
}
{
  const f = fixture(), turn = f.turn('late', { startedAt: 1_000_000 - 9000 })
  f.scheduler.update(turn, true, tips); f.tick(9000)
  assert.equal(f.scheduler.getSnapshot(), null, 'do not replay late turns')
}
{
  const f = fixture(), turn = f.turn('removed')
  f.scheduler.update(turn, true, tips); f.tick(8000)
  f.scheduler.update(turn, true, [tips[1]])
  assert.equal(f.scheduler.getSnapshot(), null, 'hide unavailable feature immediately')
}
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
const session = { provider: 'codex' as const, providerInstanceId: 'work', sessionId: 'one' }
for (const renderer of ['web', 'tui'] as const) {
  const eligible = listFeatureTips(renderer, session, true)
  assert.deepEqual(eligible.map(tip => tip.id), ['goals', 'bookmarks', 'prompts', 'skills', 'git', ...(renderer === 'tui' ? ['terminal'] : []), 'placements'])
  assert.ok(eligible.find(tip => tip.id === 'prompts')?.text.includes(renderer === 'web' ? 'Open prompt library' : 'Prompt library'))
  assert.ok(!listFeatureTips(renderer, session, false).some(tip => ['skills', 'git', 'terminal', 'placements'].includes(tip.id)))
  applyPluginSettings({ version: 1, disabled: ['goals', 'skills-manager'] })
  assert.ok(!listFeatureTips(renderer, session, true).some(tip => ['goals', 'skills', 'placements'].includes(tip.id)))
  applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
  const specs = listComposerAccessories(renderer, [goals, manifest])
  assert.equal(specs.find(spec => spec.id === 'session-goal')?.placement, undefined)
  assert.equal(specs.find(spec => spec.id === 'feature-tip')?.placement, 'footer')
  const controller = createComposerAccessoryController(specs), token = Symbol()
  controller.report('feature-tip', token, { rows: 1 }); assert.equal(controller.getSnapshot().rows, 1)
  controller.report('feature-tip', token, { rows: 0 }); assert.equal(controller.getSnapshot().rows, 0)
  controller.dispose()
}
assert.notEqual(sessionIdentityKey(session), sessionIdentityKey({ ...session, providerInstanceId: 'personal' }))
console.log('Tips smoke: PASS (cadence, rotation, cancellation, availability, renderer labels, row budget)')
