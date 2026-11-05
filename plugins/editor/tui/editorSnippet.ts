export type EditorSnippetTransform = {
  regex: string
  format: string
  options: string
}

export type EditorSnippetRange = {
  start: number
  end: number
  transform?: EditorSnippetTransform
}

export type EditorSnippetTabstop = {
  index: number
  ranges: EditorSnippetRange[]
}

export type ParsedEditorSnippet = {
  text: string
  tabstops: EditorSnippetTabstop[]
}

type ParseState = {
  values: Map<number, string>
  variables: Readonly<Record<string, string>>
  unknownVariables: Map<string, number>
  nextSyntheticTabstop: number
}

type ParsedFragment = {
  text: string
  ranges: Map<number, EditorSnippetRange[]>
}

function appendRange(ranges: Map<number, EditorSnippetRange[]>, index: number, range: EditorSnippetRange): void {
  const current = ranges.get(index)
  if (current) current.push(range)
  else ranges.set(index, [range])
}

function mergeFragment(target: ParsedFragment, fragment: ParsedFragment): void {
  const offset = target.text.length
  target.text += fragment.text
  for (const [index, ranges] of fragment.ranges) {
    for (const range of ranges) {
      appendRange(target.ranges, index, {
        ...range,
        start: range.start + offset,
        end: range.end + offset,
      })
    }
  }
}

function matchingBrace(value: string, open: number): number {
  let depth = 1
  for (let index = open + 1; index < value.length; index += 1) {
    if (value[index] === '\\') {
      index += 1
      continue
    }
    if (value[index] === '{') depth += 1
    else if (value[index] === '}' && --depth === 0) return index
  }
  return -1
}

function splitChoice(value: string): string[] {
  const choices: string[] = []
  let current = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (character === '\\' && index + 1 < value.length) {
      current += value[++index]
    } else if (character === ',') {
      choices.push(current)
      current = ''
    } else {
      current += character
    }
  }
  choices.push(current)
  return choices
}

function parseTransform(body: string): { source: string; transform: EditorSnippetTransform } | null {
  const source = /^(\d+|[A-Za-z_][\w]*)\//.exec(body)
  if (!source) return null
  const regexStart = source[0].length
  let regexEnd = -1
  for (let index = regexStart; index < body.length; index += 1) {
    if (body[index] === '\\') index += 1
    else if (body[index] === '/') { regexEnd = index; break }
  }
  if (regexEnd < 0) return null

  let formatEnd = -1
  let nestedFormatDepth = 0
  for (let index = regexEnd + 1; index < body.length; index += 1) {
    if (body[index] === '\\') {
      index += 1
      continue
    }
    if (body[index] === '$' && body[index + 1] === '{') {
      nestedFormatDepth += 1
      index += 1
      continue
    }
    if (body[index] === '}' && nestedFormatDepth > 0) {
      nestedFormatDepth -= 1
      continue
    }
    if (body[index] === '/' && nestedFormatDepth === 0) {
      formatEnd = index
      break
    }
  }
  if (formatEnd < 0) return null
  const options = body.slice(formatEnd + 1)
  if (!/^[dgimsuvy]*$/.test(options)) return null
  return {
    source: source[1]!,
    transform: {
      regex: body.slice(regexStart, regexEnd),
      format: body.slice(regexEnd + 1, formatEnd),
      options,
    },
  }
}

function unescapeFormatText(value: string): string {
  return value.replace(/\\([$}\\/])/g, '$1')
}

function splitConditional(value: string): [string, string] {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\') index += 1
    else if (value[index] === ':') return [value.slice(0, index), value.slice(index + 1)]
  }
  return [value, '']
}

