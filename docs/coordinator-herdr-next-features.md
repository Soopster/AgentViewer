# Next features for interactive Coordinator

Source review: September 29, 2026. Agent Viewer `336b424`; local Herdr
`9dc3a1df`. This reviews the requested local checkout, not an assertion about
the latest published Herdr release. Recommendations below are proposed work.

## Finding

The largest remaining opportunity is making orchestration capabilities usable
from the primary conversation. Much of the earlier Herdr-inspired work is
already implemented. Avoid building a second delegation or attention system.

Current source contains named mixed-provider delegation, targeted waits,
questions and replies, interruption, observed activity distinct from lifecycle,
uncertain-delivery recovery, worktree isolation, background attention, persistent
review marks, TUI team watching, and a remote roster. Web also already supports
one teammate reader beside the lead (`MessageViewShell` in
`components/MessageView.tsx` and `components/CoordinatorInspector.tsx`).

## Recommended order

### 1. Act on remote teammates from the current window

Herdr's `docs/next/website/src/content/docs/connecting-machines.mdx` describes
switching input and visible content to a selected remote machine while other
machines keep updating independently. Its stale cached panes cannot accept input.

Our `tui/opentui/coordinatorStore.ts` combines machine rosters, but the remote
selection branch in `tui/opentui/App.tsx` only says to open the agent on its
machine. This is a concrete interaction gap, not missing remote discovery.

Add remote transcript inspection first, then scoped reply, approval, interrupt,
and follow-up actions. Carry machine, provider, run, session, and agent identity
through the entire request. Keep existing read-only pairings read-only; expose
write controls only when the remote grants that capability. Dispatch through the
owning daemon, using its durable request identity and reconciliation path.

Acceptance: two machines may have identical session/agent identifiers without
misrouting; stale state disables writes; one offline machine never blocks local
input; an uncertain remote reply reconciles without duplicate effects; revoked
credentials produce an actionable state. Exercise actual two-daemon transport.

### 2. Start a reusable team workflow inside an ordinary chat

Herdr's agent-automation guide makes named agents and short recipes easy to
compose. Our advantage can be typed workflows with dependencies and completion
criteria, started with similarly little friction.

Playbooks, agent limits, approval settings, and completion gates already have an
editor in `components/AgentTeamCoordinator.tsx`. `RunPlaybook` and task
dependencies already exist in `lib/agentProtocol.ts`. The interactive panel in
`components/CoordinatorConversation.tsx` exposes an individual ask, provider,
name, and paths, but no playbook selection; `configureInteractiveCoordinator`
currently configures continuation and worktrees.

Expose existing playbooks from the chat: for example, implement + independent
review, or two investigations + synthesis. Preview exact roles, providers,
editable paths, dependencies, and gates before starting. Reuse the existing
planner and ledger; retain the current conversation as lead and preserve its
draft. This is integration of existing capabilities, not a new workflow engine.

Acceptance: one start produces exactly the previewed team; retries create no
extra tasks or seats; dependent work cannot start early; follow-up uses the same
team; both web and TUI can start and inspect the workflow.

### 3. Turn a result into a reviewable change package

Herdr exposes terminal results and worktree context. Coordinator has structured
task receipts and verification records (`lib/agentProtocol.ts`), which can make
review more precise than reading a terminal completion message.

The interactive web panel renders task history largely as status and
`resultSummary`. The TUI already has a worktree merge action in
`tui/opentui/CoordinationPopover.tsx`; do not duplicate that merge implementation.

Give each completion a compact review view: actual changed files, branch/base,
verification commands and outcomes, reviewer findings, unresolved blockers, and
an explicit link to inspect or integrate the work. Distinguish agent-reported
claims from executed verification. Keep completion, reviewed, verified, and
integrated as distinct states; merely opening a result must not certify it.

Acceptance: failed or missing checks remain visible; evidence refers to the
revision being reviewed; subsequent edits invalidate stale verification;
conflicts and dirty checkouts remain recoverable; integration uses the existing
gate and requires a deliberate user action.

### 4. Make restart recovery understandable at team level

Herdr's session-state guide explicitly separates detach, server restart,
restored layout, and native conversation resume. It retains failed restore
entries instead of silently dropping them.

We already have execution-host ownership, orphan adoption, dispatch recovery,
and per-agent inspect/resume controls in `lib/agentCoordination.ts` and
`components/CoordinatorConversation.tsx`. The next improvement is a consolidated
recovery view: which work is still live, which conversation can reconnect, which
submission is uncertain, and which directory or provider is unavailable.

Restore observation automatically. Offer deliberate recovery for uncertain
execution using the existing journal; restoring a conversation must never be
treated as permission to resend its last task. Include the evidence supporting
each proposed recovery action and retain inaccessible teammates in the roster.

Acceptance: kill/restart the owning daemon around submission and completion;
reopen the client; retain every task and result; reconnect live work without a
duplicate provider turn; unresolved delivery remains explicit. A client refresh
test alone is insufficient.

### 5. Put resource controls beside automatic continuation

This extends beyond the terminal-oriented Herdr workflow. `ProtocolRunBudget`
and budget enforcement already exist. The interactive panel exposes a
continuation checkbox and a four-turn pause, but no budget configuration or
spend summary.

Expose supported team budgets and agent capacity in the conversation, with
measured usage and clear missing-data labels. Explain why scheduling paused and
let the user adjust the relevant limit without creating another team. Reuse
ledger budget enforcement; a display-only budget is insufficient.

Acceptance: competing delegations respect capacity and budget; queued work stays
owned when paused; missing provider usage never displays as zero measured cost;
an approved limit change resumes eligible work once.

## Proof and limits

Ran `bun scripts/coordHerdrRecipesSmoke.ts` successfully during this review.
It covers named delegation with a returned result, waiting for a question,
resolving the question, and cancellation retaining ownership through real-ledger
Coordinator tool mappings. Its participants are scripted fixtures. It does not
measure real model performance, browser/TUI usability, remote interaction, or
restart behavior.

The existing comparison document records historical provider and UI checks.
Those were not rerun here and do not establish present comparative superiority.
To claim "as good or better", run the same representative jobs in both products:
delegate/review, clarify/resume, interrupt/follow-up, disconnect/reconnect, and
remote answer. Record time to actionable result, user interventions, duplicate
effects, missed questions, lost work, and provider usage where available.
Lower tool-call counts alone do not prove effectiveness.

Recommended first implementation: remote transcript inspection and replying
through the owning daemon. It closes the clearest remaining Herdr interaction
gap. Team recipes and evidence-backed review are the strongest opportunities to
exceed it using capabilities we already own.
