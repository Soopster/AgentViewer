# Coordinator comparison with t3code

Source: local `~/Documents/src/t3code`, revision `b1ec4b3687`, reviewed October
10, 2026. This is a source comparison, not a live-product performance claim.
The V2 overview describes a target architecture, so findings below also refer
to implemented services, tool declarations, or tests.

| Pattern | t3code evidence | Agent Viewer gap and response |
| --- | --- | --- |
| Per-task provider/model selection | `apps/server/src/mcp/OrchestratorMcpService.ts`, `resolveTarget`, and `docs/orchestration-v2/orchestrator-mcp-server.md`, `delegate_task` | Our ledger and dispatcher already support requested provider/model/effort. Ordinary delegation did not expose all three. Added them to SDK and stdio `coord_delegate`, the chat route, and TUI service. Web **Task model and effort** and TUI **n** configure task settings. Changing the selected provider clears previous overrides. |
| One delegation contract across transports | MCP toolkit delegates to a shared application service | Our SDK tools had teammate names and bounded waits, while the stdio bridge omitted them. Added those stdio fields and mapped them to the same server action. |
| Stable request identity per review round | `clientRequestId` on `delegate_task`; orchestration instructions retain it across retries | Already supported centrally by our shared tool contract and keyed ledger. New targeting fields preserve that behavior. A replay returns the original task and selection even if the retried caller changes its model argument. |
| Live provider/model discovery before dispatch | `resolveTargetRechecking` refreshes a requested unavailable instance; `resolveTarget` rejects unadvertised models | Added a read-only `coord_capabilities` tool and shared catalog for web/TUI using provider-native model metadata. Claude, Codex, OpenCode, and Copilot discovery does not create or resume sessions. Explicit advertised models/efforts are validated before teammate creation; concurrent reads coalesce, retries refresh availability, and replay receipts bypass rediscovery. Pi/ACP lack this adapter operation and report unsupported; their dispatcher remains authoritative. Configured instance targeting now persists through delegation and native dispatch; see the account identity row below. |
| Configured account and endpoint identity | `resolveTarget` checks instance registration, driver compatibility, advertised models, and inherited parent selection | Added `requested_provider_instance_id` to task creation/delegation and `provider_instance_id` to catalog discovery. Teammates persist the resolved identity; same-provider creation inherits the lead account, explicit pins prohibit cross-provider failover, and recovery inspects the saved account. Catalog reads coalesce by instance. Public discovery exposes labels and IDs without environment or executable configuration. Native session ID collisions across accounts are rejected because runtime waiting/interrupt state and interactive session tables still use unqualified session IDs; SDK tool bindings are now qualified separately. |
| Account-specific SDK bindings and teardown | `orchestration-v2/ProviderAdapterRegistry.ts` resolves adapters by instance; MCP `assertLiveCaller` verifies the calling instance still owns the active run | Claude, Codex, Pi, Copilot, and OpenCode tool bindings now include provider instance identity. Codex server-request handlers capture the turn account explicitly, independent of event callback context. A missing default-account binding fails closed. Stopping, deleting, or finalizing a run removes only that run's SDK aliases, even without a controller; warm Claude bindings remain stable across unchanged registrations. This is SDK isolation, not yet permission to remove the app-wide collision guard. |
| Model/options inheritance within the selected account | MCP `resolveTarget` inherits the parent's model only for the same instance, and options only for the same model | Managed turn dispatch now inherits lead defaults only within their source account. Changing the task model drops inherited effort unless explicitly selected. Unpinned recovery uses replacement-native defaults without erasing healthy teammates' defaults. Explicit task provider/account/model/effort selections block automatic cross-provider failover. |
| Recovery retains current ownership | MCP `assertLiveCaller` rejects a caller that no longer owns the active provider run | A dispatch fixture exposed a duplicate participant-token insertion during SDK failover. Credential rotation, agent/session updates, and attempt events now commit atomically; runtime/tool rebinding follows the commit. Failure rolls back the prior credential and native identity. The commit also rechecks run status, session/provider identity, task ownership and claim generation so a stop or reassignment cannot be overwritten by an in-flight recovery. |
| Durable lineage and context transfer artifacts | `thread-lineage-and-context-transfer.md`, V2 graph and MCP result references | `coord_handoff_task` now atomically saves an immutable portable checkpoint, attaches the latest checkpoint to the task, and retains prior checkpoints in a separate ledger table. Source session/provider, claim generation, task text, paths, checkout fingerprint (when obtainable), and content digest are pinned. `coord_read_handoff` inspects history independently of snapshot limits. Claims record the checkpoint and target provider/session; text dispatch includes the brief and SDK claims/status expose it. This transfers owner-supplied task context, not a full native transcript or filesystem changes. |
| Parent completion waits for nested work | MCP `task_status` reports `workState` and `hasPendingChildRuns` | Added completion/finalization guards for observed non-shell background tasks and scheduled wakeups. Claude SubagentStart/Stop tracks sibling identities without double counting; Claude Stop and Copilot task-list observations persist pending work. Clearing a foreground/UI marker never proves completion. Persisted pending work blocks after restart until a fresh settled provider observation arrives. Scripted native-hook and second-process fixtures cover this; unobserved native children and live-host parity for other providers remain open. |