function formatCapture(capture: string, operation: string | undefined): string {
  if (operation == null) return capture
  if (operation === '/upcase') return capture.toUpperCase()
  if (operation === '/downcase') return capture.toLowerCase()
  if (operation === '/capitalize') return capture.length === 0
    ? ''
    : `${capture[0]!.toUpperCase()}${capture.slice(1).toLowerCase()}`
  if (operation.startsWith('+')) return capture.length > 0 ? unescapeFormatText(operation.slice(1)) : ''
  if (operation.startsWith('?')) {
    const [whenPresent, whenAbsent] = splitConditional(operation.slice(1))
    return unescapeFormatText(capture.length > 0 ? whenPresent : whenAbsent)
  }
  if (operation.startsWith('-')) return capture.length > 0 ? capture : unescapeFormatText(operation.slice(1))
  return capture.length > 0 ? capture : unescapeFormatText(operation)
}

function renderTransformFormat(format: string, captures: readonly string[]): string {
  let result = ''
  for (let index = 0; index < format.length;) {
    if (format[index] === '\\' && index + 1 < format.length && /[$}\\/]/.test(format[index + 1]!)) {
      result += format[index + 1]
      index += 2
      continue
    }
    if (format[index] !== '$') {
      result += format[index]
      index += 1
      continue
    }
    const numeric = /^(\d+)/.exec(format.slice(index + 1))
    if (numeric) {
      result += captures[Number(numeric[1])] ?? ''
      index += 1 + numeric[1]!.length
      continue
    }
    if (format[index + 1] === '{') {
      const close = matchingBrace(format, index + 1)
      if (close >= 0) {
        const body = format.slice(index + 2, close)
        const braced = /^(\d+)(?::([\s\S]*))?$/.exec(body)
        if (braced) {
          result += formatCapture(captures[Number(braced[1])] ?? '', braced[2])
          index = close + 1
          continue
        }
      }
    }
    result += '$'
    index += 1
  }
  return result
}

export function transformEditorSnippetValue(value: string, transform: EditorSnippetTransform): string {
  try {
    const expression = new RegExp(transform.regex, transform.options)
    return value.replace(expression, (...args: unknown[]) => {
      const hasNamedCaptures = typeof args.at(-1) === 'object'
      const captureArgs = args.slice(0, hasNamedCaptures ? -3 : -2)
      return renderTransformFormat(transform.format, captureArgs.map((capture) => String(capture ?? '')))
    })
  } catch {
    return value
  }
}

function unknownVariable(name: string, state: ParseState): ParsedFragment {
  let index = state.unknownVariables.get(name)
  if (index == null) {
    index = state.nextSyntheticTabstop
    state.nextSyntheticTabstop += 1
    state.unknownVariables.set(name, index)
    state.values.set(index, name)
  }
  return { text: name, ranges: new Map([[index, [{ start: 0, end: name.length }]]]) }
}

