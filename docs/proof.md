# Proof

Open **Proof — verify changes** from the command palette in Web or OpenTUI.
Proof keeps local verification receipts for a Git worktree. It never launches
checks merely because an agent finishes a turn.

## Configure and run

In Web, choose **Configure checks**, add package scripts or edit the JSON array,
then save. In OpenTUI, press **s** to choose package scripts, or **e** to edit
check definitions; save the editor with **Ctrl+S**. Select checks with Space and
press **r** to run. Checks run sequentially, continuing after individual failures.

```json
[
  {
    "id": "types",
    "label": "TypeScript",
    "executable": "npx",
    "args": ["--no-install", "tsc", "--noEmit"],
    "cwd": ".",
    "timeoutMs": 300000
  }
]
```

Executables and arguments are separate; no implicit shell is used. Working
directories are relative to the worktree root and cannot resolve outside it.
Windows package-script suggestions use the supported `npm.cmd run <script>`
shim. Other commands should name a real executable, such as `node.exe`, rather
than an arbitrary `.cmd` file. Configuration changes require the version read
by the view, so a stale window cannot overwrite another window's edits.

An accepted run lives in a detached Node/Bun worker. Closing a view, disabling
Proof or exiting the app leaves it running. **Cancel run** (TUI **c**) explicitly
stops its process tree. An attached TUI executes on its daemon. Timeouts default
to five minutes; each check can set 100 milliseconds through one hour.

## Read the evidence

Each check records its definition, timestamps, exit code, output and source
fingerprints before and after execution. Results distinguish current, stale,
unstable (source changed during execution) and unknown freshness. Source changes
include HEAD/branch, the index, tracked contents and nonignored untracked files.
Submodule directories currently produce unknown freshness. A passing exit code
with unknown or stale freshness is not shown as a current green summary.

Freshness covers Git-visible files and command definitions. It cannot establish
unchanged ignored dependencies, external services, runtime environments, or
changes that occur and are reverted entirely between fingerprints. Browser and
live-provider behaviour need explicit checks; a typecheck does not cover them.

Views and widgets refresh every five seconds while mounted, sharing reads for
the same repository. Output is collapsed to twelve lines with Show all/Show less
(TUI **a**). TUI **n/p** selects a receipt's check, **[/]** selects run history,
and **g** refreshes status. **Prepare fix prompt** (TUI **f**) appends a bounded
failure prompt to the originating session's composer without sending it. It
refuses when another account or session is selected.

## Local storage and limits

Configuration, receipts and logs live in
`~/.config/agent-viewer/proof/<worktree-path-hash>/`, outside tracked source.
`AGENT_VIEWER_PROOF_DIR` overrides that base directory, useful for isolated tests.
Different worktrees keep independent state. Only one run can be active per
worktree across app processes. Dead workers are recorded as interrupted after a
ten-second startup grace period.

Proof retains the latest 100 runs and at most 1 MiB of output per check, with a
visible truncation marker. Configuration allows 40 checks and 64 KiB total.

Run `npm run proof:smoke` for domain, evidence-rule, OpenTUI and real-browser
checks. The browser smoke needs permission to launch Chrome and bind localhost.
