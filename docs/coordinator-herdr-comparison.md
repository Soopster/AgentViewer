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
| Background work keeps an agent working; a background shell alone does not (CHANGELOG #1630, #3090, #3291, #3414, #2851) | `coordinatorBackgroundWork` from Claude's Stop-hook `background_tasks`/`session_crons` and Copilot's `tasks.list()`: "Working in background · N tasks · N wake-ups", working tier, never stalled. OpenCode exposes only a move-to-background mutation, Pi nothing, Codex only background shells (which correctly do not count) | Adopted for Claude and Copilot |
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

- The stall window is 15s against herdr's 5s. It was first set at 45s on the
  assumption that provider spawn time counted against it; it does not
  (`turnActive` is set when a dispatch starts, before the provider launches), so
  the window now measures only the dispatch sweep — three missed 5s passes.
  Herdr's gate can be tighter because a terminal prompt has no sweep in between.
  `coordConversationSmoke.ts` holds real ledger delegations open with a provider
  that never answers and asserts no stall an hour past the window; dropping the
  `turnActive` exclusion was verified to fail it, so the check is exercising a
  genuinely claimed task rather than passing on its status.
- No combined multi-machine roster.
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
tier, label it "Working in background", and exclude it from stalled starts. A
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
| OpenCode | cannot staff a teammate here — see below |

OpenCode failed for a reason that had nothing to do with the Coordinator. The
installed CLI is **v2.0.1**; the newest published `@opencode-ai/sdk` is
**1.18.31**. Two separate breaks followed from that, and the first hid the
second:

1. `createOpencodeServer` waits for a line reading `opencode server listening
   on <url>`. The 2.x CLI prints `server listening on <url>`, so the helper
   waited out its timeout against a server that was already up, and **every**
   OpenCode session failed to start, teammates included. `startManagedServer`
   now spawns `opencode serve` itself, accepts both spellings, and captures the
   `server password` line 2.x prints — HTTP Basic, user `opencode` — which 1.x
   never prints. `OPENCODE_SERVER_PASSWORD` does the same for an external
   server.
2. With the server up and authenticated, `POST /session` answers 405: the 2.x
   HTTP API is not the one the 1.18 client speaks, and no SDK 2.x is published.
   That cannot be fixed here, so a managed spawn now checks the CLI's major
   version once and fails with what is actually wrong ("This OpenCode CLI is
   v2, whose HTTP API the bundled @opencode-ai/sdk (1.18.x, the newest
   published) does not speak. Install OpenCode 1.x, or point
   OPENCODE_BASE_URL at a 1.x server.") instead of a 405 from deep inside
   session creation.

So four of the five providers can staff an interactive teammate today, and the
fifth says why it cannot. `npm run opencode:harness:smoke` passes with the new
spawn path.

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
