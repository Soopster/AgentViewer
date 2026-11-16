# Composer contributions

Bundled plugins and local mods can declare composer slash commands. The shell
provides discovery and target capture; the plugin implements the command. No
provider SDK or application-root change belongs in the plugin.

```ts
commands: [{
  id: 'inspect-source', label: 'Inspect source', category: 'Session',
  scope: 'session', requires: 'session', renderers: ['web', 'tui'],
  handler: 'inspect', services: ['notices'],
  composerSlash: {
    name: 'inspect-source', // no leading slash; lowercase letters/digits/hyphens
    description: 'Inspect a source file',
    argumentHint: '[path]',
  },
}]
```

The ordinary lazy command module receives immutable
`context.input.slash = { name, arguments, draft }` when invoked by slash. The
full original draft and all argument lines are captured before asynchronous
module loading. Palette, toolbar and key invocations omit `input`.

Both composers merge these entries into their slash suggestions. Local plugin
commands take precedence over same-named provider suggestions; the declared
plugin must be enabled. Matching requires a complete command name followed by
whitespace or end of input. Submission dispatches through the normal plugin
command host before model-loading gates, provider submission, bridge routing,
queueing, or source-transcript changes. Duplicate slash names in a renderer are
refused. Providers' unrelated native slash commands pass through normally.

For a local mod, put the same `composerSlash` object on a session-scoped entry
in `plugin.json.commands`. The server command receives `input.slash` alongside
its captured `target`, `signal`, `readMessages` and declared app data.

## Inline live rows

Use a composer accessory for status rows above the input. Declare a budget of
one to four rows; register separate lazy Web and OpenTUI composer adapters.

```ts
composer: [{ id: 'research-status', title: 'Research', maxRows: 2, services: ['composer'] }]
```

The accessory draws its own rows and reports their actual occupancy:

```ts
props.report({ rows: running ? 2 : 0, backgroundKeys: running })
props.registerKeys(key => {
  if (key.name === 'escape' && running) { cancelOwnJob(); return true }
  return false
})
```

The shell reserves the reported space up to the manifest budget. It has no
knowledge of progress stages, timers, tools, animation or plugin-specific JSX.
A background key handler is opt-in and can claim only Escape. Modal accessories
retain their existing full key handling. Focused pickers and dialogs retain
precedence; once the accessory releases Escape, the next Escape reaches the
normal composer/agent handler. Disablement and composer-owner changes revoke
retained capabilities and remove the rows.

Commands can pass their captured input to an accessory with
`services['composer-accessories'].open(id, context.input)`. The accessory receives
`props.invocation` with its serial-numbered `openRequest`. This preserves slash
arguments even when loading finishes after further typing.

Use the scoped `composer.stageDraft(text, original)` capability to insert a
result without sending it. If `original` is still the current draft, it is
replaced; otherwise the newer draft is retained below the result. An empty
replacement consumes only an unchanged original. Attachments remain owned by
the composer. The host fences late writes after target changes or disablement.

`plugins/better` is a complete example. `scripts/pluginComposerSlashSmoke.ts`
registers an unrelated plugin and verifies discovery, captured arguments,
enablement, row allocation and background-key routing in both renderers.

## Passive footer hints

Bundled composer accessories may declare `placement: 'footer'` to render below
input/status rather than above the input. Omission (or `input`) keeps the
existing position. Register the adapter in the normal composer loader lists;
report zero rows when hidden and one row for a single-line hint. The shell
reserves reported rows from the transcript without shrinking the draft.

`props.turn`, when available, is a read-only `ComposerTurnContext` containing
`id`, `startedAt`, `running` and `needsAttention`. Its ID includes the qualified
session identity and runtime start timestamp. No timestamp means no turn
context: do not invent a new turn on each poll. This metadata grants no send or
interrupt capability. Observe `visible` and the owner-scoped `signal`, and keep
timers and selection in the plugin. Passive hints should not register keys.

The bundled **Tips** plugin is enabled by default in Web and OpenTUI. Disable
it in Plugins. Each new visible working turn has a 25% chance of showing one tip
after eight seconds, for up to 20 seconds, with a five-minute cooldown shared
across sessions in that app instance. Late observations, hidden composers,
errors, interruption, approvals and questions skip or dismiss the tip; it does
not replay when returning. Tips rotate through available enabled features
before repeating and use renderer-specific command labels. History and cooldown
are in memory and reset on app reload. Tips never call providers or alter drafts.

Validation: `bun scripts/tipsSmoke.ts`, `bun tui/opentui/tipsSmoke.tsx`, and
`node scripts/tipsBrowserSmoke.mjs`. The renderer checks exercise the real footer
accessory hosts with fixtures; they do not claim live-provider validation.
