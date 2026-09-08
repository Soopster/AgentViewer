# Coordinator reliability audit

Objective: reliable, token-efficient multi-agent work across Claude, Codex,
OpenCode, Copilot, and Pi, including unattended long-running tasks.

The objective remains open. Passing adapter fixtures does not establish live
provider behavior or long-duration reliability. Unrelated TUI edits in the shared
checkout are outside this audit.

## Implemented and directly exercised

| Requirement | Change | Evidence and scope |
| --- | --- | --- |
| Recover acknowledged mail after losing a result | Caller-supplied inbox `request_id`; first-call key guidance | `scripts/mcpAhpCoordinatorSmoke.mjs` replays an acknowledged batch against the real AHP ledger and confirms a fresh key does not redeliver it. `scripts/mcpBridgeSmoke.mjs` checks HTTP bridge forwarding. |
| Preserve caller identity during cancellation | Separate `targetAgentId` from authenticated `agentId` | Real AHP cancellation and all five native adapters target the teammate while retaining task ownership; native recovery smoke also rejects a teammate cancelling the lead. |
| Provide recovery tools across providers | Add native handoff, leave, and cancel tools; explicit mutation keys | `scripts/coordProviderRecoverySmoke.ts` exercises create replay, inbox replay, cancellation, handoff replay, active lock release, and leave against an isolated real ledger through all five adapters. This invokes SDK tool handlers, not live model services. |
| Prevent native tool drift | Shared pure `lib/coordinatorToolContract.mjs`; OpenCode consumes it in its separate runtime | All five adapter inventories are checked; OpenCode now exposes context search, durable memory, reusable roles, and spawning as well. Node imports the plugin and registers 27 tools. |
| Preserve actionable errors | OpenCode propagates the bridge's error text | Unauthorized cancellation returns the same useful backend rejection through the OpenCode HTTP bridge. |
| Wait without spending model turns on blocked or approval-waiting work | Supervisor distinguishes ownership from runnable work | `scripts/coordWorkerSchedulingSmoke.mjs` launches actual worker processes with deterministic CLI/daemon fixtures. Three scenarios perform three waits without a second model turn, then resume on mail or approval. A spare claimable task does not wake a blocked owner. |
| Keep baseline recovery behavior | Existing bounded worker lifecycle preserved | `scripts/coordWorkerSmoke.mjs` covers the existing timeout, shutdown, failure, and continuation paths. |
| Reduce repetitive MCP context | Shortened shared server instructions with a 1,800-character regression budget | `scripts/mcpBridgeSmoke.mjs` checks the instructions returned by MCP. This is a character budget, not a measured provider-token claim. |
| Keep retry policy consistent | MCP key generation and AHP retry classification share one action inventory | `scripts/coordRetryPolicySmoke.mjs` covers every classified read/keyed action, both transport failure classes, unkeyed/setup exclusions, bounded retries, and shutdown. The bridge smoke checks automatic keys for phase/run reviews, decisions, and learning promotion. |
| Recover a lost mutation response | Same-key replay after a real socket closure | The AHP smoke drops a successful `remember` response before client observation, closes the socket, and verifies two attempts produce exactly one durable memory entry. This proves post-result socket loss, not a crash between mutation and replay-cache persistence. |
| Reduce skill overhead without two conflicting copies | Main skill shortened from 3,794 to under 1,700 words; snapshot forwards to canonical skill; resumed prompts reuse loaded guidance | Skill validators pass for both entry points; MCP resource smoke enforces a 1,700-word main-skill budget and reference availability. Word counts are not provider token measurements or behavioral certification. |
| Prevent duplicate effects across crashes/processes and result eviction | Reserve keyed operations durably before effects; retain compact completed-key records for the run lifetime | `scripts/coordIdempotencySmoke.ts` uses separate processes and real SQLite: a child creates a task then exits before caching its result; a concurrent process cannot re-enter; thrown partial effects remain fenced; same-process callers share results; gate rejections remain correctable; v18 migration backfills completed keys; run deletion cascades records. |


The normal `npm run mcp:smoke` command includes the new provider recovery and
worker scheduling checks. Also run `npx tsc --noEmit`, `npm run tui:check`, the
Claude binding and coordinator prompt smokes, and `git diff --check` after relevant
changes.

## Remaining completion requirements

- Extend operation recovery beyond duplicate prevention. Durable reservations
  now fence concurrent/crashed/failed attempts and preserve completed-key
  tombstones after result eviction. Uncertain outcomes require reconciliation;
  this is not automatic exactly-once completion of arbitrary filesystem or
  provider effects. Test agent recovery from these errors through finalization,
  and cover setup mutations (create/join) separately.
- Repeated unchanged runnable turns now use bounded supervisor pacing (see
  `coordinator-herdr-comparison.md`). Extend this with evidence-based progress
  detection and spend limits; board state alone cannot distinguish useful file
  edits from a stalled model, so pacing does not abandon ownership.
- Measure long-run status, mailbox, event, skill, and resumed-session context
  growth. Preserve decision-relevant evidence while avoiding repeated snapshots
  and instructions; test cursor and retention boundaries.
- Forward-test the shorter skill and review remaining native/standalone tool guidance for contradictory
  recovery, idle, supervision, and completion instructions. The compatibility
  reference now distinguishes native bound sessions from the standalone MCP
  bridge, but this is not yet a complete skill audit.
- Exercise real installed provider clients, including native and ACP paths where
  supported. Record actual provider/model and usage only when observable. The
  five-adapter fixture does not certify provider service availability or behavior.
- Run long-duration fault-injection scenarios that cover task ownership, lock
  expiry, checkpoint recovery, reassignment, review gates, and finalization across
  provider combinations; confirm terminal completion without human intervention.
- Audit final integration and publication artifacts against the original
  objective before marking the thread goal complete. No commit or push is
  implied by this audit.
