// What's new in Agent Viewer: a curated list of recent features and how to use
// them, newest first. This is product copy, not the repository's history (the
// `whats-new` plugin reads git for that), so it is written by hand when a
// feature ships. No Node imports: both renderers and the smoke read it.
//
// Adding a feature: put an entry at the top of FEATURE_GUIDE with the date it
// shipped. `command` is a palette command id the TUI can run for "try it";
// `plugin` is the plugin that must be on for it to work.

export type FeatureArea = 'Agents' | 'Review' | 'Composer' | 'Workspace' | 'GitHub' | 'Customize' | 'Automation'

export type FeatureGuideEntry = {
  readonly id: string
  readonly title: string
  /** ISO date (YYYY-MM-DD) the feature shipped. */
  readonly added: string
  readonly area: FeatureArea
  /** One or two sentences: what it does and why you would want it. */
  readonly summary: string
  /** How to use it in the terminal app. Empty when it is Web-only. */
  readonly tui: readonly string[]
  /** How to use it in the Web app. Empty when it is terminal-only. */
  readonly web: readonly string[]
  /** Worth knowing: limits, defaults, where its settings live. */
  readonly notes?: readonly string[]
  /** The plugin that provides it, when there is one (it must be on). */
  readonly plugin?: string
  /** A TUI palette command that opens or starts it. */
  readonly command?: string
}

