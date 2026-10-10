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
| Live provider/model discovery before dispatch | `resolveTargetRechecking` refreshes a requested unavailable instance; `resolveTarget` rejects unadvertised models | Added a read-only `coord_capabilities` tool and shared catalog for web/TUI using provider-native model metadata. Claude, Codex, OpenCode, and Copilot discovery does not create or resume sessions. Explicit advertised models/efforts are validated before teammate creation; concurrent reads coalesce, retries refresh availability, and replay receipts bypass rediscovery. Pi/ACP lack this adapter operation and report unsupported; their dispatcher remains authoritative. Configured non-default instance targeting remains a separate gap because Coordinator currently dispatches by provider kind. |
| Durable lineage and context transfer artifacts | `thread-lineage-and-context-transfer.md`, V2 graph and MCP result references | `coord_handoff_task` now atomically saves an immutable portable checkpoint, attaches the latest checkpoint to the task, and retains prior checkpoints in a separate ledger table. Source session/provider, claim generation, task text, paths, checkout fingerprint (when obtainable), and content digest are pinned. `coord_read_handoff` inspects history independently of snapshot limits. Claims record the checkpoint and target provider/session; text dispatch includes the brief and SDK claims/status expose it. This transfers owner-supplied task context, not a full native transcript or filesystem changes. |
| Parent completion waits for nested work | MCP `task_status` reports `workState` and `hasPendingChildRuns` | Added completion/finalization guards for observed non-shell background tasks and scheduled wakeups. Claude SubagentStart/Stop tracks sibling identities without double counting; Claude Stop and Copilot task-list observations persist pending work. Clearing a foreground/UI marker never proves completion. Persisted pending work blocks after restart until a fresh settled provider observation arrives. Scripted native-hook and second-process fixtures cover this; unobserved native children and live-host parity for other providers remain open. |

## Capability discovery

Call `coord_capabilities` with an optional `provider` before choosing IDs. The
result includes `status`, advertised `models`, supported effort levels where
known, and `checkedAt`. `unavailable` does not prove authentication failed;
refresh after checking provider configuration. `unsupported` means the adapter
has no session-free discovery operation. A catalog is metadata, not a guarantee
that a model turn will succeed.

In the web task controls, **Refresh model catalog** reveals advertised choices.
In the TUI options popup, **r** refreshes, **m** cycles models, and **e** cycles
advertised effort levels. Explicit IDs remain editable for unsupported adapters.
A model change clears effort; a provider change clears both fields.

## Usage

```json
{
  "name": "reviewer",
  "title": "Review the parser",
  "detail": "Review the implementation and report actionable findings.",
  "requested_provider": "codex",
  "requested_model": "<provider-supported model ID>",
  "requested_effort": "high",
  "wait_ms": 10000,
  "request_id": "parser-review-round-1"
}
```

Use a new request ID for a new round; retain the same ID after an uncertain
response. Omitted model and effort use existing team defaults. A named existing
teammate retains its provider; explicit conflicting provider requests are
handled by the existing server checks. Task model settings apply to delegation,
not messages steering an already-running turn. Requested model settings remain
distinct from actual model provenance in completion receipts.

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

## Verification

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
  tool calls against an isolated HTTP fixture; name, wait, provider/model/effort,
  and retry identity survive transport mapping.
- `bun tui/opentui/coordinatorWorkflowSmoke.tsx`: wide/narrow keyboard flows
  configure options without submitting work, send them with named delegation,
  and cancel without mutation.

The focused browser fixture (`COORD_SMOKE_CATALOG_ONLY=1`) passed refresh, advertised model/effort selection, delegate payload mapping, and provider reset. The full browser fixture also passed on retry after an initial timeout in its existing outage scenario. The extended browser fixture checks the web model/effort fields and resetting
them when changing providers. These checks do not authenticate live models or
measure comparative throughput.
