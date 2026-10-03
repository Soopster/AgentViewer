// The session's live permission rules and hook listing, for diagnostics.
//
// Claude Code answers two control requests that describe how a session is
// *configured* rather than what it has done: `list_permission_rules` (what
// /permissions lists — every rule with its source and whether it is editable)
// and `get_hooks_listing` (what /hooks renders). Both are the missing half of
// session diagnostics: the transcript shows that a tool was denied, and until
// now nothing in Agent Viewer could say which rule denied it or where that rule
// came from.
//
// Both are reached through methods the SDK implements but does NOT declare in
// its public `sdk.d.ts` (`Query.listPermissionRules()` / `Query.getHooksListing()`,
// verified present on the runtime prototype in 0.3.270). That is the whole
// reason this module is defensive rather than typed straight through: an
// undeclared method is not part of the public contract, so it may be absent on
// an older CLI, renamed, or answer a shape that has since moved. Every read
// feature-detects, catches, and degrades to "unavailable" — diagnostics fans out
// a dozen control RPCs and must not lose the other eleven because this one
// changed.
//
// The response type for permission rules IS exported (`SDKControlListPermissionRulesResponse`);
// the hooks one is not, so its shape is read structurally below rather than
// imported, and anything unrecognized is skipped instead of rendered as
// "undefined".

import type { SDKPermissionRuleEntry, SDKPermissionWorkspaceDirectory } from '@anthropic-ai/claude-agent-sdk'

type PermissionRulesQuery = {
  listPermissionRules?: () => Promise<unknown>
  getHooksListing?: () => Promise<unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

// C0/C1 controls, DEL, the bidi and zero-width formatting ranges, and the
// no-break/ideographic spaces. Written as explicit escapes: a literal invisible
// character in this source would be invisible to the next reader of THIS file
// too, which is the same failure the function exists to prevent.
const INVISIBLE_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00A0\u3000]/g

/**
 * Make a rule string safe to print WITHOUT changing what it says.
 *
 * The SDK is explicit that a rule is stored verbatim and "can carry invisible or
 * control characters by design", and that two spellings which parse identically
 * each get their own entry. So stripping those characters is the wrong repair:
 * it renders two different rules identically, and a user looking at their
 * permission list to work out why an allow rule is not matching would see a rule
 * that appears exactly right. They are escaped to a visible `\uXXXX` instead —
 * the point of this surface is to show the rule that is actually stored.
 */
export function revealRuleText(value: string): string {
  return value.replace(INVISIBLE_PATTERN, (ch) => (
    `\\u${ch.codePointAt(0)!.toString(16).padStart(4, '0')}`
  ))
}

function formatRule(entry: SDKPermissionRuleEntry): string {
  // Behaviour first, because it is what the reader is scanning for, then the
  // rule, then where it came from and whether it can be changed. `notInEffect`
  // is the one flag that changes the meaning of the row rather than annotating
  // it — a rule listed but ignored reads as active without it.
  const parts = [
    `${entry.behavior} · ${revealRuleText(entry.rule)}`,
    entry.source,
    entry.editability,
  ]
  if (entry.notInEffect) parts.push('NOT IN EFFECT (managed policy only)')
  return parts.join(' · ')
}

// Chosen to fit a popover without burying the sections below it, while still
// showing enough that the list is useful on a real project rather than a sample.
const MAX_LISTED_RULES = 40

/**
 * Diagnostics items for the session's live permission rules, or an empty array
 * when this CLI cannot answer. An empty array means "no section", which is not
 * the same as a session with no rules — that answers with an explicit row.
 */
