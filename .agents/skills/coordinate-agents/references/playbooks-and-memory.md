# Playbooks, project memory, and reusable roles

Read this when seeding a run from a saved plan, recording something durable, searching prior context, or defining a reusable persona. The turn-by-turn lead/teammate loop lives in the main `SKILL.md`.

## Playbooks (reusable runs)

A playbook is a saved run definition — the plan held in an artifact instead of a planning turn, like Claude Code dynamic workflows. Playbooks live in `<checkout>/.agent-viewer/playbooks/<name>.json` and are shared with everyone who clones the repo.

- Discover them with `coord_list_playbooks`; each entry shows a description and an `argsHint` for what to pass.
- Before committing to a playbook + args combination, sanity-check it with `coord_preview_playbook` (same `playbook_name`/`playbook`/`args`/`cwd` inputs as `coord_create_run`) — it returns the exact task ids, titles, prompts, and dependency graph that would be seeded, without creating a run or touching the database. Useful when `args` interpolation or a dependency key might not resolve the way you expect.
- Run one with `coord_create_run` using `playbook_name` and `args` — the whole task board is seeded instantly with phases as dependency barriers (phase N+1 waits for all of phase N), and `{{args}}` / `{{args.<key>}}` placeholders in task text are filled from `args`. No lead planning turn is needed; teammates can claim immediately.
- When a run's board is worth repeating, the lead saves it with `coord_save_playbook` (a name slug, description, and args hint). Prefer running a saved playbook over re-deriving the same plan.
- Status responses include a `phases` rollup (per-phase task counts) — use it to report progress phase by phase.
- A single CLI can kick off a playbook run alone and then staff it either way: spawn unattended workers with `agent-viewer coord worker --join latest --name <name> --provider codex|claude|opencode|copilot|pi` (one per lane, via the shell) and supervise as lead, or — when no teammates are expected — claim and work teammate tasks itself phase by phase. Once a live teammate exists, role affinity is enforced: teammates claim `teammate`/`any` lanes and leads claim `lead`/`any` lanes. Phase barriers still enforce order.

## Project memory, context search, and reusable roles

Some Coordinator state lives at the repo root under `<checkout>/.agent-viewer/` and outlives a single run — unlike the task board, mailbox, and findings, which are scoped to one run and gone once it finalizes.

- `coord_remember(summary, detail?)` records a durable fact into `.agent-viewer/memory.md` — an architecture decision, a gotcha, an established pattern. Every future Coordinator run in this project starts with a tail of it already in the initial instructions. Use it sparingly for genuinely durable context; routine progress still belongs in `coord_publish_finding`, which is run-scoped and does not persist.
- `coord_query_context(query, limit?)` is a lexical search over this run's findings, learnings, task outcomes, and the project's durable memory. Reach for it instead of re-reading all of `coord_status` when you only need context on one topic — after rejoining a long-running run, or picking up a task another lane already touched.
- `coord_save_role(name, description)` / `coord_list_roles()` save and list reusable `role_name`/`role_description` personas at `.agent-viewer/roles/`. Invent a persona once and save it; later `coord_create_task` calls only need to pass `role_name` — the saved `role_description` fills in automatically whenever the inline description is omitted, this run or a future one.
- `coord_save_role` also accepts optional `default_provider`/`default_model` — a persona-pack-style suggestion for which provider/model tasks in that role are best worked by. It cannot mechanically switch an external CLI worker's provider mid-run, so it is surfaced as a line appended to the task's `role_description` (e.g. "Suggested provider/model for this role: claude / claude-opus-4"); the claiming participant decides whether to act on it. Omitting `default_provider`/`default_model` on a later `coord_save_role` call for the same name keeps whatever was set before — only an explicit new value replaces it.
