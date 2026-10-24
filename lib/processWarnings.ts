// Routes `process.emitWarning` away from raw stderr.
//
// The runtime prints a warning straight to stderr — `(node:PID) [CODE] Warning:
// …` plus a `(Use \`bun --trace-warnings …\`)` hint — which in the TUI lands on
// top of the alternate screen, outside OpenTUI's console capture. Adding a
// `'warning'` listener does not stop that print, so the emitter itself is
// wrapped.
//
// `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` is dropped everywhere: the Agent SDK emits
// it for every `query()` built with `canUseTool` in `bypassPermissions` mode, and
// both send paths install `canUseTool` on purpose — a warm pool entry changes
// permission mode live (`setPermissionMode`, no respawn), and must still prompt
// once it leaves bypass. The warning describes a choice we made, on every turn.

const INTENTIONAL_WARNING_CODES = new Set(['CLAUDE_SDK_CAN_USE_TOOL_SHADOWED'])

let installed = false
let redirect: ((text: string) => void) | null = null

function warningCode(warning: string | Error, options: unknown): string | undefined {
  if (warning instanceof Error && 'code' in warning && typeof warning.code === 'string') return warning.code
  if (options && typeof options === 'object' && 'code' in options && typeof options.code === 'string') return options.code
  return undefined
}

/**
 * Drop known-intentional warnings. With `sink`, every other warning goes there
 * instead of stderr — the TUI passes `console.warn`, which OpenTUI captures.
 */
export function installProcessWarningRouting(sink?: (text: string) => void): void {
  if (sink) redirect = sink
  if (installed) return
  installed = true
  const emit = process.emitWarning.bind(process)
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (INTENTIONAL_WARNING_CODES.has(warningCode(warning, rest[0]) ?? '')) return
    if (redirect) {
      redirect(`[warning] ${warning instanceof Error ? warning.message : warning}`)
      return
    }
    ;(emit as (...args: unknown[]) => void)(warning, ...rest)
  }) as typeof process.emitWarning
}
