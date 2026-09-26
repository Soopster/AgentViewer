// Pins the three diagnostics sections added from Claude SDK 0.3.270:
// CONTEXT WINDOW, PERMISSION RULES, HOOKS REGISTERED.
//
// Each has one failure mode that produces a plausible-looking answer rather than
// an error, which is why they are tested here rather than trusted to review:
//
//   1. Context rows must be classified on `kind`, never on their English name.
//      The names are localized display strings; a reader that matched on them
//      would count free space as used the first time one was re-worded, and the
//      symptom is a meter reading near-full on an empty session.
//   2. A permission rule is stored VERBATIM and may carry invisible characters
//      by design. Stripping them renders two different rules identically — so a
//      user auditing why an allow rule does not match sees a rule that looks
//      exactly right.
//   3. Both reads go through methods the SDK implements but does not declare, so
//      they must degrade to "no section" rather than throwing and taking the
//      other eleven diagnostics RPCs with them.
//
// Pure functions plus fake query objects — no subprocess, no network.
import assert from 'node:assert/strict'
import {
  claudeContextBreakdown,
  claudeHooksListingItems,
  claudePermissionRuleItems,
  formatClaudeMcpServerStatus,
  revealRuleText,
} from '../lib/claudeSessionPolicy'

// --- 1. classification is on `kind`, never the name ------------------------
// These names are deliberately misleading with respect to their kinds: a reader
// matching on "Free space" or "buffer" would get every row wrong.
const usage = {
  maxTokens: 200_000,
  categories: [
    { name: 'System prompt', tokens: 3_000, kind: 'used' },
    { name: 'Messages', tokens: 47_000, kind: 'used' },
    // Named like free space, actually used.
    { name: 'Free space (reserved)', tokens: 10_000, kind: 'used' },
    { name: 'Autocompact buffer', tokens: 20_000, kind: 'buffer' },
    // Named like a buffer, actually free.
    { name: 'buffer remaining', tokens: 120_000, kind: 'free' },
    { name: 'Unloaded MCP tools', tokens: 35_000, kind: 'deferred' },
  ],
}

const breakdown = claudeContextBreakdown(usage)
// Used is 3k + 47k + 10k = 60k. Both traps are in there: the row NAMED free
// counts, and the row named buffer does not.
assert.equal(breakdown.usedTokens, 60_000, 'context rows were not classified on `kind`')
// Deferred schemas are out of window and explicitly excluded from usage math.
// Folding them in overstates the meter by every tool the session has not loaded.
assert.ok(!breakdown.items.some((item) => /^used · 95/.test(item)), 'deferred tokens were counted as used')

const joined = breakdown.items.join('\n')
for (const heading of ['window · 200.0k', 'used · 60.0k', 'compaction buffer', 'free', 'deferred (out of window, not counted)']) {
  assert.ok(joined.includes(heading), `context breakdown is missing the ${JSON.stringify(heading)} group`)
}
// Each row appears under the group its kind names, not the group its name suggests.
const groupOf = (rowName: string): string => {
  let current = ''
  for (const item of breakdown.items) {
    if (!item.startsWith('  ')) current = item
    else if (item.includes(rowName)) return current
  }
  return '(not found)'
}
assert.ok(groupOf('Free space (reserved)').startsWith('used ·'), 'a used row named "Free space" was grouped as free')
assert.ok(groupOf('buffer remaining') === 'free', 'a free row named "buffer" was grouped as buffer')
assert.ok(groupOf('Unloaded MCP tools').startsWith('deferred'), 'a deferred row was not grouped as deferred')

// An older CLI sends no `kind`. Guessing is the exact failure the field removes,
// so those rows get their own heading instead of being folded into `used`.
const unclassified = claudeContextBreakdown({
  maxTokens: 1_000,
  categories: [{ name: 'Messages', tokens: 400 }],
})
assert.equal(unclassified.usedTokens, 0, 'a row with no kind was counted as used')
assert.ok(unclassified.items.some((item) => item.includes('unclassified')), 'a row with no kind was silently folded in')

// No categories at all means no section, not an empty section with a heading.
assert.deepEqual(claudeContextBreakdown({ categories: [] }).items, [])
assert.deepEqual(claudeContextBreakdown(null).items, [])

