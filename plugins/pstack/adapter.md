# pstack in Agent Viewer

pstack skills are written for Cursor. Read this file once per conversation, then apply these mappings.
`<pstack>` is the folder that holds `skills/` (its absolute path is in the `<pstack_context>` block).
If a Cursor field has no row here, drop it and say so. Never pass a field a tool's schema rejects.

## Skills

- "Run another skill" (`/name`, or "the **name** skill") means: read `<pstack>/skills/<name>/SKILL.md` and follow it.
- Not shipped: `setup-pstack` (Agent Viewer's pstack panel sets models), `make-bot-ui`, `statechart`.
- `deslop`, `control-cli`, `control-ui` and `/create-skill` are Cursor extras. Use your own equivalent, or say the step was skipped.

## Tools

| Cursor | Here |
| --- | --- |
| `Task` | Your own subagent tool. With `coord_*` tools and a teammate-sized job, `coord_delegate`. With neither, do the work yourself in sequence and say so. |
| `AskQuestion` | Your question tool, else ask in plain text. |
| todolist | Your todo or plan tool, else keep the list in your reply. |
| `subagent_type: generalPurpose` | A general-purpose subagent. |
| `poteto-agent` | A general-purpose subagent whose brief starts: read `<pstack>/agents/poteto-agent.md` and `<pstack>/skills/poteto-mode/SKILL.md`. |
| `comment-sicko` | A read-only subagent whose brief starts: read `<pstack>/agents/comment-sicko.md`. |
| `readonly: true` | Tell the subagent not to edit files, and check `git status` afterwards. |
| `environment: "cloud"` | A git worktree. With Coordinator, delegate with worktrees on. |
| `run_in_background`, `resume`, `file_attachments` | Use your tool's equivalent. Otherwise start a new agent and list file paths in its brief. |

## Models

The `<pstack_context>` block lists the model for each pstack role. It replaces
`~/.cursor/rules/pstack-models.mdc` and every Cursor model slug in the skills. Never pass a Cursor slug.

- A listed role is `provider[:instance] model effort`. Use `coord_delegate` for a provider other than your own;
  your own subagent tool when it is your provider and the tool accepts that model.
- An unlisted role runs on your current model: omit the model.
- If you cannot start the listed provider or model, run the seat on your own model and say so. A review
  panel on one model is not a multi-model review, so report that plainly.

## Delegation costs

Subagents and teammates spend the user's usage. Follow your host's rules about when you may start them;
where those rules forbid it, do the step yourself and say what was not fanned out.

## Cursor-only features

Cursor Automations, Bugbot, cloud agents and the built-in PR tool do not exist here. Reply with one line,
`Skipped in Agent Viewer: <step>. <reason>.`, and continue. Bugbot comments already on a PR are ordinary review threads.

## Paths

`.cursor/skills/` is your provider's own skills folder (for example `.agents/skills/`). Cursor transcripts do
not exist: to search past sessions use `search_sessions` and `get_session_transcript` when you have them.
