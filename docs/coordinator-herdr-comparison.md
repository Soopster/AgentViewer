# Herdr techniques applied to Coordinator

Source inspection: local `/Users/lukeryan/Documents/src/herdr`, September 8, 2026.
This is an implementation comparison, not a comparative throughput benchmark.

Herdr's `src/api/wait.rs` separates prompt submission, observed activity, and
settled state. It captures an event sequence before submission, checks the
target's identity, and preserves that sequence through both waits so short
transitions and lifecycle changes are not lost. Its skill distinguishes blocked,
unknown, working, and ready states, and warns that timeout does not prove a
prompt was never delivered. The server owns processes and observation; a model
does not need to spend turns polling terminal output.

Coordinator already has durable task ownership, typed mail, server-side waits,
provider identities, and supervisor-owned processes. The corresponding changes
in this checkout are:

- Blocked and approval-waiting ownership does not trigger model turns. Mail or
  approval can wake the worker; another claimable lane cannot override an owned
  blocked task. Restarted supervisors apply the same live-state gate before
  their first provider turn; fresh participants retain their bootstrap turn.
- Three successive successful turns with the same actionable digest trigger
  supervisor pacing: 1 second, doubling up to 30 seconds. A changed digest wakes
  promptly. Mail/reply-required work bypasses pacing. Heartbeat/cursor noise does
  not bypass it. Work remains owned and resumes after the bounded delay.
- Coordinator observation failures retry the status/wait operation without
  starting another model turn. Reconnection preserves the pacing deadline; a
  terminal run observed after an outage exits without invoking the provider.
- Immediate non-actionable event responses are throttled in blocked and idle
  states as well as paced states, preventing heartbeat-driven polling loops.
- Native CLI completion waits for stdout/stderr closure and consumes the final
  JSON frame even without a newline. A final provider error cannot be hidden by
  an otherwise successful exit code.
- Keyed mutations retain durable attempt records. After an uncertain outcome,
  agents reconcile durable state rather than blindly resubmitting effects.
- Worker listings distinguish process lifecycle from observed activity.
  `coord workers --activity blocked` and `--activity awaiting_approval` locate
  live workers needing attention; JSON includes the reason, task, and observation
  timestamp. Provider turns report working, observation failures report unknown,
  and stopped workers clear live activity.
- CLI workers support `--detach`: the launcher waits for durable registration,
  then exits while the original supervisor/provider processes continue. Restart
  uses the same acknowledged startup, avoiding optimistic success reports.
  A startup observation timeout leaves potentially accepted work intact and
  tells the user to reconcile before retrying. The daemon must remain available;
  this does not preserve processes across machine restarts.
- Interactive leads can use `coord_delegate` to assign work to a named available
  teammate with atomic task creation, ownership, baseline capture, path locks,
  and mail. The same teammate handles follow-up work in its existing session.
  The result reports queued delivery and identities, not execution success.
  Omitting the teammate reuses an available session or creates one in managed
  runs, subject to capacity. Concurrent automatic asks are serialized during
  allocation. External-only runs still require joined teammates.
- The Coordinator’s Ask another agent panel shows live task status and results,
  opens transcripts, sends messages, and starts follow-ups in the same session.
  Submission retries retain the original request key. This panel supplements
  the board; broader primary-chat integration and attention routing remain open.
  These flows have real-ledger tests with fixture provider sessions, not
  live-provider end-to-end proof.
- Compact shared tool definitions and conditional skill references keep the
  operating instructions consistent across provider entry points.

`scripts/coordWorkerSchedulingSmoke.mjs` checks blocked/approval waits, repeated
unchanged turns, wake-on-mail, and bounded continuation using actual supervisor
processes, including failures during immediate reads and long polls and a run
that completes during the outage. Restart fixtures verify zero provider turns
until mail or approval; a heartbeat flood checks bounded poll frequency.
`scripts/coordWorkerSmoke.mjs` checks an unterminated final error frame
from a provider that exits successfully, alongside recovery and shutdown cases.
`scripts/coordDetachedSmoke.mjs` exercises the public launcher for detached
leads and teammates, confirms provider survival after launcher exit, rejects
failed startup, and checks late startup after an observation timeout.
The full `mcp:smoke` suite covers transport replay and provider adapter contracts.

Pacing is deliberately not a proof of no progress: file edits can advance while
the board digest remains unchanged. It limits turn frequency without declaring
failure or automatically handing off healthy work. It does not bound total model
spend or certify parity with Herdr. Native provider activity detection and live
long-duration comparisons remain separate validation work; Herdr's terminal
state classifier and fixed five-second activity gate cannot simply be copied
into structured SDK/CLI transports with different startup behavior.

