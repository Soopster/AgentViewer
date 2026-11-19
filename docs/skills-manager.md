# Skills Manager

Open **Skills Manager** from the palette in Web or OpenTUI. It is a repository-pinned
plugin available as a panel, window, or overlay.

Browse known user and project skill folders for Claude, Codex, OpenCode, Pi, and
Copilot, plus shared `.agents/skills` folders and the Agent Viewer skill library.
Configured account roots honor `CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
`OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME`, and `PI_CODING_AGENT_DIR`. Accounts pointing
at the same physical folder appear as consumers of one shared location. No account
environment values beyond the resolved skill-folder paths are exposed to views.

This is an on-disk inventory, not a claim about the exact effective skills inside a
running provider. Additional package-provided/custom configured search paths are
not yet inventoried. Source folders and linked skill bundles remain inspectable;
provider-managed `.system` skills and destinations reached through links cannot be
modified by the manager.

Select a skill to preview `SKILL.md`, supporting scripts, references, and other
resources. Files are read as data, never executed. A bundle may contain up to 1,000
files / 16 MiB; a text preview is capped at 256 KiB. Git metadata and node_modules
are excluded. Discovery limits and invalid skill metadata are reported in the UI.

Choose destinations, then **Preview copy**. The preview compares content and file
modes and lists additions, replacements, and removed destination files. Copies
preserve the complete supported resource bundle and executable bits, rather than
copying only SKILL.md. Every conflicting location needs explicit replacement
selection before **Apply copies** becomes available. Existing destinations with
excluded local resources are blocked to prevent losing those files.

Copies are independent directories. A replacement saves its previous bundle under
`~/.agent-viewer/skills-manager/backups/<request-id>/` before swapping the directory.
The operation rechecks the source, destinations, and account paths against the
preview. Receipts prevent request replay from copying twice and show partial
results and backup paths. Open **Recent copies** after a connection failure before
starting another request. Reload skills through the provider's normal mechanism or
start a new session to use changes.

A process-wide filesystem sync lock serializes copies across Web/TUI processes. If
a process crashes, inspect its receipt, destination, backups, and any recovery path
before removing `~/.agent-viewer/skills-manager/sync.lock`. An interrupted receipt
is not automatically retried. The `AGENT_VIEWER_SKILLS_DATA_DIR` environment
variable overrides the manager's own state directory for fixtures.

OpenTUI uses a Git-style workspace: compact Locations and Skills lists sit beside
a full-height detail pane. Content, Files, Copy, Preview and History tabs keep
resource reading, destination selection and copy receipts in the same workspace.
Content offers **Raw / Rich** Markdown views (also toggled with v). Rich preview
renders headings, emphasis, links, code and tables, with YAML frontmatter shown
separately as skill metadata. Other resource types retain their raw file preview.
The view preference stays with the plugin instance. Clickable breadcrumbs lead
from the file reader back to Files or a containing folder. Backspace returns to
the file list (or its parent folder), preserving the selected file. The full
shortcut reference is a bounded help panel that captures input without changing
the workspace layout.

Locations show inventory counts; skills show their source location and linked
status. Narrow windows use a location drawer and switch between the skill list
and details.

Tab moves pane focus; 1/2/3 focus locations/skills/details; left/right switch detail
tabs. v toggles Raw / Rich Markdown; j/k moves or scrolls; Enter opens a skill or file. Space selects a destination
or explicitly permits replacement in a preview; p previews; a applies; [ and ]
change location; / searches; h shows receipts; r refreshes; Ctrl+N toggles locations;
? shows the full shortcut reference; Escape returns/closes. Mouse selection is
available for locations, skills, files, destinations, replacements and actions.

Verification: `npm run skills-manager:smoke`, `npm run skills-manager:web:smoke`,
both app typechecks, and the plugin boundary/host and route-scope smokes. The browser
and TUI fixtures perform real copies between temporary directories; they do not
assert that live provider sessions have reloaded the copied skills.

Source inspiration: [Skillshare](https://github.com/runkids/skillshare), especially
its target registry, account-root resolution, and separation of preparation,
backup, and execution (`internal/config/targets.yaml`, `agent_config_dir.go`,
`internal/sync/prepare_targets.go`, `execute_targets.go`). This feature is an
independent implementation using Agent Viewer's plugin/service contracts. The
reference source is MIT licensed.
