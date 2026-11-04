/** Terminal output pacing, separate from the strict 120 FPS CPU benchmark budget. */
export function resolveRenderPolicy(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
) {
  // A Windows Terminal profile may run Linux under WSL. Terminal delivery is
  // still through the Windows host when it passes its session marker through.
  const windowsTerminal = platform === 'win32' || Boolean(env.WT_SESSION?.trim())
  const requested = Number(env.AGENT_VIEWER_TUI_MAX_FPS)
  const maxFps = Number.isFinite(requested) && requested >= 10 && requested <= 240
    ? requested
    : windowsTerminal ? 60 : 120
  // Compacting rewrites each frame in JS and gives up the native writer thread; it is
  // worth it where the terminal's cost is per escape sequence (ConPTY), and opt-in elsewhere.
  const compactRequested = env.AGENT_VIEWER_COMPACT_OUTPUT
  const compactOutput = compactRequested === '1' ? true : compactRequested === '0' ? false : windowsTerminal
  return {
    maxFps,
    compactOutput,
    // Never commit text faster than the terminal can present it. Preserve the
    // existing 16ms cadence on fast hosts; batch two frames on Windows to leave
    // room for input/scroll while a provider floods text.
    liveTextFlushMs: Math.max(16, Math.ceil((windowsTerminal ? 2000 : 1000) / maxFps)),
  }
}

export const TUI_RENDER_POLICY = resolveRenderPolicy()
