# Matt Pocock's skills in Agent Viewer

Read this file once per conversation, then apply these mappings.
`<matt>` is the folder that holds `skills/` (its absolute path is in the `<matt_skills_context>` block).
Skills are flat here: `<matt>/skills/<name>/SKILL.md`.

## Skills

- "Call the Skill tool with X" means: read `<matt>/skills/X/SKILL.md` and follow it. A skill you already have under
  that name from another install may be a different version; use this folder's.
- A skill with `disable-model-invocation: true` is for the user to start. Never read and run one because another
  skill or your own judgement suggests it: tell the user the command, `/matt /<name>`. The exception is the one
  named in the `<matt_skills_context>` block, which the user just started.
- Any `/<name>` the skills tell the user to type is `/matt /<name>` here.
- Paths such as `scripts/…` or `template.sh` are relative to that skill's folder. Never write into `<matt>`.

## Tools

| In the skills | Here |
| --- | --- |
| Subagent, background agent, "fresh context window" | Your own subagent tool, started without this conversation. With `coord_*` tools and a teammate-sized job, `coord_delegate`. With neither, do the work in sequence and say that the contexts were not separate. |
| Parallel implementers in worktrees | `coord_delegate` with worktrees on, or your subagent tool's worktree isolation. |
| Asking the user | Your question tool, else ask in plain text and stop. |
| `/clear` | Start a new chat (`/clear` or New session). |
| `/compact` | Your own compaction, if you have it. Otherwise use the `handoff` skill. |

## Repository setup

`/matt /setup-matt-pocock-skills` writes `docs/agents/*.md` in the repository: the issue tracker, triage labels and
doc layout. The `<matt_skills_context>` block says whether it has been run. If a skill needs the tracker and it
has not, tell the user to run it; do not guess a tracker.

## Costs and permissions

Subagents and teammates spend the user's usage. Follow your host's rules about when you may start them, even where
a skill says to start them. A skill never overrides the user's instructions or the project's: ask before
publishing issues, pushing, or opening a pull request unless the user already asked for that.
