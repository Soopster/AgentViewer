// Turning transcript prose into clickable targets.
//
// OpenTUI 0.5.11 added `renderer.getLinkAt(x, y)`, which reads a link id back
// out of the *rendered cell attributes* — so a target is clickable only if it
// was painted as a link chunk (`<a href>`) in the first place. That makes this
// module the whole feature: it decides which runs of a line become links, and
// the click handler only has to ask the renderer what is under the cursor.
//
// Pure string work, no filesystem access. This runs per rendered line on every
// transcript render, so a `stat` to confirm a path exists is out of the
// question — the detectors below are deliberately conservative instead, because
// the cost of a false positive is ordinary prose painted as a link.

// A file path is carried as a `file://` URL so one mechanism covers both kinds:
// the terminal gets a real hyperlink either way, and `parseTuiLinkTarget` maps
// it back to a path the editor can open. A line number rides as `#L<n>`, the
// spelling GitHub and most editors already use.
export type TuiLinkRun = { text: string; url: string }
export type TuiLineToken =
  | { kind: 'plain'; text: string }
  | { kind: 'link'; text: string; url: string }

export type TuiLinkTarget =
  | { kind: 'url'; url: string }
  | { kind: 'file'; path: string; line?: number }

// Trailing punctuation is almost never part of the target: prose ends sentences
// and wraps references in brackets. Closing brackets are only trimmed when the
// run has no matching opener, so a URL containing a legitimate paren (a Wikipedia
// article, an MSDN page) keeps it.
const TRAILING_TRIM = /[.,;:!?'"]+$/

function trimTrailing(raw: string): string {
  let value = raw.replace(TRAILING_TRIM, '')
  while (value.length > 0) {
    const last = value[value.length - 1]!
    const opener = last === ')' ? '(' : last === ']' ? '[' : last === '}' ? '{' : null
    if (!opener) break
    const opens = value.split(opener).length - 1
    const closes = value.split(last).length - 1
    if (closes <= opens) break
    value = value.slice(0, -1)
  }
  return value.replace(TRAILING_TRIM, '')
}

// Extensions worth treating as a file reference when the path is relative. An
// absolute path needs no extension (it is already unambiguous), but a bare
// relative token with a slash is far too common in prose — "and/or", "w/ the",
// a URL path fragment — to linkify on the slash alone.
const FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'env',
  'md', 'mdx', 'txt', 'css', 'scss', 'less', 'html', 'htm', 'xml', 'svg',
  'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'h',
  'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'lua',
  'sql', 'graphql', 'gql', 'proto', 'tf', 'dockerfile', 'gradle', 'vue', 'svelte',
])

// One pass over the line. Ordered by specificity: a markdown link's target must
// win over the bare URL sitting inside its parentheses, so `[text](url)` is
// matched first and the URL branch never sees those characters.
//
// The path branch requires either a leading `/` or `./`, or a `/` plus a known
// extension — see FILE_EXTENSIONS. `:line[:col]` is captured so a stack-trace
// style reference lands on the right line.
const LINE_TOKEN_PATTERN = new RegExp([
  // [label](target)
  /\[([^\]\n]+)\]\(([^)\s]+)\)/.source,
  // bare URL. Parentheses are ALLOWED in the run and sorted out afterwards by
  // trimTrailing: excluding them here truncates every Wikipedia/MSDN-style link
  // at its first `(`, and the opposite problem — prose wrapping a URL in
  // parens — is a balance question trimTrailing can answer but a character
  // class cannot.
  /(https?:\/\/[^\s<>[\]{}'"]+)/.source,
  // absolute or explicitly-relative path, optional trailing slash and :line:col.
  // The trailing slash is MATCHED rather than left behind so looksLikeFilePath can
  // see it and refuse a directory; excluded from the pattern, `/abs/dir/` would
  // match as `/abs/dir` and link a directory as if it were a file.
  /((?:\.{1,2}\/|\/)[A-Za-z0-9._~@+-]+(?:\/[A-Za-z0-9._~@+-]+)*\/?(?::\d+(?::\d+)?)?)/.source,
  // bare relative path with at least one slash, optional :line:col
  /([A-Za-z0-9._~@+-]+(?:\/[A-Za-z0-9._~@+-]+)+\/?(?::\d+(?::\d+)?)?)/.source,
].join('|'), 'g')

// The "is there anything here at all" test the render fast path uses: the
// overwhelming majority of transcript lines contain no target and must not pay
// for tokenization. It is the SAME alternation, unanchored and non-global so it
// can stop at the first hit.
//
// It is deliberately nothing more than that. An earlier version rejected any
// line without a `/` first, on the reasoning that every branch needs one — but a
// markdown target need not (`[mail me](mailto:a@b.c)`), so the shortcut made the
// probe disagree with the tokenizer and silently dropped those lines before
// tokenization. Sharing one pattern makes the dangerous direction — the probe
// saying "no" to a line that has a target — impossible by construction rather
// than something a test has to keep catching. The reverse (a probe hit the
// detectors then reject, e.g. `and/or`) is harmless: the line tokenizes to all
// plain, costing one wasted pass.
const LINE_TOKEN_PROBE = new RegExp(LINE_TOKEN_PATTERN.source)

