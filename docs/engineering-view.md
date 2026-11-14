# Engineering view

Open the TUI view picker (`v`) and select **Engineering**, or choose **Engineering view** in the command palette. This is opt-in; existing views keep their presentation and layout settings.

- Engineering is one workspace for session work, Git review, checks, tasks, and attention. Inspector tabs select the content; they keep the same repository and layout. The former Build, Review, and Agents presets no longer change inspector width, select tabs, or rearrange session windows. **Focus** independently hides the docked inspector and terminal.
- **F7** toggles Focus without changing inspector selection, widths, or session windows, **F8** focuses the inspector, and **F9** opens or closes the terminal/process drawer. In Changes, left/right collapses or expands folders, up/down moves through the tree, and Enter or Space toggles a folder. `[` / `]` switches inspector tabs (left/right also switches tabs outside Changes), and Escape returns to the transcript. Narrow terminals open the inspector on demand; short terminals use an overlay for the terminal.
- **Work** in the header opens the task brief, catch-up summary, and evidence links. The brief is saved per workspace and repository across sessions/providers. Record an objective, one acceptance criterion per line, constraints, questions, decisions, and linked sessions. Edit a field with Ctrl+S to save or Escape to cancel; a current session goal can be copied explicitly. Acceptance marks are manual decisions. Unchanged criteria retain review/evidence identities; changed requirements start pending. Copy the brief or add it to the composer without sending it automatically.
- **Agents** inside Work is a read-only overview of observed Coordinator runs for this repository or its agent worktrees. It shows agent/provider/liveness, task owners, declared file scopes, dependencies and missing dependencies, owner status reports, bottlenecks, and the selected run’s live scope overlaps using the Coordinator’s existing rules. Selecting a run does not change the watched-run binding. Open the full Coordinator or an agent session explicitly; entering the overview does not create runs, claim tasks, send messages, or acknowledge mail. The existing Coordinator feed is acquired only while this section is mounted. Work’s `1`–`4` keys switch Brief, Catch up, Evidence, and Agents.
- **Catch up** compares the current repository, loaded session catalog, check statuses, and attention against a saved observation checkpoint. The first complete visit starts tracking; opening or leaving the view does not clear observations. **Mark observations reviewed** advances the checkpoint without acknowledging attention. Newly observed sessions are not claimed to be newly created sessions. A file leaving Git status is labelled “no longer changed”, since it may have been committed or reverted.
- **Evidence** on a selected file (`v` in Changes) links to requests, recorded edit activity, and responses in the loaded transcript. The Work evidence view also opens files associated with the selected transcript message. Pin a selected message to an acceptance criterion to retain its source session and excerpt across providers. Opening a source is explicit; missing/unloaded messages remain identified as such. Turn adjacency does not establish intent, test coverage, or ownership of current hunks.
- Every transcript view, including Engineering, uses the same sidebar and keyboard navigation. Sessions and Coordinator tabs switch content inside one border frame; `a` remains the keyboard shortcut. Search, repository scope, activity filters (All sessions, Running, Needs input, Pinned, Settled), pin/unpin controls, groups, context menus, and density settings are shared. Repository and activity choices use dropdowns. Needs input takes precedence over Running, then Pinned, without duplicate sessions. Long titles are available on hover or keyboard focus; Page Up/Down scrolls the detail and Escape dismisses it. Existing Engineering pins migrate once into shared workspace sidebar storage. Sidebar width and sort order remain the same when switching views.
- A fixed current-turn header provides Previous prompt, Next prompt, and Latest controls. Prompt jumps pause following; Latest resumes it. Click prompt/edit/error markers beside the scrollbar to jump to the represented card.
- The inspector header has Expand/Restore and Move to window controls. `=` expands or restores a focused inspector; `w` moves it into the shared window layout. Its window can be tiled, floated, or zoomed with the usual window controls; ⇥ Inspector returns it to the dock. Its tab, selected file, folder folds, hunk and comment draft survive presentation changes.
- Changes are repository-wide. Files use the Git review’s collapsible directory tree, with directories before files, merged single-child paths, and colored status letters. The file list and selected diff scroll independently. Add a file comment to the composer, or open the existing Git surface for full review and hunk comments.
- Pane borders use the window manager's mouse-resize pattern in every view: hover to highlight the border, drag to resize, and read the live column/row sizes beside it. Escape cancels the drag. This covers sidebars, docked and inline composers, task and surface panels, plus Engineering's inspector, terminal drawer, and file/diff divider.
- Checks run only when requested. Application-recorded runs show their process result, duration, session identity, and pre-run working-state fingerprint. Changed files or index state make previous results stale. Transcript evidence has an unknown working state and is never promoted to a recorded pass. Completed application-observed results retain their exit status, completion time, and a bounded output excerpt across restarts. Older records without an archived result remain explicitly unavailable. Every new check uses a distinct run identity; a restarted process ID cannot overwrite an older result. Work criteria and files can have explicitly linked custom checks, run only on request; linking a command does not infer its file coverage.
- Tasks and attention link to their source sessions. Reading attention does not acknowledge it. Completion notices, viewer notes, and recorded check failures have explicit acknowledgement actions.
- Handoff assembles Markdown locally from recorded objective, response excerpts, changes, checks, and unresolved attention. Copy it for export or add it to the composer. It does not invoke a model.

Engineering layout, inspector selection, and check records are saved per workspace. Session sidebar pins and activity filters are saved in shared workspace state. Its layout and transcript positions use separate storage keys. Drafts and underlying sessions remain available when switching views. Repository fingerprinting runs in a worker only while Engineering is active. Closing the view or drawer does not stop user processes or shells.

Edit links establish recorded file activity, not ownership of the current hunks. Missing evidence is shown as unattributed. Context uses passive local data; potentially activating provider diagnostics remain an explicit action.

Focused verification:

```sh
npm run tui:check
bun run tui/opentui/engineeringModelSmoke.ts
bun run tui/opentui/engineeringWorkbenchModelSmoke.ts
bun run tui/opentui/engineeringWorkbenchStateSmoke.tsx
bun run tui/opentui/engineeringWorkSmoke.tsx
bun run tui/opentui/engineeringCoordinationSmoke.tsx
bun run tui/opentui/engineeringStateSmoke.tsx
bun run tui/opentui/engineeringPanelsSmoke.tsx
bun run tui/opentui/engineeringTreeSmoke.tsx
bun run tui/opentui/sessionSidebarGroupingSmoke.ts
bun run tui/opentui/sharedSidebarSmoke.tsx
bun run tui/opentui/sidebarRedesignSmoke.tsx
ENGINEERING_NAV_SMOKE=1 bun run tui/opentui/stickyHeaderSmoke.tsx
bun run tui/opentui/scrollMarkersSmoke.tsx
bun run tui/opentui/promptNavigationSmoke.tsx
bun run tui/opentui/engineeringViewSmoke.tsx
bun run tui/opentui/engineeringShellSmoke.tsx
bun run tui/opentui/paneResizeSmoke.tsx
```
