/** @jsxImportSource @opentui/react */
// Session goals, pinned at both ends: the pure rules the engine decides on, the
// store the API and TUI share, and the two surfaces a person actually sees.
//
// The dangerous defects here are quiet ones. A budget that never floors lets a
// NaN stop a goal dead; a continuation prompt that omits the objective drifts;
// a strip that clips its status shows a glyph with no meaning. None of them
// throw, so each is asserted against a frame or a value.
import React from 'react'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// The store resolves .agent-viewer-data from process.cwd() when it loads, so
// move before importing it.
process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-goal-smoke-')))

const { testRender, act } = await import('./testRender')
const { getThemePalette } = await import('../theme')
const {
  DEFAULT_MAX_CONTINUATIONS,
  MAX_OBJECTIVE_LENGTH,
  buildGoalAuditPrompt,
  buildGoalContinuationPrompt,
  isSessionGoalLive,
  lastUserText,
  parseSessionGoalAudit,
  parseSessionGoalKey,
  sanitizeSessionGoal,
  sessionGoalKey,
  sumSessionGoalTokens,
} = await import('../../lib/sessionGoals')
type SessionGoal = import('../../lib/sessionGoals').SessionGoal
const store = await import('../../lib/sessionGoalStore')
const { SessionGoalStrip } = await import('../../plugins/goals/tui/SessionGoalStrip')
const { SessionGoalOverlay } = await import('../../plugins/goals/tui/SessionGoalOverlay')
const { DARK_THEME } = await import('../theme')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function goalFixture(patch: Partial<SessionGoal> = {}): SessionGoal {
  return {
    provider: 'claude',
    sessionId: 'ses_goal',
    objective: 'Ship the login flow with a passing integration test',
    status: 'active',
    tokenBudget: 2_000_000,
    tokensUsed: 12_345,
    continuations: 3,
    maxContinuations: DEFAULT_MAX_CONTINUATIONS,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastNote: null,
    lastDecision: null,
    lastEvaluatedAt: null,
    error: null,
    ...patch,
  }
}

// ── Keys ────────────────────────────────────────────────────────────────────
{
  const one = sessionGoalKey('claude', 'work', 's1')
  const two = sessionGoalKey('claude', 'personal', 's1')
  const three = sessionGoalKey('codex', undefined, 's1')
  assert(one !== two && two !== three, 'the same session id under two accounts is two goals')
  assert(three === sessionGoalKey('codex', 'codex', 's1'), 'an absent instance falls back to the provider name')
  const parsed = parseSessionGoalKey(two)
  assert(parsed?.provider === 'claude' && parsed.providerInstanceId === 'personal' && parsed.sessionId === 's1', 'the key round-trips')
  assert(parseSessionGoalKey('not json') === null && parseSessionGoalKey('["claude"]') === null, 'a corrupt key is dropped, not guessed')
  console.log('Goals are keyed by provider, instance and session.')
}

// ── Sanitising stored JSON ──────────────────────────────────────────────────
{
  assert(sanitizeSessionGoal({ sessionId: 's', provider: 'claude' }) === null, 'an objective is required')
  const sanitized = sanitizeSessionGoal({
    sessionId: 's',
    provider: 'claude',
    objective: 'x'.repeat(MAX_OBJECTIVE_LENGTH + 500),
    status: 'nonsense',
    tokenBudget: 0,
    maxContinuations: -2,
    tokensUsed: -1,
  })
  assert(sanitized, 'a minimal goal survives')
  assert(sanitized.objective.length === MAX_OBJECTIVE_LENGTH, 'the objective is capped')
  assert(sanitized.status === 'paused', 'an unknown status is paused, never active')
  assert(sanitized.tokenBudget === null && sanitized.maxContinuations === DEFAULT_MAX_CONTINUATIONS, 'a zero budget and a negative cap fall back')
  assert(sanitized.tokensUsed === 0, 'a negative count is zero')
  assert(isSessionGoalLive(goalFixture()) && !isSessionGoalLive(goalFixture({ status: 'paused' })), 'only active goals run')
  console.log('A corrupt goal file pauses instead of resurrecting a runaway goal.')
}

