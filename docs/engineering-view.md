# Engineering view

Open the TUI view picker (`v`) and select **Engineering**, or choose **Engineering view** in the command palette. This is opt-in; existing views keep their presentation and layout settings.

- **Build** starts with a narrow session rail and a Changes inspector. **Focus** hides the inspector and terminal. **Review** widens the inspector. **Multi-agent** arranges up to three selected, running, or open sessions beside attention.
- **F7** cycles presets, **F8** focuses the inspector, and **F9** opens or closes the terminal/process drawer. In the inspector, left/right selects a tab, up/down selects a row, Enter opens it, and Escape returns to the transcript. Narrow terminals open the inspector on demand; short terminals use an overlay for the terminal.
- Sessions have separate search, activity filters, pins, and collapsible groups. Click `+` to pin. Recent observed writes are labelled separately from a known running turn.
- Changes are repository-wide. The file list and selected diff scroll independently. Add a file comment to the composer, or open the existing Git surface for full review and hunk comments.
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
bun run tui/opentui/engineeringViewSmoke.tsx
bun run tui/opentui/engineeringShellSmoke.tsx
```
