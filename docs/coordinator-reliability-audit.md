# Coordinator reliability audit

Objective: reliable, token-efficient multi-agent work across Claude, Codex,
OpenCode, Copilot, and Pi, including unattended long-running tasks.

The objective remains open. Passing adapter fixtures does not establish live
provider behavior or long-duration reliability. Unrelated TUI edits in the shared
checkout are outside this audit.

## November follow-up

The Coordinator now wakes a restarted unattended lead when its active task
board is empty. Native SDK and unattended prompts request actionable status for
routine work. A lead planning from an empty board can still read the full
objective, and lead staffing and recovery still have the full roster available.

Native Coordinator execution retains an uncertain dispatch when its SSE stream
closes with setup metadata alone. An external worker retains an uncertain
attempt when a JSON-mode CLI exits zero without structured output. Both paths
retain enough identity for reconciliation. A provider event followed by EOF
still requires stronger provider-specific settlement evidence.

Request `coord_query_context(query=…, detail_chars=0)` to shortlist evidence.
The fixture with 20 matches dropped from 48,570 to 4,953 serialized characters
(89.8%). Findings carry a stable event ID. Fetch one by `event_id` to retrieve
its full detail regardless of its rank or age in lexical search. The fixture
retrieves the original 32,000 characters and verifies run isolation. These
figures measure tool payload size. Provider billing and cache effects vary.

The 300-task, 6,000-event scale fixture retrieved a finding after its lexical
search window expired. The lead's routine status serialized to 589 characters,
versus about 219,000 for the full view.