export const FEATURE_GUIDE: readonly FeatureGuideEntry[] = [
  {
    id: 'project-memory', title: 'Agents remember the project', added: '2026-11-28', area: 'Agents', plugin: 'project-memory', command: 'project-memory',
    summary: 'Agents keep their own notes per repository — decisions, conventions, gotchas — and recall them in later sessions, whichever provider you use.',
    tui: ['Open the palette (?) and choose "Shared Project Memory" to read, edit or delete notes.', 'Press m in the panel to turn agent memory off for this project.'],
    web: ['Command palette (⌘K) → "Shared Project Memory".', 'Untick "Agent memory" in the panel to turn it off for this project.'],
    notes: ['Editing an agent note makes it yours and puts it back into review.', 'Worktrees and subfolders share one memory: it is keyed on the repository root.', 'Agents in other CLIs get project_memory_recall / remember / forget tools through the MCP bridge.'],
  },
  {
    id: 'second-opinion', title: 'Second Opinion: another model reviews a turn', added: '2026-11-28', area: 'Review', plugin: 'second-opinion', command: 'second-opinion',
    summary: "A model from a different provider reviews one turn's diff. Claude turns go to Codex, everything else to Claude, and each finding is pinned to the diff line it is about.",
    tui: ['⌃K i (or the palette → "Second opinion") on the turn you want reviewed; confirm with a second press.', 'Open ⇧U to see the verdict and each finding under its diff line.'],
    web: ['Command palette → "Second opinion", or the session menu.', 'Findings also show in the checkpoint review.'],
    notes: ['Auto-review after every turn is per repository and off by default — it spends model usage.', 'Findings that point at lines the diff does not contain are dropped.'],
  },
  {
    id: 'focus-mode', title: 'Focus Mode', added: '2026-11-28', area: 'Workspace', plugin: 'focus-mode', command: 'focus-mode',
    summary: 'Hold interruptions that can wait — toasts, finished-turn alerts, teammate news — for a timed block, then see them as one digest.',
    tui: ['Type /focus 45m in the composer, or ⌃K z and pick 1/2/3 for a preset length.', '/focus off ends the block early.'],
    web: ['Type /focus 45m in the composer, or palette → "Focus Mode".'],
    notes: ['Urgent things always get through: approvals, questions, errors and teammates who need you.', 'One block covers the TUI and the Web together.'],
  },
  {
    id: 'open-in-ide', title: 'Open files in your own editor', added: '2026-11-28', area: 'Workspace', plugin: 'open-in-ide', command: 'open-in-ide',
    summary: 'File links in the transcript, changed-files lists and reviews open in VS Code, Cursor, Windsurf, Zed, JetBrains or Sublime at the right line.',
    tui: ['Palette → "Open files in…" and pick your editor.', 'Then click any file path in a transcript, or press o on a file in Engineering / Files.'],
    web: ['Palette → "Open files in…".', 'Use the ↗ button on Read/Edit/Write cards, or click a file link in a reply.'],
    notes: ['Until you pick one, the TUI keeps using its built-in editor.', 'Terminal editors ($EDITOR=vim) cannot be launched this way; ⌃G still edits the prompt in $EDITOR.'],
  },
  {
    id: 'turn-overview', title: 'Turn overview and outline', added: '2026-11-28', area: 'Review',
    command: 'turn-outline',
    summary: 'See where each turn starts, how long it took and what failed, and jump straight to any prompt or the first failure.',
    tui: ['Click "Turn n/m" in the window header, or palette → "Turn outline: jump to any prompt".', 'Click "N failed" to jump to the first failing tool call.'],
    web: [],
    notes: ['"New since you left" marks what arrived after you last read a window.'],
  },
  {
    id: 'composer-strip', title: 'Composer strip readings', added: '2026-11-28', area: 'Customize', plugin: 'view-studio', command: 'view-studio-edit',
    summary: 'Show tokens, cache hits, lines changed, active time, plan limits or the linked PR under the composer — on one row or two.',
    tui: ['v then e on your view to open the View Studio, and turn readings on under Composer.'],
    web: ['View menu → View Studio → Composer.'],
    notes: ['Readings are only computed while a view shows them; the closest plan limit is on by default.'],
  },
  {
    id: 'github-transcript', title: 'GitHub in the transcript', added: '2026-11-27', area: 'GitHub', plugin: 'github',
    summary: 'gh and git commands an agent runs read as what they did ("Opened pull request #12"), PR links preview on hover, and #123 / commit hashes link to GitHub.',
    tui: ['Nothing to set up: GitHub cards appear in the transcript; the window border shows the session\'s PR and its next step.'],
    web: ['Hover a PR chip for a preview. The session PR bar shows checks, review and the next step.'],
    notes: ['A session that opens a PR is linked to it automatically, and settles itself when the PR merges.'],
  },
  {
    id: 'github-watch', title: 'Watch PRs, stacks and review guides', added: '2026-11-27', area: 'GitHub', plugin: 'github', command: 'github',
    summary: 'Have the agent woken when its PR gets review comments or failing checks, see stacked PRs as layers, and get a guided tour of a PR\'s diff.',
    tui: ['Palette → "Pull request: watch it and wake the agent (toggle)" on a session with a linked PR.', 'Palette → "GitHub", open a PR, then t for its review guide.'],
    web: ['Click Watch in the session PR bar.', 'Open a PR in the GitHub view and use its Guide tab for the tour.'],
    notes: ['Watching never merges or replies for you, and stops on merge, close or after 10 comment-only wakes.', 'Only the bottom layer of a stack offers Merge.'],
  },
  {
    id: 'github-surface', title: 'GitHub: inbox, PRs, issues, CI', added: '2026-11-27', area: 'GitHub', plugin: 'github', command: 'github',
    summary: 'Review requests, your PRs, issues, Actions runs with the failing step\'s log, releases and security alerts — with actions — without leaving the app.',
    tui: ['Palette → "GitHub". Tab between Overview, Inbox, PRs, Issues, Actions, Releases and Security.'],
    web: ['Palette → "GitHub".'],
    notes: ['Uses your gh login. Merge is refused unless the PR is mergeable and its checks pass.'],
  },
  {
    id: 'view-studio-themes', title: 'Icon themes, border themes and tab styles', added: '2026-11-27', area: 'Customize', plugin: 'view-studio', command: 'view-studio-new',
    summary: 'Oh My Posh and Nerd Font icon sets, Powerline presets, window border themes and more tab-strip styles (chrome, pills, boxed, Windows Terminal).',
    tui: ['v then n for a new view (or e to edit one) → Tabs / Panels sections.'],
    web: ['View menu → View Studio.'],
    notes: ['Custom views are shared between the TUI and the Web.'],
  },
  {
    id: 'activity-island', title: 'Actionable activity island', added: '2026-11-17', area: 'Workspace', plugin: 'dynamic-island', command: 'activity-island',
    summary: 'A compact island for running agents and things that need you, where you can approve, answer or open them in place.',
    tui: ['Palette → "Toggle activity island". Click a row to act on it.'],
    web: ['Palette → "Toggle activity island".'],
    notes: ['Dismissed insights stay dismissed across restarts.'],
  },
  {
    id: 'scratch-chats', title: 'Scratch chats', added: '2026-11-17', area: 'Workspace', command: 'new-scratch',
    summary: 'Start a chat that is not tied to a repository, for questions and quick experiments.',
    tui: ['Palette → "New scratch chat (no repository)".', '⇧Y hides or shows scratch sessions in the rail.'],
    web: ['The scratch-chat button beside New session in the sidebar.'],
  },
  {
    id: 'spaces-lift', title: 'Pinned, running and needs-you from every Space', added: '2026-11-17', area: 'Workspace',
    command: 'lift-spaces',
    summary: 'Sessions that are pinned, running or waiting on you show at the top of every Space\'s rail, so nothing is hidden in another Space.',
    tui: ['Palette → "Show pinned/running/needs-you from all Spaces" to toggle it.'],
    web: [],
  },
  {
    id: 'schedules', title: 'Schedules: recurring prompts', added: '2026-11-16', area: 'Automation', plugin: 'schedules', command: 'schedules-open',
    summary: 'Run a prompt every hour, every weekday at 9, or on any cron schedule — in a session, a fresh one, or as a playbook run.',
    tui: ['In the composer: /schedule every 1h <prompt>  or  /schedule "0 9 * * 1-5" <prompt>.', 'Palette → "Schedules" to list, pause, run now or delete.'],
    web: ['Same /schedule command in the composer, or palette → "Schedules".'],
    notes: ['Only one process fires schedules, so a daemon and a TUI never double-run them.', 'From a script: agent-viewer schedule list|add|rm|run|pause|resume.'],
  },
  {
    id: 'skill-picker', title: 'Skill picker', added: '2026-11-16', area: 'Composer', plugin: 'skill-picker', command: 'skill-picker',
    summary: 'Browse and search every skill (project, user, commands) with its SKILL.md beside it, and insert it in the syntax your provider understands.',
    tui: ['Type /skill (or /skill <search>), or ⌃K k.', 'Type to search; ↑/↓ to move; Enter inserts. Inserted skills show as chips you can remove.'],
    web: ['Skills button on the composer, or /skill.'],
    notes: ['Suggested skills come from words in your draft — no model is called.'],
  },
  {
    id: 'chief-of-staff', title: 'Chief of Staff', added: '2026-11-16', area: 'Agents', plugin: 'chief-of-staff', command: 'chief-of-staff-open',
    summary: 'One standing chat per repository that splits your requests into workstreams and delegates each to a teammate, following routing rules you set.',
    tui: ['/cos <request> in the composer.', 'Palette → "Chief of Staff" for the board, the latest report and the rules (Tab to edit them).'],
    web: ['/cos <request>, or palette → "Chief of Staff".'],
    notes: ['Routing rules live in .agent-viewer/chief-of-staff.json; a rule naming a model the provider does not offer is shown as "NOT applied".', 'Morning digest and stale-check schedules are declared but off until you enable them.'],
  },
  {
    id: 'tips', title: 'Feature tips while an agent works', added: '2026-11-16', area: 'Composer', plugin: 'tips',
    summary: 'An occasional one-line hint under the composer about a feature you may not have tried.',
    tui: ['Shown automatically while a turn runs. Turn the Tips plugin off in Plugins if you do not want them.'],
    web: ['Same, under the Web composer.'],
  },
  {
    id: 'adaptive-ui', title: 'Adaptive UI cards', added: '2026-11-16', area: 'Customize', plugin: 'adaptive-ui', command: 'adaptive-ui',
    summary: 'Design a transcript card for a tool that only has a generic one — as data, in place — and let past sessions suggest which tools need one most.',
    tui: ['Palette → "Adaptive UI cards" to see the busiest tools without a card and design one.'],
    web: ['Palette → "Adaptive UI cards".'],
    notes: ['Cards can also ship in a mod\'s ui-recipes folder.'],
  },
  {
    id: 'whats-new-history', title: "What's new in your repository", added: '2026-11-15', area: 'Review', plugin: 'whats-new', command: 'whats-new',
    summary: "The highlights of the current repository's git history, release by release (or day by day), with the files each change touched.",
    tui: ['Palette → "What\'s new: highlights of the git history". c copies an item as markdown, C everything.'],
    web: ['Palette → "What\'s new".'],
  },
  {
    id: 'plan-review', title: 'Plan Review', added: '2026-11-15', area: 'Review', plugin: 'plan-review', command: 'plan-review',
    summary: 'Annotate an agent\'s plan line by line, ask for a revision, and approve it before anything is implemented.',
    tui: ['Palette → "Plan Review" on a session with a plan.'],
    web: ['"Review plan" in the session toolbar.'],
  },
  {
    id: 'proof', title: 'Proof: verification receipts', added: '2026-11-14', area: 'Review', plugin: 'proof', command: 'proof',
    summary: 'Run your checks (tests, typecheck, lint) and keep receipts tied to the exact code they checked, so "it passed" stays provable.',
    tui: ['Palette → "Proof — verify changes".'],
    web: ['Palette → "Proof".'],
  },
  {
    id: 'better-prompts', title: 'Better prompts', added: '2026-11-14', area: 'Composer', plugin: 'better', command: 'better',
    summary: 'Turn a rough draft into a deeper prompt — researched against the repository, with concrete methods and checks — and review it before sending.',
    tui: ['Write a draft, then ⌃K e (or palette → "Better prompt").'],
    web: ['The Better button on the composer.'],
  },
  {
    id: 'omni-bar', title: 'Omni bar', added: '2026-11-14', area: 'Workspace', plugin: 'omni-bar', command: 'omni-bar-actions',
    summary: 'A bar above the workspace with the project, session, what needs you, a turn clock, and shortcuts to files, terminal, search and new sessions.',
    tui: ['Click an item to use it; right-click the bar (or palette → "Customize omni bar") to choose what it shows.'],
    web: ['Same bar at the top of the Web app.'],
  },
  {
    id: 'matt-skills', title: 'Matt Pocock skills', added: '2026-11-28', area: 'Agents', plugin: 'matt-skills', command: 'matt-skills-open',
    summary: "mattpocock/skills' 27 skills (TDD, diagnosing bugs, code review, grilling, domain modelling…) for every provider.",
    tui: ['/matt <task> lets the router pick a skill; /matt /<skill> <task> runs one.', 'Palette → "Matt Pocock skills" lists them; Enter puts the command in the composer.'],
    web: ['Same /matt command, or palette → "Matt Pocock skills".'],
  },
  {
    id: 'pstack', title: 'pstack', added: '2026-11-28', area: 'Agents', plugin: 'pstack', command: 'pstack-open',
    summary: "cursor/plugins' pstack skills with model roles you choose, plus arena and interrogate playbooks for the Coordinator.",
    tui: ['/pstack <task> or /pstack /<skill> <task>.', 'Palette → "pstack" to set which provider and model fill each role.'],
    web: ['/pstack <task>, or palette → "pstack".'],
  },
  {
    id: 'plugin-manager', title: 'Turn features on or off', added: '2026-11-16', area: 'Customize',
    command: 'plugins',
    summary: 'Most of Agent Viewer is now plugins, grouped by category. Search them, sort them and switch off anything you do not use.',
    tui: ['Palette (?) → "Plugins: turn features on or off".', 'Type to search; the list is grouped into Agents, Code, Composer, Sessions, Interface and Themes.'],
    web: ['Command palette (⌘K) → "Plugins".'],
    notes: ['A switched-off plugin costs nothing at startup: its code is not loaded.'],
  },
  {
    id: 'palette-keys', title: 'Command palette: mouse, and type any letter', added: '2026-11-16', area: 'Workspace',
    summary: 'The palette and the ⌃B / ⌃K key guides take the mouse (wheel, hover, click), and j and k are now ordinary letters in the search.',
    tui: ['? opens the palette. ⌃J / ⌃K or ↑ / ↓ move the selection; click an entry to run it.', '⌃B ? and ⌃K ? list every window and command chord.'],
    web: [],
  },
  {
    id: 'mods', title: 'Mods: your own plugins', added: '2026-11-13', area: 'Customize', plugin: 'mod-views', command: 'mod-views',
    summary: 'Drop a plugin into your config folder to add themes, slash commands, views, widgets, tool cards — even a whole agent backend — without forking the app.',
    tui: ['Put a mod in ~/.config/agent-viewer/plugins (or $AGENT_VIEWER_PLUGINS_DIR). It reloads without a restart.', 'Palette → "Mod views" (⌃K x) opens views your mods provide.'],
    web: ['Mods load on the Web too; their views open from the palette like built-ins.'],
    notes: ['Ask an agent to write one: the agent-viewer-plugins skill covers the format.', 'A mod\'s hooks can approve or deny tool calls under a permission policy you set.'],
  },
  {
    id: 'web-parity', title: 'Desk, editor, checkpoints and more on the Web', added: '2026-11-14', area: 'Workspace',
    summary: 'The desk, project editor (with search, rename and a language server), tab manager, subagents, checkpoints & review, file history and session insights now run on the Web as the same plugins as the terminal.',
    tui: [],
    web: ['Open them from the command palette (⌘K) by name, e.g. "Desk", "Checkpoints & review", "File history".'],
  },
  {
    id: 'sidebar-rail', title: 'A tidier session rail', added: '2026-11-13', area: 'Workspace',
    summary: 'One rail with Sessions and Coordinator tabs, a NEEDS YOU group at the top, foldable project headers, and the sort and count moved into its border.',
    tui: ['a switches between the Sessions and Coordinator tabs.', 'j/k land on group headers too: ← / → or Enter fold and open them, e folds the current folder.', 'Click "↕ by project" in the rail\'s bottom border to change the sort.'],
    web: ['Same Sessions / Coordinator tabs and NEEDS YOU / RUNNING / PINNED groups; right-click a session for its menu.'],
  },
  {
    id: 'custom-views', title: 'Compose your own transcript views', added: '2026-11-08', area: 'Customize', plugin: 'view-studio', command: 'view-studio-new',
    summary: 'Build a view from any built-in one — layout, cards, tool grouping, markers, composer and tabs — and edit the built-ins themselves, with the transcript redrawing as you change it.',
    tui: ['v opens the view menu; n makes a new view, e edits the current one, c clones it.', 'In the studio, x resets an edited built-in to its defaults.'],
    web: ['View menu → View Studio.'],
    notes: ['Views are stored in tui.json and shared by the TUI and the Web.'],
  },
  {
    id: 'chrome-tabs', title: 'Browser-style session tabs', added: '2026-11-08', area: 'Workspace', plugin: 'tab-manager', command: 'tab-manager',
    summary: 'The tab strip draws like a browser\'s, takes the mouse, and tabs can be pinned and reordered.',
    tui: ['Click a tab to switch, its × to close, drag to move.', '⌃K m opens the tab manager to pin and reorder.'],
    web: [],
  },
  {
    id: 'engineering-view', title: 'Engineering workspace', added: '2026-11-07', area: 'Review',
    command: 'engineering-view',
    summary: 'A workspace for reviewing what agents did: sessions filtered by state, work briefs, evidence and catch-up, and an inspector with the Git diff beside the transcript.',
    tui: ['Palette → "Engineering view".', 'In the inspector, o opens a file and the prompt bar jumps between prompts.'],
    web: [],
  },
  {
    id: 'git-hunks', title: 'Accept, reject and resolve in the Git workspace', added: '2026-11-05', area: 'Review', plugin: 'git', command: 'git',
    summary: 'Stage or discard each hunk straight from the diff, leave threaded line comments, and resolve merge conflicts one at a time with a continue/abort banner.',
    tui: ['⌃G opens Git. Select a hunk and accept (stage) or reject (discard) it; press ? in the panel for every key.'],
    web: ['Git view: accept or reject hunks from the diff, and resolve conflicts in the visual resolver.'],
  },
  {
    id: 'tool-output-colour', title: 'Syntax and terminal colours in tool output', added: '2026-11-05', area: 'Review',
    summary: 'File reads and search hits are syntax highlighted, and commands that print colour keep it, in both the terminal and the Web.',
    tui: ['Nothing to set up. o on a tool card shows its full output.'],
    web: ['Nothing to set up.'],
  },
  {
    id: 'oled-themes', title: 'OLED themes and rounded borders', added: '2026-11-07', area: 'Customize', plugin: 'theme-picker', command: 'theme',
    summary: 'Vivid OLED dark and light themes, and a toggle for rounded window borders.',
    tui: ['t opens the theme menu; Tab in it follows your terminal\'s light/dark setting.'],
    web: ['Theme menu in the sidebar.'],
  },
  {
    id: 'windows-terminal', title: 'Shells on Windows', added: '2026-11-03', area: 'Workspace',
    summary: 'Terminal tabs and windows run on Windows through ConPTY, using PowerShell (or cmd) with the right quoting for each.',
    tui: ['Palette → "Shell and processes in a window", or ⌃K l for the Terminal panel.'],
    web: [],
    notes: ['Not yet checked on a real Windows machine.'],
  },
  {
    id: 'scripting', title: 'Script sessions and terminals from the CLI', added: '2026-11-03', area: 'Automation',
    summary: 'Drive chats and the TUI\'s terminals from a shell script: list, read, prompt and wait for a session; send keys to a terminal and wait for the agent in it.',
    tui: ['agent-viewer session list | read | prompt --wait | wait --until idle | interrupt', 'agent-viewer terminal list | read | send | run | wait (talks to the running TUI)'],
    web: ['agent-viewer session … works against a running agent-viewer web daemon too.'],
    notes: ['Output is JSON, so it pipes into jq.'],
  },
  {
    id: 'user-keys', title: 'Your own ⌃K keys', added: '2026-11-03', area: 'Customize',
    summary: 'Rebind any ⌃K letter to a palette command, or bind one to run a command of your own in the Terminal view.',
    tui: ['Edit ~/.config/agent-viewer/keys.json: "chords" maps a letter to a command id (null unbinds), "commands" runs argv as a process.', 'Restart the TUI; problems are reported once at startup.'],
    web: [],
  },
  {
    id: 'session-insights', title: 'Session insights', added: '2026-11-02', area: 'Review', plugin: 'session-insights', command: 'changed-files',
    summary: 'The files a session touched, a waterfall of tool timing per turn, and a faceted search across every indexed session.',
    tui: ['⌃K f files touched · ⌃K p tool timing · ⌃K h search the index (provider, date, errors, file).'],
    web: ['Command palette → "Files touched by this session", "Tool timing by turn" or "Search the session index".'],
  },
  {
    id: 'session-alerts', title: 'Desktop alerts when a session needs you', added: '2026-11-02', area: 'Workspace', plugin: 'session-alerts', command: 'session-alerts',
    summary: 'Get a desktop or in-app alert when a turn finishes or an agent asks for approval.',
    tui: ['Palette → "Session alerts" to choose desktop, in-app or off.'],
    web: ['Palette → "Session alerts".'],
    notes: ['Focus Mode holds alerts that can wait.'],
  },
  {
    id: 'daily-summary', title: 'Daily summary', added: '2026-10-19', area: 'Review', plugin: 'daily-summary', command: 'daily-summary',
    summary: 'What every agent did today, yesterday or this week, by repository — with commits, dirty trees, open PRs and what is waiting on you.',
    tui: ['⌃K s. t / y / w switch the range, c copies it as markdown, a drafts a status update in the composer.'],
    web: ['Palette → "Daily summary".'],
  },
  {
    id: 'ask-selection', title: 'Ask an agent about these lines', added: '2026-10-19', area: 'Composer',
    summary: 'Select code in the editor or Git panel and send it to the composer with the file, line range and its history, asking why, how to fix it, or to explain.',
    tui: ['In the editor: select, then ⌃A and a menu key. In the Git panel: ? then one key.'],
    web: [],
  },
  {
    id: 'file-history', title: 'A file through every turn', added: '2026-10-19', area: 'Review', plugin: 'file-history',
    summary: 'Scrub one file through the turns that changed it, see each step\'s diff, and undo a single hunk or restore the file to before a step.',
    tui: ['⌃A h in the editor, or h on a file in ⇧U. u undoes a hunk, R restores to before the step.'],
    web: ['File history in the command palette.'],
  },
  {
    id: 'window-layouts', title: 'Window layouts, tabs and floating windows', added: '2026-10-19', area: 'Workspace',
    command: 'window-layout',
    summary: 'Arrange sessions and tools as a split, a main stack or a grid; drag sessions onto the window area, stack windows as tabs, float one, and save layouts by name.',
    tui: ['⌃B w (or ⊞ layout in a title) picks an arrangement; ⌃B space walks them.', 'Drag a session from the rail onto an edge to put it beside, or onto a title row to make it a tab. ⌃B f floats the focused window.'],
    web: [],
    notes: ['Any popover can become a window: ⌃⇧W or its ⧉ window button.'],
  },
  {
    id: 'processes', title: 'Dev servers and a real shell in the Terminal tab', added: '2026-10-19', area: 'Workspace', plugin: 'terminal', command: 'window-terminal',
    summary: 'Run long-lived processes from .agent-viewer/processes.json (or your package.json scripts) and open a full interactive shell — vim and less included.',
    tui: ['⌃K l opens the Terminal tab; o opens a shell. ⌃] hands the keyboard back.', 'e on a process sends its latest stack trace to the composer.'],
    web: [],
  },
  {
    id: 'scrollback-view', title: 'SCROLLBACK view', added: '2026-10-10', area: 'Customize',
    summary: 'Read a transcript like terminal scrollback: no card cursor, j/k scroll by rows, and e expands or folds everything at once.',
    tui: ['v → SCROLLBACK. Click a folded tool row to open it.'],
    web: [],
  },
  {
    id: 'daemon', title: 'Teams that outlive the window', added: '2026-10-11', area: 'Agents',
    summary: 'Host your sessions and Coordinator teams in a background daemon, so closing the TUI detaches instead of stopping work.',
    tui: ['Start with agent-viewer --daemon. agent-viewer daemon status | start | stop manages it.'],
    web: ['The web app is the daemon: agent-viewer web, then attach the TUI with --attach.'],
  },
]