export async function claudePermissionRuleItems(query: unknown): Promise<string[]> {
  const q = query as PermissionRulesQuery
  if (typeof q?.listPermissionRules !== 'function') return []
  let response: unknown
  try {
    response = await q.listPermissionRules()
  } catch {
    return []
  }
  const state = asRecord(asRecord(response)?.state ?? response)
  if (!state) return []

  const rules = asArray(state.rules).flatMap((raw) => {
    const record = asRecord(raw)
    if (!record) return []
    const behavior = str(record, 'behavior')
    const rule = str(record, 'rule')
    // A row missing either half says nothing a reader can act on, and printing
    // a half-row as if it were a rule is worse than omitting it.
    if (!behavior || !rule) return []
    return [formatRule(record as unknown as SDKPermissionRuleEntry)]
  })

  const directories = asArray(state.workspaceDirectories).flatMap((raw) => {
    const record = asRecord(raw)
    const dirPath = record ? str(record, 'path') : ''
    if (!dirPath) return []
    const entry = record as unknown as SDKPermissionWorkspaceDirectory
    return [`dir · ${revealRuleText(dirPath)}${entry.source ? ` · ${entry.source}` : ''}`]
  })

  const items: string[] = []
  // Enterprise managed settings can pin the session to policy rules only, which
  // silently disables every rule from a settings file. Saying so once at the top
  // explains a whole list of NOT IN EFFECT rows below it.
  if (state.managedOnly === true) items.push('managed policy rules only · settings-file rules are ignored')
  // A real project accumulates a lot of these — 112 on the repo this was built
  // in — and an unbounded list buries every section after it. But this is an
  // AUDIT surface, so a silent cap is the wrong trade: the reason to open it is
  // usually a rule you cannot find, and a truncated list that does not say it is
  // truncated answers "that rule is not here" when it is. Cap, then say what was
  // withheld and how to see it. Deny rules are never withheld: they are the ones
  // that explain a refusal, and there are few of them.
  const denies = rules.filter((rule) => rule.startsWith('deny ·'))
  const others = rules.filter((rule) => !rule.startsWith('deny ·'))
  items.push(...denies)
  items.push(...others.slice(0, Math.max(MAX_LISTED_RULES - denies.length, 0)))
  const withheld = rules.length - denies.length - Math.min(others.length, Math.max(MAX_LISTED_RULES - denies.length, 0))
  if (withheld > 0) items.push(`… ${withheld} more rule${withheld === 1 ? '' : 's'} not shown · run /permissions for the full list`)
  items.push(...directories)
  const errors = asArray(state.errors).flatMap((raw) => {
    const record = asRecord(raw)
    if (!record) return []
    const file = str(record, 'path') || str(record, 'file') || 'settings file'
    const message = str(record, 'message') || str(record, 'error') || 'parse error'
    // A skipped settings file means its rules are NOT in the session. Silence
    // here would present a shorter list as if it were the whole list.
    return [`skipped ${revealRuleText(file)} · ${message}`]
  })
  items.push(...errors)

  if (items.length === 0) return ['None']
  return items
}

/**
 * Diagnostics items for the session's hook listing, or an empty array when this
 * CLI cannot answer. Complements the existing HOOK TIMELINE section, which shows
 * what hooks have *fired*: this one shows what is registered and would fire.
 */
export async function claudeHooksListingItems(query: unknown): Promise<string[]> {
  const q = query as PermissionRulesQuery
  if (typeof q?.getHooksListing !== 'function') return []
  let response: unknown
  try {
    response = await q.getHooksListing()
  } catch {
    return []
  }
  const record = asRecord(response)
  if (!record) return []

  // Policy locks lead: they change what every row below means. A managed
  // settings source that could not be read (SDK 0.3.274) is the one to never
  // drop — what the organization configured is then unknown, so an empty or
  // short list would look authoritative when it is not.
  const policy = asRecord(record.policy)
  const locks: string[] = []
  if (policy) {
    if (policy.policyUnreadable === true) locks.push('managed policy unreadable · organization hooks unknown, editing locked')
    if (policy.disabledByPolicy === true) locks.push('all hooks disabled by managed policy')
    else if (policy.allDisabled === true) locks.push('all hooks disabled (disableAllHooks)')
    if (policy.managedOnly === true) locks.push('managed hooks only · managed hooks are not listed')
    if (policy.pluginOnly === true) locks.push('plugin-only customization · hooks surface locked')
    if (typeof policy.policyHookCount === 'number' && policy.policyHookCount > 0) {
      locks.push(`${policy.policyHookCount} managed hook${policy.policyHookCount === 1 ? '' : 's'} (run regardless)`)
    }
  }

  // The response type is not exported, so the two arrays are read structurally
  // and an unrecognized row is skipped rather than printed as "undefined".
  const events = asArray(record.events).flatMap((raw) => {
    const event = asRecord(raw)
    const name = event ? str(event, 'name') : ''
    if (!name) return []
    const count = typeof event!.hookCount === 'number' ? event!.hookCount : null
    const summary = str(event!, 'summary')
    return [`${name}${count != null ? ` · ${count} hook${count === 1 ? '' : 's'}` : ''}${summary ? ` · ${summary}` : ''}`]
  })
  if (events.length === 0) return [...locks, 'None']
  return [...locks, ...events]
}

