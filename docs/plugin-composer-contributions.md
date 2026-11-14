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