export function hasTuiLinkTarget(text: string): boolean {
  if (!text) return false
  return LINE_TOKEN_PROBE.test(text)
}

function splitPathAndLine(raw: string): { path: string; line?: number } {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(raw)
  if (!match) return { path: raw }
  return { path: match[1]!, line: Number.parseInt(match[2]!, 10) }
}

function looksLikeFilePath(raw: string, requireExtension: boolean): boolean {
  const { path } = splitPathAndLine(raw)
  if (!path.includes('/')) return false
  // A trailing slash is a directory reference, and the editor opens files.
  if (path.endsWith('/')) return false
  const basename = path.slice(path.lastIndexOf('/') + 1)
  if (!basename) return false
  const dot = basename.lastIndexOf('.')
  const extension = dot > 0 ? basename.slice(dot + 1).toLowerCase() : ''
  if (!requireExtension) return true
  return FILE_EXTENSIONS.has(extension)
}

function fileUrlFor(raw: string, cwd: string | undefined): string | null {
  const { path, line } = splitPathAndLine(raw)
  const absolute = path.startsWith('/')
    ? path
    : cwd
      ? `${cwd.replace(/\/+$/, '')}/${path.replace(/^\.\//, '')}`
      : null
  // A relative path with no cwd to resolve against cannot be opened, and a link
  // that does nothing when clicked is worse than plain text.
  if (!absolute) return null
  return `file://${encodeURI(absolute)}${line ? `#L${line}` : ''}`
}

/**
 * Split one line into plain and link runs. `cwd` resolves relative paths; with
 * no cwd, relative paths stay plain text rather than becoming dead links.
 *
 * Runs are returned in source order and concatenate back to the input, so a
 * caller can clip them to a width the way it would clip the raw string.
 */
export function parseTuiLineTokens(text: string, cwd?: string): TuiLineToken[] {
  if (!hasTuiLinkTarget(text)) return text ? [{ kind: 'plain', text }] : []
  const tokens: TuiLineToken[] = []
  let last = 0
  LINE_TOKEN_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  const pushPlain = (value: string) => {
    if (!value) return
    const previous = tokens[tokens.length - 1]
    if (previous?.kind === 'plain') previous.text += value
    else tokens.push({ kind: 'plain', text: value })
  }
  while ((match = LINE_TOKEN_PATTERN.exec(text)) !== null) {
    const [whole, mdLabel, mdTarget, bareUrl, absolutePath, relativePath] = match
    pushPlain(text.slice(last, match.index))
    last = LINE_TOKEN_PATTERN.lastIndex

    if (mdLabel !== undefined && mdTarget !== undefined) {
      const target = /^https?:\/\//.test(mdTarget)
        ? trimTrailing(mdTarget)
        : looksLikeFilePath(mdTarget, false)
          ? fileUrlFor(mdTarget, cwd)
          : null
      // An unrecognized markdown target (a mailto:, an anchor) still loses its
      // markers — the label is what the other renderers show — but is not a link.
      if (target) tokens.push({ kind: 'link', text: mdLabel, url: target })
      else pushPlain(mdLabel)
      continue
    }

    const raw = bareUrl ?? absolutePath ?? relativePath ?? ''
    const trimmed = trimTrailing(raw)
    // Whatever trimTrailing removed is still part of the line.
    const tail = raw.slice(trimmed.length)
    if (!trimmed) { pushPlain(raw); continue }

    if (bareUrl !== undefined) {
      tokens.push({ kind: 'link', text: trimmed, url: trimmed })
    } else {
      const requireExtension = relativePath !== undefined
      const url = looksLikeFilePath(trimmed, requireExtension) ? fileUrlFor(trimmed, cwd) : null
      if (url) tokens.push({ kind: 'link', text: trimmed, url })
      else pushPlain(trimmed)
    }
    pushPlain(tail)
    void whole
  }
  pushPlain(text.slice(last))
  return tokens
}

/**
 * Classify a url the renderer handed back from `getLinkAt`. A `file://` target
 * becomes a path + optional line for the editor; everything else opens
 * externally.
 */
export function parseTuiLinkTarget(url: string): TuiLinkTarget | null {
  if (!url) return null
  if (!url.startsWith('file://')) {
    return /^https?:\/\//.test(url) ? { kind: 'url', url } : null
  }
  const hash = url.indexOf('#')
  const body = hash >= 0 ? url.slice(0, hash) : url
  const fragment = hash >= 0 ? url.slice(hash + 1) : ''
  let path: string
  try {
    path = decodeURI(body.slice('file://'.length))
  } catch {
    return null
  }
  if (!path.startsWith('/')) return null
  const lineMatch = /^L(\d+)$/.exec(fragment)
  const line = lineMatch ? Number.parseInt(lineMatch[1]!, 10) : undefined
  return line ? { kind: 'file', path, line } : { kind: 'file', path }
}