/**
 * One MCP diagnostics row. `source` (SDK 0.3.274) says where the definition came
 * from — `sdk` is a server this host registered in-process, anything else is
 * configuration. The name of a configured server is untrusted text, so it is
 * revealed rather than printed raw.
 */
export function formatClaudeMcpServerStatus(
  server: { name: string; status: string; source?: string },
  dynamic: boolean,
): string {
  const origin = server.source === 'sdk' ? 'built-in' : server.source
  // A server added through `mcp_set_servers` reports source `dynamic` itself,
  // so the local flag and the SDK's answer can both say it.
  const parts = [revealRuleText(server.name), server.status, origin, dynamic ? 'dynamic' : undefined]
  return [...new Set(parts.filter(Boolean))].join(' · ')
}

// ── Context window breakdown ────────────────────────────────────────────────
//
// `getContextUsage()` returns per-category rows, and SDK 0.3.270 added a `kind`
// to each: 'used' occupies the window, 'free' is what remains, 'buffer' is the
// compaction reserve, and 'deferred' rows are out-of-window tool schemas listed
// for awareness and EXCLUDED from usage math.
//
// The SDK's own wording is "classify on this, never on the English name", and it
// means it: the names are display strings ("Free space", "Autocompact buffer"),
// they are localized and re-worded upstream, and a reader that matched on them
// would quietly start counting free space as used the first time one changed —
// producing a meter that reads near-full on an empty session, with no error.
type ContextCategoryRow = { name: string; tokens: number; kind?: string }

export type ClaudeContextBreakdown = {
  items: string[]
  /** Tokens that actually occupy the window: 'used' rows only. */
  usedTokens: number
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

/**
 * Diagnostics items for the context window, grouped by what each row *is*.
 *
 * Rows are ordered used → buffer → free → deferred, which is the order the
 * question is usually asked in ("what is filling my window, and how much is
 * left"). A row whose `kind` is missing — an older CLI — is reported under its
 * own heading rather than guessed into one of the four, because guessing is the
 * exact failure the `kind` field exists to remove.
 */
export function claudeContextBreakdown(usage: unknown, maxTokens?: number): ClaudeContextBreakdown {
  const record = asRecord(usage)
  if (!record) return { items: [], usedTokens: 0 }
  const rows = asArray(record.categories).flatMap((raw): ContextCategoryRow[] => {
    const row = asRecord(raw)
    if (!row) return []
    const name = str(row, 'name')
    const tokens = typeof row.tokens === 'number' ? row.tokens : 0
    if (!name) return []
    return [{ name, tokens, kind: typeof row.kind === 'string' ? row.kind : undefined }]
  })
  if (rows.length === 0) return { items: [], usedTokens: 0 }

  const window = typeof record.maxTokens === 'number' && record.maxTokens > 0
    ? record.maxTokens
    : maxTokens && maxTokens > 0 ? maxTokens : 0
  const usedTokens = rows.reduce((sum, row) => row.kind === 'used' ? sum + row.tokens : sum, 0)

  const share = (tokens: number) => window > 0 ? ` · ${((tokens / window) * 100).toFixed(1)}%` : ''
  const group = (kind: string | undefined) => rows
    .filter((row) => row.kind === kind)
    .sort((a, b) => b.tokens - a.tokens)
    .map((row) => `  ${row.name} · ${formatTokens(row.tokens)}${share(row.tokens)}`)

  const items: string[] = []
  const push = (heading: string, lines: string[]) => {
    if (lines.length === 0) return
    items.push(heading)
    items.push(...lines)
  }
  push(`used · ${formatTokens(usedTokens)}${share(usedTokens)}`, group('used'))
  push('compaction buffer', group('buffer'))
  push('free', group('free'))
  // Deferred schemas are not in the window, so they are listed last and their
  // tokens are deliberately absent from `usedTokens`. Folding them in would
  // overstate the meter by the size of every tool the session has not loaded.
  push('deferred (out of window, not counted)', group('deferred'))
  push('unclassified (older CLI)', group(undefined))

  if (window > 0) items.unshift(`window · ${formatTokens(window)}`)
  return { items, usedTokens }
}
