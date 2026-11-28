# Mod runtime observation

Declare `behavior.hooks: ["runtimeEvent"]` and export
`runtimeEvent({ event, signal, config })` from a local mod's server module.
Bundled behavior modules use the same event/context contract without mod config.

Events are immutable metadata:

- `turn.started` and `turn.settled`: authoritative entry/exit of the shared
  running-turn registry, not SDK session creation/deletion.
- `tool.started` and `tool.completed`: recognized metadata in a consumed,
  attached provider SSE response. Tool metadata is ID, optional name and failure
  flag. Tool arguments, command text and result content are never included.
- `usage.updated`: provider-reported context total/output token counts from
  existing named SSE usage frames. Absent fields stay absent.

Every event includes provider, provider-instance ID when known, native session
ID, timestamp and source (`runtime-registry` or `response-stream`). Never rebuild
identity from session ID alone. Lifecycle event emission does not alter the
existing `onTurnSettled` hook used by goals and plugin follow-ups.

`pluginRuntimeCapabilities(provider)` in `lib/plugins/runtimeEvents.ts` reports
what this implementation observes. The five native Claude/Codex/Copilot/OpenCode/
Pi adapters support recognized attached-stream tool/usage events. ACP variants,
LM Studio and arbitrary provider mods currently expose registry lifecycle only
through this hook; no unsupported event is synthesized. Approval bridges support
permission decisions only when the provider actually requests approval (Pi and
arbitrary provider mods do not currently offer this bridge).

These are observations, not tool execution interception. Already allowed tools
may not request approval; unknown native event types are skipped. Attached-stream
observation stops when that response is detached/cancelled. Events are not replayed
when a view opens, and historical transcript reads do not generate runtime events.
No model-request rewriting, subagent lifecycle or session-created/deleted hook is
claimed. A call starting is not proof it succeeded; wait for completion.

Observers run asynchronously in per-plugin order with a one-second budget per
event and at most 64 queued events per plugin. Overflow/failures are bounded mod
diagnostics. Disabling aborts the current hook and suppresses queued delivery.
An observer's return value cannot change the stream or prevent provider execution.
The observation parser passes original bytes through unchanged, caps parsed frames
at 256 KiB, and deduplicates recognized tool start/completion IDs within one
response (bounded to 2,048 keys).

Example:

```js
export function runtimeEvent({ event }) {
  if (event.type === 'tool.completed') {
    console.log(event.target.provider, event.target.sessionId, event.tool.id)
  }
}
```

Run `bun scripts/pluginRuntimeEventsSmoke.ts` for registry emission, immutable
identity, hook delivery/disablement, native envelope normalization, deduplication,
and byte-preserving streamed observation. This uses fixtures, not live providers.
