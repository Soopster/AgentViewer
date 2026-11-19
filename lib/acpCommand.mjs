// A user-supplied ACP agent command, as argv. Shared by the coord worker
// (vanilla node) and the session pool, so both read one command the same way.

/**
 * A JSON array, or a command line with simple quoting. It is never handed to a
 * shell, so a path with a space needs quotes and nothing in it is expanded.
 * `source` names where the command came from, for the error.
 */
export function parseAcpCommand(value, source = '--acp-command') {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`${source} requires a command`)
  if (text.startsWith('[')) {
    let parsed
    try { parsed = JSON.parse(text) } catch { throw new Error(`${source} looks like JSON but does not parse`) }
    if (!Array.isArray(parsed) || !parsed.length || !parsed.every((part) => typeof part === 'string' && part)) throw new Error(`${source} JSON must be a non-empty array of strings`)
    return parsed
  }
  const argv = []
  let current = ''
  let quote = null
  let open = false
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === "'") { quote = char; open = true }
    else if (/\s/.test(char)) { if (current || open) argv.push(current); current = ''; open = false }
    else current += char
  }
  if (quote) throw new Error(`${source} has an unterminated quote`)
  if (current || open) argv.push(current)
  return argv
}
