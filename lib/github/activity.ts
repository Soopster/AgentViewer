// What a tool call did on GitHub. `gh pr create` run through a shell and the
// GitHub MCP server's `create_pull_request` are the same event to the person
// reading the transcript, so both become one `GithubActivity` that the Web card,
// the terminal card and PR auto-linking all read. No Node imports.
//
// Output is read only where its shape is fixed (gh's non-terminal TSV and
// `key:\tvalue` forms, `--json`, git's commit and push summaries). Anything not
// understood is left out: the raw output is always one click away, and a wrong
// summary is worse than none.
import { findGithubLinks, parseGithubUrl, type GithubLink } from './links'
import { scrubGithubText } from './text'

export type GithubActivityKind =
  | 'pr-create' | 'pr-merge' | 'pr-view' | 'pr-list' | 'pr-checks' | 'pr-checkout' | 'pr-ready' | 'pr-draft'
  | 'pr-close' | 'pr-reopen' | 'pr-comment' | 'pr-review' | 'pr-edit' | 'pr-diff' | 'pr-update'
  | 'issue-create' | 'issue-view' | 'issue-list' | 'issue-close' | 'issue-reopen' | 'issue-comment' | 'issue-edit'
  | 'run-list' | 'run-view' | 'run-watch' | 'run-rerun' | 'run-cancel' | 'workflow-run'
  | 'release-create' | 'release-view' | 'repo-view' | 'api' | 'search'
  | 'commit' | 'push'

export type GithubActivityTone = 'success' | 'danger' | 'warning' | 'merged' | 'info'

export type GithubCheckRow = { name: string; state: 'success' | 'failure' | 'pending' | 'neutral'; url?: string; duration?: string }

export type GithubListRow = { number?: number; title: string; meta?: string; url?: string }

export type GithubActivity = {
  kind: GithubActivityKind
  /** What happened, in the past tense when it succeeded: "Opened pull request". */
  verb: string
  tone: GithubActivityTone
  failed: boolean
  repo?: string
  number?: number
  /** The PR's or issue's title, a commit subject, a release tag. */
  subject?: string
  url?: string
  /** One line of facts: branches, review verdict, diff size. */
  facts: string[]
  /** The body of a comment, review, PR or issue as it was sent. */
  body?: string
  checks?: GithubCheckRow[]
  rows?: GithubListRow[]
  sha?: string
  branch?: string
  base?: string
  draft?: boolean
}

const MAX_ROWS = 30
const MAX_BODY = 4000
const MAX_COMMAND = 40_000
const MAX_OUTPUT = 200_000

// ── Shell reading ────────────────────────────────────────────────────────────

/** `<<EOF … EOF` bodies replaced by a placeholder, so their text is never read as commands. */
function extractHeredocs(command: string): { text: string; bodies: string[] } {
  const bodies: string[] = []
  const lines = command.split('\n')
  const out: string[] = []
  for (let at = 0; at < lines.length; at++) {
    let line = lines[at]!
    const markers = [...line.matchAll(/<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_]\w*))/g)]
    if (!markers.length) { out.push(line); continue }
    for (const marker of markers) {
      const word = marker[1] ?? marker[2] ?? marker[3]!
      const body: string[] = []
      while (at + 1 < lines.length && lines[at + 1]!.trim() !== word) body.push(lines[++at]!)
      at++
      line = line.replace(marker[0], `\u0001${bodies.length}\u0001`)
      bodies.push(body.join('\n'))
    }
    out.push(line)
  }
  return { text: out.join('\n'), bodies }
}

