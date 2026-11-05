// Self-termination guard for child processes spawned by the Tauri desktop
// shell (src-tauri/src/lib.rs) and the CLI's dev-mode spawn chain
// (bin/agent-viewer.mjs). The shell's own cleanup (RunEvent::ExitRequested,
// external SIGTERM/SIGINT — see kill_backend() in lib.rs) only runs if the
// shell process is still alive to receive it; a crash or SIGKILL leaves
// this process orphaned under launchd/init with no supervisor left to signal
// it — confirmed happening in practice. Poll for that instead of waiting to
// be told: if AGENT_VIEWER_PARENT_PID stops existing, self-terminate.

const POLL_INTERVAL_MS = 3_000

function parentAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH: no such process — the real "parent is gone" case. Any other
    // error (e.g. EPERM) is ambiguous; fail safe and assume it's alive
    // rather than risk self-terminating a healthy process.
    return (err as NodeJS.ErrnoException)?.code !== 'ESRCH'
  }
}

/** No-op unless AGENT_VIEWER_PARENT_PID is set (only true when spawned by
 *  the desktop shell) — a plain `npm run dev`/CLI session never sets it. */
export function startParentWatchdog(label: string): void {
  const raw = process.env.AGENT_VIEWER_PARENT_PID
  if (!raw) return
  const parentPid = Number(raw)
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) return

  const timer = setInterval(() => {
    if (!parentAlive(parentPid)) {
      clearInterval(timer)
      console.error(`[${label}] parent process ${parentPid} is gone — exiting to avoid an orphaned process`)
      process.exit(1)
    }
  }, POLL_INTERVAL_MS)
  timer.unref()
}
