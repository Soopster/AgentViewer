# A2A Protocol Gap Audit — agentViewer vs upstream 1.0.1

Auditor: claude-auditor (Coordinator run baadc48d). Compared agentViewer's A2A facade against
`~/Documents/src/A2A/specification/a2a.proto`, `~/Documents/src/A2A/CHANGELOG.md`, and
`~/Documents/src/A2A/docs/specification.md` (the human-readable binding spec, consulted for the
JSON-RPC error-code registry and content-type rules that aren't in the `.proto` file itself).

**Files reviewed:** `lib/a2aAdapter.ts`, `lib/agentProtocol.ts` (A2A types + `taskStateFromStatus`),
`lib/agentCoordination.ts` (push-config CRUD + `sweepPushNotifications` webhook delivery),
`app/api/a2a/route.ts`, `app/api/a2a/[runId]/route.ts`, `app/.well-known/agent-card.json/route.ts`.

**Overall assessment:** the implementation is materially complete and careful — all 11 RPC methods
exist, `TaskState` enum matches the proto exactly, JSON-RPC error codes are mostly correct against
the real registry (spec §5.4), pagination/page-token handling matches the proto's documented
defaults, push-notification webhook delivery is implemented and already uses the correct
`application/a2a+json` content-type for webhook payloads (§4.3.3), and the A2A/MCP boundary from
`protocol-and-hosts.md` is respected — `submitA2AMessageAsTask` creates a normal Coordinator task via
`createProtocolTaskAdmin`, not a shadow system. The gaps below are narrow and mostly additive.

---

## 1. `GetExtendedAgentCard` uses the wrong error code (trivial)

**Status:** present but wrong shape — `lib/a2aAdapter.ts:416`

```ts
if (method === 'GetExtendedAgentCard') return rpcError(id, -32004, 'Extended Agent Card is not supported')
```

Per the real A2A error-code registry (`docs/specification.md` §5.4), `-32004` is
`UnsupportedOperationError`, but there is a purpose-built code for exactly this case:
`-32007 ExtendedAgentCardNotConfiguredError`. Since `capabilities.extendedAgentCard` is
correctly advertised as `false`, this call should fail with `-32007`, not the generic `-32004`.

**Effort:** trivial — change the numeric code (and message to match the registry's wording).

---

## 2. SSE streams never carry the terminal result artifact (small)

**Status:** partial — `lib/a2aAdapter.ts:164-208` (`streamA2ATaskUpdates`)

`StreamResponse` in the proto is a oneof of `task | message | status_update | artifact_update`
(a2a.proto:790-803). agentViewer's SSE loop only ever emits the initial `{task}` snapshot and then
a stream of `{statusUpdate}` events; it never emits an `artifactUpdate`, and the final terminal
`statusUpdate` does not carry the result artifact either (only `state`/`timestamp`, per
`lib/a2aAdapter.ts:184-194`). `resultArtifact()` (line 39-46) is only ever read inside
`protocolTaskToA2A`, which the stream loop stops calling once it starts polling for state changes.

Concretely: a client using `SendStreamingMessage` or `SubscribeToTask` to watch a task to completion
receives no artifact in the stream and must issue a separate `GetTask` call to retrieve the result —
defeating part of the purpose of streaming.

**Fix:** on the loop's terminal-state branch, enqueue one more chunk carrying either the full
`{task: protocolTaskToA2A(task)}` (simplest — reuses the existing helper, matches what
`SendMessage`'s non-streaming path already returns) or a dedicated `artifactUpdate` chunk, before
calling `controller.close()`.

**Effort:** small — same file, same function, ~10 lines.

---

## 3. `CancelTaskRequest.metadata` is accepted on the wire but discarded (trivial)

**Status:** partial — `lib/a2aAdapter.ts:343-346`

The 1.0 CHANGELOG explicitly added `metadata` to `CancelTaskRequest` (`spec: add metadata to
CancelTaskRequest`, #1485/#1484), and the proto reflects it (`CancelTaskRequest.metadata`,
a2a.proto:723). agentViewer's handler ignores `params.metadata` entirely and always cancels with a
fixed reason string:

```ts
const task = await cancelProtocolTask(address.runId, address.taskId, 'Cancelled through A2A 1.0')
```

`cancelProtocolTask(runId, taskId, reason?: string)` (`lib/agentCoordination.ts:3475`) already
accepts an optional reason — the adapter just never forwards one from the request.

**Fix:** if `params.metadata` contains a string field (e.g. a `reason`/`note` convention), pass it
through as the cancellation reason instead of the hardcoded string.

**Effort:** trivial.

---

## 4. `history_length` / `historyLength` is accepted nowhere and `Task.history` is never populated (medium)

**Status:** absent — spans `lib/a2aAdapter.ts` `SendMessageConfiguration`, `GetTaskRequest`,
`ListTasksRequest`, and `protocolTaskToA2A`

The proto defines `history_length` on three request messages
(`SendMessageConfiguration.history_length` a2a.proto:154, `GetTaskRequest.history_length` :672,
`ListTasksRequest.history_length` :694) and `Task.history` (`repeated Message history`,
a2a.proto:180) to return it. `A2ATask.history?: A2AMessage[]` already exists in
`lib/agentProtocol.ts:77`, but `protocolTaskToA2A()` never sets it, and none of the three request
handlers in `lib/a2aAdapter.ts` read the `historyLength` param at all — it's silently accepted and
ignored (not rejected, just a no-op).

This is architecturally the biggest of the additive gaps: it requires deciding what "message
history" means for a Coordinator task (candidate source: the task's own mailbox
messages/progress notes, or just the two A2A `Message`s — the inbound submit and the outbound
result — synthesized on demand) and then wiring `historyLength` truncation through three call
sites.

**Recommendation:** scope this down for a first pass — synthesize a 2-entry history (the inbound
user `Message` reconstructed from `task.metadata.prompt`, and an outbound agent `Message` built
from `resultSummary`/`resultDetail`) rather than exposing full mailbox/progress-log detail, and
respect `historyLength` as a simple slice/limit. Full mailbox-message translation is a larger,
separate effort — track as follow-up if attempted.

**Effort:** medium for the minimal 2-entry version; large if translating full Coordinator mailbox
history into `A2AMessage[]`.

---

## 5. `AgentCardSignature` (JWS card signing) not implemented (large, defer)

**Status:** absent — `AgentCard.signatures` (a2a.proto:396, `repeated AgentCardSignature`) has no
equivalent field populated in `buildCoordinatorAgentCard()` (`lib/a2aAdapter.ts:461-504`), and
`lib/agentProtocol.ts`'s `A2AAgentCard` type doesn't even declare a `signatures` field.

This is an optional, additive integrity feature (RFC 7515 JWS over the card JSON) with no existing
signing-key infrastructure anywhere in this codebase to build on.

**Effort:** large — new key management, no existing foundation. **Recommend deferring**, matching
the precedent set by the prior AHP gap-audit run for "large new subsystem with no existing
foundation."

---

## 6. `A2A-Extensions` request header is not read or acknowledged (small, low priority)

**Status:** absent — `lib/a2aAdapter.ts:441-459` (`handleA2AHttpRequest`)

Per spec §3.2.6/§9.2, clients opt into extensions via the `A2A-Extensions` header (comma-separated
extension URIs), and servers can use it to decide whether to include extension-specific data.
agentViewer has exactly one extension (`A2A_COORDINATION_EXTENSION_URI`, `required: false`) and
never reads this header — coordination metadata is always attached to every `Task.metadata`
regardless of whether the client opted in.

Since the extension is optional and always-on, this isn't causing incorrect behavior today, but a
strict client that didn't declare the extension and doesn't expect
`metadata["https://agent-viewer.dev/extensions/coordination/v1"]` in responses has no way to
suppress it.

**Effort:** small — read the header in `handleA2AHttpRequest`, thread an `extensionsRequested: Set<string>` through to `protocolTaskToA2A`, and omit the coordination metadata key when not requested. **Low priority** given the extension is declared non-required.

---

## 7. `TASK_STATE_REJECTED` / `TASK_STATE_AUTH_REQUIRED` are unreachable (informational, not a bug)

`taskStateFromStatus()` (`lib/agentProtocol.ts:340-361`) can never produce
`TASK_STATE_REJECTED` or `TASK_STATE_AUTH_REQUIRED` because `ProtocolTaskStatus` (the Coordinator's
own task-status enum) has no equivalent states — there's no "agent declined to do this task" or
"needs auth to proceed" concept in the task board today. The `A2ATaskState` TypeScript union
correctly includes both (matching the proto 1:1), so nothing is mis-typed; it's just that two of
the nine states are currently dead code paths.

**Not recommending implementation** — introducing "rejected"/"auth_required" as first-class
Coordinator task statuses is a task-board schema change (new status values ripple through
`lib/agentCoordination.ts`'s task-status switch statements, the TUI/web status badges, etc.), not a
narrow A2A-adapter fix. Flagging for awareness only.

---

## Confirmed non-gaps (checked and found correct — noting so the implementer doesn't "fix" these)

- **JSON-RPC binding content-type is correctly `application/json`.** The CHANGELOG's 1.0.1 fix
  "prefer `application/a2a+json` in HTTP binding" applies to the HTTP+JSON/REST binding (spec §11)
  and to push-notification webhook payloads (spec §4.3.3) — **not** to the JSON-RPC binding
  agentViewer implements, which spec §9.1 pins to `application/json` explicitly. agentViewer's
  `rpcJson()` (`lib/a2aAdapter.ts:217-227`) and its inbound content-type check
  (`lib/a2aAdapter.ts:450`) are both correct as-is. The webhook sender in
  `sweepPushNotifications()` (`lib/agentCoordination.ts:3647`) already correctly uses
  `application/a2a+json` for the binding where the spec actually requires it.
- **Method coverage is complete.** All 11 service methods from `a2a.proto` (`SendMessage`,
  `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`,
  `CreateTaskPushNotificationConfig`, `GetTaskPushNotificationConfig`,
  `ListTaskPushNotificationConfigs`, `GetExtendedAgentCard`, `DeleteTaskPushNotificationConfig`)
  are dispatched in `handleA2AJsonRpc`.
  `TaskPushNotificationConfig` request shape matches exactly.
- **`TaskState` enum is complete and correctly named** (all 9 values, matching a2a.proto:187-208).
- **Error codes for the implemented paths are correct**: `-32001` (task not found), `-32002` (task
  not cancelable), `-32004` (unsupported operation — for continue-via-`SendMessage` and
  subscribe-to-terminal-task), `-32005` (content type), `-32009` (version) all match spec §5.4's
  registry (the one gap is item 1 above).
- **`SubscribeToTask` resubscription semantics are correct**: returns `-32004` if the task is
  already terminal, per a2a.proto:75 and spec §9.4.6.
- **Push-notification config CRUD is complete** (create/get/list/delete), with SSRF-safe URL
  validation (`validatePushUrl`, `lib/a2aAdapter.ts:256-273`) and actual webhook delivery on task
  status changes (`sweepPushNotifications`, `lib/agentCoordination.ts:3624-3661`) — this is a fully
  working feature, not a stub.
- **A2A/MCP boundary is respected.** `submitA2AMessageAsTask` → `createProtocolTaskAdmin` lands the
  task on the normal Coordinator board; there is no parallel/shadow task system. Matches
  `.agents/skills/coordinate-agents/references/protocol-and-hosts.md`'s stated contract.
- **AgentCard fields**: all required fields present (`name`, `description`, `supportedInterfaces`,
  `version`, `capabilities`, `defaultInputModes`, `defaultOutputModes`, `skills`); optional fields
  correctly omitted where genuinely inapplicable (`provider`, `iconUrl`, per-interface `tenant` —
  no multi-tenancy in this deployment model). `securitySchemes`/`securityRequirements` correctly
  describe the bearer-token gate.
- **`AgentInterface.protocol_version` / `A2A-Version` service parameter**: agentViewer requires an
  exact `A2A-Version: 1.0` header match and rejects otherwise with `-32009`
  (`VersionNotSupportedError`) — correct behavior since only one version is served (spec's "assume
  0.3 for empty header" fallback is moot here, since 0.3 isn't supported either way and the
  resulting error code is right).

---

## Priority summary for task-2 (implementer)

| # | Gap | Effort | Priority |
|---|-----|--------|----------|
| 1 | `GetExtendedAgentCard` wrong error code (`-32004` → `-32007`) | trivial | do |
| 3 | `CancelTaskRequest.metadata` discarded | trivial | do |
| 2 | SSE streams don't carry terminal artifact | small | do |
| 6 | `A2A-Extensions` header unread | small | optional / low priority |
| 4 | `history_length` / `Task.history` unpopulated | medium | do minimal 2-entry version if time allows; otherwise defer with a note |
| 5 | `AgentCardSignature` (JWS signing) | large | defer — no existing key-management foundation |
| 7 | `TASK_STATE_REJECTED`/`AUTH_REQUIRED` unreachable | n/a | informational only, not a fix |
