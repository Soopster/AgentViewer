export type EditorSearchMatch = {
  start: number
  end: number
  value: string
  captures: Array<string | undefined>
  groups?: Record<string, string | undefined>
}

export type EditorSearchResult = { matches: EditorSearchMatch[]; error: string | null }

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function advanceUnicodeOffset(value: string, offset: number): number {
  const first = value.charCodeAt(offset)
  return first >= 0xD800 && first <= 0xDBFF
    && value.charCodeAt(offset + 1) >= 0xDC00 && value.charCodeAt(offset + 1) <= 0xDFFF
    ? offset + 2
    : offset + 1
}

export function findEditorSearchMatches(
  content: string,
  query: string,
  options: { matchCase: boolean; regex: boolean; range?: { start: number; end: number } | null },
): EditorSearchResult {
  if (!query) return { matches: [], error: null }
  const rangeStart = Math.max(0, Math.min(content.length, options.range?.start ?? 0))
  const rangeEnd = Math.max(rangeStart, Math.min(content.length, options.range?.end ?? content.length))
  let expression: RegExp
  try {
    expression = new RegExp(options.regex ? query : escapeRegExp(query), `gu${options.matchCase ? '' : 'i'}`)
  } catch (error) {
    return { matches: [], error: error instanceof Error ? error.message : 'Invalid regular expression' }
  }
  const source = content.slice(rangeStart, rangeEnd)
  const matches: EditorSearchMatch[] = []
  let match: RegExpExecArray | null
  while ((match = expression.exec(source)) && matches.length < 10_000) {
    matches.push({
      start: rangeStart + match.index,
      end: rangeStart + match.index + match[0].length,
      value: match[0],
      captures: match.slice(1),
      groups: match.groups,
    })
    if (match[0].length === 0) expression.lastIndex = advanceUnicodeOffset(source, expression.lastIndex)
  }
  return { matches, error: null }
}

export function expandEditorSearchReplacement(
  content: string,
  match: EditorSearchMatch,
  replacement: string,
): string {
  return replacement.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g, (token, reference: string) => {
    if (reference === '$') return '$'
    if (reference === '&') return match.value
    if (reference === '`') return content.slice(0, match.start)
    if (reference === "'") return content.slice(match.end)
    if (reference.startsWith('<')) return match.groups?.[reference.slice(1, -1)] ?? token
    const index = Number.parseInt(reference, 10)
    if (!Number.isFinite(index) || index < 1) return token
    if (index <= match.captures.length) return match.captures[index - 1] ?? ''
    // "$12" against two groups is group 1 followed by a literal "2" — every
    // regex engine falls back a digit at a time, and refusing to would paste
    // the token itself into the user's file instead of the replacement.
    const single = Math.floor(index / 10)
    return reference.length === 2 && single >= 1 && single <= match.captures.length
      ? `${match.captures[single - 1] ?? ''}${reference[1]}`
      : token
  })
}
