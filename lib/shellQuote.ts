// One command line from argv, for the shell that will read it.
//
// argv is what a user's keys.json and a script's `terminal run` give us, and a
// value in it must never become syntax. Quoting is per shell because the three
// families disagree about what is special:
//   posix       single quotes; an embedded ' is closed, escaped and reopened.
//   powershell  single quotes (no expansion at all); an embedded ' is doubled,
//               and a leading `&` calls a quoted path as a command.
//   cmd         double quotes protect spaces and & | < > ^ — but `%VAR%` still
//               expands inside them and `"` cannot be escaped reliably, so a word
//               holding either is refused rather than quoted wrong.

export type ShellDialect = 'posix' | 'powershell' | 'cmd'

const POSIX_SAFE = /^[A-Za-z0-9_\/.:=@%+,-]+$/
const CMD_SAFE = /^[A-Za-z0-9_\/\\.:=@+,#-]+$/

/** Which family a shell program belongs to, by its executable name. */
export function shellDialectFor(program: string): ShellDialect {
  const base = program.split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, '') ?? ''
  if (base === 'pwsh' || base === 'powershell') return 'powershell'
  if (base === 'cmd') return 'cmd'
  return 'posix'
}

export function quoteArgv(argv: readonly string[], dialect: ShellDialect = 'posix'): string {
  if (argv.some((word) => /[\r\n\0]/.test(word))) throw new Error('A command word cannot contain a line break')
  if (dialect === 'posix') return argv.map((word) => (POSIX_SAFE.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`)).join(' ')
  if (dialect === 'powershell') return `& ${argv.map((word) => `'${word.replace(/'/g, "''")}'`).join(' ')}`
  return argv.map((word) => {
    if (/["%]/.test(word)) throw new Error(`"${word}" cannot be quoted safely for cmd.exe (it holds a " or %); use PowerShell`)
    return word !== '' && CMD_SAFE.test(word) ? word : `"${word}"`
  }).join(' ')
}
