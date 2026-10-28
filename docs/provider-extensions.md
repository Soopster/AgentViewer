# Provider extensions

Providers are trusted, bundled extensions. The design uses declarative
contributions and activation on demand, as documented by
[VS Code's manifest](https://code.visualstudio.com/api/references/extension-manifest)
and [activation model](https://code.visualstudio.com/api/references/activation-events).
It does not embed VS Code, load arbitrary installed packages, or add a framework
dependency. This is an in-process contract, not a security sandbox.

## Add a provider

```sh
npm run providers:scaffold -- my-agent "My Agent"
```

This creates `lib/extensions/providers/my-agent/` and adds two static registration
entries: browser-safe metadata in `catalog.ts`, and lazy executable entries in
`registry.ts`. `AgentProvider` is inferred from the catalog. There is no separate
provider union to update. No shell, command palette or backend switch needs an
entry for basic session browsing and chat.

The scaffold compiles but deliberately throws for unimplemented creation and
streaming. Implement its files before shipping it:

| File | Responsibility |
| --- | --- |
| `manifest.ts` | Stable ID, API version, labels, capabilities, discovery, attachment policy, optional composer branding |
| `server.ts` | Static lazy imports for the read adapter and turn runtime |
| `adapter.ts` | SDK reads mapped to canonical `Session`, `SessionInfo` and `SessionMessage` values |
| `runtime.ts` | Session creation, streaming, prewarming, actions, fork, rewind and resource cleanup |

Use SDKs, not direct provider transcript-file parsing. The read adapter contract
is `lib/adapters/types.ts`; the lifecycle contract is
`lib/extensions/providers/types.ts`. Only implement operations the provider
supports. Missing destructive/control operations fail explicitly. Declare
capabilities honestly; adapter identity/delete capability and runtime operation
requirements are checked on activation.

No composer branding is required: new providers get neutral defaults using
their own display name. Native attachments are opt-in; inputs that can be
represented as portable text keep that fallback. Invalid/unrepresentable input
is rejected. Native slash commands can come from `readSlashCommands`; unknown
providers do not inherit Claude's native command list. Core messaging commands
remain available. A native CLI launch command or Coordinator SDK tool bridge
requires its own integration; these are not inferred from a provider name.

## Boundaries and lifecycle

- Metadata may import declarative branding and types. It must not import SDKs,
  server entries, timers, React, workers, or the backend. The browser bundle
  boundary is checked by `providerExtensionSmoke.mjs`.
- `loadAdapter` must not import the turn runtime. Transcript workers should pay
  only for the selected provider's read implementation.
- The host caches successful activation and deduplicates concurrent loads.
  Failed activation/validation is evicted so another attempt can retry. Extension
  modules have process/isolate lifetime, not window lifetime.
- Runtime requests carry an explicit `provider` and `providerInstanceId` and run
  inside the existing request scope. Use `currentProviderInstance()`,
  `currentProviderEnvironment()` and `currentProviderExecutable()` from
  `lib/providerInstances.ts` when configuring the SDK. Never consult the globally
  selected UI provider after an asynchronous operation has begun.
- Keep modules stateless or key SDK pools by configured instance and native
  session ID. `supportsInstances` defaults to false. Set it true only after
  testing independent accounts/configurations; it controls whether configured
  duplicate instances are admitted.
- Return canonical messages. The host owns transcript pagination, persistence,
  provenance and window caches. An active instance is also stamped on session
  information by the host. Plugins must not mutate cached wire objects.
- `streamTurn` receives the host checkpoint promise. Await it before the first
  agent write. Honor its `AbortSignal`, stream cancellation and backpressure.
  Register interrupt/steer callbacks with the existing `lib/sessionRuntime.ts`
  control plane, and clear them on completion. Streaming follows the existing
  backend SSE wire contract consumed by Web and TUI; do not invent a parallel
  renderer protocol.
- The host handles steering dispatch, interruption, inbox reopening, context
  projection, checkpoints and fork provenance. Implement SDK-specific actions
  in the extension. Permission/question payloads must use the normalized core
  contract; `listPendingPermissions` exposes active state without loading an
  unused runtime. Expected permission tokens are checked before action dispatch;
  revalidate requests after SDK awaits before responding to a native prompt.
- `closeSession` is required. The host requests interruption before calling it.
  Release listeners, streams, handles and session resources idempotently.
  Hiding a view does not close a provider session.

## Migration status

All nine provider IDs contribute manifests and separate lazy read and runtime
entry points, and every SDK turn implementation now lives in its extension's
`runtime.ts` (the three ACP IDs share `transports/acpRuntime.ts`). The
`builtinRuntime.ts` compatibility bridge is gone; `lib/sessionBackend.ts` is the
host facade and contains no provider branches. Shared, provider-neutral turn
plumbing (usage reporting, watchdogs) is in `runtimeCore.ts`; host services the
runtimes call back into (steering, the control plane, subagent summaries, index
operations, diagnostics) are separate `lib/session*.ts` modules so no runtime
imports the facade.

`providerRuntimeBoundarySmoke.mjs` loads each runtime in a cold isolate and
asserts it loads only its own SDK, and that the facade loads none.

## Verify

```sh
npm run providers:extensions:smoke
npx tsc --noEmit
npm run tui:check
```

The contributor smoke makes a temporary source copy, runs the same scaffold,
implements a fixture only inside its extension directory, and typechecks the
entire Web and TUI with the additional provider ID. It then tests discovery,
reads and instance provenance, creation, streaming, interruption, abort,
cleanup and unsupported operations through the public APIs. It uses two
configured instances with the same native ID, including concurrent reads. Turn
lifecycle checks run sequentially; they do not establish simultaneous-turn
isolation in the existing session control registry.

The host smoke checks lazy activation, concurrent-load deduplication, retry after
load/validation failure, unknown IDs and the browser import boundary. These are
hermetic contract checks, not live-provider authentication or SDK parity proof.
