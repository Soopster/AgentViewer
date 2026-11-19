# Local mod SDK and portable controls

Scaffold and validate a portable mod:

```sh
agent-viewer mods create my-mod --path ./my-mod
agent-viewer mods check ./my-mod --json
agent-viewer mods check ./my-mod --render --json
agent-viewer mods test ./my-mod
```

Creation refuses existing destinations. Scaffolds include a manifest, server,
README and test. Install the directory under the user's configured plugins
directory and reload or restart the app. Project directories are never auto-discovered.
Use [explicit reload](mod-reload.md) during development and
[pinned local packages](mod-distribution.md) for installation and rollback.
[Runtime observation](mod-runtime-events.md) and [permission policy composition](mod-permissions.md)
are shared across renderers; provider limitations are documented explicitly.

## Typed server contract

```js
/** @type {import('agent-viewer/lib/plugins/modSdk.ts').ModServerModule} */
export default {
  views: { main: ({ config }) => ({ title: String(config.greeting), blocks: [
    { type: 'input', id: 'message', label: 'Message', action: 'echo' },
    { type: 'select', id: 'mode', label: 'Mode', action: 'mode', value: 'fast',
      options: [{ value: 'fast', label: 'Fast' }, { value: 'careful', label: 'Careful' }] },
    { type: 'progress', label: 'Build', value: 3, max: 4 },
    { type: 'table', columns: ['Job', 'Status'], rows: [['build', 'running']] },
    { type: 'code', text: 'npm run build', language: 'sh' },
  ] }) },
  actions: { echo: ({ item }) => ({ notice: { kind: 'info', text: item ?? '' } }) },
}
```

The type-only SDK loads no providers. It ships inside Agent Viewer; it is not a
separate npm package. Editors must resolve the installed `agent-viewer` package
for JSDoc types. TypeScript authors use `import type`; server TypeScript requires
Bun as before. Named exports remain supported.

## Configuration

Declare `config` in `plugin.json`:

```json
{
  "config": {
    "greeting": { "type": "string", "title": "Greeting", "default": "Hello" },
    "retries": { "type": "number", "title": "Retries", "min": 0, "max": 5, "default": 2 },
    "enabled": { "type": "boolean", "title": "Enabled", "default": true },
    "mode": { "type": "string", "title": "Mode", "enum": ["fast", "careful"] },
    "token": { "type": "string", "title": "API token", "secretEnv": "MY_API_TOKEN", "required": true }
  }
}
```

Fields support `description` and `required`. Schemas allow 50 fields with keys of at most 48 characters. Only
strings, finite numbers and booleans are accepted; unknown keys, invalid
defaults, bounds and enum values are rejected. The API/CLI never coerce strings.
Generated number and boolean controls parse their values before validation.

A nonempty schema adds a `<title> settings` palette command and a `mod-config`
view through the ordinary Web/OpenTUI surface host. That view ID is reserved
when declaring a schema. Each field saves explicitly with Apply (Web) or Enter
(OpenTUI). Missing required fields can be filled individually; server invocations
refuse until all required values exist. Invalid submissions preserve the previous
file. Settings views work without importing server code, even with missing values.

Inspect a schema and configured-key summary, or apply a typed JSON patch:

```sh
agent-viewer mods configure my-mod
printf '%s' '{"retries":3}' | agent-viewer mods configure my-mod --values-stdin
```

Values live in `mod-settings/<id>.json` beside the configured user plugins
directory, with restricted file permissions and atomic replacement. Concurrent
writes are not transactional. This is machine-local configuration. Every server
hook, command, view, action and widget receives a frozen `config` snapshot,
resolved for each invocation. Custom renderer components do not receive config.

`secretEnv` names an environment variable in the app/daemon environment. It
cannot have a default/enum and cannot be assigned through stored configuration.
Generated views show only the variable name and availability. The CLI never
prints resolved values. This is secret referencing, not keychain storage or a
sandbox: trusted mod server code retains its existing host permissions.

## Portable controls

Existing heading/text/item/button blocks remain compatible. New input/select
controls submit their string value in the existing action context's `item`
field, including empty strings; item rows still submit their ID. Use distinct
action names for controls. Actions refresh the view after completion.

Web uses labeled forms with explicit Apply buttons. OpenTUI uses j/k to select,
Enter to edit an input, Enter to apply and Escape to cancel editing. During input
editing, q/r/j/k are ordinary text. Selects use left/right to choose and Enter to
apply; clicking cycles the choice, followed by Enter to apply.

Inputs allow 4,000 characters; selects allow 100 unique options; tables allow
12 columns and 100 rows; code blocks allow 20,000 characters. Progress requires
a positive finite maximum and clamps its value. Malformed blocks are dropped.
Code is plain text, without execution or syntax highlighting. Web tables scroll
horizontally; terminal columns fit the viewport. Use stable control IDs.
Renderer-specific component modules remain available for complex interfaces.

## Author fixtures

Static checks never import code. Render checks and tests execute trusted code
with host permissions, including import side effects. They are not sandboxes.
`mods test` requires Bun. It runs root-level `*.test.mjs`, `*.test.js` and
`*.test.ts` files, each default-exporting an async `test(harness)` function:

```js
import assert from 'node:assert/strict'
export default async function test(harness) {
  assert.equal((await harness.press('main', 'echo', 'hello')).notice.text, 'hello')
  assert.equal(harness.sent.length, 0)
}
```

Each test runs in a separate child process with a ten-second timeout and a fresh server entry module; dependencies can still share the
runtime module cache. CLI fixtures use default config and no secrets. A test can export `fixture = { config, env, app, target, messages }` to provide explicit fixture data, including fake secret values. For custom
fixtures, import `createModHarness` from
`agent-viewer/lib/plugins/modTesting.ts` and supply a module plus optional
`configSchema`, `config`, `env`, `app`, `target` and `messages`.

Methods: `command(id, input?)`, `render(view)`, `action(view, action, item?)`,
`press(view, action, value?)`, `beforeTurn(body)`, `disable()`. `sent` records
mock send requests; `signal` exposes fixture cancellation. No fixture sends real
provider turns. `press` checks the action exists in the view and validates select
choices, then invokes server logic; it does not synthesize native UI events.
Disabling aborts pending work, rejects late results and calls `deactivate` once.
Real focus, keyboard, layout and provider behavior require application checks.

Verification: `npm run mods:sdk:smoke`, `npm run mods:sdk:tui:smoke`,
`npm run mods:sdk:web:smoke`, plus both application typechecks. Renderer smokes
use local fixtures, not live providers. See [contributions](mod-contributions.md) for panel/widget declarations. Provider
execution interception, remote marketplaces, persistent mod state and a virtual
clock remain separate framework work.