## Capability discovery

Call `coord_capabilities` with an optional `provider` and `provider_instance_id` before choosing IDs. `instances` lists enabled public account identities. A task can pin one using `requested_provider_instance_id`, even without specifying the driver; a conflicting driver is rejected. The
result includes `status`, advertised `models`, supported effort levels where
known, and `checkedAt`. `unavailable` does not prove authentication failed;
refresh after checking provider configuration. `unsupported` means the adapter
has no session-free discovery operation. A catalog is metadata, not a guarantee
that a model turn will succeed.

In the web task controls, **Refresh model catalog** reveals advertised choices.
In the TUI options popup, **r** refreshes, **m** cycles models, and **e** cycles
advertised effort levels. Explicit IDs remain editable for unsupported adapters.
A model change clears effort; a provider change clears account/model/effort overrides. Web catalog refresh exposes a configured-account selector and the actual catalog account. In the terminal options panel, **i** cycles configured accounts after **r** discovers them; **r** then reads that account's catalog. Account IDs can also be entered directly.

## Usage

```json
{
  "name": "reviewer",
  "title": "Review the parser",
  "detail": "Review the implementation and report actionable findings.",
  "requested_provider": "codex",
  "requested_provider_instance_id": "<configured Codex instance ID>",
  "requested_model": "<provider-supported model ID>",
  "requested_effort": "high",
  "wait_ms": 10000,
  "request_id": "parser-review-round-1"
}
```

Use a new request ID for a new round; retain the same ID after an uncertain
response. Omitted model and effort inherit existing defaults only on their source account; other accounts use native defaults. A changed model does not inherit the prior model's effort. A named existing
teammate retains its provider; explicit conflicting provider requests are
handled by the existing server checks. Task model settings apply to delegation,
not messages steering an already-running turn. Requested model settings remain
distinct from actual model provenance in completion receipts.

Configured identity is saved on each managed teammate and task pin. Restart
inspection resolves the same account; disabled or missing accounts cannot be
silently replaced during recovery. Any explicit task provider/account/model/effort selection prevents automatic
cross-provider failover. Account/provider pins retain their claim/provenance
constraints after a handoff. Unpinned work retains cross-provider recovery,
with native defaults on the replacement and a freshly rotated credential. Older ledger rows use
their provider's default instance; the v25-to-v26 migration preserves runs.

## Portable task checkpoints

After `coord_handoff_task`, `task.contextHandoff` carries the latest checkpoint.
Use `coord_read_handoff` with `handoff_id` to inspect an earlier immutable record.
A later checkpoint gets a new ID; it never overwrites the previous context.
Keep the handoff request ID across retries. Ownership, locks, task identity,
and provider constraints retain their existing semantics. A task constrained
to one provider still requires the lead to adjust that constraint before a
cross-provider claim. Context notes grant no extra write paths or approvals.