// --- 2. invisible characters are revealed, never stripped -----------------
// Two rules that differ only by a zero-width space are DIFFERENT rules and each
// gets its own entry upstream. Rendering them identically is how an audit misses
// the reason a rule is not matching.
const plain = 'Bash(npm run build)'
const sneaky = 'Bash(npm run​build)'
assert.notEqual(revealRuleText(sneaky), revealRuleText(plain), 'an invisible character was stripped, hiding a distinct rule')
assert.ok(revealRuleText(sneaky).includes('\\u200b'), 'a zero-width space was not revealed')
assert.equal(revealRuleText(plain), plain, 'an ordinary rule was altered')
// A control character must not reach the terminal raw.
assert.ok(!revealRuleText('Bash(ab)').includes(''), 'an escape character survived into display')
// A right-to-left override can reorder a rule on screen so it reads as something
// else entirely — the one case where display and stored value disagree visually.
assert.ok(revealRuleText('Read(‮)').includes('\\u202e'), 'a bidi override was not revealed')

// --- 3. permission rules: provenance, effect, and failure ------------------
const rulesQuery = {
  listPermissionRules: async () => ({
    state: {
      rules: [
        { behavior: 'allow', source: 'projectSettings', rule: 'Bash(npm run test)', editability: 'persistent' },
        { behavior: 'deny', source: 'policySettings', rule: 'Read(./.env)', editability: 'readonly' },
        { behavior: 'allow', source: 'userSettings', rule: 'Bash(rm)', editability: 'readonly', notInEffect: true },
        // Half a row says nothing actionable; printing it as a rule is worse.
        { behavior: 'allow', source: 'userSettings' },
      ],
      workspaceDirectories: [{ path: '/repo/extra', source: 'cliArg' }],
      originalCwd: '/repo',
      managedOnly: true,
      errors: [{ path: '/repo/.claude/settings.json', message: 'Unexpected token' }],
    },
  }),
}
const ruleItems = await claudePermissionRuleItems(rulesQuery)
const ruleText = ruleItems.join('\n')
// The source is the whole point: a denial is only understandable next to the
// settings file that caused it.
assert.ok(ruleText.includes('allow · Bash(npm run test) · projectSettings · persistent'))
assert.ok(ruleText.includes('deny · Read(./.env) · policySettings · readonly'))
// A rule that is listed but ignored reads as active without this.
assert.ok(ruleText.includes('NOT IN EFFECT'), 'an ignored rule was presented as active')
// managedOnly explains a whole list of NOT IN EFFECT rows, so it is said once up front.
assert.ok(ruleItems[0]!.includes('managed policy rules only'), 'managedOnly was not surfaced first')
// A skipped settings file means its rules are NOT in the session; silence would
// present a shorter list as if it were the whole list.
assert.ok(ruleText.includes('skipped /repo/.claude/settings.json'), 'a settings parse error was swallowed')
assert.ok(ruleText.includes('dir · /repo/extra · cliArg'))
assert.equal(ruleItems.filter((item) => item.startsWith('allow ·') || item.startsWith('deny ·')).length, 3, 'a half-row was rendered as a rule')

// A session with no rules answers explicitly — distinct from "no section".
assert.deepEqual(
  await claudePermissionRuleItems({ listPermissionRules: async () => ({ state: { rules: [], workspaceDirectories: [] } }) }),
  ['None'],
)

// --- 4. an undeclared method may simply not be there ----------------------
// This is why the module feature-detects rather than calling straight through.
// Diagnostics fans out a dozen control RPCs; losing the other eleven because an
// undocumented one changed would be a far worse outcome than a missing section.
assert.deepEqual(await claudePermissionRuleItems({}), [], 'a CLI without the method should yield no section')
assert.deepEqual(await claudeHooksListingItems({}), [], 'a CLI without the method should yield no section')
assert.deepEqual(
  await claudePermissionRuleItems({ listPermissionRules: async () => { throw new Error('unsupported method') } }),
  [],
  'a throwing read must not escape into diagnostics',
)
assert.deepEqual(
  await claudeHooksListingItems({ getHooksListing: async () => { throw new Error('unsupported method') } }),
  [],
  'a throwing read must not escape into diagnostics',
)
// A shape that has moved on is skipped, never rendered as "undefined".
assert.deepEqual(await claudePermissionRuleItems({ listPermissionRules: async () => ({ unexpected: true }) }), ['None'])
assert.deepEqual(await claudeHooksListingItems({ getHooksListing: async () => ({ events: [{ nope: 1 }] }) }), ['None'])

