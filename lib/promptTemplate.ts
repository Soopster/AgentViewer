// Pure prompt-template rules shared by the Web and terminal adapters.
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z][\w.-]*)\s*\}\}/g

export function extractPlaceholders(body: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1]
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/** Replace `{{name}}` tokens with provided values; tokens left unfilled (or filled with '') stay intact. */
export function applyPlaceholders(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER_PATTERN, (full, name: string) => {
    const value = values[name]
    return value && value.length > 0 ? value : full
  })
}