/** Words of each simple command, split at `&&`, `||`, `;`, `|` and newlines, quotes honoured. */
export function shellCommands(command: string): string[][] {
  const { text, bodies } = extractHeredocs(command.slice(0, MAX_COMMAND))
  const commands: string[][] = []
  let words: string[] = []
  let word = ''
  let quoted = false
  let started = false
  const endWord = () => {
    if (!started) return
    // `$(cat <<'EOF' …)` is how agents pass a multi-line body: give back the body itself.
    const heredoc = /^\$\(\s*cat\s+\u0001(\d+)\u0001\s*\)$/.exec(word.trim())
    words.push(heredoc ? bodies[Number(heredoc[1])] ?? '' : word)
    word = ''; started = false; quoted = false
  }
  const endCommand = () => {
    endWord()
    if (words.length) commands.push(words)
    words = []
  }
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!
    if (char === '$' && text[at + 1] === '(') {
      // Consume the substitution whole, so its quotes and operators stay inside the word.
      let depth = 0
      let inner = ''
      let quote = ''
      for (; at < text.length; at++) {
        const c = text[at]!
        inner += c
        if (quote) { if (c === quote) quote = ''; continue }
        if (c === "'" || c === '"') quote = c
        else if (c === '(') depth++
        else if (c === ')' && --depth === 0) break
      }
      word += inner; started = true
      continue
    }
    if (char === "'") {
      const end = text.indexOf("'", at + 1)
      word += text.slice(at + 1, end < 0 ? text.length : end)
      at = end < 0 ? text.length : end
      started = true; quoted = true
    } else if (char === '"') {
      let value = ''
      for (at++; at < text.length && text[at] !== '"'; at++) {
        if (text[at] === '\\' && '"\\$`\n'.includes(text[at + 1] ?? '')) { value += text[++at]; continue }
        if (text[at] === '$' && text[at + 1] === '(') {
          let depth = 0
          for (; at < text.length; at++) {
            value += text[at]
            if (text[at] === '(') depth++
            else if (text[at] === ')' && --depth === 0) break
          }
          continue
        }
        value += text[at]
      }
      word += value; started = true; quoted = true
    } else if (char === '\\') {
      if (text[at + 1] !== '\n') { word += text[at + 1] ?? ''; started = true }
      at++
    } else if (char === '\n' || char === ';' || char === '|' || char === '&' || char === '(' || char === ')') {
      // `2>&1` is a redirect, not a separator.
      if (char === '&' && (text[at - 1] === '>' || text[at + 1] === '>')) { word += char; started = true; continue }
      endCommand()
    } else if (char === ' ' || char === '\t') {
      endWord()
    } else if (char === '#' && !started && !quoted) {
      const end = text.indexOf('\n', at)
      at = end < 0 ? text.length : end - 1
    } else {
      word += char; started = true
    }
  }
  endCommand()
  return commands
}

/** The program and its arguments, past `VAR=x`, `env`, `cd`-style prefixes and redirects. */
function programArgs(words: string[]): string[] {
  let start = 0
  while (start < words.length && (/^[A-Za-z_]\w*=/.test(words[start]!) || ['env', 'sudo', 'time', 'command', 'nohup', 'then', 'do'].includes(words[start]!))) start++
  const rest: string[] = []
  for (let at = start; at < words.length; at++) {
    const word = words[at]!
    if (/^\d*(>>?|<)$/.test(word)) { at++; continue }
    if (/^\d*(>>?|<)\S/.test(word)) continue
    rest.push(word)
  }
  return rest
}

type Flags = { positional: string[]; values: Map<string, string[]>; has: (...names: string[]) => boolean; get: (...names: string[]) => string | undefined }

/** Flags that take no value, so the word after one is still a positional argument. */
const BOOLEAN_FLAGS = new Set([
  '--approve', '-a', '--request-changes', '--comment', '--draft', '--squash', '-s', '--merge', '-m', '--rebase', '-r', '--auto',
  '--delete-branch', '-d', '--web', '-w', '--fill', '-f', '--fill-first', '--fill-verbose', '--watch', '--failed', '--log', '--log-failed',
  '--verbose', '-v', '--undo', '--force', '--force-with-lease', '--set-upstream', '-u', '--tags', '--all', '--amend', '--no-verify',
  '--required', '--prerelease', '--latest', '--generate-notes', '--exit-status', '--paginate', '--admin', '--disable-auto', '--yes', '-y',
  '--no-edit', '--quiet', '-q', '--porcelain', '--dry-run', '--delete', '--allow-empty', '--editor', '--recover',
])

function readFlags(args: string[], valueless: Set<string> = BOOLEAN_FLAGS): Flags {
  const positional: string[] = []
  const values = new Map<string, string[]>()
  const add = (name: string, value: string) => values.set(name, [...(values.get(name) ?? []), value])
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!
    if (!arg.startsWith('-') || arg === '-') { positional.push(arg); continue }
    const equals = arg.indexOf('=')
    if (equals > 0) { add(arg.slice(0, equals), arg.slice(equals + 1)); continue }
    if (valueless.has(arg) || at + 1 >= args.length || args[at + 1]!.startsWith('-')) { add(arg, ''); continue }
    add(arg, args[++at]!)
  }
  return {
    positional, values,
    has: (...names) => names.some(name => values.has(name)),
    get: (...names) => { for (const name of names) { const list = values.get(name); if (list?.length && list[0] !== '') return list[list.length - 1] } return undefined },
  }
}

