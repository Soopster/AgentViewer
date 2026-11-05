// Issue bodies, comments and CI logs are written by other people and tools.
// Rendered raw into a terminal, an escape sequence in them can move the cursor,
// retitle the window or paint over the UI, so every string from GitHub is
// scrubbed once, here, before it leaves `lib/github`.

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g
// Control characters except tab and newline; also bidi overrides that reorder text on screen.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g

export function scrubGithubText(value: unknown): string {
  return String(value ?? '').replace(ANSI, '').replace(/\r\n?/g, '\n').replace(CONTROL, '')
}

/** Keep the end of a log: the failure is nearly always the last thing printed. */
export function tailText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false }
  const cut = value.slice(value.length - maxChars)
  const newline = cut.indexOf('\n')
  return { text: newline >= 0 && newline < 2000 ? cut.slice(newline + 1) : cut, truncated: true }
}
