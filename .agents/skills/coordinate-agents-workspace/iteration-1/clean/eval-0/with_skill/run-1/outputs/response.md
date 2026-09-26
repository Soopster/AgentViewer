Here's exactly what I'd do as lead, in order, before any teammate touches a file. This follows the "Multi-agent startup invariant" — the board has to be fully seeded with disjoint lanes before Codex or OpenCode are allowed to start claiming, otherwise a broad `coord worker --start "<goal>"` lead could grab the whole refactor as one umbrella task before teammates even arrive.

**1. Check prior memory before planning**

`coord_query_context({ query: "<the refactor objective>" })`

If a past run already recorded a `coord_remember` fact, gotcha, or pattern relevant to this refactor or these files, I want to fold that in before I decompose the work, not rediscover it mid-run.

**2. Create the run**

`coord_create_run({ objective: "<full description of the refactor, including the independent-files boundary>", provider: "claude", checkout: "<current repo path>", max_agents: 3 })`

I leave `respond_to_mode` unset (default `anyone`) since there's no reason for any of the three participants to ignore each other's messages here. I record the run ID this returns — that's the only thing I'd ever share with the other CLIs, never the capability token.

**3. Seed the board — two teammate lanes + one dependent lead task — before anyone joins**

Since this is "3 agents, fan out then integrate," the normal shape per the skill is two parallel teammate tasks plus one dependent lead task:

- `coord_create_task({ role: "teammate", title: "Refactor lane A", description: "<concrete outcome + acceptance check>", paths: ["<non-overlapping file set A>"] })` — intended for Codex
- `coord_create_task({ role: "teammate", title: "Refactor lane B", description: "<concrete outcome + acceptance check>", paths: ["<non-overlapping file set B>"] })` — intended for OpenCode
- `coord_create_task({ role: "lead", title: "Integrate and finalize", description: "Merge/verify both lanes, run full typecheck, resolve any cross-lane seams", depends_on: ["<lane A task id>", "<lane B task id>"] })` — this is the one I (lead) will claim myself, only after both lanes complete. I do *not* claim this early, and I do not create a broad task that swallows the teammates' work.

Each teammate task gets the narrowest expected write paths and a concrete acceptance check, and I check the `similarTasks` field on each creation response — if non-empty, I read the flagged task before assuming this one is genuinely new work.

**4. Verify the board before anyone starts editing**

`coord_status` — confirm exactly 3 tasks exist, roles are `teammate`/`teammate`/`lead`, the lead task's dependency is set correctly, and no path overlap between the two teammate lanes.

**5. Only now bring Codex and OpenCode onto the board**

Either they join themselves with `agent-viewer coord worker --join <run-id> --name codex-refactor --provider codex --attach <url>` and `--join <run-id> --name opencode-refactor --provider opencode --attach <url>`, or if I'm driving supervised workers I start them myself pointed at this run ID. Either way, they arrive to a board that already has claimable, disjoint lanes waiting — they are never able to invent or absorb an umbrella task, because it doesn't exist.

**6. Confirm kickoff actually completed, not just roster presence**

`coord_status` again — I check that both teammates have moved from `joined`/`ready` to actually holding a claimed or `working` task (distinct owners, one each), and I check each `snapshot.agents[]` entry's `liveness` (`fresh`/`stale`/`dead`) before assuming anyone is listening. If a teammate joined but sits idle with nothing claimed, I don't wait passively — I send them the assignment directly via `coord_send_message` rather than trusting terminal output or process liveness as delivery.

**7. Drain my own inbox and enter the wait loop**

`coord_read_inbox`, then settle into the standard loop: react to `coord_status`'s `actionable` digest, respond to blockers/locks/plan-approval requests, send heartbeats-aware messages as needed, and call `coord_wait` (not polling) whenever there's nothing immediate to do. I only claim the integration task once both teammate lanes report complete — and even then I re-verify with my own proportionate check (typecheck across the merged tree, re-read the diff) rather than trusting either lane's self-report, since a lane-scoped smoke test can miss something that only shows up once both sets of changes are combined.

Before I ever call `coord_finalize_run`, I audit substantive participation (claimed+worked task, completed task, or a real finding/mailbox response counts — `ready`/heartbeat alone doesn't), and I call `coord_remember` for anything durable this refactor uncovered so the next run doesn't have to rediscover it.