An automatic claim now skips older tasks whose paths are locked and takes the
first eligible independent lane. The status digest applies the same lock check.
An explicit claim still targets the requested task and reports conflicts. With
100 runnable lanes, the digest reports the total and previews 12 titles. The
serialized queue fell from 20,693 to 1,996 characters. The fixture also claims
the last lane by ID. This preserves the first-eligible policy across the full
board, similar to Kueue's best-effort FIFO admission.
[Kueue queueing strategies](https://kueue.sigs.k8s.io/v0.20/docs/reference/kueue.v1beta2/)

The first isolated live Codex fixture found no recorded usage. The Coordinator
now records Codex app-server turn usage in run totals and task receipts. It
deduplicates by provider instance, session, and native turn. A cold or reset
counter records the latest observed request and marks the turn partial to
avoid charging historical usage. A deterministic fixture verifies that the
recorded usage prevents a subsequent dispatch when the run crosses its token
budget. [Codex usage counter semantics](https://github.com/openai/codex/blob/main/codex-rs/tui/src/token_usage.rs)

The accounting-enabled live fixture passed in 105 seconds. Two distinct
teammates completed their read-only tasks with nonzero provider usage in
their receipts. The lead reported both results in one automatic turn. The
checkout stayed clean and the two-second idle check found no extra lead turn.
The ledger recorded 871,948 observed tokens across five native turns,
including 738,432 cached input tokens. Three turns carried partial accounting.
These are provider-reported counters. Billing and comparative efficiency
require matched workloads and account-specific cost data.

Managed SDK teammates now receive the current claim at submission. For a
short new task, the brief includes its instructions, active write grants,
and verification commands. Longer briefs and handoffs point to exact reads.
Teammates can skip routine status, claim, and empty inbox calls. A matching
assignment notice is acknowledged only after the stream settles. Other mail
and unanswered replies remain in the mailbox. An unassigned managed teammate
with no mail or dispatch note waits without a model turn.

A repeat of the same two-lane Codex fixture passed in 89 seconds and recorded
680,236 observed tokens, 22% fewer than the prior run's 871,948. One teammate
called only the message and completion tools. The other also read status and
inbox. Both completed with provider usage in their receipts, and the lead
synthesized the results in one automatic turn. This is a single before/after
sample with variable provider usage. Repeat it on dependency-heavy workloads
before treating the difference as an expected saving.

Managed startup now allocates teammate slots to explicit provider and account
pins before filling from the configured pool. Ready work takes precedence over
future dependencies when pins compete for slots. Lead-only tasks do not
increase teammate staffing. A resumed lead fixture verifies that a Claude lane
claims the only teammate slot even when Codex appears first in the pool, then
the same session takes the dependent lane.

The idle sweep preserves paused runs, pending judgments, cooldowns and
unreconciled execution. It also gives a newly claimed managed task the full
supervision interval before a routine checkpoint can wake the lead. The idle
alert previews eight unfinished tasks and gives the remaining count.

The managed live fixture exposed a Codex teammate reaching an unbound MCP
client. Managed Codex turns now receive the same authenticated session-client
fallback as interactive turns. The dispatch fixture checks the generated
command with the loopback bridge enabled.

Run the opt-in dependency fixture with
`node --import tsx scripts/coordManagedWorkflowLive.ts`. The default pins a
Claude worker and a Codex lead. Set `COORD_WORKFLOW_LIVE_TEAMMATE=codex` to
exercise the same dependency and single-slot constraint with Codex.
The Codex run completed both ordered tasks in one worker session and reached
lead synthesis in 80 seconds. It verified both receipts, both evidence codes
in the synthesis, and a clean checkout. The Claude run reached its pinned
worker and stopped making progress after the provider reported its usage
limit. Its dependent task remained pending.

Managed and interactive runs can now reuse a teammate slot when a ready task
needs a different provider or account. The Coordinator prepares the incoming
session, rechecks the run, outgoing worker and task, then commits retirement
and the new claim together. Active turns, mail obligations, unresolved
attempts, and background work keep their slots. An outgoing worker's
credentials are retired. Its checkout and receipt remain inspectable.

The one-slot Codex-to-OpenCode live run passed in 81 seconds. The prerequisite
completed before the dependent task was claimed, the lead synthesized both
results, and the checkout stayed clean. Reproduce with
`COORD_WORKFLOW_LIVE_TEAMMATE=codex COORD_WORKFLOW_LIVE_NEXT_TEAMMATE=opencode node --import tsx scripts/coordManagedWorkflowLive.ts`.
The staffing fixture also exercises a nondefault provider instance,
concurrent sweeps, startup failure, a pause during setup, and review of the
retired worker's changed files.

An isolated completion that changes repository files now records an
integration requirement. Staging records the reviewed squash tree against the
receipt. A dependent can claim only when the target Git history contains a
commit of that tree and the claimant's checkout contains that commit. Managed
staffing can replace a stale idle checkout. Lead actionable status previews the
blocked tasks. A final-only run review and an intermediate target integration
cannot both precede a dependent lane. The Coordinator reports that conflict
while preserving the existing review requirement.

The live write fixture passed in 74 seconds. A Codex worker wrote `rule.ts`
in its own worktree, the harness inspected and staged the pinned result,
and the OpenCode dependent stayed pending until the harness committed it.
OpenCode's receipt included the value it read from `rule.ts` in its own
checkout. The lead synthesized both results. The Git regression also rejected
a commit of a different tree and verified recovery when the reviewed tree was
committed. Set `COORD_WORKFLOW_LIVE_WRITE=1` with the two-provider fixture.

### Patterns to carry forward

- Keep submission, provider liveness, settlement, and accepted task results
  distinct. Herdr observes agent activity from the host. Temporal records
  activity outcomes and recommends stable idempotency keys for retries. Apply
  these patterns to explicit settlement and to remote workers using the existing
  run, participant, task, claim, and attempt identities.
  [Herdr agent states](https://herdr.dev/tui/docs/agents/)
  [Temporal activity definitions](https://docs.temporal.io/activity-definition)
- Preserve successful lanes when a dependent lane fails. LangGraph persists
  graph checkpoints and can retain sibling writes. Coordinator already has
  immutable task handoffs and receipts. Verify a resumed run retains completed
  work, dependency order, and integration checks across daemon and worker
  crashes. [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- Scale delegation to independent work and pass references to durable evidence.
  Anthropic reports increased token use in multi-agent research and describes
  direct artifact storage. Compare single-agent, current Coordinator, and
  revised Coordinator runs on the same coding tasks and provider account.
  [Anthropic multi-agent research](https://www.anthropic.com/research/multi-agent-research-system)

### Remaining verification

Exercise cross-account slot reuse and recovery with live providers. Workflows
that need intermediate integration and final-only approval still need a
separate dependency staging path that preserves final target approval.

1. Verify each provider's accepted, settled, interrupted, and background-work
   signals on live runs. Exercise acceptance followed by disconnect, daemon
   restart, and remote worker loss. Check that every uncertain attempt has an
   observable state and that recovery submits at most one new turn.
2. Run a dependency graph with competing paths, an approval gate, a failed
   lane, and a final integration check through Web, OpenTUI, and standalone MCP.
   Compare task completion, retries, manual interventions, and elapsed time.
3. Collect reported input, cached input, and output tokens by provider and
   account for those runs. Record how each MCP host renders text and structured
   results. Use identical acceptance checks and report missing usage separately.

## Implemented and directly exercised

| Requirement | Change | Evidence and scope |
| --- | --- | --- |
| Recover acknowledged mail after losing a result | Caller-supplied inbox `request_id`; first-call key guidance | `scripts/mcpAhpCoordinatorSmoke.mjs` replays an acknowledged batch against the real AHP ledger and confirms a fresh key does not redeliver it. `scripts/mcpBridgeSmoke.mjs` checks HTTP bridge forwarding. |
| Preserve caller identity during cancellation | Separate `targetAgentId` from authenticated `agentId` | Real AHP cancellation and all five native adapters target the teammate while retaining task ownership; native recovery smoke also rejects a teammate cancelling the lead. |
| Provide recovery tools across providers | Add native handoff, leave, and cancel tools; explicit mutation keys | `scripts/coordProviderRecoverySmoke.ts` exercises create replay, inbox replay, cancellation, handoff replay, active lock release, and leave against an isolated real ledger through all five adapters. This invokes SDK tool handlers, not live model services. |
| Prevent native tool drift | Shared pure `lib/coordinatorToolContract.mjs`; OpenCode consumes it in its separate runtime | All five adapter inventories are checked; OpenCode now exposes context search, durable memory, reusable roles, and spawning as well. Node imports the plugin and registers 27 tools. |
| Preserve actionable errors | OpenCode propagates the bridge's error text | Unauthorized cancellation returns the same useful backend rejection through the OpenCode HTTP bridge. |
| Wait without spending model turns on blocked or approval-waiting work | Supervisor distinguishes ownership from runnable work | `scripts/coordWorkerSchedulingSmoke.mjs` launches actual worker processes with deterministic CLI/daemon fixtures. Three scenarios perform three waits without a second model turn, then resume on mail or approval. A spare claimable task does not wake a blocked owner. |
| Recover observation outages without spending model turns | Retry coordinator reads and long polls inside the observation loop, preserving the pacing deadline | `scripts/coordWorkerSchedulingSmoke.mjs` injects HTTP 503 during a read and a long poll, asserts no extra provider invocation before actionable mail, and checks terminal recovery exits without another turn. |
| Resume without waking blocked work | Restarted supervisors read live state before their first provider turn | Worker scheduling smoke resumes persisted identities awaiting mail/approval and verifies zero provider calls until actionable change; terminal recovery makes zero calls total. |
| Bound idle observation churn | Throttle immediate non-actionable wait replies even without turn pacing | Worker scheduling smoke injects twelve heartbeat-like replies and checks elapsed time and provider invocation count. |
| Find workers needing attention | Persist observed activity separately from supervisor lifecycle; expose CLI activity filters | Scheduling smoke checks actual worker records during provider turns, waits, and outages, plus CLI blocked filtering and display. Worker smoke rejects unknown filters and excludes dead workers with old blocked activity. |
| Keep work alive after closing the launcher | `--detach` and restart use IPC startup acknowledgement after durable registration | Detached smoke starts leads and teammates through the public CLI, observes their original provider processes after launcher exit, and covers rejected and uncertain startup. This covers local child-process survival, not daemon or machine restarts. |
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