// ── Output reading ───────────────────────────────────────────────────────────

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim()
  if (!/^[[{]/.test(trimmed)) return undefined
  try { return JSON.parse(trimmed) } catch { return undefined }
}

/** gh's non-terminal `view` form: `key:\tvalue` lines, then `--` and the body. */
function parseViewFields(output: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of output.split('\n')) {
    if (line === '--') break
    const match = /^([a-z][a-z ]*):\t(.*)$/.exec(line)
    if (match) fields[match[1]!] = match[2]!.trim()
  }
  return fields
}

const CHECK_STATES: Record<string, GithubCheckRow['state']> = { pass: 'success', fail: 'failure', pending: 'pending', skipping: 'neutral', cancel: 'failure' }

export function parseCheckRows(output: string): GithubCheckRow[] {
  const rows: GithubCheckRow[] = []
  for (const line of output.split('\n')) {
    const cells = line.split('\t')
    const state = CHECK_STATES[cells[1] ?? '']
    if (!state || !cells[0]) continue
    rows.push({ name: cells[0], state, duration: cells[2] && cells[2] !== '0' ? cells[2] : undefined, url: cells[3]?.startsWith('http') ? cells[3] : undefined })
  }
  return rows
}

function checkFacts(checks: GithubCheckRow[]): string[] {
  const count = (state: GithubCheckRow['state']) => checks.filter(check => check.state === state).length
  return [
    count('failure') ? `${count('failure')} failing` : '',
    count('pending') ? `${count('pending')} pending` : '',
    count('success') ? `${count('success')} passed` : '',
    count('neutral') ? `${count('neutral')} skipped` : '',
  ].filter(Boolean)
}

function jsonRows(value: unknown): GithubListRow[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rows: GithubListRow[] = []
  for (const entry of value as Array<Record<string, unknown>>) {
    if (!entry || typeof entry !== 'object') continue
    const title = String(entry.title ?? entry.displayTitle ?? entry.name ?? '')
    if (!title) continue
    rows.push({
      number: typeof entry.number === 'number' ? entry.number : undefined, title,
      meta: [entry.state, entry.conclusion, entry.headRefName, entry.workflowName].filter(Boolean).map(String).join(' · ') || undefined,
      url: typeof entry.url === 'string' ? entry.url : undefined,
    })
  }
  return rows.length ? rows : undefined
}

function tsvListRows(output: string): GithubListRow[] | undefined {
  const rows: GithubListRow[] = []
  for (const line of output.split('\n')) {
    const cells = line.split('\t')
    if (cells.length < 3 || !/^\d+$/.test(cells[0]!)) continue
    // `pr list`: number, title, branch, state, updated. `issue list`: number, state, title, labels, updated.
    const issueForm = /^(OPEN|CLOSED)$/.test(cells[1]!)
    rows.push({ number: Number(cells[0]), title: cells[issueForm ? 2 : 1]!, meta: [cells[issueForm ? 1 : 3], issueForm ? cells[3] : cells[2]].filter(Boolean).join(' · ') })
  }
  return rows.length ? rows : undefined
}

// ── gh ───────────────────────────────────────────────────────────────────────

type Draft = Omit<GithubActivity, 'tone' | 'failed' | 'facts' | 'verb'> & { facts?: string[]; tone?: GithubActivityTone; pastVerb: string; tryVerb: string }

function finish(draft: Draft, failed: boolean): GithubActivity {
  const { pastVerb, tryVerb, ...activity } = draft
  return {
    ...activity,
    verb: failed ? tryVerb : pastVerb,
    facts: (activity.facts ?? []).filter(Boolean),
    tone: failed ? 'danger' : activity.tone ?? 'info',
    failed,
    subject: activity.subject ? scrubGithubText(activity.subject).split('\n')[0]!.slice(0, 200) : undefined,
    body: activity.body ? scrubGithubText(activity.body).trim().slice(0, MAX_BODY) || undefined : undefined,
    checks: activity.checks?.slice(0, MAX_ROWS * 2),
    rows: activity.rows?.slice(0, MAX_ROWS),
  }
}

