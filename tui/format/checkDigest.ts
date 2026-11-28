// One-line verdict for a build/test/lint command's output ("4 failed · 152 passed",
// "12 errors"), so a Bash card says what the run concluded without opening it.
// Conservative by design: null unless the command names a known tool AND the
// output carries that tool's summary — a wrong digest is worse than none.

const TSC_COMMAND = /\b(tsc|tui:check)\b/
const TEST_COMMAND = /\b(bun\s+test|jest|vitest|pytest|go\s+test|cargo\s+test|npm\s+(run\s+)?test)\b/
const LINT_COMMAND = /\b(eslint|biome|ruff|clippy)\b/

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function lastCount(raw: string, pattern: RegExp): number | null {
  let found: number | null = null
  for (const match of raw.matchAll(pattern)) found = Number(match[1])
  return found
}

export function checkDigest(command: string, raw: string, exitCode: number | null): string | null {
  if (!raw && exitCode == null) return null
  if (TSC_COMMAND.test(command)) {
    const errors = (raw.match(/\berror TS\d+:/g) ?? []).length
    if (errors > 0) return plural(errors, 'type error')
    return exitCode === 0 ? 'no type errors' : null
  }
  if (TEST_COMMAND.test(command)) {
    // bun test / vitest print "N pass" / "N fail"; jest prints "Tests: 4 failed, 152 passed".
    const failed = lastCount(raw, /\b(\d+)\s+(?:fail(?:ed|ing)?)\b/gi)
    const passed = lastCount(raw, /\b(\d+)\s+(?:pass(?:ed|ing)?)\b/gi)
    if (failed == null && passed == null) return null
    const parts: string[] = []
    if (failed) parts.push(`${failed} failed`)
    if (passed != null) parts.push(`${passed} passed`)
    return parts.length ? parts.join(' · ') : null
  }
  if (LINT_COMMAND.test(command)) {
    const problems = lastCount(raw, /(\d+)\s+problems?\b/gi)
    if (problems) return plural(problems, 'problem')
    return exitCode === 0 ? 'clean' : null
  }
  return null
}
