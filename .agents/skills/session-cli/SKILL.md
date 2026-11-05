---
name: session-cli
description: Drive ordinary Agent Viewer chats from a shell — list, read, prompt and wait on sessions, and report the state of an agent that is not an SDK provider. Use when a script or another agent must send a prompt to a session and wait for it, or wait until a session is blocked or idle.
---

# `agent-viewer session`

Needs a running daemon (`agent-viewer daemon start`); `--attach <url|port>` or `AGENT_VIEWER_ATTACH` picks it. JSON on stdout; exit 1 on error, 2 on usage, 3 when a wait or a `prompt --wait` timed out.

- `session list [--provider p] [--limit n]`
- `session get <id>` — `state` is `working`, `blocked` (a question or approval is pending; `waitingOn` says which) or `idle`.
- `session read <id> [--tail n]`
- `session prompt <id> <text> [--wait] [--timeout ms]` — `--wait` returns when the turn ends.
- `session wait <id> --until working|blocked|idle [--timeout ms]`
- `session interrupt <id>`
- `session report --state working|blocked|idle --source <name> [--session id] [--seq n] [--ttl ms]` — for an agent with no SDK integration; call it from that agent's hooks. A report lapses after `--ttl` (default 10 minutes) so a dead agent does not read as working forever, and a lower `--seq` never overwrites a newer one.
- `session explain --file <screen.txt|-> [--agent claude|codex]` — offline: why a saved terminal screen reads as working, blocked or idle.

`<id>` may be `current` when `AGENT_VIEWER_SESSION_ID` is set.

# `agent-viewer terminal`

Drives the terminals a **running TUI** holds (not the daemon). Ids come from `terminal list`; `--pid` picks a TUI when several run.

- `terminal list` — shells and processes; a coding agent in a shell shows `agent` and `agentState`.
- `terminal read <id> [--lines n] [--scrollback]`
- `terminal send <id> <text> [--enter]`
- `terminal keys <id> Enter Esc C-c Up ...` (Enter Esc Tab Space BSpace arrows Home End PageUp PageDown F1-F12, a character, C-/M-/S- combinations)
- `terminal run <id> -- <command> [args...]` (args are quoted) or `--command "<one line>"`
- `terminal wait <id> --until working|blocked|idle|exited [--timeout ms]` — exit 3 on timeout.
