# Engineering view

Open the TUI view picker (`v`) and select **Engineering**, or choose **Engineering view** in the command palette. This is opt-in; existing views keep their presentation and layout settings.

- **Build** starts with a narrow session rail and a Changes inspector. **Focus** hides the inspector and terminal. **Review** widens the inspector. **Multi-agent** arranges up to three selected, running, or open sessions beside attention.
- **F7** cycles presets, **F8** focuses the inspector, and **F9** opens or closes the terminal/process drawer. In Changes, left/right collapses or expands folders, up/down moves through the tree, and Enter or Space toggles a folder. `[` / `]` switches inspector tabs (left/right also switches tabs outside Changes), and Escape returns to the transcript. Narrow terminals open the inspector on demand; short terminals use an overlay for the terminal.
- Sessions show Running, Needs input, and Pinned above collapsible repo headers and Today/Yesterday/Older groups. Each session appears once: Needs input takes precedence over Running, then Pinned. Older starts collapsed, including older-only repositories; explicit expansion is saved per workspace. Choose This repo or All repos independently of the Running, Needs input, or Pinned activity filter; clicking the active activity filter clears it. Search applies to both controls. Selected titles can occupy two lines, with the full title available on hover or keyboard focus (Page Up/Down scrolls the detail; Escape dismisses it). Click a group to fold it; `e` or left/right folds or opens the selected session's group. Click `+` to pin. Recent observed writes are labelled separately from a known running turn.
- A fixed current-turn header provides Previous prompt, Next prompt, and Latest controls. Prompt jumps pause following; Latest resumes it. Click prompt/edit/error markers beside the scrollbar to jump to the represented card.
- The inspector header has Expand/Restore and Move to window controls. `=` expands or restores a focused inspector; `w` moves it into the shared window layout. Its window can be tiled, floated, or zoomed with the usual window controls; ⇥ Inspector returns it to the dock. Its tab, selected file, folder folds, hunk and comment draft survive presentation changes.
- Changes are repository-wide. Files use the Git review’s collapsible directory tree, with directories before files, merged single-child paths, and colored status letters. The file list and selected diff scroll independently. Add a file comment to the composer, or open the existing Git surface for full review and hunk comments.
- Pane borders use the window manager's mouse-resize pattern in every view: hover to highlight the border, drag to resize, and read the live column/row sizes beside it. Escape cancels the drag. This covers sidebars, docked and inline composers, task and surface panels, plus Engineering's inspector, terminal drawer, and file/diff divider.
- Checks run only when requested. Application-recorded runs show their process result, duration, session identity, and pre-run working-state fingerprint. Changed files or index state make previous results stale. Transcript evidence has an unknown working state and is never promoted to a recorded pass. Process results unavailable after a restart remain explicitly unavailable.
- Tasks and attention link to their source sessions. Reading attention does not acknowledge it. Completion notices, viewer notes, and recorded check failures have explicit acknowledgement actions.
- Handoff assembles Markdown locally from recorded objective, response excerpts, changes, checks, and unresolved attention. Copy it for export or add it to the composer. It does not invoke a model.

Engineering layout, filters, pins, inspector selection, and check records are saved per workspace. Its layout and transcript positions use separate storage keys. Drafts and underlying sessions remain available when switching views. Repository fingerprinting runs in a worker only while Engineering is active. Closing the view or drawer does not stop user processes or shells.

Edit links establish recorded file activity, not ownership of the current hunks. Missing evidence is shown as unattributed. Context uses passive local data; potentially activating provider diagnostics remain an explicit action.

Focused verification:

```sh
npm run tui:check
bun run tui/opentui/engineeringModelSmoke.ts
bun run tui/opentui/engineeringStateSmoke.tsx
bun run tui/opentui/engineeringPanelsSmoke.tsx
bun run tui/opentui/engineeringTreeSmoke.tsx
bun run tui/opentui/engineeringSidebarSmoke.tsx
bun run tui/opentui/engineeringSidebarControlsSmoke.tsx
ENGINEERING_NAV_SMOKE=1 bun run tui/opentui/stickyHeaderSmoke.tsx
bun run tui/opentui/scrollMarkersSmoke.tsx
bun run tui/opentui/promptNavigationSmoke.tsx
bun run tui/opentui/engineeringViewSmoke.tsx
bun run tui/opentui/engineeringShellSmoke.tsx
bun run tui/opentui/paneResizeSmoke.tsx
```
