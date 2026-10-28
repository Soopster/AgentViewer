Here's exactly what I'd do as the lead, in order, before any teammate touches a file.

## 1. Check context first

Before creating anything, I'd call `coord_query_context` with the refactor's objective as the query. If a past run already left a `coord_remember` fact, gotcha, or established pattern relevant to this refactor, I want to replan around it rather than rediscover it mid-run.

## 2. Create the run

Call `coord_create_run` with:
- The complete objective (the actual refactor goal, not a vague summary — e.g. "Refactor X across files A/B/C to pattern Y, independent per-file, then integrate")
- `provider: claude` (my actual provider, since I'm the one calling this)
- The current checkout path
- A realistic `participant_limit` (at least 3 — the two fan-out lanes plus my own lead slot)
- Run controls worth setting up front given this is a multi-provider fan-out: `autonomy` (probably `medium`), and an `acceptanceContract` if I can articulate concrete verification commands (e.g. typecheck/lint per touched area) — this makes completion gates meaningful instead of rubber-stamped.

I would **not** use an unseeded `coord worker --start "<goal>"` shortcut here, because that pattern lets the lead's own worker claim the only broad task before teammates arrive. Since this is a multi-agent request, the skill's "multi-agent startup invariant" requires seeding the board first.

## 3. Seed the task graph before anyone joins

This is the critical ordering rule: **seed the board before starting teammate workers**, not after. So next, still before Codex or OpenCode exist as participants, I call `coord_create_task` three times:

- **Task A (teammate lane 1)**: e.g. "Refactor file-group A to pattern Y" — `role: teammate`, narrow explicit write paths scoped to just that file group, concrete acceptance check, no dependencies.
- **Task B (teammate lane 2)**: same shape, disjoint file paths, `role: teammate`, no dependencies.
- **Task C (lead integration task)**: "Integrate and finalize the refactor across A+B" — `role: lead`, with explicit `dependencies` on both Task A and Task B so it can't be claimed until both lanes report done.

I'm careful that Task A and Task B have non-overlapping write paths — that's the whole point of the fan-out, and it's also what keeps the board's completion gate from misattributing dirty files later. If there's any shared file (e.g. a barrel export both refactors touch), I don't hand it to two owners — I'd note in both task descriptions that whichever lane needs the shared edit requests it via `coord_send_message` to the owning lane, so the dependency is visible on the board instead of discovered at integration time.

I would explicitly **not** claim Task C myself yet, and I would not let myself absorb A or B's work into an umbrella lead task — the lead's job right now is coordinating, not implementing the fan-out lanes.

## 4. Verify the board before anyone joins

Call `coord_status` and confirm: three tasks exist, A and B are `role: teammate` and independently claimable, C is `role: lead` and blocked on A+B, and the write paths look disjoint. This is the checkpoint that proves seeding actually happened before I open the door to teammates.

## 5. Start/join the teammate workers

Only now do I bring in Codex and OpenCode. Since these are different provider CLIs, I'd use the bounded supervisor pattern rather than assuming they're already in an interactive session:

```
agent-viewer coord worker --join <run-id> --name codex-refactor --provider codex --attach <url>
agent-viewer coord worker --join <run-id> --name opencode-refactor --provider opencode --attach <url>
```

(Or `--join latest` if I don't want to pass the run ID explicitly.) I'd keep the default isolated-checkout behavior (each teammate gets its own checkout) unless there's a specific reason this refactor needs a shared checkout — isolation is the safer default for parallel edits across independent files.

## 6. Confirm actual participation, not just roster presence

After both workers join, I call `coord_status` again and check `snapshot.agents[]` for each teammate's `liveness` (`fresh`/`stale`/`dead`) and confirm each has a claimed or `working` task — specifically that Codex claimed Task A (or B) and OpenCode claimed the other, not that they're merely `ready`. A joined-but-idle agent doesn't count as participating. If either is idle after a reasonable window, I'd send the assignment explicitly via `coord_send_message` rather than assuming they'll self-claim.

## Summary of the call order

1. `coord_query_context` (objective) — check prior learnings
2. `coord_create_run` (objective, provider: claude, cwd, participant_limit ≥3, autonomy/acceptanceContract)
3. `coord_create_task` × 3 — Task A (teammate, lane 1, no deps), Task B (teammate, lane 2, no deps), Task C (lead, depends on A+B)
4. `coord_status` — verify the graph is seeded correctly, nothing claimed yet
5. `agent-viewer coord worker --join <run-id> --provider codex ...` and `--provider opencode ...` — bring teammates in only now
6. `coord_status` again — confirm each teammate actually claimed a distinct lane and is `working`, not just `ready`

Only after step 6 confirms real claims would I step back into the lead loop: draining inbox, watching for blockers/locks, and waiting for both lanes to complete before claiming Task C myself for integration.
