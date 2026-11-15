# Shared Project Memory

Open **Shared Project Memory** from the palette. Notes are scoped to the canonical
repository directory and shared across providers/accounts using that directory.
The plugin is available as a Web/OpenTUI panel, window, or overlay.

Create a decision, convention, or lesson. **Save draft** persists it locally;
**Approve note** makes it eligible for recall. Editing its title, text, pin, or
source returns it to draft. Pin an approved note to recall it even without a
keyword match. Search ranks title and body matches, with pinned notes first.

**Capture latest reply** copies the current session's most recent completed
assistant text into an editable draft. Capture neither summarizes using a model
nor approves the note automatically. It preserves the source provider, account,
session, and message; **Open source conversation** navigates to that exact source.
Manual notes need no source session.

**Recall approved memory on new turns** is off by default. Enabling it affects this
project across providers. The shared before-turn hook adds up to six relevant
approved notes, bounded to 8,000 characters, with note IDs, versions, and source
identities. Current task/session instructions take precedence. Slash commands are
left alone, drafts are excluded, and repeated injection is avoided. No background
model calls or retrospective transcript ingestion occur.

Notes and preferences are stored in a repository-keyed SQLite database under
`~/.agent-viewer/project-memory/`. `AGENT_VIEWER_PROJECT_MEMORY_DIR` overrides the
location for fixtures. Optimistic versions reject stale updates; persistent note
generations also prevent a deleted note being resurrected by an old creation
request. Up to 500 notes of 20,000 characters each are supported. Unsaved editor
drafts remain with their view; save a draft to persist it beyond closing the view.

OpenTUI uses a workspace with compact filters and a note list beside Note, Source
and Recall tabs. Filters include draft/approved state, pinned notes and note type.
The empty state offers New note and Capture latest reply. Editing and approval
controls stay with the selected note; unsaved changes must be saved before
approval. Small panels switch between the list and detail and use a filter drawer.

Tab changes pane focus; 1/2/3 focuses filters/notes/details; left/right changes
detail tabs; Ctrl+N toggles filters; ? opens bounded, scrollable help. Help captures
input until closed and does not resize the workspace. j/k moves within the focused
pane or scrolls the note; Enter opens a note. In the title editor, Enter moves to
note text. The following shortcuts remain available: n creates; t edits title;
e edits text; y cycles type; s saves; a approves/returns to draft; p toggles pin; r toggles recall; c captures the latest
reply; o opens the source; d deletes; / searches. Ctrl+S saves in an editor;
Escape leaves it with the view's draft intact.

The data/retrieval design is inspired by
[Claude-Mem](https://github.com/thedotmack/claude-mem), implemented independently
using Agent Viewer's shared plugin behavior and navigation contracts. This first
version emphasizes user-reviewed project knowledge; it does not install or vendor
Claude-Mem's capture/compression services.

Validation: `npm run project-memory:smoke`, `npm run knowledge-plugins:tui:smoke`,
and `npm run knowledge-plugins:web:smoke`. These exercise real local persistence
and the recall formatter. Live provider execution with recalled context remains a
separate verification step.