## Interactive mode verification, September 17, 2026

The current implementation includes the docked primary-chat teammate panel,
OpenTUI teammate panel, background attention, transcript inspection, persistent
follow-ups, bounded automatic lead continuation, and exclusive execution-host
ownership. These supersede the earlier note that primary-chat integration was
still absent; they do not establish comparative effectiveness by themselves.

Observation failures now mark cached roster activity as unknown in both panels.
A successful observation restores the activity label without restarting work or
discarding the last roster. A foreign execution host is identified explicitly;
its missing process-local turn registry must not imply an available teammate.
The TUI tracks read availability separately from an uncertain mutation so a
successful refresh cannot erase the exact request required for reconciliation.

Verified in this pass: the real-process restart smoke leaves an interrupted
provider submission paused until explicit recovery, then reuses the same task
and teammate. The TUI store smoke covers outage/reconnection, foreign-host
activity, session isolation, and identical-key retries. Broad live-provider,
long-duration, and comparative workflow effectiveness remain separate gates;
these focused checks do not prove them.

### Client restart and uncertain submission

Herdr's prompt/wait contract requires inspecting the agent after a timeout;
submitting again is unsafe because the original prompt may already have landed.
Interactive Coordinator now retains the exact TUI request on disk before sending
it, scoped by backend address, provider, and conversation. Restarting the client
restores an explicit retry/inspection gate without automatically sending work.
Confirmation or user-directed discard clears only that request. Private,
atomically published records survive client exit; invalid or unwritable storage
prevents submission rather than dropping the retry identity. Teammate transcript
inspection and roster navigation remain available during reconciliation.

`bun scripts/coordTuiRequestRecoverySmoke.ts` runs three separate processes. The
first exits after a real ledger task commits but before the client gets its
response. The second restores and explicitly retries the identical request,
leaving exactly one task. The third verifies confirmation cleared the journal,
provider/backend isolation, explicit discard, and corrupt/unwritable storage.
It is included in `tui:smoke:run`. The rendered teammate smoke also checks opening
a transcript without discarding an unresolved request.

The browser smoke now passes with local API fixtures for enable/disable,
continuation preferences, native approval attention, embedded transcript
inspection, preserved lead drafts, named follow-up, observation outage/recovery,
and foreign-host controls. Screenshots were inspected at 1440 by 1100. This is
rendered browser evidence, not a real-provider execution result. A three-round
real-provider check remains pending explicit approval for test sessions and
provider usage.

### Attention without opening the panel

Herdr exposes agents needing input without requiring the user to inspect every
pane first. The TUI now observes the selected, existing conversation even when
Teammates has never been opened. An existing team or a team created directly
from chat can surface attention without changing focus or sending work. Active
teams remain observed after navigation. Ordinary chats release their feed when
the last observer leaves and the initial read finishes; duplicate observers
share one subscription. New, unsent conversations do not start observation.

`tui/opentui/teammatesAttentionSmoke.tsx` renders this path against the real
ledger: selecting a conversation discovers an existing question, navigating
away still receives the next question, and opening attention targets the
correct conversation. Both questions remain unresolved until explicitly
answered. The store smoke checks shared feeds, navigation cleanup, and zero
mutation calls during discovery. The full App and Coordinator slot-isolation
smokes also pass; attention updates remain outside the root's state.

### Transitions, stalled starts, and seen results, September 17, 2026

Three more herdr patterns, each chosen because its absence failed silently:

- **Transition notifications** (`src/app/actions.rs`). Herdr notifies when an
  agent becomes blocked ("needs attention") or settles after work ("finished"),
  and stays quiet while that tab is active and the terminal is not known to be
  blurred. `lib/coordinatorSignals.ts` derives the same two kinds from durable
  Coordinator state — questions, plans, decisions, native approvals, recovery,
  stalled starts, and unreviewed results — and both surfaces apply herdr's rule:
  the TUI through OSC desktop notifications gated on OpenTUI `focus`/`blur`
  events and on whether the Teammates panel is open for that conversation, the
  web through the Notification API gated on `document.hidden`/`hasFocus()`. The
  first read of a conversation is a baseline, so launching a client or selecting
  an old chat never replays what it already holds. Signals are keyed by durable
  ids, so a re-read is silent and a second question notifies again. This goes
  further than herdr in one respect: the source is ledger state, so a teammate
  running on a daemon (`--attach`) or another host notifies exactly like a local
  one.
