import assert from 'node:assert/strict'
import { commands } from '../plugins/schedules/commands'
import { parseScheduleSlash, parseTimeOfDay } from '../lib/schedules/slash'
import { matchPluginComposerSlashCommand } from '../lib/plugins/composerSlash'

assert.deepEqual(parseScheduleSlash('every 1h check the build'), { trigger: { kind: 'every', amount: 1, unit: 'h' }, prompt: 'check the build' })
assert.deepEqual(parseScheduleSlash('every 30m  hi'), { trigger: { kind: 'every', amount: 30, unit: 'm' }, prompt: 'hi' })
assert.deepEqual(parseScheduleSlash('"0 9 * * 1-5" standup digest'), { trigger: { kind: 'cron', expression: '0 9 * * 1-5' }, prompt: 'standup digest' })
assert.deepEqual(parseScheduleSlash("'*/5 * * * *' ping"), { trigger: { kind: 'cron', expression: '*/5 * * * *' }, prompt: 'ping' })
// Flexible forms: the input that failed in the TUI, words and plurals, optional count, limits either side.
assert.deepEqual(parseScheduleSlash('every 10 seconds say hi for 1 minutes'), { trigger: { kind: 'every', amount: 10, unit: 's' }, prompt: 'say hi', expiresInMs: 60_000 })
assert.deepEqual(parseScheduleSlash('every hour check mail'), { trigger: { kind: 'every', amount: 1, unit: 'h' }, prompt: 'check mail' })
assert.deepEqual(parseScheduleSlash('every minute ping'), { trigger: { kind: 'every', amount: 1, unit: 'm' }, prompt: 'ping' })
assert.deepEqual(parseScheduleSlash('every 2 hrs for 1 day sync'), { trigger: { kind: 'every', amount: 2, unit: 'h' }, prompt: 'sync', expiresInMs: 86_400_000 })
assert.deepEqual(parseScheduleSlash('every 1w review'), { trigger: { kind: 'every', amount: 1, unit: 'w' }, prompt: 'review' })
assert.deepEqual(parseScheduleSlash('EVERY 5 MIN Tidy'), { trigger: { kind: 'every', amount: 5, unit: 'm' }, prompt: 'Tidy' })
assert.deepEqual(parseScheduleSlash('every weekday at 9am standup'), { trigger: { kind: 'cron', expression: '0 9 * * 1-5' }, prompt: 'standup' })
assert.deepEqual(parseScheduleSlash('daily at 17:30 wrap up'), { trigger: { kind: 'cron', expression: '30 17 * * *' }, prompt: 'wrap up' })
assert.deepEqual(parseScheduleSlash('every monday at noon plan'), { trigger: { kind: 'cron', expression: '0 12 * * 1' }, prompt: 'plan' })
assert.deepEqual(parseScheduleSlash('every weekend at 12am x'), { trigger: { kind: 'cron', expression: '0 0 * * 0,6' }, prompt: 'x' })
assert.deepEqual(parseScheduleSlash('0 9 * * 1-5 bare cron works'), { trigger: { kind: 'cron', expression: '0 9 * * 1-5' }, prompt: 'bare cron works' })
const base = new Date(2026, 5, 10, 14, 0, 0).getTime()
assert.deepEqual(parseScheduleSlash('in 30 minutes check', base), { trigger: { kind: 'at', at: base + 30 * 60_000 }, prompt: 'check' })
assert.deepEqual(parseScheduleSlash('at 3pm later', base), { trigger: { kind: 'at', at: new Date(2026, 5, 10, 15, 0).getTime() }, prompt: 'later' })
assert.deepEqual(parseScheduleSlash('at 9am tomorrowish', base), { trigger: { kind: 'at', at: new Date(2026, 5, 11, 9, 0).getTime() }, prompt: 'tomorrowish' }, 'a time already past today means tomorrow')
assert.equal(parseTimeOfDay('12am')?.[0], 0)
assert.equal(parseTimeOfDay('12pm')?.[0], 12)
assert.equal(parseTimeOfDay('13pm'), null)
assert.equal(parseTimeOfDay('25:00'), null)
// Prose that merely begins like a schedule is not one.
for (const prose of ['everything is fine', 'every other day do x', 'at the end summarize']) assert.ok('error' in parseScheduleSlash(prose), `rejects "${prose}"`)
assert.ok('error' in parseScheduleSlash('"61 * * * *" x'), 'a bad quoted cron explains itself')
for (const bad of ['', 'every 1h', 'every 10 seconds for 1 minute', 'soon do it']) assert.ok('error' in parseScheduleSlash(bad), `rejects "${bad}"`)

// The command is reachable as /schedule in both renderers.
assert.equal(matchPluginComposerSlashCommand('/schedule every 1h x', 'tui')?.id, 'schedule-create')
assert.equal(matchPluginComposerSlashCommand('/schedule every 1h x', 'web')?.id, 'schedule-create')

// The handler targets the typing session and reports instead of throwing.
const created: unknown[] = []
const notices: string[] = []
const context = (args: string, session: object | null) => ({
  target: { session, cwd: null },
  input: { slash: { name: 'schedule', arguments: args, draft: `/schedule ${args}` } },
  signal: new AbortController().signal,
  services: { schedules: { create: async (input: unknown) => { created.push(input) } }, notices: { show: (_k: string, text: string) => { notices.push(text) } } },
  defer: () => () => {},
}) as never
await commands.handlers.create(context('every 1h check', { sessionId: 's1', provider: 'codex', providerInstanceId: 'i2' }))
assert.deepEqual((created[0] as { action: unknown }).action, { kind: 'prompt-session', sessionId: 's1', provider: 'codex', instance: 'i2' })
await commands.handlers.create(context('nonsense', { sessionId: 's1', provider: 'codex' }))
await commands.handlers.create(context('every 1h x', null))
assert.equal(created.length, 1, 'a bad schedule or no session creates nothing')
assert.equal(notices.length, 3)
console.log('scheduleSlashSmoke ok')
