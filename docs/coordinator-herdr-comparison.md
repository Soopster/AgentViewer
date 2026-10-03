# Herdr techniques applied to Coordinator

## Status, September 19, 2026

**Effectiveness — herdr's own recipes, run through our tools.**
`scripts/coordHerdrRecipesSmoke.ts` takes the recipes in herdr's
agent-automation guide and runs each through Coordinator's MCP tool surface
(the same argument mapping an agent's `coord_*` call uses) against a real
ledger. Every one completes, in fewer calls:

| herdr recipe | herdr calls | Coordinator | calls |
|---|---|---|---|
| start `reviewer`, `prompt --wait`, `read` the result | 3 | `coord_delegate` with `name` + `wait_ms` — the result comes back with it | 1 |
| `wait --until blocked`, `read` the question, `send-keys` an answer | 3 | `coord_wait` with `agent`/`until` returns the question itself; `coord_send_message` with `in_reply_to` resolves it in the ledger | 2 |
| `send-keys ctrl+c` to stop a teammate | 1 | `coord_cancel_turn` (external) / `i` / Interrupt (managed); the task stays owned | 1 |

Live runs with real providers are recorded below: Claude, Codex, Copilot and
Pi each staff a teammate and complete the same task; a Claude-led chat ran a
Claude and a Codex teammate side by side.

**Parity.** Every agent-facing method in herdr's socket API has a Coordinator
counterpart (the sweep is under "Naming a teammate by its job"). Attention
follows herdr's rules throughout — transition-only notifications with the
active-tab/focus rule and delivery delay, stalled starts, done-versus-idle
review marks, priority ordering, background work, alert delivery settings,
per-agent status lines, worktree visibility, name release, a narrow-terminal
layout, and the client/daemon version handshake.

**Better than herdr** because state is typed rather than inferred from a
screen: a teammate's question, plan, decision or approval is a ledger record,
so attention names what is being asked and a reply *resolves* it rather than
typing into a dialog; alerts work for teammates on another host or behind the
daemon; an uncertain submission is replayed safely rather than only flagged;
and the coordination layer — task ownership and dependencies, path locks and a
completion gate, plan and decision gates, mixed-provider teams, a durable
mailbox — has no herdr equivalent.

**Behind, and why.** A stalled start is reported at 15s against herdr's 5s,
because our window includes the dispatch sweep (measured live: 2-3s to first
activity, so the gap is headroom, not latency). The combined list across
machines is read-only. Terminal plumbing (panes,
layout, graphics, plugins, live handoff) is out of scope for an SDK-driven
coordinator.


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
  with no observed turn for `COORDINATOR_START_STALL_MS` (now 15s, see the inventory
  below) now
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
| Background work keeps an agent working; a background shell alone does not (CHANGELOG #1630, #3090, #3291, #3414, #2851) | `coordinatorBackgroundWork` from Claude's Stop-hook `background_tasks`/`session_crons` and Copilot's `tasks.list()`: "In background · N tasks · N wake-ups", working tier, never stalled. OpenCode exposes only a move-to-background mutation, Pi nothing, Codex only background shells (which correctly do not count) | Adopted for Claude and Copilot |
| Unloadable saved state preserved before replacement (CHANGELOG #4125) | Reviewed markers back up an unreadable file first and leave it untouched if the backup fails | Adopted this pass |
| Client-side view state tracked per client (0.9.0 #3526; SKILL.md "each TUI client tracks viewed completions independently") | Reviewed markers: per TUI data dir, per browser localStorage | Present |
| Agent list carries each agent's `cwd` and branch (`AgentInfo`, sidebar tokens) | `coordinatorAgentWorkspace`: a teammate's own worktree branch beside its activity, blank when it shares the lead's checkout | Adopted this pass |
| Client/server version handshake before relying on a feature (`herdr status`, `api/status.rs`; SKILL.md: "a missing method is not permission to stop or upgrade a server") | `GET /api/version` (name, version, protocol, features) + `daemonCompatibilityWarning`; the attached TUI reports a mismatch once at startup and never restarts the daemon | Adopted this pass |
| `agent send-keys <name> ctrl+c` to stop an agent going the wrong way (SKILL.md) | `interrupt-agent`: `i` in the Teammates panel, **Interrupt** in the web roster. A managed teammate's live turn is interrupted in this process; an external worker takes the cancel flag and urgent mail `cancelExternalProtocolTurn` already sent. The task stays owned | Adopted this pass |
| Every pane marked in the sidebar, so the stuck one is never hunted for (README, `aggregate.rs`) | `GET /api/agent-protocol/attention` + a per-row mark in the web session list (`! n` amber waiting, `✓ n` green results); the TUI's global badge already did this | Adopted this pass |
| Agent-reported metadata tokens shown in the sidebar (`metadata_tokens.rs`, `pane report-agent`) | `coordinatorAgentNote`: the teammate's own last progress/heartbeat/block/result line, quoted under its activity in both rosters | Adopted this pass |
| `agent start <name> --kind <agent>`: each pane's agent is chosen per agent, so a workspace mixes kinds freely | A chat's team can now staff teammates from different providers: `p` cycles the next new teammate's provider in the TUI panel, a select in the web panel; the set is durable per conversation | Adopted this pass |
| Closing a workspace with linked worktree workspaces needs explicit group intent (`workspace_group_close_required`), and a dirty checkout is never removed quietly (`worktree.rs`) | Turning a team off names what it leaves: teammate checkouts with uncommitted work, and turns still running (`readInteractiveTeardown`, read on demand) | Adopted this pass |
| A name follows the current pane occupant and is cleared when that agent exits, is released or is replaced (SKILL.md, `app/agents.rs`) | `availableTeammateName`: stopped and failed teammates release their name; a `done` one keeps it while its session is live, because that is what a follow-up reuses | Adopted this pass |
| A terminal observer that stops accepting output is disconnected after 30s without write progress (CHANGELOG #3612) | The Coordinator change stream drops a subscriber whose queue stops draining; the team keeps running and clients reconnect | Adopted this pass |
| `agent wait <name> --until <state>`, and `pane.agent_status_changed` subscriptions filtered by pane and status (SKILL.md, `api/schema/events.rs`) | `coord_wait` takes `agent` and `until`: it returns when that teammate settles or reaches a named state, at once if it already has, and whenever mail needs the waiter's reply | Adopted this pass |
| `agent prompt <name> "…" --wait`: submit, gate on observed activity (`agent_prompt_stalled`), then wait for a settled state (agent-automation docs, `api/wait.rs`) | `coord_delegate` with `wait_ms`: returns `settled.outcome` — completed (with the result), failed, cancelled, blocked, needs_reply, stalled, or timeout; a stall leaves the queued work untouched | Adopted this pass |
| TUI works on a phone over SSH; "the TUI adapts to narrow screens" (how-to-work docs) | Teammates panel verified at 60×28 and a phone-shaped 44×40 in the suite: meta drops whole entries in importance order, the typed draft text outranks its label, settings labels wrap and are counted | Adopted this pass |
| Goto picker lists every agent across workspaces; `b/w/i/d` filter blocked, working, idle, done (#4384) | The TUI coordinator rail lists every run's agents with herdr's states (`coordinatorPickerState`: needs you / working / result to review / idle / unknown); `f` cycles the filter; blocked and unreviewed counts stay in the header under any filter | Adopted (September 26) |
| Inherited agent-session and outer-terminal markers removed from new panes (#4461) | `lib/inheritedIdentityEnv.mjs`, scrubbed at every process entry; hosted PTYs also drop terminal markers | Adopted (September 26) |
| Restored agents start 100ms apart (#4487) | Measured concurrent vs spaced Claude starts; spacing did not help | Not adopted, measured |
| An evicted event cursor reports `events_lost` instead of silently resuming (#4225) | Events are durable rows paged by rowid; pruning drops only heartbeats and acknowledged status mail | Not needed: no silent gap exists |
| Startup and session switches do not count as completed work (#4457) | "Finished" comes from a task-result record, never an idle transition | Not needed by construction |
| OpenCode status follows the selected session and its descendants: blocked while any has a pending permission or question (#4357) | The OpenCode harness forwards a subagent's asks to every ancestor's stream and snapshot, and answers them on the asking session | Adopted (September 26) — this was a hang, not a label |
| Every agent's terminal is on screen at once — the pane is the agent (README, layouts) | `o`/`O` in the Teammates panel open the selected teammate, or the team in attention order, in split panes beside the lead's chat | Adopted (September 26) |
| State rolls up: a blocked agent marks its pane, tab and workspace; a done one stays marked until viewed (agents.mdx "State rollups") | TUI session rows now carry `!n` / `✓n` for their conversation's team, like the web rows; both subtract reviewed results | Adopted (September 26) — the TUI had only a badge for observed chats, and the web's `✓ n` never cleared |
| Named agents, unique, validated; `agent start <name>` names an agent by its job (SKILL.md) | Protocol names, delegation requires exactly one active match; **a new teammate can now be named** — `name` on `coord_delegate`, `@name` in a TUI draft, a field in the web panel — under herdr's `[a-z][a-z0-9_-]{0,31}` rule | Adopted this pass (naming) |
| Detach without stopping work (README) | `agent-viewer web` daemon + `--attach`; turns run server-side | Present |
| Resume supported agent sessions after restart (`agent_resume.rs`) | Provider sessions are durable by id; interrupted teammate execution waits for explicit recovery rather than auto-resuming | Present, deliberately stricter |
| Worktrees per agent (`worktree.rs`) | Per-teammate worktrees, baselines, path locks, completion gate | Present, stronger (locks and gate) |
| Several machines, one combined agent list (`--machine`) | `agent-viewer machines add` pairs this TUI with another machine's daemon (read-only); the coordinator rail lists each machine's teams under its heading with the same states and filter | Adopted (September 26), read-only |
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

- The stall window is 15s against herdr's 5s. It was first set at 45s on the
  assumption that provider spawn time counted against it; it does not
  (`turnActive` is set when a dispatch starts, before the provider launches), so
  the window now measures only the dispatch sweep — three missed 5s passes.
  Herdr's gate can be tighter because a terminal prompt has no sweep in between.
  `coordConversationSmoke.ts` holds real ledger delegations open with a provider
  that never answers and asserts no stall an hour past the window; dropping the
  `turnActive` exclusion was verified to fail it, so the check is exercising a
  genuinely claimed task rather than passing on its status.
- The multi-machine roster is read-only: acting on another machine's teammate happens on that machine.
- Live-provider proof now exists for two paths, but only those (below). No
  long-duration run and no side-by-side comparison with herdr has been made.

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

### Background work and preserved state

Herdr's changelog is a record of state it got wrong, and two entries apply
directly. Claude Code, Copilot and Pi agents read as idle while background
subagents or scheduled continuations were still due to wake them, which ended
`agent wait` early; the opposite fix stopped a lone background shell from
holding an agent "working" forever. Coordinator now reads the same distinction
from Claude's Stop hook, which records in-flight `background_tasks` and
`session_crons` into the runtime's waiting registry: running or pending tasks
other than shells, and any scheduled wake-up, keep a teammate in the working
tier, label it "In background", and exclude it from stalled starts. A
permission question still outranks it, since that is what the user can act on.
The field is optional on the wire, so an older daemon simply omits it. Only
Claude reports background work today; other providers stay as they were.

Herdr #4125 preserves a saved session that cannot be loaded before replacing
it. The TUI's reviewed-result markers read an unreadable file as "nothing
reviewed", which is right for display, but the next write then replaced the
only copy. They now copy it to `backups/` first, and skip the write if the copy
fails.

`coordSignalsSmoke.ts` pins the shell exclusion, finished tasks, wake-ups, the
label, the stall exclusion and question precedence; `coordConversationSmoke.ts`
drives the real route with a subagent and a shell in the waiting registry;
`teammatesPopoverSmoke.tsx` renders the label through the TUI read and watches
it clear; `coordReviewedMarkersSmoke.ts` pins backup-before-replace and
untouched-on-failure. Removing the shell filter, the stall exclusion, the
backup, the abort-on-failed-backup, and either client's wiring were each
verified to fail.

### Copilot background tasks

Herdr #3291 kept GitHub Copilot CLI "working" while it waited for background
agents. Copilot SDK 1.0.14 lists a session's tasks (`session.rpc.tasks.list()`:
agent, shell and client tasks with a status) and announces changes with the
ephemeral `session.background_tasks_changed` event. `refreshCopilotBackgroundTasks`
runs when a turn's stream ends and whenever that event fires on a pooled
session, and records `running` tasks in the same waiting registry Claude's Stop
hook feeds, translated to Claude's vocabulary (`agent` → `subagent`) so one
classifier reads both. Tasks Copilot reports `idle` are waiting for input, not
working, and do not count.

The registry also drives the TUI attention inbox, so two races matter: a
session with a live turn is never marked waiting, and a turn that starts while
the task list is in flight wins — the running check after the RPC is the one
that guards it (the one before is a fast path, since the event fires throughout
a live turn). A failed RPC leaves the previous marker alone rather than reading
as "nothing running". Eviction unsubscribes the watcher and clears the marker.

`scripts/copilotBackgroundTasksSmoke.ts` pins all of this with a fake session;
dropping the post-RPC guard, counting non-running tasks, treating an RPC failure
as empty, and dropping the turn-start clear were each verified to fail it. A
live probe against the installed CLI confirmed `tasks.list()` answers on a fresh
throwaway session (`{"tasks":[]}`, no marker); no background agent was started,
so the populated path is proven only against the fixture. `copilot:sdk:smoke`
still passes with the watcher attached to pooled sessions.

### Alert delivery, preference writes, and host ownership

Herdr's `ui.toast.delivery` lets a user choose where agent notifications go
(off by default, in-app, terminal, or system). Teammate alerts had no switch
at all. `l` in the Teammates panel now cycles desktop → in-app → off;
`coordinatorAlertDelivery` combines it with the active-tab rule (a blurred
terminal still gets a desktop alert while the panel is open; the in-app notice
is skipped because the panel already shows it). Desktop stays the default: herdr
paints a state glyph on every pane, where this TUI has one badge.

Testing the setting surfaced a defect in every TUI preference. `tui.json` was
written by an async, unserialized read-merge-write, so two quick toggles raced
and the later write erased the earlier change (three of five runs), and a torn
write read back as `{}`, so the next save wiped every preference. The merge is
now synchronous (the file is a few hundred bytes), written by temp-and-rename,
and an unparseable file is backed up before replacement (herdr #4125 again).
`scripts/tuiStateSmoke.ts` writes five preferences concurrently and restores the
old writer to confirm it fails.

A user report while this was in progress found the same shape of problem in
host ownership. The maintenance sweep runs in every process that loads the
coordination module, including the AHP sidecar `agent-viewer web` spawns, and
it resolved lead identities, which claims. A team enabled from the TUI was
taken over by the sidecar once that TUI exited; the restarted TUI and the web
then showed "Running in another host" for nine teams owned by a process with
no UI. The sweep now works only runs its process owns, and a dead owner is
adopted by a UI read. Herdr has no equivalent because its server is the only
process that executes panes; here several processes can, so which of them may
own work has to be decided explicitly.

### Which checkout a teammate is in, and the web delivery setting

Herdr's agent list carries each agent's working directory and branch, and its
sidebar can show them as tokens. A Coordinator team whose members each get
their own worktree had none of that: every roster row looked like the same
place. Both rosters now show the teammate's branch beside its activity, and
nothing when it shares the lead's checkout — repeating the lead's branch on
every row is noise, not information.

The web panel also gained the alert delivery setting the TUI got (desktop /
in-app / off, per browser). Its browser smoke sets it to off, raises a new
approval with the page blurred, and asserts silence, then switches to desktop
and asserts the notification. That assertion's window is deliberately longer
than the panel's 5s poll: at 3s it passed no matter what the setting was, and
the mutation that ignores the setting survived. At 9s the same mutation fails.

Unrelated, found by running the whole TUI suite: `gitReviewStreamSmoke.tsx`
fails on "clicking the selected file jumps back to its header". It fails the
same way at `e65ac35`, before any of this work, so it is pre-existing and left
untouched here.

### The attach handshake

`agent-viewer --attach` routes every backend call through a daemon that can be
older than the client — the daemon is long-lived by design, and today's session
found one three and a half hours old. There was no handshake: a route the
daemon lacks answers 404 with Next's HTML page, so the client reported
"Daemon request failed (HTTP 404)" with nothing to act on, per feature, every
time.

`GET /api/version` now answers name, version, protocol and a feature list, and
`daemonCompatibilityWarning` turns that into one sentence the attached TUI shows
at startup. A *newer* daemon is fine — this client only asks for what it knows
about — and a daemon that cannot answer the handshake at all is reported rather
than assumed good. As in herdr, the client never restarts or upgrades the
daemon: it may be serving somebody else's turns. The bare 404 message now says
the daemon may be older, since that is what it almost always means.

`scripts/daemonProtocolSmoke.ts` pins current, newer, older, missing-capability
and no-handshake cases plus the route's own shape; three mutations were verified
to fail it.

### Interrupting a teammate

Herdr stops a runaway agent with `agent send-keys <name> ctrl+c`. Coordinator
could cancel an *external* worker's turn (`coord_cancel_turn` sets a flag its
supervisor polls) but had no way to stop a **managed** teammate — the kind the
interactive panel creates — because that turn streams in the host process,
where nothing polls that flag. `interruptInteractiveAgent` interrupts the live
session for a managed teammate and falls back to the flag plus urgent mailbox
message for an external one, so one control covers both. The task stays owned:
this stops a turn, it does not take work away.

`coordConversationSmoke.ts` interrupts a real delegated teammate through the
ledger and asserts the live session's interrupt ran, the task keeps its owner,
a teammate credential cannot interrupt anyone, and a teammate with no live turn
here reports that rather than pretending. The TUI smoke presses `i` on an idle
teammate and asserts it never reaches the server. Removing the live-turn check
and removing the panel's gate were each verified to fail.

### Teammate marks in the session list

Herdr's pitch is that no pane has to be opened to find the stuck one. The TUI
had a global badge, but the web knew only about the conversation whose panel
was open: a team needing an answer in another chat was invisible until it was
selected. `readInteractiveAttention` summarises attention per interactive
conversation from the ledger alone — no provider calls, no session activation,
nothing acknowledged — bounded and newest-run-first because it rides the
session-list poll. Each row shows `! n` (waiting on you, amber) or `✓ n`
(results to review, green), the same split the TUI badge makes.

It is delivered by context rather than a row prop: the poll produces a fresh
object every five seconds, and as a prop that would re-render every memoized
session row. The page keeps the previous value when nothing changed, so the
context identity is stable too. Verified against real local data (five teams,
`✓ 1 | 1 teammate result to review`) and pinned in the browser smoke; making
the row ignore the context fails it.

### The teammate's own last word

Herdr lets an agent report tokens that its sidebar then shows, because a state
label says the agent is working, not what the work is. Coordinator teammates
already report progress, heartbeats, blocks, findings and results with a
summary — the ledger had it and neither roster showed it. Both now quote the
teammate's most recent line under its activity.

Only the teammate's own reports count: a `message` to another teammate is
correspondence, not a status line, and the lead's events are not this
teammate's voice. The quote is one line and capped at 72 characters, because it
shares a roster row, and a heartbeat with nothing to say leaves the previous
line standing rather than blanking it. `coordSignalsSmoke.ts` pins the source
filter, the newest-wins rule, trimming, the cap and the empty-heartbeat case;
`teammatesPopoverSmoke.tsx` has a real teammate report a line and asserts the
roster shows it. Three mutations were verified to fail.

### Live-provider check, September 18, 2026

Everything above was fixture-driven until this pass. Two scenarios were run
against a real Claude teammate, each in its own throwaway git repository with
its own `.agent-viewer-data`, shared checkout, no worktrees:

1. **Delegate → result.** A task to report a word from README. Observed, in 12
   seconds: `Starting · awaiting provider activity` → `Working · live turn`
   (2s) → the teammate's own word quoted in the roster (`“PARSNIP”`), a
   `finished` signal, and `task=completed` carrying `PARSNIP`. The stall window
   was never approached, which is the evidence behind 15s that the fixtures
   could not give.
2. **Teammate asks → attention.** A task whose instruction was to ask the lead
   which file to review. Observed: one `needs-attention` alert, fired as a
   transition, carrying the teammate's actual question ("Which file should I
   review: alpha.ts or beta.ts?"), with the attention list showing `message`.

Repeated with a **Codex** teammate through the identical script, since an
interactive run staffs teammates with the lead conversation's provider:

| | Claude | Codex |
|---|---|---|
| dispatch → `Working · live turn` | 2.1s | 2.7s |
| task completed with the right word | 10.1s | 21.2s |
| teammate's own line quoted | `“PARSNIP”` | `“PARSNIP”` |
| `finished` alert | once, on transition | once, on transition |
| teammate question → attention | `message`, with its real words | `blocker` + `message`, `Waiting for input` |

Codex reaches the blocked state through both paths at once — the task goes
`blocked` *and* the reply-required message lands — so its roster row reads
"Waiting for input" where Claude's read "Working · live turn" while the question
sat in the mailbox. Both produce the alert; the Codex row is the more accurate
of the two.

All runs were stopped and left nothing behind in this repository's data. What
this does NOT show: OpenCode, Copilot or Pi teammates, worktree-backed
teammates, long-running turns, recovery after a host restart with real provider
state, or any comparative measurement against herdr.

### Mixed-provider teams

Herdr picks an agent kind per pane, so one workspace runs Claude and Codex side
by side. Interactive Coordinator staffed every teammate from the lead
conversation's provider: the machinery for per-task providers existed
(`requestedProvider`, provider-aware spawn and failover) but the interactive
controller pinned `teammateProviders` to `[run.provider]`, so any request was
refused with "Requested provider is not configured for this team".

A chat's allowed set is now durable (`protocol_interactive_sessions.teammate_providers`,
schema v23) rather than inferred from whoever is on the roster, because failover
after a restart has to know what the team may staff. A provider the user picks
joins the set — the user choosing in the panel *is* the configuration — while a
non-interactive run keeps the old refusal, where the set came from the run's own
parameters.

Two rules matter more than the plumbing. A provider choice staffs a **new**
teammate only: asking for one while assigning to an existing teammate is
refused, because that teammate already has a session and silently ignoring the
mismatch would run the work somewhere the user did not choose. And an unknown
provider string is rejected rather than remembered.

Verified live: a Claude-led chat ran a Claude teammate and a Codex teammate
against the same task, both completing with the right answer (12.8s and 24.9s),
with `["claude","codex"]` persisted for the conversation.
`coordConversationSmoke.ts` pins the staffing, the persistence and the
existing-teammate refusal; three mutations were verified to fail it.

### Which providers can actually staff a teammate

A provider picker that offers an option which cannot work is a trap, so every
provider was run through the same live task (read a word from README, complete
the task with it) in its own throwaway repository:

| Provider | Result |
|---|---|
| Claude | completed, 10.1s |
| Codex | completed, 21.2s |
| Copilot | completed, 15.1s (blocks briefly, then completes) |
| Pi | completed, 30.2s |
| OpenCode | completed, after the OpenCode 2 support below |

OpenCode failed for a reason that had nothing to do with the Coordinator, and
the first diagnosis of it was half wrong. The installed CLI was **2.x** while
the client here spoke OpenCode 1's HTTP API, which produced two breaks:

1. `createOpencodeServer` waits for a line reading `opencode server listening
   on <url>`. The 2.x CLI prints `server listening on <url>`, so the helper
   waited out its timeout against a server that was already up, and **every**
   OpenCode session failed to start, teammates included. `startManagedServer`
   now spawns `opencode serve` itself, accepts both spellings, and captures the
   `server password` line 2.x prints — HTTP Basic, user `opencode` — which 1.x
   never prints. `OPENCODE_SERVER_PASSWORD` does the same for an external
   server.
2. With the server up and authenticated, `POST /session` answered 405, and the
   conclusion drawn was that no SDK 2.x existed. **It does**: OpenCode 2 ships
   under a different npm scope (`@opencode/cli`, `@opencode/client`), so
   searching `@opencode-ai/*` for a 2.x release found nothing and the provider
   was left reporting that it could not work. Support for both server
   generations is now in the provider itself — see CLAUDE.md's "OpenCode 1 and
   OpenCode 2 are one provider over two APIs". The version is read from the
   server (`GET /api/info`), and a 2.x server is adapted to the OpenCode 1
   client surface at the transport boundary rather than branched on at each
   call site.

The Coordinator needed one thing of its own: a 1.x plugin is a file exporting a
hook factory and a 2.x plugin is a directory default-exporting `{ id, setup }`,
so each major refuses the other's shape and a 2.x server loaded no `coord_*`
tools at all. `lib/opencodePlugin/agentViewerCoordinator2/` is the 2.x build.

Verified live end to end against `opencode` 2.0.8 in an isolated git repo: an
OpenCode-led chat delegated "read README.md and report the secret word" through
`coord_delegate`, the Coordinator spawned teammate **nova** on OpenCode, and
nova claimed the task, read the file and completed it with the right word
(`PARSNIP`) through `coord_complete_task`. Its first turn failed on an upstream
model error (`AI.Error: Internal server error` from the provider, not from this
app); the task went `blocked`, and the next turn recovered it — which is the
recovery path working rather than a clean run.

So all five providers can staff an interactive teammate.
`npm run opencode:harness:smoke` covers both server generations, ending in
`scripts/opencode2CompatSmoke.ts`.

### What turning a team off leaves behind

Herdr refuses to close a workspace that has linked worktree workspaces unless
the user says `--group`, and refuses to remove a checkout with modified or
untracked files without `--force`. Coordinator's "Turn off" ended a team with a
bare yes/no, and a worktree-backed team's branches simply stayed on disk with
nothing pointing at them — the work was not lost, but nothing said where it
went.

`readInteractiveTeardown` now answers that question and both confirmations ask
it before turning off: which teammates still have a turn running, and which
teammate checkouts hold uncommitted files. It runs `git status` once per
teammate checkout, so it is read when the user asks to turn off and never on a
poll.

Three rules, each pinned by `coordConversationSmoke.ts` against real worktrees:
a clean checkout is not mentioned; a checkout **shared with the lead** is never
mentioned, dirty or not, because that is the user's own working copy and ending
the team does not strand it; and a checkout that cannot be read is reported as
unknown rather than assumed clean, since the point of the warning is not to
lose work. Two of these survived their first mutation — the fixture's teammates
had their own clean worktrees, so the shared-checkout case was passing for the
wrong reason, and the unreadable case was not covered at all. Both now fail
when the rule is removed.

### Teammate names are a pool, not a ledger

Herdr clears an agent's name when that agent exits. Coordinator held a name for
every teammate a run had ever created, and an interactive chat is long-lived by
design: the ninth delegation failed with "Teammate name pool exhausted" while
nothing was running, because eight stopped teammates still owned the pool.

`availableTeammateName` frees a name when its teammate is stopped or failed. A
`done` teammate keeps its name while its session is still live, because that is
exactly the teammate a follow-up reuses. `resolveRecipientsSync` already
preferred "the newest active exact match" for a name — its comment promised
reuse that allocation never delivered, and now both halves agree.

`scripts/coordTeammateNamesSmoke.ts` pins each status, the done-with-live-session
case, and that retiring one teammate frees exactly its own name; two mutations
were verified to fail it.

### A stalled subscriber is dropped

Herdr disconnects a terminal observer that makes no write progress for thirty
seconds: one wedged client must not cost the server for the life of the
process. `/api/agent-protocol/runs/changes` queued every run change and every
heartbeat for every subscriber with no such rule, so a reader that stopped
draining and never disconnected — a suspended laptop, a wedged tab — grew that
stream's buffer without bound.

The stream now watches `controller.desiredSize`: progress clears the timer, so
a slow reader is fine, and only one that accepts nothing for
`STALLED_SUBSCRIBER_MS` is closed. As in herdr, what is dropped is the
observer, not the work: the team keeps running and clients reconnect.

`scripts/coordRunChangesSmoke.ts` drives the real route — fifty changes through
a draining reader, which is kept, then a reader that stops, which is dropped.
The drop shows up as the reader reaching `done` after draining, because a
closed `ReadableStream` still hands over what it buffered; asserting on
`reader.closed` instead hangs forever, which is how the first version of this
test failed. Two mutations were verified to fail it.

### Waiting on one teammate

Herdr's `agent wait reviewer --until blocked` returns when that agent reaches
that state, and its event API lets a client subscribe to status changes for a
single pane. `coord_wait` woke on any change in the run — every heartbeat, every
progress line, every message between other teammates — so a lead waiting for
one teammate spent a model turn per unrelated write, which is exactly the cost
herdr's filter exists to avoid.

`coord_wait` now takes `agent` and `until` (defaulting, like herdr's settled
states, to idle/ready/done/blocked plus the protocol's failed and stopped). Two
rules carry over and one is added:

- A state that already holds returns at once — herdr checks the initial state
  before waiting, and a wait for "idle" on an idle teammate must not sit out the
  timeout.
- The teammate is named by id or by name, and a name resolves to its newest
  holder, since names are reused after a teammate retires.
- **Mail that needs the waiter's reply always wakes it.** Herdr has no mailbox,
  so this one is ours: a filter that swallowed it would leave a teammate blocked
  on an answer from a lead that is waiting on that teammate.

`scripts/coordTargetedWaitSmoke.ts` runs against a real ledger: a state that
already holds, heartbeats and progress that must not wake the wait, the named
state that must, reply mail that must, unknown targets and states refused, and
the unfiltered wait unchanged. Ignoring the filter, swallowing mail, and
requiring a fresh change before matching were each verified to fail it.

### Naming a teammate by its job, and the API sweep that found it

A final pass mapped every method herdr's socket API exposes against ours. The
agent-facing set is covered: `agent.start`/`agent.prompt` are delegation and
follow-up, `agent.wait` is the targeted `coord_wait`, `agent.get`/`agent.list`/
`session.snapshot` are `coord_status` and the rosters, `agent.read`/`agent.focus`
open a teammate's transcript (and review its results), `agent.send_keys` for
Ctrl-C is interrupt, `events.subscribe`/`events.wait` are the MCP resource
subscription and the change stream, `worktree.*` is per-teammate worktrees and
the teardown warning, `notification.show` is `post_attention`, `ping` is
`/api/version`, `pane.report_agent`/`report_metadata` are the teammate's quoted
reports, and `pane.release_agent` is the name release. What remains unmapped is
terminal plumbing with no counterpart here — panes, tabs, layout, scrolling,
graphics, copy mode, plugins, popups, live handoff — plus `agent.rename` and
`agent.view.set`, below.

The one agent-facing gap was naming. `herdr agent start reviewer --kind codex`
names an agent by what it is for, and the name is then how every other command
reaches it; our teammates were always `nova`, `orion` and the rest of a fixed
pool, so the lead had to remember which star did the review. A new teammate can
now be named — `name` on `coord_delegate`, `@reviewer check the diff` in a TUI
draft, a field in the web panel — and the name addresses whoever holds it:
reused when that teammate is free, refused when it is busy (never a second
`reviewer`), and created when nobody holds it. Names follow herdr's rule,
`[a-z][a-z0-9_-]{0,31}`, and `lead`, `all` and `agent-N` are reserved because
they already mean something to the mailbox.

`coordConversationSmoke.ts` pins creation, the busy refusal, uniqueness and
the rejected names; the busy assertion first matched "All teammate slots are
busy" too, which let the reuse path be deleted unnoticed, so it now accepts only
the messages the reuse path can produce. `coordDelegateTargetSmoke.ts` pins the
`@name` split, including that an already-addressed follow-up is never
re-targeted. Four naming mutations were verified to fail.

Not adopted, deliberately: `agent.rename` (a teammate's name is written into
mail, results and transcripts already sent; renaming a live one would split its
history under two names) and `agent.view.set` (herdr's saved filters and sorts
serve a sidebar of many agents across machines; a conversation's team is a
handful, already ordered by what needs the user).

### Delegate and wait, in one call

Herdr's most-used recipe is `agent prompt reviewer "…" --wait`: submit, then
wait for the work to settle, in one command. A Coordinator lead needed two —
`coord_delegate`, then a wait — and got back "queued", which herdr's own
contract warns is not proof of anything. `coord_delegate` now takes `wait_ms`
and returns `settled` alongside the delegation.

It keeps herdr's two phases. First an **activity gate**: the teammate has to be
seen working, or its task seen moving, within `COORDINATOR_START_STALL_MS`, or
the outcome is `stalled`. Without the gate an idle teammate that never started
would read as settled — exactly what herdr's gate prevents. A stall, like
`agent_prompt_stalled`, proves nothing about delivery, so the queued task is
left alone for inspection, never retried. Then the task has to settle:
completed (the result comes back with it), failed, cancelled, or stopped on the
lead (blocked, a plan to approve, a teammate asking). The two carry-overs from
the targeted wait apply here too — new reply-required mail ends the wait, and
only new mail does.

That last rule was a bug found by this test, in both waits. Counting *any*
unanswered question meant one message the lead had not yet answered made every
later wait return at once: a filtered `coord_wait` degraded into waking on any
change, and delegate-and-wait returned `needs_reply` without waiting at all.
Both now count only mail that arrives during the wait.

`scripts/coordDelegateWaitSmoke.ts` covers every outcome against a real ledger,
including a stall that returns at the start window rather than the caller's
timeout with the task still `claimed`. Removing the gate, assuming activity, and
counting old mail were each verified to fail it; the targeted-wait smoke pins
the old-mail rule for `coord_wait` (its first version used a heartbeat as noise,
which is not a change at all, so it passed for the wrong reason until the noise
became a real message).

### The panel on a phone

Herdr's workflow docs lead with "work from your phone": SSH in, run the same
TUI, and it adapts to a narrow screen. The Teammates panel had only ever been
tested at 110 columns. Running the same smoke at 60×28 and at a phone-shaped
44×40 found four defects, each of which hid exactly the wrong thing:

- **The header cut the status, not the title.** It reserved sixteen columns for
  the conversation's title — which the reader already knows — and truncated the
  status meta instead, so "alerts in-app", the one thing nothing else on screen
  admits to, was the part lost. The title now yields first, and the meta drops
  **whole entries** from its least important end, ordered: what needs
  attention, a silenced alert mode, "nothing waiting", then the head count.
- **Typing a task overwrote itself.** The draft's label filled the row and the
  typed text drew over its tail ("…(@name to clook at the par"). The text now
  gets the width first: the parenthetical hint goes, then the label shortens,
  and a long draft shows its end, where the caret is.
- **Settings labels were clipped mid-phrase**, and wrapping them left the height
  estimate two rows short, which pushed the roster below the fold. They wrap
  under their checkbox and `bodyRows` counts the wrapped rows.
- **The background-work label** ("Working in background · 1 background task · 1
  scheduled wake-up") said "background" twice and could not fit. It reads
  "In background · 1 task · 1 wake-up".

The narrow runs are in `tui:smoke:run`. Prose assertions read the frame as a
line of words (`readable()`), since a correct panel wraps text a raw substring
check would miss, and the few checks that are genuinely width-dependent say so
(the `@name` hint is asserted from 60 columns up, because below that it gives
way to the text being typed, by design). The header order, the draft fitting
and the wrapped-row count were each verified to fail at 44×40; two of them could
not fail at 60×28, where everything fits either way, which is why the phone size
is the one registered.

### Herdr's recipes as an executable check

The status section above is backed by `scripts/coordHerdrRecipesSmoke.ts`,
which runs herdr's documented recipes through `COORD_TOOL_SPECS` rather than
calling library functions directly, so a broken argument mapping fails it the
same way it would fail an agent. Dropping `wait_ms`, `name`, or the `agent`/
`until` mapping from the contract was each verified to fail it; the `name` case
first survived because the reviewer was the only teammate, so an idle decoy
teammate now joins first and an unnamed delegation would go to it.

### A teammate is not the session that launched Agent Viewer

Herdr #4461 (September 22) removes inherited agent-session and outer-terminal
markers from every new pane, so a pane cannot claim the session that started
the server. The same leak existed here, on the paths people actually use: the
TUI started from a Claude Code shell, and `agent-viewer coord worker` started by
a lead's Bash tool — which exports `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`,
`CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_EFFORT` and the
messaging socket to its tools. Every teammate and pooled session inherited them,
because the Agent SDK's default environment is `process.env`.

Measured against the bundled CLI, not inferred: a spawn with the inherited
environment registers as `entrypoint: sdk-cli` (the CLI promotes an inherited
`cli`), the same spawn scrubbed registers as `sdk-ts`; the child is also marked a
nested child session, and its hooks and Bash see the launcher's effort level.
The messaging socket did *not* leak — the CLI allocates its own — so the damage
is misidentification rather than misdelivery, which is also why nothing had
visibly failed.

`lib/inheritedIdentityEnv.mjs` holds the list (Claude Code's per-tool exports,
Codex's `CODEX_THREAD_ID`, OMP's marker). Every process entry scrubs its own
environment once — `bin/agent-viewer.mjs`, the coord worker, `npm run tui`'s
`main.tsx`, and the Next server's `instrumentation.ts` for the packaged app —
which covers every spawn below it, SDK defaults included, rather than chasing
fifteen call sites. The embedded terminals additionally drop the outer
terminal's markers (iTerm2, tmux, WezTerm, Kitty, Zellij…) and identify as
`TERM_PROGRAM=agent-viewer`; our own process keeps those, since OpenTUI reads
them to talk to the user's real terminal. `coordWorkerSmoke.mjs` launches a
worker carrying a lead's identity and asserts the teammate it spawns sees none
of it while ordinary variables survive (verified to fail with the scrub
removed); `inheritedIdentitySmoke.ts` pins the lists and that each entry point
still scrubs.

### Every team at once: herdr's Goto picker on the coordinator rail

Herdr #4384 (September 19) made its Goto picker list every agent across
workspaces, each with its state, and filter by `b/w/i/d`. The coordinator rail
already listed every run's agents but said only `●`/`○` — working or not — so a
teammate waiting on the lead looked the same as one with nothing to do.

`coordinatorPickerState` (`lib/coordinatorSignals.ts`) reads herdr's states
from a run snapshot alone, because the rail spans runs whose interactive extras
(pending permissions, the live-turn registry) are not loaded. The ledger still
decides it: a question, plan or decision waiting on the lead is **blocked**
first; **done** is an unreviewed result, using the same markers the Teammates
panel writes, so reviewing there clears it here; an ended run's results are
history and never keep a teammate done. Each row leads with the state (`! needs
you`, `● working`, `✓ result to review`), `f` cycles all → blocked → working →
done → idle, and the selection moves to the first visible agent when its own row
is filtered out, so Enter never opens something the list no longer shows. `b`
and `d` are global toggles here (tab bar, density), which is why one key cycles
rather than herdr's four.

Two things the rail's width forced: the title names the active filter
(`BLOCKED 1/3`) and the blocked/unreviewed counts (`!1 ✓1`) come straight after
it, ahead of the key hints — the first version put them last and a 30-column
rail cut them off, which the smoke caught. And moving the selection no longer
re-derives every row: it used to rebuild the list per `j`/`k`, which was
harmless while rows were cheap and would now have re-read each run's review
markers per keystroke.

`coordinatorSidebarSmoke.tsx` seeds a teammate asking the lead a question and
one with a finished task, then drives `f` through every filter. Ignoring the
filter, dropping the selection follow, and dropping the done state were each
verified to fail it.

### Herdr changes from September 18-25 that did not need porting

- **Staggered restored startups (#4487).** Six concurrent Claude CLI starts do
  contend — about 2s alone, 6-13s each together — but spacing them 100ms or
  400ms apart was slower or no better in both interleaved rounds (the machine's
  noise was large: the single-start baseline itself read 1.9s and 6.2s). Herdr
  restores terminals whose first paint competes; ours are headless SDK
  processes whose total CPU is the same either way.
- **`events_lost` on an evicted cursor (#4225).** Herdr's event history is a
  512-entry ring, so a slow cursor silently resumed at the oldest survivor.
  Coordinator events are durable rows, paged 100 at a time by rowid, and
  retention prunes only heartbeats and acknowledged status mail — a waiter
  cannot skip an event that means anything.
- **Completion distinguished from startup and session changes (#4457).** Herdr
  infers "done" from a working→idle transition and had to stop crediting an
  agent's first idle prompt or a conversation switch. A Coordinator result is a
  task record written by the teammate, so neither can produce one.

### A subagent's question reached nobody

Herdr #4357 (September 22) keeps an OpenCode pane blocked while any
*descendant* session — a subagent — has a pending permission or question. Ours
did not track descendants at all, and the consequence was worse than a wrong
label. Reproduced live on OpenCode 2.0.8 with `bash: ask` and a prompt that
delegates `echo` to a subagent: the ask arrived on the child session, the chat's
turn stream (subscribed by the parent's id) never saw it, and the turn sat
"working" with no card to answer. Answering it anyway failed a second way — the
reply was keyed by the chat's session and OpenCode returned
`PermissionNotFoundError`. For a teammate this read as "Working · live turn"
indefinitely, while it was in fact waiting on the user.

The harness now learns parentage from `session.created`/`session.updated`
(looking a session up only when it is asking something, as herdr does) and
mirrors request events — never the child's messages — into every ancestor's
subscribers and snapshot, so the card appears in the chat, the teammate reads as
waiting for an answer, and a reattaching client's pending prompts include it.
The reply goes to the session that asked. Verified end to end through the send
path (`npm run opencode:subagent:live`); disabling the forwarding and reverting
the reply each fail it. `opencodeSubagentRequestsSmoke.ts` pins the rest without
a model: hydration includes a child's ask and excludes an unrelated session's, a
grandchild whose parent must be looked up is delivered late rather than never,
a child's own messages stay out, and a reply or a deleted child clears the
mirrored ask — three mutations checked to fail it.

The same defect existed for Codex, found by asking the question herdr's fix
raises for every provider: where does a sub-agent's ask arrive? Codex 0.157
runs `spawn_agent` sub-agents in their own threads (multi-agent is on by
default), and the turn claimed approvals for its own thread only, so the
sub-agent's approval fell through to the client's "method not supported"
reply: Codex refused the command and the user was never asked (reproduced
live — the file the sub-agent was told to create never appeared). The client
now learns thread parentage from the parent's `subAgentActivity` item — the
record 0.157 actually emits; the schema's `collabAgentToolCall` receivers and a
child's `thread/started` source are read too — and a turn claims approvals from
its descendant threads. `npm run codex:subagent:live` passes, and fails with the
old exact-thread check; `codexThreadParentsSmoke.ts` pins the three records,
transitivity, and that another chat's sub-agent is not claimed.

### Watching the team beside the lead

Herdr's most basic property is also its most effective one: every agent is a
pane, so the whole team is in view while you talk to one of them. Ours showed a
teammate only by *replacing* the lead's chat in the reader (`⏎` in the
Teammates panel), and split panes — which already existed — could only be
filled from tabs the user had opened by hand.

`o` in the Teammates panel now opens the selected teammate in a split pane
beside the lead, and `O` the team, in the panel's attention order, so when there
are more teammates than panes the one waiting on the user gets the first pane.
The lead's chat stays in the reader; existing panes are kept behind the watched
ones and the pane count only grows. Watching is deliberately not reviewing — a
result stays flagged until its transcript is opened. The notice says what
actually fits: a narrow terminal drops panes before it squeezes the reader, so
it names the teammates that got a pane and how to see the rest (`⌃B "` to
stack, or the tabs), rather than claiming all of them are on screen.

`teammatesWatchSmoke.tsx` mounts the real App with a seeded team and asserts
both teammates' transcripts render in panes beside the lead's, left to right in
attention order; not raising the pane count and reversing the order each fail
it (the order check first passed the reversal, because it only compared rows
holding both panes, and was rewritten to compare columns wherever each landed).
`splitPaneSmoke.ts` pins `planTeammateWatch`, and the popover smoke the keys at
all three panel sizes.

### One list across machines

Herdr's `--machine` gives one agent list spanning machines; `--attach` here
targets one daemon. `agent-viewer machines add <name> <url>` now pairs this TUI
with another machine's daemon using a pairing URL from `agent-viewer pair
--scope read-only` run there — the same single-use exchange a phone makes, so
the other machine lists the TUI among its paired devices and can revoke it. The
coordinator rail then shows that machine's teams under a `⌂ NAME` heading, with
the same needs-you / working / result states and the `f` filter, and its
counts join the header's.

Two herdr rules shaped it. A machine that is slow or down must not stall the
local list (#4234), so each machine has its own feed and deadline and a failure
is written on its heading beside the last good roster. And "unknown is not
done": an unreadable machine stays visible under every filter, because hiding
it would say nobody there needs you when the list does not know. Opening a
remote teammate says which machine it is on rather than attempting a transcript
this process cannot read — the list is for seeing where attention is needed,
and the acting happens there, as in herdr, where a remote pane is driven on its
own machine. `scripts/machinesSmoke.ts` covers pairing (single use, 0600, never
echoed), a revoked credential reading as revoked rather than empty, a machine
that never answers being cut off at its deadline, and the rail's grouping,
scoped keys and filter.

### The sidebar says which chat's team needs you

Herdr's agents page calls its rollup "the main Herdr workflow": start several
agents, then read the sidebar to see which project needs a decision, which is
running and which is ready to review. We had half of it. The web marked session
rows, but its `✓ n` counted every result a team had ever produced, so a team
that had finished anything carried the mark forever — herdr's done means *not
yet viewed*. The TUI had no row marks at all: its badge covered only
conversations it had already observed, so a team waiting in another chat was
invisible until that chat was selected.

Both now take the summary with result ids and subtract their own reviewed
markers (herdr: each client tracks viewed completions independently). The TUI
reads it on a 5s poll from boot, which is where the memory budget bit: the
summary lived in `agentCoordination.ts`, which imports the send path. The row
mappers and snapshot windows moved into `lib/coordinatorLedger.ts` with a
read-only ledger open, and `agentCoordination.ts` uses the same functions, so
there is one definition of what a snapshot's window is. `teamAttentionLedgerSmoke.ts`
traces module resolution during the read (routing it through `coordination()`
was verified to fail it) and asserts the light summary equals the full
Coordinator's; the full-App watch smoke asserts the lead chat's row shows `!1`
(verified to fail with the mark not drawn).