/** The number or URL a `gh pr|issue <verb> [target]` call names. */
function target(flags: Flags, links: GithubLink[], kind: 'pr' | 'issue'): { number?: number; repo?: string; url?: string; branch?: string } {
  const repo = flags.get('--repo', '-R')
  const word = flags.positional[0]
  if (word) {
    const link = parseGithubUrl(word)
    if (link?.number) return { number: link.number, repo: link.repo, url: link.url }
    const number = Number(word.replace(/^#/, ''))
    if (Number.isSafeInteger(number) && number > 0) {
      const mentioned = links.find(candidate => candidate.kind === kind && candidate.number === number && (!repo || candidate.repo === repo))
      return { number, repo: repo ?? mentioned?.repo, url: mentioned?.url }
    }
    return { branch: word, repo }
  }
  const mentioned = links.find(candidate => candidate.kind === kind)
  return mentioned ? { number: mentioned.number, repo: mentioned.repo, url: mentioned.url } : { repo }
}

function ghActivity(args: string[], output: string, failed: boolean): GithubActivity | null {
  const [group, verb, ...rest] = args
  const links = findGithubLinks(output)
  const flags = readFlags(rest)
  const done = (draft: Draft) => finish(draft, failed)
  const body = () => {
    const direct = flags.get('--body', '-b', '--comment', '-c')
    return direct && direct !== '-' ? direct : undefined
  }

  if (group === 'pr' && verb) {
    const at = target(flags, links, 'pr')
    const base: Pick<Draft, 'number' | 'repo' | 'url' | 'branch'> = at
    switch (verb) {
      case 'create': {
        const created = links.find(link => link.kind === 'pr')
        const head = flags.get('--head', '-H')
        const into = flags.get('--base', '-B')
        const draft = flags.has('--draft', '-d')
        return done({
          kind: 'pr-create', pastVerb: draft ? 'Opened draft pull request' : 'Opened pull request', tryVerb: 'Could not open pull request', tone: 'success',
          number: created?.number, repo: created?.repo ?? flags.get('--repo', '-R'), url: created?.url,
          subject: flags.get('--title', '-t'), body: body(), branch: head, base: into, draft,
          facts: [head && into ? `${head} → ${into}` : into ? `into ${into}` : head ?? ''],
        })
      }
      case 'merge': {
        const method = flags.has('--squash', '-s') ? 'squash' : flags.has('--rebase', '-r') ? 'rebase' : flags.has('--merge', '-m') ? 'merge' : ''
        const auto = flags.has('--auto')
        const named = /pull request (?:([\w.-]+\/[\w.-]+))?#(\d+)(?: \((.*)\))?/i.exec(output)
        return done({
          ...base, kind: 'pr-merge', pastVerb: auto ? 'Enabled auto-merge' : 'Merged pull request', tryVerb: 'Could not merge pull request', tone: auto ? 'info' : 'merged',
          number: base.number ?? (named ? Number(named[2]) : undefined), repo: base.repo ?? named?.[1], subject: named?.[3],
          facts: [method, flags.has('--delete-branch', '-d') ? 'branch deleted' : ''],
        })
      }
      case 'view': {
        const json = parseJsonOutput(output) as Record<string, unknown> | undefined
        const fields = json && !Array.isArray(json) ? undefined : parseViewFields(output)
        const state = String(json?.state ?? fields?.state ?? '')
        const additions = json?.additions ?? fields?.additions
        const deletions = json?.deletions ?? fields?.deletions
        return done({
          ...base, kind: 'pr-view', pastVerb: 'Read pull request', tryVerb: 'Could not read pull request',
          number: Number(json?.number ?? fields?.number ?? base.number) || undefined,
          url: String(json?.url ?? fields?.url ?? base.url ?? '') || undefined,
          subject: String(json?.title ?? fields?.title ?? '') || undefined,
          tone: state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'danger' : 'info',
          facts: [state.toLowerCase(), additions !== undefined && deletions !== undefined ? `+${additions} −${deletions}` : ''],
        })
      }
      case 'checks': {
        const checks = parseCheckRows(output)
        const failing = checks.some(check => check.state === 'failure')
        const pending = checks.some(check => check.state === 'pending')
        // `gh pr checks` exits non-zero for failing or pending checks: with rows read, that is the answer, not an error.
        return finish({
          ...base, kind: 'pr-checks', pastVerb: failing ? 'Checks failing' : pending ? 'Checks running' : checks.length ? 'Checks passed' : 'Checked pull request',
          tryVerb: 'Could not read checks', tone: failing ? 'danger' : pending ? 'warning' : checks.length ? 'success' : 'info', checks, facts: checkFacts(checks),
        }, failed && checks.length === 0)
      }
      case 'list':
      case 'status':
        return done({ kind: 'pr-list', pastVerb: 'Listed pull requests', tryVerb: 'Could not list pull requests', repo: flags.get('--repo', '-R'), rows: jsonRows(parseJsonOutput(output)) ?? tsvListRows(output) })
      case 'checkout':
        return done({ ...base, kind: 'pr-checkout', pastVerb: 'Checked out pull request', tryVerb: 'Could not check out pull request' })
      case 'ready':
        return flags.has('--undo')
          ? done({ ...base, kind: 'pr-draft', pastVerb: 'Converted to draft', tryVerb: 'Could not convert to draft' })
          : done({ ...base, kind: 'pr-ready', pastVerb: 'Marked ready for review', tryVerb: 'Could not mark ready', tone: 'success' })
      case 'close':
        return done({ ...base, kind: 'pr-close', pastVerb: 'Closed pull request', tryVerb: 'Could not close pull request', tone: 'danger', body: body() })
      case 'reopen':
        return done({ ...base, kind: 'pr-reopen', pastVerb: 'Reopened pull request', tryVerb: 'Could not reopen pull request', tone: 'success' })
      case 'comment':
        return done({ ...base, kind: 'pr-comment', pastVerb: 'Commented on pull request', tryVerb: 'Could not comment', url: links.find(link => link.kind === 'pr')?.url ?? base.url, body: body() })
      case 'review': {
        const approve = flags.has('--approve', '-a')
        const changes = flags.has('--request-changes', '-r')
        const text = flags.get('--body', '-b')
        return done({
          ...base, kind: 'pr-review', body: text,
          pastVerb: approve ? 'Approved pull request' : changes ? 'Requested changes' : 'Reviewed pull request', tryVerb: 'Could not submit review',
          tone: approve ? 'success' : changes ? 'warning' : 'info',
        })
      }
      case 'edit':
        return done({ ...base, kind: 'pr-edit', pastVerb: 'Edited pull request', tryVerb: 'Could not edit pull request', subject: flags.get('--title', '-t'), body: body(),
          facts: [...flags.values].filter(([name]) => name.startsWith('--add-') || name.startsWith('--remove-') || name === '--base').map(([name, value]) => `${name.slice(2).replace('-', ' ')}: ${value.join(', ')}`) })
      case 'diff':
        return done({ ...base, kind: 'pr-diff', pastVerb: 'Read pull request diff', tryVerb: 'Could not read diff' })
      case 'update-branch':
        return done({ ...base, kind: 'pr-update', pastVerb: 'Updated pull request branch', tryVerb: 'Could not update branch' })
      default: return null
    }
  }

  if (group === 'issue' && verb) {
    const at = target(flags, links, 'issue')
    switch (verb) {
      case 'create': {
        const created = links.find(link => link.kind === 'issue')
        return done({ kind: 'issue-create', pastVerb: 'Opened issue', tryVerb: 'Could not open issue', tone: 'success', number: created?.number, repo: created?.repo, url: created?.url, subject: flags.get('--title', '-t'), body: body() })
      }
      case 'view': {
        const json = parseJsonOutput(output) as Record<string, unknown> | undefined
        const fields = json ? undefined : parseViewFields(output)
        return done({ ...at, kind: 'issue-view', pastVerb: 'Read issue', tryVerb: 'Could not read issue',
          number: Number(json?.number ?? fields?.number ?? at.number) || undefined,
          subject: String(json?.title ?? fields?.title ?? '') || undefined,
          facts: [String(json?.state ?? fields?.state ?? '').toLowerCase()] })
      }
      case 'list':
      case 'status':
        return done({ kind: 'issue-list', pastVerb: 'Listed issues', tryVerb: 'Could not list issues', rows: jsonRows(parseJsonOutput(output)) ?? tsvListRows(output) })
      case 'close': return done({ ...at, kind: 'issue-close', pastVerb: 'Closed issue', tryVerb: 'Could not close issue', tone: 'merged', body: body() })
      case 'reopen': return done({ ...at, kind: 'issue-reopen', pastVerb: 'Reopened issue', tryVerb: 'Could not reopen issue', tone: 'success' })
      case 'comment': return done({ ...at, kind: 'issue-comment', pastVerb: 'Commented on issue', tryVerb: 'Could not comment', body: body() })
      case 'edit': return done({ ...at, kind: 'issue-edit', pastVerb: 'Edited issue', tryVerb: 'Could not edit issue', body: body() })
      default: return null
    }
  }

  if (group === 'run' && verb) {
    const id = flags.positional[0]
    const url = links.find(link => link.kind === 'run')?.url
    const facts = [id ? `run ${id}` : '']
    const base = { url, facts }
    switch (verb) {
      case 'list': return done({ kind: 'run-list', pastVerb: 'Listed workflow runs', tryVerb: 'Could not list runs', rows: jsonRows(parseJsonOutput(output)) ?? runListRows(output) })
      case 'view': return done({ ...base, kind: 'run-view', pastVerb: flags.has('--log', '--log-failed') ? 'Read workflow log' : 'Read workflow run', tryVerb: 'Could not read run' })
      case 'watch': return done({ ...base, kind: 'run-watch', pastVerb: 'Watched workflow run', tryVerb: 'Workflow run failed' })
      case 'rerun': return done({ ...base, kind: 'run-rerun', pastVerb: flags.has('--failed') ? 'Re-ran failed jobs' : 'Re-ran workflow', tryVerb: 'Could not re-run workflow', tone: 'success' })
      case 'cancel': return done({ ...base, kind: 'run-cancel', pastVerb: 'Cancelled workflow run', tryVerb: 'Could not cancel run', tone: 'warning' })
      default: return null
    }
  }

  if (group === 'workflow' && verb === 'run') return done({ kind: 'workflow-run', pastVerb: 'Dispatched workflow', tryVerb: 'Could not dispatch workflow', tone: 'success', subject: flags.positional[0] })
  if (group === 'release' && (verb === 'create' || verb === 'view')) {
    return done({
      kind: verb === 'create' ? 'release-create' : 'release-view',
      pastVerb: verb === 'create' ? 'Published release' : 'Read release', tryVerb: verb === 'create' ? 'Could not create release' : 'Could not read release',
      tone: verb === 'create' ? 'success' : 'info', subject: flags.positional[0], url: links.find(link => link.kind === 'release')?.url, facts: [flags.has('--draft') ? 'draft' : '', flags.has('--prerelease') ? 'pre-release' : ''],
    })
  }
  if (group === 'repo' && verb === 'view') return done({ kind: 'repo-view', pastVerb: 'Read repository', tryVerb: 'Could not read repository', subject: flags.positional[0] })
  if (group === 'search' && verb) return done({ kind: 'search', pastVerb: `Searched GitHub ${verb}`, tryVerb: 'GitHub search failed', subject: flags.positional.join(' ') || undefined, rows: jsonRows(parseJsonOutput(output)) })
  if (group === 'api') {
    const apiFlags = readFlags(args.slice(1))
    const method = (apiFlags.get('--method', '-X') ?? (apiFlags.has('-f', '-F', '--field', '--raw-field', '--input') ? 'POST' : 'GET')).toUpperCase()
    const endpoint = apiFlags.positional[0]
    return done({ kind: 'api', pastVerb: method === 'GET' || endpoint === 'graphql' ? 'Queried GitHub API' : 'Called GitHub API', tryVerb: 'GitHub API call failed', subject: endpoint ? `${endpoint === 'graphql' ? '' : `${method} `}${endpoint}` : undefined })
  }
  return null
}

/** `gh run list` non-terminal form: status, conclusion, title, workflow, branch, event, id, elapsed, age. */
function runListRows(output: string): GithubListRow[] | undefined {
  const rows: GithubListRow[] = []
  for (const line of output.split('\n')) {
    const cells = line.split('\t')
    if (cells.length < 7 || !/^\d+$/.test(cells[6]!)) continue
    rows.push({ title: cells[2]!, meta: [cells[1] || cells[0], cells[3], cells[4]].filter(Boolean).join(' · ') })
  }
  return rows.length ? rows : undefined
}

// ── git ──────────────────────────────────────────────────────────────────────

const COMMIT_LINE = /^\[([^\]\n]*?)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.*)$/gm
const STAT_LINE = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/

function commitActivities(args: string[], output: string, failed: boolean): GithubActivity[] {
  const flags = readFlags(args)
  const made = [...output.matchAll(COMMIT_LINE)]
  if (!made.length) {
    // `-q` prints nothing; the message given is still what was committed.
    const message = flags.get('-m', '--message')
    if (!failed && !flags.has('-q', '--quiet')) return []
    return message ? [finish({ kind: 'commit', pastVerb: 'Committed', tryVerb: 'Commit failed', subject: message, tone: 'success' }, failed)] : []
  }
  return made.map((match, index) => {
    const stat = STAT_LINE.exec(output.slice(match.index, made[index + 1]?.index))
    return finish({
      kind: 'commit', pastVerb: flags.has('--amend') ? 'Amended commit' : 'Committed', tryVerb: 'Commit failed', tone: 'success',
      branch: match[1], sha: match[2], subject: match[3],
      facts: [match[1]!, stat ? `${stat[1]} file${stat[1] === '1' ? '' : 's'}${stat[2] || stat[3] ? ` · +${stat[2] ?? 0} −${stat[3] ?? 0}` : ''}` : ''],
    }, false)
  })
}

function pushActivity(args: string[], output: string, failed: boolean): GithubActivity | null {
  const flags = readFlags(args)
  if (flags.has('--dry-run', '-n')) return null
  const rejected = /^\s*!\s+\[(?:remote )?rejected\]\s+(\S+)\s+->\s+(\S+)\s*(?:\((.*)\))?/m.exec(output)
  const updated = /^\s*(?:\+\s)?\s*([0-9a-f]{7,40}\.{2,3}[0-9a-f]{7,40})\s+(\S+)\s+->\s+(\S+)/m.exec(output)
  const created = /^\s*\*\s+\[new (branch|tag)\]\s+(\S+)\s+->\s+(\S+)/m.exec(output)
  const upToDate = /Everything up-to-date/.test(output)
  const links = findGithubLinks(output)
  const offer = links.find(link => link.kind === 'new-pr')
  const existing = links.find(link => link.kind === 'pr')
  const to = /^To (\S+)/m.exec(output)?.[1]
  const repo = offer?.repo ?? existing?.repo ?? (to ? /[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(to)?.[1] : undefined)
  const branch = rejected?.[2] ?? updated?.[3] ?? created?.[3] ?? flags.positional[1]?.split(':').pop()
  const forced = flags.has('--force', '-f', '--force-with-lease')
  const broke = failed || !!rejected
  return finish({
    kind: 'push', repo, branch, url: offer?.url ?? existing?.url, tone: forced ? 'warning' : 'success',
    pastVerb: upToDate ? 'Already up to date' : forced ? 'Force-pushed' : created?.[1] === 'tag' ? 'Pushed tag' : created ? 'Pushed new branch' : 'Pushed',
    tryVerb: rejected ? 'Push rejected' : 'Push failed', subject: branch,
    facts: [updated?.[1] ?? '', rejected?.[3] ?? ''],
  }, broke)
}

/** `git -C dir -c k=v push` → `push` and what follows it. */
function gitSubcommand(args: string[]): { verb: string; rest: string[] } | null {
  let at = 0
  while (at < args.length && args[at]!.startsWith('-')) at += args[at] === '-C' || args[at] === '-c' || args[at] === '--git-dir' || args[at] === '--work-tree' ? 2 : 1
  return at < args.length ? { verb: args[at]!, rest: args.slice(at + 1) } : null
}

export function shellGithubActivities(command: string, output: string, failed = false): GithubActivity[] {
  if (!/\b(gh|git)\b/.test(command)) return []
  const text = scrubGithubText(output.slice(0, MAX_OUTPUT))
  const commands = shellCommands(command).map(programArgs).filter(words => words.length)
  const activities: GithubActivity[] = []
  let sawCommit = false
  const found: Array<{ index: number; read: (failedHere: boolean) => GithubActivity[] }> = []
  commands.forEach((words, index) => {
    const program = words[0]!.split('/').pop()
    if (program === 'gh') found.push({ index, read: broke => { const activity = ghActivity(words.slice(1), text, broke); return activity ? [activity] : [] } })
    else if (program === 'git') {
      const git = gitSubcommand(words.slice(1))
      if (git?.verb === 'commit' && !sawCommit) { sawCommit = true; found.push({ index, read: broke => commitActivities(git.rest, text, broke) }) }
      else if (git?.verb === 'push') found.push({ index, read: broke => { const activity = pushActivity(git.rest, text, broke); return activity ? [activity] : [] } })
    }
  })
  // One exit status covers the whole line. A failure is pinned on the last step
  // that shows no evidence of having worked; earlier chained steps ran.
  found.forEach((step, position) => activities.push(...step.read(failed && position === found.length - 1)))
  return activities
}

// ── GitHub MCP tools ─────────────────────────────────────────────────────────

const MCP_PREFIX = /^(?:mcp__[\w-]*github[\w-]*__|github[_.:/]+)/i

export function isGithubMcpTool(toolName: string): boolean {
  return MCP_PREFIX.test(toolName)
}

const MCP_TOOLS: Record<string, { kind: GithubActivityKind; past: string; tried: string; tone?: GithubActivityTone }> = {
  create_pull_request: { kind: 'pr-create', past: 'Opened pull request', tried: 'Could not open pull request', tone: 'success' },
  merge_pull_request: { kind: 'pr-merge', past: 'Merged pull request', tried: 'Could not merge pull request', tone: 'merged' },
  get_pull_request: { kind: 'pr-view', past: 'Read pull request', tried: 'Could not read pull request' },
  pull_request_read: { kind: 'pr-view', past: 'Read pull request', tried: 'Could not read pull request' },
  list_pull_requests: { kind: 'pr-list', past: 'Listed pull requests', tried: 'Could not list pull requests' },
  search_pull_requests: { kind: 'search', past: 'Searched pull requests', tried: 'GitHub search failed' },
  update_pull_request: { kind: 'pr-edit', past: 'Edited pull request', tried: 'Could not edit pull request' },
  update_pull_request_branch: { kind: 'pr-update', past: 'Updated pull request branch', tried: 'Could not update branch' },
  create_pull_request_review: { kind: 'pr-review', past: 'Reviewed pull request', tried: 'Could not submit review' },
  pull_request_review_write: { kind: 'pr-review', past: 'Reviewed pull request', tried: 'Could not submit review' },
  get_pull_request_status: { kind: 'pr-checks', past: 'Checked pull request', tried: 'Could not read checks' },
  get_pull_request_files: { kind: 'pr-diff', past: 'Read pull request diff', tried: 'Could not read diff' },
  create_issue: { kind: 'issue-create', past: 'Opened issue', tried: 'Could not open issue', tone: 'success' },
  get_issue: { kind: 'issue-view', past: 'Read issue', tried: 'Could not read issue' },
  issue_read: { kind: 'issue-view', past: 'Read issue', tried: 'Could not read issue' },
  list_issues: { kind: 'issue-list', past: 'Listed issues', tried: 'Could not list issues' },
  search_issues: { kind: 'search', past: 'Searched issues', tried: 'GitHub search failed' },
  add_issue_comment: { kind: 'issue-comment', past: 'Commented', tried: 'Could not comment' },
  update_issue: { kind: 'issue-edit', past: 'Edited issue', tried: 'Could not edit issue' },
}

function mcpActivity(toolName: string, input: Record<string, unknown>, output: string, failed: boolean): GithubActivity | null {
  const spec = MCP_TOOLS[toolName.replace(MCP_PREFIX, '')]
  if (!spec) return null
  const json = parseJsonOutput(output) as Record<string, unknown> | undefined
  const object = json && !Array.isArray(json) ? json : undefined
  const text = (value: unknown) => typeof value === 'string' && value ? value : undefined
  const url = text(object?.html_url) ?? text(object?.url)
  const link = (url ? parseGithubUrl(url) : null) ?? (spec.kind.endsWith('-create') ? findGithubLinks(output)[0] ?? null : null)
  const number = Number(input.pullNumber ?? input.pull_number ?? input.issue_number ?? object?.number ?? link?.number) || undefined
  const repo = text(input.owner) && text(input.repo) ? `${input.owner}/${input.repo}` : link?.repo
  const verdict = String(input.event ?? '')
  return finish({
    kind: spec.kind, pastVerb: verdict === 'APPROVE' ? 'Approved pull request' : verdict === 'REQUEST_CHANGES' ? 'Requested changes' : spec.past, tryVerb: spec.tried,
    tone: verdict === 'APPROVE' ? 'success' : verdict === 'REQUEST_CHANGES' ? 'warning' : spec.tone,
    repo, number, url: link?.url, subject: text(input.title) ?? text(object?.title) ?? text(input.query) ?? text(input.q),
    body: text(input.body), branch: text(input.head), base: text(input.base), draft: input.draft === true || undefined,
    facts: [text(input.head) && text(input.base) ? `${input.head} → ${input.base}` : '', text(input.merge_method) ?? text(input.mergeMethod) ?? ''],
    rows: spec.kind === 'pr-list' || spec.kind === 'issue-list' || spec.kind === 'search'
      ? jsonRows(Array.isArray(json) ? json : object?.items)?.map(row => ({ ...row })) : undefined,
  }, failed)
}

const SHELL_TOOLS = new Set(['Bash', 'bash', 'shell', 'exec_command', 'run_terminal_cmd'])

/** Everything a tool call did on GitHub or to git history; empty for every other call. */
export function detectGithubActivities(toolName: string, input: unknown, output: string, failed = false): GithubActivity[] {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  if (SHELL_TOOLS.has(toolName)) {
    const command = typeof record.command === 'string' ? record.command : ''
    return command ? shellGithubActivities(command, output, failed) : []
  }
  if (isGithubMcpTool(toolName)) {
    const activity = mcpActivity(toolName, record, output, failed)
    return activity ? [activity] : []
  }
  return []
}

/** One line naming an activity: `Opened pull request #12 · Fix the thing`. */
export function describeGithubActivity(activity: GithubActivity): string {
  const number = activity.number ? ` #${activity.number}` : ''
  const subject = activity.subject ? ` · ${activity.subject}` : activity.sha ? ` · ${activity.sha.slice(0, 7)}` : ''
  return `${activity.verb}${number}${subject}`
}
