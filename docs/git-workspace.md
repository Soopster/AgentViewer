# Git workspace

Open Git from the existing Git action. OpenTUI uses one repository browser, opening into **Local Changes → Changes** with history collapsed. Web retains its changes-first review and separate Git workspace.

## OpenTUI repository browser

The sidebar pins Local Changes (with a file count) and All Commits above a filter. Worktrees, Branches, Remotes (grouped by remote), Tags, Stashes, and Submodules start collapsed. Click a group to expand it. Click the filter, or press `/` with navigation focused, to search across groups; Enter returns to navigation and Escape clears the filter. Pinned navigation remains visible while the group list scrolls. Click ◀ in the sidebar heading or toolbar to collapse it; **▶ Sidebar** restores it at its previous width. Ctrl+N can still open navigation while it is collapsed. Tags open history; initialized submodules open in their own Git context. Selecting a branch filters history without checking it out. Selecting a worktree changes only the Git browser's context; the active agent session stays in its existing directory.

History shows graph markers, refs, subject, author, SHA and date. It loads 100 commits at a time. Select a commit to inspect it; Shift+arrows and Enter compare a range. Root commits compare against the empty tree and merge commits against their first parent.

The detail area has three tabs:

- **Commit:** author/committer metadata, full message, navigable parents, and changed files. Local Changes provides the existing commit/amend editor with staged preview and confirmation.
- **Changes:** changed-file tree and annotated diff review. The selected file and file counter follow the diff viewport in parsed and plain (`v`) views, including wrapped lines; clicking a file still jumps to it. Local Changes offers **g Stage changes** for file/hunk/line staging and **G Annotated review** to return. Existing source comparisons, notes, search, copy and agent actions remain available in review.
- **File Tree:** all files at the selected commit, or current tracked and non-ignored untracked files under Local Changes. Directories load on expansion. File previews are bounded to 1 MiB; binary files, symlinks and submodules have explicit placeholders. Historical contents come from Git objects.

Use Ctrl+N for navigation, Ctrl+H to toggle history, and Ctrl+R to refresh. Tab/Shift+Tab move through regions, including the file and diff focus positions inside detail panels. Focus the tab strip to change tabs with Left/Right, then Enter to enter the panel. Escape leaves a menu/editor first, then returns to the tab strip, then closes Git. Text editors retain their own Tab behavior.

Drag the sidebar divider, history divider, or any file/preview divider to resize its panes. Sizes are bounded to keep adjacent content accessible.

Below 110 columns navigation opens as a selector. Below 32 rows history and details alternate; Enter opens details and Ctrl+H returns to history. The shell supports overlays, docked panels and detached windows. Opened tabs and worktree contexts retain their local reading state while hidden review subscriptions pause.

The **Actions** control (`:`) exposes existing branch, stash, sync and recovery operations. In staging, actions use the selected file; in repository navigation they use the selected branch, commit or stash. Existing revision checks and confirmations still apply.

## Local workflow

1. Choose **Unstaged** or **Staged**, then select a file.
2. Stage/unstage the whole file, all listed files, a hunk, or individual changed lines.
3. Enter a commit message. **Amend HEAD** replaces the latest commit and its message.
4. Review the complete staged diff, then explicitly confirm the commit or amend.

Commit message drafts are retained per repository directory. Web stores drafts in browser local storage; OpenTUI stores them under `.agent-viewer-data/git-drafts/`.

Branches, remote branches, recent commits, and stashes can be selected for inspection. Branch, stash, sync, and conflict actions are described below. History editing and general worktree management remain later phases. Existing agent-task worktree actions remain available through their existing entry points.

## OpenTUI staging keys

| Key | Action |
| --- | --- |
| `2` | Focus the staging file list |
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

- `node --import tsx scripts/gitBrowseSmoke.ts` — structured history, paging, revision contents and file edge cases.
- `bun run tui/opentui/gitBrowserSmoke.tsx` — repository navigation, detail tabs, historical diffs and file previews.
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
