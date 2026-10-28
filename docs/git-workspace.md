# Git workspace

Open Git from the existing Git action. The popup opens directly in the annotated changes view, including branch and agent-turn comparisons. **Git workspace** opens staging, commits, and the full repository workflow (press `g` in OpenTUI); **Review changes** returns to the changes view. Reopening the popup starts in the changes view.

## Local workflow

1. Choose **Unstaged** or **Staged**, then select a file.
2. Stage/unstage the whole file, all listed files, a hunk, or individual changed lines.
3. Enter a commit message. **Amend HEAD** replaces the latest commit and its message.
4. Review the complete staged diff, then explicitly confirm the commit or amend.

Commit message drafts are retained per repository directory. Web stores drafts in browser local storage; OpenTUI stores them under `.agent-viewer-data/git-drafts/`.

Branches, remote branches, recent commits, and stashes can be selected for inspection. Branch, stash, sync, and conflict actions are described below. History editing and general worktree management remain later phases. Existing agent-task worktree actions remain available through their existing entry points.

## OpenTUI keys

| Key | Action |
| --- | --- |
| `2` / `3` / `4` / `5` | Files / branches / commits / stashes |
| `j` / `k` or arrows | Navigate the focused list or diff |
| `Tab` / `Enter` | Switch focus / focus diff |
| `t` | Switch staged and unstaged |
| `Space` in files | Stage or unstage the current file |
| `a` in files | Stage or unstage all listed files |
| `Space` in diff | Toggle selected changed line or range |
| `a` in diff | Toggle the current hunk |
| `v` / Shift+arrows | Select a range |
| `s` in diff | Stage or unstage the selected lines |
| `h` / `l` | Pan long diff lines horizontally |
| `c` / `A` | Edit commit message / amend HEAD |
| Ctrl+Enter or Ctrl+S | Review the staged diff and message |
| Enter in confirmation | Commit or amend |
| Escape in confirmation / editor | Edit message / retain draft and return |
| `r` / `G` | Refresh / open annotated review |

The sidebar collapses in narrow terminals; numbered navigation still works.

## Operation behavior

Web and OpenTUI share the same typed operation service. Selections are bound to a repository revision. External changes require a refreshed selection; commits are bound to the previewed HEAD and index. Index updates use Git's index lock and a private index, and app operations are serialized per common Git directory within a process.

Git hooks run normally, but a pre-commit or message hook that changes staged content stops the commit. Working-tree changes made by hooks remain available for review and staging. Hook failures preserve the original index. Binary files, renames, symlinks, and metadata changes use whole-file staging. Conflicted files use the resolution editor described below.

The workspace does not automatically retry mutations after transport failures. Request IDs deduplicate retries within the running service; this is not a durable operation journal. Git output is returned on completion. A dedicated interactive authentication/signing handoff, live operation streaming, and persistent recovery records remain future work.

## Verification

- `node --import tsx scripts/gitWorkspaceSmoke.ts` — temporary-repository integration coverage.
- `bun run tui/opentui/gitWorkspaceSmoke.tsx` — keyboard routing, staging, native composer, commit confirmation, narrow rendering, and annotated-review navigation.
- `npx tsc --noEmit`, `npm run tui:check`, and `npm run routes:smoke`.

## Everyday workflow actions

**Git actions** opens the shared action menu. OpenTUI uses `:` or `?`. Select a branch or stash first to see its actions. Every action has a target/options preview and explicit confirmation.

- **Branches:** create from a local branch, inspected commit, or remote branch; switch while retaining compatible local changes; rename; delete merged branches; merge into the current branch; set upstream. Branches occupied by another worktree cannot be switched to or deleted. Creating from a remote branch configures tracking. Web's **Show remotes** and OpenTUI's `B` switch branch lists.
- **Stashes:** stash all tracked changes, staged changes only, selected files, or use keep-index mode. Include untracked files when appropriate. Keep-index mode leaves staged changes in place and also records them in the stash. Apply retains a stash; pop removes it only after successful application; drop removes the selected entry. Apply/pop require a clean worktree. The selected object and reflog selector are revalidated before mutation.
- **Remotes:** add/remove a remote, fetch and prune, pull with an explicit fast-forward/merge/rebase strategy, push and set upstream. Force-with-lease is opt-in and bound to the fetched remote tip displayed in the confirmation. Interactive authentication and signing setup still use Git's existing credentials/tools; the workspace does not collect credentials or automatically retry a failed remote action.
- **Conflicts:** choose a conflicted file and **Resolve conflict**, or press `f` in OpenTUI. Inspect base/ours/theirs, edit the result, choose individual conflict blocks, choose a whole-file version, or stage an externally resolved working file. Saving a text resolution requires all markers to be removed. Choosing an absent version stages deletion. Whole-file choices support binary and symlink conflicts; submodule conflicts require resolution inside the submodule.
- **Paused operations:** continue/abort a merge, rebase, cherry-pick, or revert from Git actions; skip a replay step where supported. Failed operations refresh the repository state, exposing conflicts rather than hiding them. Starting interactive rebase, cherry-pick, and revert remains a later phase.

OpenTUI action forms use Tab/Shift+Tab between fields, arrows for choices, Space for toggles/selected paths, Ctrl+Enter or Ctrl+S to review, and Enter to confirm. In the conflict result editor, Ctrl+O/Ctrl+T/Ctrl+Y choose ours/theirs/both for the first remaining block; Ctrl+Enter reviews saving. During rebase, ours denotes the branch being rebased onto and theirs denotes the replayed commit.

App instances share a per-repository operation lease; a dead process's lease is recoverable. Native Git index/ref locks remain authoritative. Repository, references, upstream configuration, stash identity, and remote configuration are checked against the action preview. These checks cannot make a series of Git commands atomic against arbitrary external CLI activity; a concurrent external mutation can require refresh or conflict resolution.

Phase 2 integration coverage: `node --import tsx scripts/gitWorkflowSmoke.ts` and `bun run tui/opentui/gitWorkflowSmoke.tsx`. Remote tests use local bare repositories, not a live hosting provider. Interactive remote authentication and signing prompts have not been validated by these tests.