- **Stalled starts** (herdr's `agent_prompt_stalled`). "Starting · awaiting
  provider activity" had no deadline. A managed teammate holding a claimed task
  with no observed turn for `COORDINATOR_START_STALL_MS` (45s; wider than herdr's
  5s because delegation crosses the maintenance sweep and a provider spawn) now
  reads "Stalled · no provider activity observed · inspect before resending",
  counts as attention, and notifies. As in herdr, the label claims only that
  nothing was observed: recovery-owned teammates, external supervisors, ended
  runs, and foreign hosts are excluded, since silence there proves nothing.
- **Done versus idle.** Herdr keeps a finished agent flagged until it is seen.
  Reviewed-result markers were in memory in the TUI, so a restart re-flagged
  every result in every team; they are now persisted per conversation
  (`lib/tui/coordinatorReviewed.ts`, merge-on-write so two clients cannot erase
  each other's). The attention badge separates the two states as herdr's
  indicator does — `! Teammates: 2 need attention · 1 finished`, or a green
  `✓ Teammates: 1 finished` when nothing is waiting on the user — so results
  alone never read as urgent.

`bun scripts/coordSignalsSmoke.ts` pins the stall window and every exclusion,
baseline-silent transitions, reviewed results, the lead exclusion, and the
focus rule; four mutations (baseline replay, unknown focus as blurred, stalling
`in_progress` work, double-reporting recoveries) were each verified to fail it.
The TUI store smoke asserts a background question notifies once with the right
`viewing` flag, a re-read is silent, markers survive a store reset, and the
badge wording; three store mutations were verified to fail it. The browser smoke
now grants notification permission, asserts no notification while focused, then
blurs the page and asserts a new approval notifies; forcing suppression was
verified to fail it. These are fixture-driven checks, not live-provider or
long-duration comparisons with herdr.

## Herdr pattern inventory, September 17, 2026

A pass over herdr's source (`README.md`, `skills/herdr/SKILL.md`,
`src/app/actions.rs`, `src/workspace/aggregate.rs`, `src/api/wait.rs`,
`src/api/schema/events.rs`, `src/config/model.rs`, `src/agent_resume.rs`,
`src/worktree.rs`, `src/sound.rs`, `src/terminal_notify.rs`) against interactive
Coordinator. Herdr owns terminals and infers agent state by classifying screen
output; Coordinator drives agents through their SDKs and a durable ledger. That
difference decides most of the verdicts below.

| Herdr pattern (source) | Coordinator | Status |
|---|---|---|
| Lifecycle states `idle/working/blocked/done/unknown` (SKILL.md) | `coordinatorAgentActivity`: working, waiting for answer, blocked, finished, needs recovery, stalled, unknown, managed elsewhere | Present, finer-grained |
| `unknown` is not completion (SKILL.md) | Observation failure shows "Unknown · last observation unavailable" and keeps the last roster | Present |
| Prompt stall gate, `agent_prompt_stalled` (SKILL.md, `api/wait.rs`) | `COORDINATOR_START_STALL_MS` stalled-start state | Adopted this pass |
| Timeout does not prove non-delivery; never blindly resubmit (SKILL.md) | Idempotent request keys, on-disk unconfirmed-request journal, retry-same-request gate | Present, stronger: replay is safe by construction |
| Event sequence captured before submit so short transitions are not lost (`api/wait.rs`) | Store subscribes to run changes before first read; SSE pumps subscribe before `refetch()` | Present |
| Blocked / finished notifications (`actions.rs`) | `lib/coordinatorSignals.ts`, TUI OSC + web Notification | Adopted this pass |
| Active tab + terminal focus suppress notifications (`active_tab_suppresses_notifications`) | `coordinatorSignalSuppressed`, OpenTUI `focus`/`blur`, `document.hidden`/`hasFocus()` | Adopted this pass |
| Notification delay, cancelled if the agent moves on (`ui.toast.delay_seconds`, `delayed_background_waiting_cancels_when_agent_resumes_working`) | `COORDINATOR_NOTIFICATION_DELAY_MS`; delivery re-checks the signal and focus at fire time, web and TUI | Adopted this pass |
| `done` vs `idle` via server-side `seen` (SKILL.md, `aggregate.rs`) | Reviewed-result markers, durable in both clients; badge separates finished from waiting | Adopted this pass (TUI durability, badge split) |
| Attention priority blocked > unseen done > working > seen idle > unknown (`pane_attention_priority`) | `coordinatorAttentionPriority` picks which conversation "jump to attention" opens | Adopted this pass |
| `agent_blocked`: refuse to type into an approval dialog (SKILL.md) | Follow-ups go to the durable mailbox, never keystrokes, so they cannot answer an approval; delegation already refuses busy teammates | Not needed: the hazard does not exist |
| Agent panel sorted by attention priority, then latest state change (`AgentPanelSort::Priority`, `agent_view.rs`) | `coordinatorRosterOrder` in both rosters: waiting on user > unreviewed result > working > rest, newest task change first; TUI selection tracks teammate id so a reorder cannot retarget a key | Adopted this pass |
| Focusing an agent marks its completion seen (`mark_active_tab_seen`) | Opening a teammate's transcript reviews its results (`coordinatorResultIdsForAgent`), web and TUI | Adopted this pass |
| Metadata tokens with TTL shown per agent (`metadata_tokens.rs`) | Roster activity labels plus provider context/usage in each transcript | Present in substance; no free-form token API needed |
| Server handoff preserving PTYs (`handoff_runtime.rs`) | Turns run in the daemon and survive client restarts; a daemon replacement does not keep live turns | Not adopted: PTY handoff has no equivalent for SDK subprocess streams |
| Named agents, unique, validated (SKILL.md) | Protocol names, delegation requires exactly one active match | Present |
| Detach without stopping work (README) | `agent-viewer web` daemon + `--attach`; turns run server-side | Present |
| Resume supported agent sessions after restart (`agent_resume.rs`) | Provider sessions are durable by id; interrupted teammate execution waits for explicit recovery rather than auto-resuming | Present, deliberately stricter |
| Worktrees per agent (`worktree.rs`) | Per-teammate worktrees, baselines, path locks, completion gate | Present, stronger (locks and gate) |
| Several machines, one combined agent list (`--machine`) | `--attach` targets one daemon; remote pairing is per device | Not adopted: a cross-daemon roster is a separate project, not an interactive-mode change |
| Sounds per state (`sound.rs`) | OSC notifications; the terminal or OS decides whether they sound | Not adopted: bundled audio players are platform surface with no Coordinator value |
| Terminal output classifier / detection manifests (`detect/`) | Structured SDK events and the live-turn registry | Not needed: state is reported, not inferred |
| `pane wait-output`, `send-keys`, read sources (SKILL.md) | Transcript APIs and `coord_wait` / resource subscriptions | Not needed for structured transports |
| Tab-bar status commands, plugins (`tab_bar_status.rs`, plugins) | — | Not adopted: terminal-multiplexer chrome, outside Coordinator |

### Where this is better than herdr

- **State comes from the ledger, not the screen.** Herdr must classify
  terminal output and admits an `unknown` it cannot resolve; a Coordinator
  question, plan, decision or approval is a typed record, so attention is exact
  and names what is being asked.
- **Alerts are host-independent.** Signals derive from run state, so a teammate
  on a daemon (`--attach`) or another host alerts the same way a local one does;
  herdr's notifications come from the process that owns the pane.
- **Uncertain submissions are replayable, not just flagged.** Herdr tells the
  caller not to resubmit; Coordinator persists the exact keyed request and
  reconciles a replay server-side, across client restarts.
- **Coordination semantics herdr does not have:** tasks with ownership,
  dependencies, path locks and a completion gate, a durable mailbox, plan and
  decision gates, bounded automatic lead continuation, and cross-provider teams
  (Claude, Codex, OpenCode, Copilot, Pi).

### Where it is only as effective, or not yet shown

- The stall window (45s) is wider than herdr's 5s, so a genuinely dead start is
  reported later.
- No combined multi-machine roster.
- Every check above is fixture-driven. No live-provider, long-duration or
  side-by-side workflow comparison with herdr has been run.

Tests added for the second half of this pass: `coordSignalsSmoke.ts` pins
`coordinatorAttentionPriority`; the TUI store smoke asserts delivery is held
past 300ms, a question resolved within the delay never notifies, and a blocked
teammate outranks a finished one regardless of observation order. Removing the
at-delivery re-check, reverting to first-match jumping, and a zero delay were
each verified to fail it. The browser smoke passes with the delayed web path.

### Roster order and review on focus

Recency within a tier reads task `updatedAt`, never heartbeats or `lastSeenAt`,
so a quiet roster does not reshuffle under the cursor. Reordering is only safe
because TUI selection is held by teammate id: with a positional index, a
teammate rising above the selected row silently retargets `m` or `r`.
`teammatesPopoverSmoke.tsx` selects one teammate, has another raise a question
so the order changes, and asserts `m` still addresses the selected teammate;
reverting to positional selection was verified to fail it for exactly that
reason. It also asserts `⏎` on a teammate reviews its result, and the browser
smoke asserts the web **Transcript** button clears **Mark reviewed**. Removing
either review path, dropping the priority sort, dropping the result tier, and
dropping the recency tiebreak were each verified to fail their smokes.
