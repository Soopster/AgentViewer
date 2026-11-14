# Omni bar

A bundled OpenTUI plugin that adds one row above the workspace. Existing session
tabs and the reader's pinned prompt remain below it.

- Click the repository for Git status, activity to focus the transcript, attention
  counts for the inbox, or **Commands…** for the command palette.
- Open **Omni bar actions** in the command palette for keyboard access to all four
  actions. Use arrows or j/k, Enter to open, and Escape to close.
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