Nested-work recovery requires a fresh authoritative provider observation.
An empty in-memory registry after restart, a new foreground turn, or clearing
a waiting indicator is insufficient to discard previously observed children.
Claude hook observations and idle Copilot task-list reads can clear the gate
once the provider reports no remaining work. Providers that do not expose these
observations cannot gain equivalent guarantees from this change.

## Remaining gaps

- Qualify runtime waiting/interrupt/steering state and interactive session
  persistence by instance so equal native session IDs can coexist throughout
  the app. SDK tool isolation is implemented; the Coordinator collision guard
  remains mandatory until the remaining layers are qualified.
- Persist a continuation/configuration fingerprint so hot-reloading a different
  account under an existing instance ID cannot silently change recovery identity.
  t3code exposes a `continuationKey` in provider adapter metadata; our current
  selection persists instance IDs and checks enabled configuration.
- Transfer full provider-independent conversation history; current portable
  checkpoints are explicit task briefs with audited lineage.
- Broaden authoritative nested-work observations across providers and prove
  them with live-host runs. Current fixtures are isolated and scripted.
- Benchmark representative teams before claiming a throughput or reliability
  advantage over t3code.

## Verification

- `bun scripts/coordSdkBindingIsolationSmoke.ts`: identical native IDs across
  account-specific SDK bindings, actual isolated `coord_status` dispatch,
  fail-closed default lookups, warm Claude object identity, isolated token
  rotation, filtered cleanup, and stop/delete cleanup without a controller.
- `bun scripts/coordModelInheritanceSmoke.ts`: managed lead/teammate transport,
  model and effort inheritance by account, changed-model effort reset,
  successful SDK credential rotation, healthy defaults after another teammate's
  recovery, explicit selection rejection, injected credential-write rollback,
  and a stop racing replacement session creation.

- `bun scripts/coordProviderInstanceSmoke.ts`: isolated real ledger/controller,
  distinct catalogs and instance-scoped native transport, inherited lead
  identity, public-metadata filtering, wrong-account/driver rejection,
  collision rejection, pinned failure, web/TUI request scope, restart recovery,
  exact replay with a disabled account, and migration with both columns absent.

- `bun scripts/coordContextLifecycleSmoke.ts`: immutable checkpoint and history,
  stable keyed handoff, cross-provider claim and target lineage, prompt delivery,
  run-scoped inspection, restart before a completion attempt, native sibling
  hooks, durable pending-work rejection, settled observations, finalization,
  and shell exclusion. Provider hook events are scripted, not a live model run.
- `bun scripts/coordDelegationSelectionSmoke.ts`: real ledger/controller with
  scripted provider transport; mixed-provider selection, persisted task model
  and effort, actual dispatch parameters, web validation, TUI service, and
  same-key replay without additional tasks, sessions, turns, or rediscovery; invalid/unavailable selections leave the roster unchanged, and concurrent discovery shares one read.
- `node scripts/coordDelegationBridgeSmoke.mjs`: actual stdio MCP discovery and
  tool calls against an isolated HTTP fixture; name, wait, provider/account/model/effort,
  and retry identity survive transport mapping.
- `bun tui/opentui/coordinatorWorkflowSmoke.tsx`: wide/narrow keyboard flows
  configure options without submitting work, send them with named delegation,
  and cancel without mutation.

The focused browser fixture (`COORD_SMOKE_CATALOG_ONLY=1`) passed refresh, configured-account selection, advertised model/effort selection, delegate payload mapping, and provider/account reset. The full browser fixture also passed on retry after an initial timeout in its existing outage scenario. The extended browser fixture checks the web model/effort fields and resetting
them when changing providers. These checks do not authenticate live models or
measure comparative throughput.