// ── Tokens and transcript reading ───────────────────────────────────────────
{
  const message = (type: 'user' | 'assistant', timestamp: string | undefined, tokens: number) => ({
    type,
    uuid: `${type}-${timestamp}-${tokens}`,
    session_id: 's',
    parent_tool_use_id: null,
    ...(timestamp ? { timestamp } : {}),
    message: {
      role: type,
      content: type === 'user' ? 'go' : 'working',
      usage: { input_tokens: tokens, output_tokens: 0 },
    },
  }) as never
  const messages = [
    message('assistant', '2026-01-01T00:00:01.000Z', 100),
    message('user', '2026-01-01T00:00:02.000Z', 999),
    message('assistant', '2026-01-01T00:00:09.000Z', 500),
  ]
  assert(sumSessionGoalTokens(messages, '2026-01-01T00:00:05.000Z') === 500, 'only assistant tokens after the cutoff count')
  assert(sumSessionGoalTokens([message('assistant', undefined, 42)], 'now') === 42, 'an unstamped transcript falls back to its last reply')
  assert(sumSessionGoalTokens([], 'now') === 0, 'an empty transcript spends nothing')

  const transcript = [
    { type: 'user', uuid: 'u1', session_id: 's', parent_tool_use_id: null, message: { role: 'user', content: 'add the logout button' } },
    { type: 'user', uuid: 'u2', session_id: 's', parent_tool_use_id: null, message: { role: 'user', content: '[goal] Continue toward the objective below.' } },
  ] as never
  assert(lastUserText(transcript) === 'add the logout button', 'the auditor reads the human prompt, not our own nudge')
  console.log('Token spend and the last human prompt are read the way the auditor needs them.')
}

// ── Prompt and audit shape ──────────────────────────────────────────────────
{
  const goal = goalFixture({ continuations: 4 })
  const prompt = buildGoalContinuationPrompt(goal, 'Tests are still missing for the failure path.')
  assert(prompt.includes(goal.objective), 'the continuation carries the objective')
  assert(prompt.includes('Continuation 5 of at most 25'), `the counter advances: ${prompt.split('\n').find(line => line.startsWith('Continuation'))}`)
  assert(prompt.includes('Tests are still missing'), 'the auditor note reaches the agent')
  assert(!buildGoalContinuationPrompt(goal, '').includes('Auditor note'), 'an empty note is left out')

  assert(parseSessionGoalAudit({ decision: 'continue', note: 'next' })?.decision === 'continue', 'a valid audit parses')
  assert(parseSessionGoalAudit({ decision: 'keeps going', note: 'next' }) === null, 'an unknown decision is rejected, not coerced')
  assert(parseSessionGoalAudit({ decision: 'complete', note: '  done  ' })?.note === 'done', 'the note is trimmed')
  assert(parseSessionGoalAudit({ decision: 'continue', note: 'n', nextPrompt: '  ' })?.nextPrompt === undefined, 'a blank next prompt is absent')

  const audit = buildGoalAuditPrompt({
    goal: goalFixture({ tokenBudget: null, tokensUsed: 800 }),
    lastAssistant: 'Added the form',
    lastUser: 'add login',
  })
  assert(audit.includes('no ceiling') && audit.includes('Added the form'), 'the audit prompt states both the budget and the reply')
  assert(buildGoalAuditPrompt({ goal, lastAssistant: '', lastUser: '' }).includes('(no reply yet)'), 'an empty turn still audits')
  console.log('Continuations carry the objective and the auditor answers in a fixed shape.')
}

// ── Store round trip ────────────────────────────────────────────────────────
{
  const target = { provider: 'claude' as const, providerInstanceId: 'work', sessionId: 'ses_store' }
  const created = await store.createSessionGoal({ target, objective: 'Land the migration', tokenBudget: 50_000 })
  assert(created.status === 'active' && created.tokenBudget === 50_000, 'a new goal starts active')
  assert((await store.readSessionGoal({ ...target, providerInstanceId: 'personal' })) === null, 'another account does not see it')

  const patched = await store.patchSessionGoal(target, { status: 'paused', lastNote: 'Waiting on the migration owner' })
  assert(patched?.status === 'paused' && patched.lastNote === 'Waiting on the migration owner', 'patches stick')
  assert(patched && Date.parse(patched.updatedAt) >= Date.parse(created.updatedAt), 'an update moves updatedAt')

  assert((await store.patchSessionGoal({ ...target, sessionId: 'missing' }, { status: 'paused' })) === null, 'patching a goal that is gone reports nothing')
  assert(await store.removeSessionGoal(target), 'removal reports success once')
  assert(!(await store.removeSessionGoal(target)), 'removal is not idempotent-silent')
  assert((await store.readSessionGoal(target)) === null, 'a removed goal is gone')
  console.log('The goal file round-trips through create, patch and remove.')
}