// --- 5. hooks registered ---------------------------------------------------
const hookItems = await claudeHooksListingItems({
  getHooksListing: async () => ({
    events: [
      { name: 'PreToolUse', summary: 'Before a tool runs', supportsMatcher: true, hookCount: 2 },
      { name: 'SessionStart', summary: 'When a session starts', supportsMatcher: false, hookCount: 1 },
    ],
  }),
})
assert.ok(hookItems.some((item) => item.startsWith('PreToolUse · 2 hooks')), hookItems.join('\n'))
assert.ok(hookItems.some((item) => item.startsWith('SessionStart · 1 hook ·')), 'singular hook count was not pluralized correctly')

// --- 6. the cap says what it withheld, and never withholds a deny ----------
// A real project accumulates dozens of rules, and the reason to open this
// surface is usually a rule you cannot find. A cap that does not announce itself
// answers "that rule is not here" when it is — so the count is asserted, and so
// is the rule that deny rules survive the cap, because those are the ones that
// explain a refusal.
const manyRules = {
  listPermissionRules: async () => ({
    state: {
      rules: [
        ...Array.from({ length: 60 }, (_, i) => ({
          behavior: 'allow', source: 'localSettings', rule: `Bash(cmd${i})`, editability: 'persistent',
        })),
        { behavior: 'deny', source: 'policySettings', rule: 'Read(./.env)', editability: 'readonly' },
      ],
      workspaceDirectories: [],
    },
  }),
}
const capped = await claudePermissionRuleItems(manyRules)
const cappedText = capped.join('\n')
assert.ok(cappedText.includes('deny · Read(./.env)'), 'a deny rule was withheld by the cap')
const notice = capped.find((item) => item.startsWith('…'))
assert.ok(notice, 'the cap withheld rules without saying so')
// 61 rules, 40 listed, so 21 withheld — and the number has to be right, or it is
// just a different kind of wrong answer.
assert.ok(notice!.includes('21 more rules not shown'), notice)
assert.equal(capped.filter((item) => /^(allow|deny) ·/.test(item)).length, 40, 'the cap listed the wrong number of rules')
// A list that fits is not annotated at all.
const short = await claudePermissionRuleItems({
  listPermissionRules: async () => ({
    state: { rules: [{ behavior: 'allow', source: 'userSettings', rule: 'Bash(ls)', editability: 'persistent' }], workspaceDirectories: [] },
  }),
})
assert.ok(!short.some((item) => item.startsWith('…')), 'a list that fits was annotated as truncated')

// --- 7. hook policy locks lead the listing (SDK 0.3.274) -------------------
// An unreadable managed-settings source means the organization's hooks are
// unknown. A listing that showed only the events would read as complete.
const lockedHooks = await claudeHooksListingItems({
  getHooksListing: async () => ({
    events: [{ name: 'PreToolUse', hookCount: 1 }],
    policy: { disabledByPolicy: false, managedOnly: false, pluginOnly: false, allDisabled: false, policyHookCount: 2, policyUnreadable: true },
  }),
})
assert.ok(lockedHooks[0]!.startsWith('managed policy unreadable'), lockedHooks.join('\n'))
assert.ok(lockedHooks.includes('2 managed hooks (run regardless)'), lockedHooks.join('\n'))
assert.ok(lockedHooks.some((item) => item.startsWith('PreToolUse')), 'policy lines displaced the events')
// A listing with no locks is unchanged — no "0 managed hooks" noise.
assert.deepEqual(
  await claudeHooksListingItems({
    getHooksListing: async () => ({
      events: [{ name: 'Stop', hookCount: 1 }],
      policy: { disabledByPolicy: false, managedOnly: false, pluginOnly: false, allDisabled: false, policyHookCount: 0 },
    }),
  }),
  ['Stop · 1 hook'],
)

// --- 8. MCP server rows carry their source (SDK 0.3.274) -------------------
assert.equal(formatClaudeMcpServerStatus({ name: 'agent-viewer', status: 'connected', source: 'sdk' }, false), 'agent-viewer · connected · built-in')
assert.equal(formatClaudeMcpServerStatus({ name: 'github', status: 'failed', source: 'project' }, false), 'github · failed · project')
// An older CLI sends no source; the row must not grow an empty segment.
assert.equal(formatClaudeMcpServerStatus({ name: 'github', status: 'connected' }, false), 'github · connected')
assert.equal(formatClaudeMcpServerStatus({ name: 'live', status: 'connected', source: 'dynamic' }, true), 'live · connected · dynamic')
// The name of a configured server is untrusted text.
assert.equal(formatClaudeMcpServerStatus({ name: 'git‮hub', status: 'connected', source: 'user' }, false), 'git\\u202ehub · connected · user')

console.log('Claude session policy smoke passed (kind classification, invisible-char reveal, rule provenance, undeclared-method fallback, hooks listing, hook policy locks, MCP source)')
