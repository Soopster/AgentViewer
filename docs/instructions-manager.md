# Instructions Manager

Open **Instructions Manager** from the command palette in Web or OpenTUI. The
view opens against its captured repository directory and can be a panel, window,
or overlay. It does not start an agent or inject instructions into a live turn.

## Browse and edit

Search paths or provider/account labels and filter user, project, nested, and
ancestor scopes. Select a file to read rich or raw Markdown, inspect rule
frontmatter, and see `@...md` references. References are listed without being
expanded or fetched. Missing standard files appear as creation targets.

Known locations include:

- Project `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, `CLAUDE.local.md`,
  `.claude/CLAUDE.md`, and `.github/copilot-instructions.md`.
- Existing nested versions of those files and `GEMINI.md` compatibility files.
- Claude `.claude/rules/**/*.md` and Copilot
  `.github/instructions/**/*.instructions.md` rules.
- User/account instruction files under Claude, Codex, OpenCode, Pi, and Copilot
  config locations, plus user Claude/Copilot rule directories. Account overrides
  include `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_CONFIG_DIR`,
  `XDG_CONFIG_HOME`, and `PI_CODING_AGENT_DIR`.

The nearest `.git` directory/file identifies the repository root; without one,
the opening directory is the project. Ancestor instruction files are visible but
read-only. Files under linked paths are inspectable but cannot be write targets.
Nested discovery skips hidden and common generated/dependency directories, stops
at depth 8, 2,500 directories, or 350 instruction files, and reports limits.
Opening an individual instruction file is limited to 256 KiB of UTF-8 text.

**Edit** keeps an independent local draft per file. Switching files or relocating
the view preserves it through the host's scoped state. **Refresh instructions**
updates disk information without discarding drafts; **Reload editor** discards the
selected draft using the last read disk state. Unsaved drafts are view state and
are not a substitute for saving files.

Use **Preview save**, inspect Before/After, then explicitly approve replacement
if the destination already exists. **Apply reviewed change** writes the file.
For new scoped rules, enter a path under `.claude/rules/` ending in `.md`, or
`.github/instructions/` ending in `.instructions.md`, then **Open or create rule**.
Custom filenames outside discovered instruction locations are refused.

## Compare and copy

The **Copy** tab chooses a known destination file. Preview compares its exact text
with the selected on-disk source. An unsaved source draft must be saved or reloaded
first. Copies preserve raw text, including frontmatter and relative references;
they do not translate provider semantics or rewrite imports. Review scope before
copying user instructions into a project or project instructions into user scope.
The source file remains unchanged and the destination is an independent file.

Both saves and copies reject stale source/destination versions and changed
location metadata. Replacements require explicit selection and back up the prior
text before publication. Writes preserve an existing destination's file mode.
Create-only publication refuses an intervening file. History shows change
receipts and backup paths. Request IDs make completed apply retries idempotent.

Backups and receipts live in `~/.agent-viewer/instructions-manager/`.
`AGENT_VIEWER_INSTRUCTIONS_DATA_DIR` overrides that location. A manager-wide lock
serializes its writes. If a process crashes, inspect backups and any reported
`.previous` recovery file before manually removing `write.lock`. An unexpected
external write during replacement is not overwritten; an error names any retained
recovery copy. There is no automatic restore, delete, merge, or ongoing sync.

## Loading rules differ

This is an inventory/editor for known files, not an authoritative effective-prompt
viewer. Runtime versions, exclusions, settings, overrides, imports, and matching
paths determine what each provider loads. Custom config `instructions` entries,
managed policies, extra directories, and system-prompt replacements are not
resolved. Providers may need another turn, reload, or session to pick up changes.

Sources for the location/scope labels:

- [Claude instruction files and rules](https://code.claude.com/docs/en/memory):
  CLAUDE files, rule frontmatter, imports, and version/settings-dependent AGENTS
  support.
- [Codex instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md):
  global/project AGENTS files and overrides.
- [OpenCode instructions](https://opencode.ai/docs/instructions): AGENTS files and
  provider configuration.
- [Copilot CLI custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions):
  user/repository files and path-specific `applyTo` rules.
- Installed Pi SDK `dist/core/resource-loader.js`: context-file candidates and
  user/ancestor discovery. Pi's `SYSTEM.md` and `APPEND_SYSTEM.md` are outside this
  manager.

## Terminal controls and verification

Tab/Enter switches list/detail; left/right switches detail tabs; j/k or arrows
navigates files/destinations or scrolls. `/` searches; `g` cycles scope; `v` toggles
raw/rich; `e` edits; `n` enters a rule path; Ctrl+S previews the editor save or
accepts the entered path; Escape leaves an editor with the draft intact. `p`
previews, Space selects replacement, `a` applies, `h` shows history, `r` refreshes,
and `x` reloads the editor. `?` opens bounded help. Visible rows/tabs/actions are
clickable. A narrow view switches between the list and detail.

Run `npm run instructions-manager:smoke` and
`npm run instructions-manager:web:smoke`. The fixtures exercise real temporary
instruction files and native/browser views. They do not modify personal
instruction files or prove live provider reload behavior.