// ── The strip ───────────────────────────────────────────────────────────────
async function renderGoalStrip() {
  const setup = await testRender(
    <box width="100%" height={1} flexDirection="column"><SessionGoalStrip goal={goalFixture()} theme={DARK_THEME} width={100} /></box>,
    { width: 100, height: 1 },
  )
  await act(async () => { await setup.flush() })
  const frame = setup.captureCharFrame()
  assert(frame.includes('GOAL ACTIVE'), `the strip names the state:\n${frame}`)
  assert(frame.includes('Ship the login flow'), `the strip shows the objective:\n${frame}`)
  assert(frame.includes('3/25'), `the strip shows continuation headroom:\n${frame}`)
  assert(frame.includes('12k/2.0M'), `the strip shows spend against the ceiling:\n${frame}`)
  assert(frame.includes('⇧D'), `the strip advertises its dialog:\n${frame}`)
  console.log('The goal strip reports state, objective, continuations and spend on one row.')
}

async function renderErrorStrip() {
  const setup = await testRender(
    <box width="100%" height={1} flexDirection="column">
      <SessionGoalStrip goal={goalFixture({ status: 'blocked', error: 'Auditor is unreachable', tokenBudget: null, tokensUsed: 900 })} theme={DARK_THEME} width={100} />
    </box>,
    { width: 100, height: 1 },
  )
  await act(async () => { await setup.flush() })
  const frame = setup.captureCharFrame()
  assert(frame.includes('GOAL BLOCKED') && frame.includes('Auditor is unreachable'), `an error replaces the objective:\n${frame}`)
  assert(frame.includes('900 tok ·'), `an absent ceiling shows spend alone:\n${frame}`)
  console.log('A stopped goal shows why, not what it was trying to do.')
}

async function renderGoalOverlay(goal: SessionGoal | null, focus: 'objective' | 'budget') {
  const setup = await testRender(
    <box width="100%" height="100%" flexDirection="column">
      <SessionGoalOverlay
        open
        goal={goal}
        objective={goal?.objective ?? 'Make the dashboard load under 200ms'}
        setObjective={() => {}}
        budget={goal?.tokenBudget ? String(goal.tokenBudget) : ''}
        setBudget={() => {}}
        focus={focus}
        busy={false}
        error={null}
        width={80}
        height={30}
        theme={getThemePalette('dark')}
        onSubmit={() => {}}
      />
    </box>,
    { width: 80, height: 30 },
  )
  await act(async () => { await setup.flush() })
  return setup.captureCharFrame()
}

{
  await renderGoalStrip()
  await renderErrorStrip()

  const fresh = await renderGoalOverlay(null, 'objective')
  assert(fresh.includes('Start a goal'), `a new goal dialog is titled as a start:\n${fresh}`)
  assert(fresh.includes('What does done look like?'), 'the dialog asks for a finish line')
  assert(fresh.includes('⏎ start') && fresh.includes('tab budget'), `the footer names the keys:\n${fresh}`)
  assert(!fresh.includes('^D delete'), 'a goal that does not exist offers no delete')

  const existing = await renderGoalOverlay(goalFixture({ lastNote: 'Form renders; tests still missing' }), 'budget')
  assert(existing.includes('Goal active'), `an existing goal is titled by status:\n${existing}`)
  assert(existing.includes('Form renders; tests still missing'), 'the last audit note is shown, so editing is informed')
  assert(existing.includes('⏎ save') && existing.includes('^D delete') && existing.includes('esc cancel'), `the footer names save and delete:\n${existing}`)
  assert(existing.includes('^P pause'), `a running goal offers to stop:\n${existing}`)
  const stopped = await renderGoalOverlay(goalFixture({ status: 'paused' }), 'objective')
  assert(stopped.includes('^P resume'), `a stopped goal offers to run again:\n${stopped}`)
  // The dialog fits the screen it is drawn on, at the narrow end too.
  const narrow = await renderGoalOverlay(goalFixture(), 'objective')
  assert(narrow.split('\n').every((line) => [...line].length <= 80), 'the dialog never overruns the screen')
  console.log('The goal dialog starts, edits and clears, and says which keys do it.')
}

console.log('session goal smoke passed')
process.exit(0)
