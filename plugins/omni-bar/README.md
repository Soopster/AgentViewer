# Omni bar

A bundled OpenTUI plugin that adds one row above the workspace. Existing session
tabs and the reader's pinned prompt remain below it.

- Click the repository for Git status, activity to focus the transcript, attention
  counts for the inbox, or **Commands…** for the command palette.
- Open **Omni bar actions** in the command palette for keyboard access to all
  available actions. Use arrows or j/k, Enter to open, and Escape to close.
- Disable **Omni bar** in Plugins to return the row to the workspace. Fullscreen
  presentation hides it automatically.
- Narrow terminals omit activity and then repository context. Attention and
  commands remain available.

Git summaries refresh every five seconds through the shell's shared cache. Late
results from a previous directory are ignored. Elapsed time is shown only when
the host knows the selected running turn's start time; its clock updates inside
the widget rather than the transcript root.

Verification:

```sh
bun run tui/opentui/omniBarSmoke.tsx
STICKY_HEADER_SMOKE_ONLY=1 bun run tui/opentui/scrollbackTranscriptSmoke.tsx
```

Wide terminals also offer **+ New**, **Files**, **Terminal**, and **Search**.
These open the ordinary new-session dialog, project browser, processes panel,
and session history search. Plugin shortcuts disappear when their owning plugin
is disabled; the actions menu provides keyboard access at smaller widths.
The activity segment includes the selected provider and session title. Git
context distinguishes a clean worktree and reports stashes when present.