export const FEATURE_AREAS: readonly FeatureArea[] = ['Agents', 'Review', 'Composer', 'Workspace', 'GitHub', 'Customize', 'Automation']

/** Newest first; a stable order within a day (the order written above). */
export function sortedFeatures(entries: readonly FeatureGuideEntry[] = FEATURE_GUIDE): FeatureGuideEntry[] {
  return entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => (a.entry.added === b.entry.added ? a.index - b.index : a.entry.added < b.entry.added ? 1 : -1))
    .map(({ entry }) => entry)
}

/** Every word of the query must appear somewhere in the entry (title, summary, steps, notes, area). */
export function filterFeatures(entries: readonly FeatureGuideEntry[], query: string, area: FeatureArea | null = null): FeatureGuideEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((entry) => {
    if (area && entry.area !== area) return false
    if (words.length === 0) return true
    const haystack = [entry.title, entry.summary, entry.area, entry.plugin ?? '', ...entry.tui, ...entry.web, ...(entry.notes ?? [])].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

export function formatFeatureDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year!, (month ?? 1) - 1, day ?? 1).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export type FeatureGuideRow =
  | { readonly type: 'date'; readonly key: string; readonly label: string }
  | { readonly type: 'feature'; readonly key: string; readonly entry: FeatureGuideEntry; readonly isNew: boolean }

/** A date heading, then its features. Features added after `newAfter` (ISO date) are marked new; null marks none. */
export function featureGuideRows(entries: readonly FeatureGuideEntry[], newAfter: string | null): FeatureGuideRow[] {
  const rows: FeatureGuideRow[] = []
  let day = ''
  for (const entry of entries) {
    if (entry.added !== day) {
      day = entry.added
      rows.push({ type: 'date', key: `d:${day}`, label: formatFeatureDate(day) })
    }
    rows.push({ type: 'feature', key: `f:${entry.id}`, entry, isNew: newAfter !== null && entry.added > newAfter })
  }
  return rows
}

/** The newest date in the guide. */
export function latestFeatureDate(entries: readonly FeatureGuideEntry[] = FEATURE_GUIDE): string {
  return entries.reduce((latest, entry) => (entry.added > latest ? entry.added : latest), '')
}

/** Features added after this date are "new": the week ending at the newest entry. Null for an empty guide. */
export function featureNewAfter(entries: readonly FeatureGuideEntry[] = FEATURE_GUIDE): string | null {
  const latest = latestFeatureDate(entries)
  if (!latest) return null
  const [y, m, d] = latest.split('-').map(Number)
  return new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) - 7)).toISOString().slice(0, 10)
}

export function featureMarkdown(entry: FeatureGuideEntry): string {
  const lines = [`## ${entry.title}`, `_${entry.area} · ${formatFeatureDate(entry.added)}_`, '', entry.summary, '']
  if (entry.tui.length) lines.push('**Terminal**', ...entry.tui.map((step) => `- ${step}`), '')
  if (entry.web.length) lines.push('**Web**', ...entry.web.map((step) => `- ${step}`), '')
  if (entry.notes?.length) lines.push('**Good to know**', ...entry.notes.map((note) => `- ${note}`), '')
  return lines.join('\n')
}

export function featureGuideMarkdown(entries: readonly FeatureGuideEntry[] = sortedFeatures()): string {
  return [`# What's new in Agent Viewer`, '', ...entries.map(featureMarkdown)].join('\n')
}