function parseBraced(body: string, state: ParseState): ParsedFragment | null {
  const tabstop = /^(\d+)$/.exec(body)
  if (tabstop) {
    const index = Number(tabstop[1])
    const text = state.values.get(index) ?? ''
    return { text, ranges: new Map([[index, [{ start: 0, end: text.length }]]]) }
  }

  const placeholder = /^(\d+):([\s\S]*)$/.exec(body)
  if (placeholder) {
    const index = Number(placeholder[1])
    const parsed = parseFragment(placeholder[2]!, state)
    const text = state.values.get(index) ?? parsed.text
    state.values.set(index, text)
    const ranges = text === parsed.text ? parsed.ranges : new Map<number, EditorSnippetRange[]>()
    appendRange(ranges, index, { start: 0, end: text.length })
    return { text, ranges }
  }

  const choice = /^(\d+)\|([\s\S]*)\|$/.exec(body)
  if (choice) {
    const index = Number(choice[1])
    const text = state.values.get(index) ?? splitChoice(choice[2]!)[0] ?? ''
    state.values.set(index, text)
    return { text, ranges: new Map([[index, [{ start: 0, end: text.length }]]]) }
  }

  const variableWithDefault = /^([A-Za-z_][\w]*):([\s\S]*)$/.exec(body)
  if (variableWithDefault) {
    const known = state.variables[variableWithDefault[1]!]
    return known == null
      ? parseFragment(variableWithDefault[2]!, state)
      : { text: known, ranges: new Map() }
  }

  if (/^[A-Za-z_][\w]*$/.test(body)) {
    const known = state.variables[body]
    return known == null ? unknownVariable(body, state) : { text: known, ranges: new Map() }
  }

  const transformed = parseTransform(body)
  if (transformed) {
    if (/^\d+$/.test(transformed.source)) {
      const index = Number(transformed.source)
      const text = transformEditorSnippetValue(state.values.get(index) ?? '', transformed.transform)
      return {
        text,
        ranges: new Map([[index, [{ start: 0, end: text.length, transform: transformed.transform }]]]),
      }
    }
    const known = state.variables[transformed.source]
    if (known == null) return unknownVariable(transformed.source, state)
    return { text: transformEditorSnippetValue(known, transformed.transform), ranges: new Map() }
  }
  // Keep malformed transforms visible. Silently dropping server-provided code
  // makes a broken completion much harder to understand or repair.
  if (/^(?:\d+|[A-Za-z_][\w]*)\//.test(body)) return { text: `\${${body}}`, ranges: new Map() }
  return null
}

function parseFragment(value: string, state: ParseState): ParsedFragment {
  const result: ParsedFragment = { text: '', ranges: new Map() }
  for (let index = 0; index < value.length;) {
    const character = value[index]!
    if (character === '\\' && index + 1 < value.length && /[$}\\,|]/.test(value[index + 1]!)) {
      result.text += value[index + 1]
      index += 2
      continue
    }
    if (character !== '$') {
      result.text += character
      index += 1
      continue
    }

    const numeric = /^(\d+)/.exec(value.slice(index + 1))
    if (numeric) {
      const tabstop = Number(numeric[1])
      const text = state.values.get(tabstop) ?? ''
      const start = result.text.length
      result.text += text
      appendRange(result.ranges, tabstop, { start, end: result.text.length })
      index += 1 + numeric[1]!.length
      continue
    }

    if (value[index + 1] === '{') {
      const close = matchingBrace(value, index + 1)
      if (close >= 0) {
        const parsed = parseBraced(value.slice(index + 2, close), state)
        if (parsed) {
          mergeFragment(result, parsed)
          index = close + 1
          continue
        }
      }
    }

    const variable = /^([A-Za-z_][\w]*)/.exec(value.slice(index + 1))
    if (variable) {
      const known = state.variables[variable[1]!]
      if (known == null) mergeFragment(result, unknownVariable(variable[1]!, state))
      else result.text += known
      index += 1 + variable[1]!.length
      continue
    }

    result.text += '$'
    index += 1
  }
  return result
}

export function parseEditorSnippet(
  value: string,
  variables: Readonly<Record<string, string>> = {},
): ParsedEditorSnippet {
  const explicitIndexes = [...value.matchAll(/\$(?:\{)?(\d+)/g)].map((match) => Number(match[1]))
  const state: ParseState = {
    values: new Map(),
    variables,
    unknownVariables: new Map(),
    nextSyntheticTabstop: Math.max(0, ...explicitIndexes) + 1,
  }
  // The first pass seeds placeholder defaults so transformed mirrors work even
  // when an LSP server emits them before the editable occurrence.
  parseFragment(value, state)
  const parsed = parseFragment(value, state)
  if (!parsed.ranges.has(0)) appendRange(parsed.ranges, 0, { start: parsed.text.length, end: parsed.text.length })
  const tabstops = [...parsed.ranges]
    .map(([index, ranges]) => ({
      index,
      ranges: [...ranges].sort((left, right) => Number(Boolean(left.transform)) - Number(Boolean(right.transform))),
    }))
    .sort((left, right) => {
      if (left.index === 0) return 1
      if (right.index === 0) return -1
      return left.index - right.index
    })
  return { text: parsed.text, tabstops }
}
