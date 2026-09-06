// Deterministic, local, no-LLM session quality scoring.
//
// Ported from agentsview's `internal/signals` package (outcome, tool health,
// context pressure, and Coach-derived prompt/workflow heuristics) and adapted
// to our shared `ThreadedMessage` shape. The score is penalty-based: every
// session starts at 100 and loses capped penalties for failure, context loss,
// and weak prompting, then maps to an A–F grade.
//
// Pure computation — no DB, no network, no transcript ever leaves the process.

import type { ThreadedBlock, ThreadedMessage } from './threading'
import type { AnalyticsInput } from './analytics'

// ── Wire shapes ───────────────────────────────────────────────────────────────

/** Ordered tool call, flattened from threaded tool_thread blocks. */
type ToolCallRow = {
  toolName: string
  /** Normalized category used by the failure/context heuristics. */
  category: string
  inputJSON: string
  resultContent: string
  messageOrdinal: number
  /** '' (unknown / mid-turn), 'completed', or 'errored'. */
  eventStatus: '' | 'completed' | 'errored'
}

type HeuristicMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
  isSystem: boolean
  ordinal: number
  timestamp: string
}

export type SessionOutcome = 'completed' | 'abandoned' | 'errored' | 'unknown'

export type OutcomeResult = {
  outcome: SessionOutcome
  confidence: 'high' | 'medium' | 'low'
  isRecent: boolean
}

export type SessionArchetype = 'automation' | 'quick' | 'standard' | 'deep' | 'marathon'

export type HealthGrade = '' | 'A' | 'B' | 'C' | 'D' | 'F'

export type HealthReport = {
  /** null when there is too little signal to score the session. */
  score: number | null
  grade: HealthGrade
  /** Which signal families contributed (for "scored on …" copy). */
  basis: string[]
  /** signal_name -> penalty points applied. Empty when perfect. */
  penalties: Record<string, number>
  outcome: OutcomeResult
  archetype: SessionArchetype
}

// ── Tunables (mirrors agentsview RecencyWindow / window sizes) ──────────────────

const RECENCY_WINDOW_MS = 10 * 60 * 1000

const GIVE_UP_PATTERNS = [
  "i'm unable to",
  "i can't proceed",
  "i don't have access",
  'i cannot proceed',
  'i am unable to',
]

// Context window sizes by model prefix (longest prefix wins). Unknown models
// yield no pressure penalty, so we deliberately err toward the larger window to
// avoid penalizing long sessions on models we can't size.
const CONTEXT_WINDOW_SIZES: Array<[string, number]> = ([
  ['claude-opus-4', 1_000_000],
  ['claude-sonnet-4', 200_000],
  ['claude-haiku-4', 200_000],
  ['claude-3-5-sonnet', 200_000],
  ['claude-3-opus', 200_000],
  ['claude-3-haiku', 200_000],
  ['gpt-4o-mini', 128_000],
  ['gpt-4o', 128_000],
  ['gemini-2.5-pro', 1_000_000],
  ['gemini-2.5-flash', 1_000_000],
  ['gemini-2.0-flash', 1_000_000],
  ['gemini', 1_000_000],
] as Array<[string, number]>).sort((a, b) => b[0].length - a[0].length)

// ── Extraction from threaded messages ──────────────────────────────────────────

function blockText(block: ThreadedBlock): string {
  if (block.type === 'text') return block.text ?? ''
  return ''
}

function messageText(msg: ThreadedMessage): string {
  let out = ''
  for (const block of msg.blocks) {
    const t = blockText(block)
    if (t) out += (out ? '\n' : '') + t
  }
  return out
}

/** Map a tool name to the coarse category the heuristics switch on. */
function toolCategory(name: string): string {
  switch (name) {
    case 'MultiEdit':
      return 'Edit'
    case 'Edit':
    case 'Write':
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'Bash':
      return name
    default:
      return name
  }
}

function resultText(result: { content: string | unknown[] } | null): string {
  if (!result) return ''
  const c = result.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    let out = ''
    for (const part of c) {
      if (part && typeof part === 'object' && 'text' in part) {
        const t = (part as { text?: unknown }).text
        if (typeof t === 'string') out += (out ? '\n' : '') + t
      }
    }
    return out
  }
  return ''
}

function extractToolCalls(threaded: ThreadedMessage[]): ToolCallRow[] {
  const rows: ToolCallRow[] = []
  for (let ordinal = 0; ordinal < threaded.length; ordinal += 1) {
    const msg = threaded[ordinal]!
    for (const block of msg.blocks) {
      if (block.type !== 'tool_thread') continue
      const name = block.toolUse.name || 'tool'
      let inputJSON = '{}'
      try {
        inputJSON = JSON.stringify(block.toolUse.input ?? {})
      } catch {
        inputJSON = '{}'
      }
      let eventStatus: ToolCallRow['eventStatus'] = ''
      if (block.result) eventStatus = block.result.is_error ? 'errored' : 'completed'
      rows.push({
        toolName: name,
        category: toolCategory(name),
        inputJSON,
        resultContent: resultText(block.result),
        messageOrdinal: ordinal,
        eventStatus,
      })
    }
  }
  return rows
}

function extractHeuristicMessages(threaded: ThreadedMessage[]): HeuristicMessage[] {
  const out: HeuristicMessage[] = []
  for (let ordinal = 0; ordinal < threaded.length; ordinal += 1) {
    const msg = threaded[ordinal]!
    out.push({
      role: msg.role,
      content: messageText(msg),
      isSystem: msg.role === 'system',
      ordinal,
      timestamp: msg.timestamp ?? '',
    })
  }
  return out
}

// ── Tool health ────────────────────────────────────────────────────────────────

const GOROUTINE_RE = /goroutine \d+/
const EXIT_STATUS_RE = /exit (?:status|code) ([1-9]\d*)/

function hasJsStackTrace(content: string): boolean {
  let consecutive = 0
  for (const line of content.split('\n')) {
    if (line.startsWith('  at ')) {
      consecutive += 1
      if (consecutive >= 3) return true
    } else {
      consecutive = 0
    }
  }
  return false
}

function hasErrorCompanion(content: string): boolean {
  for (const c of ['command not found', 'No such file', 'Permission denied', 'fatal:', 'panic:']) {
    if (content.includes(c)) return true
  }
  if (content.includes('Traceback (most recent call last)')) return true
  if (GOROUTINE_RE.test(content)) return true
  return hasJsStackTrace(content)
}

function isBashFailure(content: string): boolean {
  if (content.includes('command not found')) return true
  if (content.includes('Permission denied')) return true
  if (content.includes('Traceback (most recent call last)')) return true
  if (GOROUTINE_RE.test(content)) return true
  if (hasJsStackTrace(content)) return true
  if (EXIT_STATUS_RE.test(content)) return hasErrorCompanion(content)
  return false
}

function isContentFailure(category: string, content: string): boolean {
  switch (category) {
    case 'Bash':
      return isBashFailure(content)
    case 'Edit':
    case 'Write':
      return content.includes('FAILED')
    default:
      return false
  }
}

function isFailure(c: ToolCallRow): boolean {
  if (c.eventStatus !== '') return c.eventStatus === 'errored'
  return isContentFailure(c.category, c.resultContent)
}

type ToolHealthSignals = {
  failureSignalCount: number
  consecutiveFailureMax: number
  finalFailureStreak: number
  retryCount: number
  editChurnCount: number
}

function extractFilePath(input: string): string {
  const marker = '"file_path":"'
  const idx = input.indexOf(marker)
  if (idx < 0) return ''
  const start = idx + marker.length
  const end = input.indexOf('"', start)
  if (end < 0) return ''
  return input.slice(start, end)
}

function hasChurnWindow(ordinals: number[], windowSize: number, maxSpan: number): boolean {
  const n = ordinals.length
  if (n < windowSize) return false
  for (let i = 0; i <= n - windowSize; i += 1) {
    let lo = ordinals[i]!
    let hi = ordinals[i]!
    for (let j = i + 1; j < i + windowSize; j += 1) {
      const v = ordinals[j]!
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (hi - lo < maxSpan) return true
  }
  return false
}

function computeToolHealth(calls: ToolCallRow[]): ToolHealthSignals {
  let failureSignalCount = 0
  let consecutiveFailureMax = 0
  let finalFailureStreak = 0
  let streak = 0
  for (const c of calls) {
    if (isFailure(c)) {
      failureSignalCount += 1
      streak += 1
      if (streak > consecutiveFailureMax) consecutiveFailureMax = streak
    } else {
      streak = 0
    }
  }
  finalFailureStreak = streak

  // Retries: 3+ consecutive identical (name + input) calls = (run - 1) each.
  let retryCount = 0
  if (calls.length >= 3) {
    let runLen = 1
    for (let i = 1; i < calls.length; i += 1) {
      if (calls[i]!.toolName === calls[i - 1]!.toolName && calls[i]!.inputJSON === calls[i - 1]!.inputJSON) {
        runLen += 1
      } else {
        if (runLen >= 3) retryCount += runLen - 1
        runLen = 1
      }
    }
    if (runLen >= 3) retryCount += runLen - 1
  }

  // Edit churn: 3+ edits to the same file within a 10-ordinal span = 1 event.
  const fileOrdinals = new Map<string, number[]>()
  for (const c of calls) {
    if (c.category !== 'Edit' && c.category !== 'Write') continue
    const path = extractFilePath(c.inputJSON)
    if (!path) continue
    const arr = fileOrdinals.get(path) ?? []
    arr.push(c.messageOrdinal)
    fileOrdinals.set(path, arr)
  }
  let editChurnCount = 0
  for (const ords of fileOrdinals.values()) {
    if (hasChurnWindow(ords, 3, 10)) editChurnCount += 1
  }

  return { failureSignalCount, consecutiveFailureMax, finalFailureStreak, retryCount, editChurnCount }
}

// ── Context pressure ────────────────────────────────────────────────────────────

type ContextPressureResult = {
  compactionCount: number
  /** Ordinals where a >30% context drop occurred (compaction boundaries). */
  boundaryOrdinals: number[]
  pressureMax: number | null
}

function lookupWindowSize(model: string): number {
  for (const [prefix, size] of CONTEXT_WINDOW_SIZES) {
    if (model === prefix) return size
    if (model.startsWith(prefix) && model[prefix.length] === '-') return size
  }
  return 0
}

function computeContextPressure(threaded: ThreadedMessage[], model: string): ContextPressureResult {
  let compactionCount = 0
  const boundaryOrdinals: number[] = []
  let prevTokens = -1
  let peak = 0
  for (let ordinal = 0; ordinal < threaded.length; ordinal += 1) {
    const u = threaded[ordinal]!.usage
    if (!u) continue
    const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    if (ctx <= 0) continue
    if (ctx > peak) peak = ctx
    if (prevTokens > 0 && ctx < prevTokens * 0.7) {
      compactionCount += 1
      boundaryOrdinals.push(ordinal)
    }
    prevTokens = ctx
  }
  let pressureMax: number | null = null
  if (peak > 0 && model) {
    const windowSize = lookupWindowSize(model)
    if (windowSize > 0) pressureMax = peak / windowSize
  }
  return { compactionCount, boundaryOrdinals, pressureMax }
}

const MID_TASK_WINDOW_BEFORE = 10
const MID_TASK_WINDOW_AFTER = 5
const MID_TASK_OVERLAP_THRESHOLD = 2

function countMidTaskCompactions(boundaryOrdinals: number[], calls: ToolCallRow[]): number {
  if (boundaryOrdinals.length === 0 || calls.length === 0) return 0
  let count = 0
  for (const b of boundaryOrdinals) {
    const before: string[] = []
    for (const c of calls) if (c.messageOrdinal < b) before.push(c.toolName)
    const beforeWindow = before.slice(Math.max(0, before.length - MID_TASK_WINDOW_BEFORE))
    const after: string[] = []
    for (const c of calls) {
      if (c.messageOrdinal > b) {
        after.push(c.toolName)
        if (after.length >= MID_TASK_WINDOW_AFTER) break
      }
    }
    if (beforeWindow.length === 0 || after.length === 0) continue
    const beforeSet = new Set(beforeWindow)
    const matched = new Set<string>()
    for (const name of after) if (beforeSet.has(name)) matched.add(name)
    if (matched.size >= MID_TASK_OVERLAP_THRESHOLD) count += 1
  }
  return count
}

// ── Prompt / workflow heuristics ────────────────────────────────────────────────

type HeuristicSignals = {
  shortPromptCount: number
  unstructuredStart: boolean
  missingSuccessCriteriaCount: number
  missingVerificationCount: number
  duplicatePromptCount: number
  noCodeContextCount: number
  runawayToolLoopCount: number
}

const CODE_FENCE_RE = /```[\s\S]*?```/g
const SPACE_RE = /\s+/g
const BULLET_RE = /^\s*(?:[-*+]|\d+\.)\s+\S+/m
const FILE_REF_RE = /(?:^|[\s"'`])(?:\.{0,2}\/)?[a-z0-9_.-]+(?:\/[a-z0-9_. -]+)+|[a-z0-9_.-]+\.(?:go|ts|tsx|js|jsx|py|rs|java|kt|rb|php|cs|cpp|c|h|hpp|sql|svelte|vue|css|scss|html|json|ya?ml|toml|md|sh|zsh|bash)/i

const CONTROL_PROMPTS = new Set([
  'yes', 'y', 'no', 'n', 'ok', 'okay', 'continue', 'go ahead', 'proceed',
  'do it', 'done', 'thanks', 'thank you', 'please continue', 'keep going',
])

type PromptInfo = {
  content: string
  normalized: string
  tokens: string[]
  index: number
  timestamp: string
  hasPreviousAssistant: boolean
  previousAssistantTimestamp: string
  firstUserAfterLastAssistant: boolean
}

function normalizePrompt(content: string): string {
  const withoutCode = content.replace(CODE_FENCE_RE, ' ')
  const lower = withoutCode.trim().toLowerCase()
  return lower.replace(SPACE_RE, ' ')
}

function promptTokens(normalized: string): string[] {
  const parts = normalized.split(/[^\p{L}\p{N}_-]+/u)
  return parts.filter((p) => p.length >= 3)
}

function isControlPrompt(normalized: string): boolean {
  return CONTROL_PROMPTS.has(normalized)
}

function userPrompts(msgs: HeuristicMessage[]): PromptInfo[] {
  const prompts: PromptInfo[] = []
  let previousAssistantTimestamp = ''
  let hasPreviousAssistant = false
  let userSinceLastAssistant = false
  for (const m of msgs) {
    if (m.isSystem) continue
    if (m.role === 'assistant') {
      previousAssistantTimestamp = m.timestamp
      hasPreviousAssistant = true
      userSinceLastAssistant = false
      continue
    }
    if (m.role !== 'user') continue
    const normalized = normalizePrompt(m.content)
    if (normalized === '') continue
    const firstAfterAssistant = !userSinceLastAssistant
    prompts.push({
      content: m.content,
      normalized,
      tokens: promptTokens(normalized),
      index: prompts.length,
      timestamp: m.timestamp,
      hasPreviousAssistant,
      previousAssistantTimestamp,
      firstUserAfterLastAssistant: firstAfterAssistant,
    })
    if (!isControlPrompt(normalized)) userSinceLastAssistant = true
  }
  return prompts
}

function containsWord(text: string, word: string): boolean {
  return promptTokens(text).includes(word)
}

function containsAnyWord(text: string, words: string[]): boolean {
  const toks = new Set(promptTokens(text))
  return words.some((w) => toks.has(w))
}

function hasFileRef(content: string): boolean {
  return FILE_REF_RE.test(content)
}

function hasCodeAction(text: string): boolean {
  return containsAnyWord(text, [
    'implement', 'fix', 'debug', 'refactor', 'update', 'change', 'add',
    'remove', 'create', 'write', 'test', 'lint', 'compile', 'build', 'wire',
  ])
}

function hasCodeObject(text: string): boolean {
  return containsAnyWord(text, [
    'code', 'codebase', 'repo', 'repository', 'app', 'backend', 'frontend',
    'api', 'endpoint', 'component', 'function', 'class', 'module', 'package',
    'schema', 'migration', 'test', 'tests', 'bug', 'error',
  ])
}

function isCodeTask(prompts: PromptInfo[]): boolean {
  for (const p of prompts) {
    const text = p.normalized
    if (hasFileRef(p.content) && hasCodeAction(text)) return true
    if (hasCodeAction(text) && hasCodeObject(text)) return true
    if (
      text.includes('failing test') || text.includes('stack trace') ||
      text.includes('build error') || text.includes('compile error')
    ) return true
  }
  return false
}

function firstSubstantivePrompt(prompts: PromptInfo[]): PromptInfo | null {
  for (const p of prompts) if (!isControlPrompt(p.normalized)) return p
  return null
}

function parsePromptTime(raw: string): number | null {
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : null
}

function hasStaleAssistantBefore(p: PromptInfo): boolean {
  if (!p.hasPreviousAssistant) return false
  const userTime = parsePromptTime(p.timestamp)
  const assistantTime = parsePromptTime(p.previousAssistantTimestamp)
  if (userTime === null || assistantTime === null) return false
  return userTime - assistantTime > 30 * 60 * 1000
}

function isShortPrompt(p: PromptInfo): boolean {
  return !isControlPrompt(p.normalized) && p.normalized.length > 0 && p.normalized.length < 30
}

function countShortStartPrompts(prompts: PromptInfo[]): number {
  const first = firstSubstantivePrompt(prompts)
  if (!first) return 0
  let count = 0
  for (const p of prompts) {
    if (!isShortPrompt(p)) continue
    if (p.index === first.index) {
      count += 1
      continue
    }
    if (p.firstUserAfterLastAssistant && hasStaleAssistantBefore(p)) count += 1
  }
  return count
}

function hasConstraintLanguage(text: string): boolean {
  return containsAnyWord(text, [
    'must', 'never', 'only', 'preserve', 'keep', 'avoid', 'require', 'requires',
    'constraint', 'constraints', 'acceptance', 'criteria', 'success', 'expected',
    'output', 'format', 'verify', 'validation', 'test', 'tests',
  ])
}

function hasSpecStructure(content: string, normalized: string): boolean {
  if (content.includes('\n#') || BULLET_RE.test(content)) return true
  for (const phrase of ['acceptance criteria', 'success criteria', 'requirements', 'steps', 'plan', 'scope', 'non-scope']) {
    if (normalized.includes(phrase)) return true
  }
  return false
}

function isUnstructuredStart(content: string): boolean {
  const normalized = normalizePrompt(content)
  if (hasFileRef(content) || hasConstraintLanguage(normalized) || hasSpecStructure(content, normalized)) return false
  return true
}

function hasSuccessCriteria(prompts: PromptInfo[]): boolean {
  for (const p of prompts) {
    for (const phrase of ['success', 'acceptance', 'expected', 'done when', 'should result', 'output', 'criteria']) {
      if (p.normalized.includes(phrase)) return true
    }
  }
  return false
}

function hasVerificationLanguage(prompts: PromptInfo[]): boolean {
  for (const p of prompts) {
    for (const phrase of ['test', 'tests', 'verify', 'verification', 'validate', 'validation', 'check', 'reproduce', 'proof', 'run']) {
      if (containsWord(p.normalized, phrase) || p.normalized.includes(phrase)) return true
    }
  }
  return false
}

function hasPromptContext(prompts: PromptInfo[]): boolean {
  return prompts.some((p) => hasFileRef(p.content))
}

function commandText(inputJSON: string): string {
  try {
    const payload = JSON.parse(inputJSON) as Record<string, unknown>
    for (const key of ['command', 'cmd']) {
      const v = payload[key]
      if (typeof v === 'string') return v
    }
  } catch {
    return inputJSON
  }
  return inputJSON
}

function isContextCommand(command: string): boolean {
  const fields = command.trim().split(/\s+/)
  if (fields.length === 0 || !fields[0]) return false
  const name = fields[0]
  if (['rg', 'grep', 'git', 'ls', 'find', 'cat', 'sed', 'awk', 'go', 'npm', 'pnpm', 'yarn', 'pytest', 'cargo', 'make'].includes(name)) {
    return true
  }
  return command.includes(' test') || command.includes(' lint')
}

function hasContextToolActivity(calls: ToolCallRow[]): boolean {
  for (const c of calls) {
    switch (c.category) {
      case 'Read':
      case 'Grep':
      case 'Glob':
        return true
      case 'Bash':
        if (isContextCommand(commandText(c.inputJSON))) return true
        break
    }
  }
  return false
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const seen = new Set(a)
  let intersections = 0
  let union = seen.size
  for (const token of b) {
    if (seen.has(token)) intersections += 1
    else union += 1
  }
  return union === 0 ? 0 : intersections / union
}

function countDuplicatePrompts(prompts: PromptInfo[]): number {
  const seen: PromptInfo[] = []
  let repeats = 0
  for (const p of prompts) {
    if (isControlPrompt(p.normalized) || p.normalized.length < 20 || p.tokens.length < 4) continue
    let duplicate = false
    for (const prev of seen) {
      if (p.normalized === prev.normalized || jaccard(p.tokens, prev.tokens) >= 0.85) {
        duplicate = true
        break
      }
    }
    if (duplicate) repeats += 1
    else seen.push(p)
  }
  return repeats
}

function toolSignature(c: ToolCallRow): string {
  return `${c.toolName} ${c.category} ${c.inputJSON}`
}

function commandClass(c: ToolCallRow): string {
  if (c.category !== 'Bash') return `${c.category}:${c.toolName}`
  const fields = commandText(c.inputJSON).trim().split(/\s+/)
  if (fields.length === 0 || !fields[0]) return `${c.category}:${c.toolName}`
  return `${c.category}:${fields[0]}`
}

function hasRepeatedFailingExactToolRun(calls: ToolCallRow[], threshold: number, failureThreshold: number): boolean {
  let run = 1
  let failures = calls.length > 0 && isFailure(calls[0]!) ? 1 : 0
  for (let i = 1; i < calls.length; i += 1) {
    if (toolSignature(calls[i]!) === toolSignature(calls[i - 1]!)) {
      run += 1
      if (isFailure(calls[i]!)) failures += 1
      if (run >= threshold && failures >= failureThreshold) return true
    } else {
      run = 1
      failures = isFailure(calls[i]!) ? 1 : 0
    }
  }
  return false
}

function countWindowFailures(calls: ToolCallRow[]): number {
  let failures = 0
  for (const c of calls) if (isFailure(c)) failures += 1
  return failures
}

function dominantToolSignatureCount(calls: ToolCallRow[]): number {
  const counts = new Map<string, number>()
  let max = 0
  for (const c of calls) {
    const sig = commandClass(c)
    const next = (counts.get(sig) ?? 0) + 1
    counts.set(sig, next)
    if (next > max) max = next
  }
  return max
}

function hasRunawayToolLoop(calls: ToolCallRow[]): boolean {
  if (calls.length < 12) return false
  if (hasRepeatedFailingExactToolRun(calls, 5, 3)) return true
  for (let start = 0; start + 12 <= calls.length; start += 1) {
    const window = calls.slice(start, start + 12)
    if (countWindowFailures(window) >= 6) return true
    if (dominantToolSignatureCount(window) >= 10 && countWindowFailures(window) >= 3) return true
  }
  return false
}

function analyzeHeuristics(msgs: HeuristicMessage[], calls: ToolCallRow[]): HeuristicSignals {
  const prompts = userPrompts(msgs)
  const codeTask = isCodeTask(prompts)
  const s: HeuristicSignals = {
    shortPromptCount: countShortStartPrompts(prompts),
    unstructuredStart: false,
    missingSuccessCriteriaCount: 0,
    missingVerificationCount: 0,
    duplicatePromptCount: 0,
    noCodeContextCount: 0,
    runawayToolLoopCount: 0,
  }
  if (codeTask) {
    const first = firstSubstantivePrompt(prompts)
    if (first) s.unstructuredStart = isUnstructuredStart(first.content)
    if (!hasSuccessCriteria(prompts)) s.missingSuccessCriteriaCount = 1
    if (!hasVerificationLanguage(prompts)) s.missingVerificationCount = 1
    if (!hasPromptContext(prompts) && !hasContextToolActivity(calls)) s.noCodeContextCount = 1
  }
  s.duplicatePromptCount = countDuplicatePrompts(prompts)
  if (hasRunawayToolLoop(calls)) s.runawayToolLoopCount = 1
  return s
}

// ── Outcome classification ──────────────────────────────────────────────────────

function hasGiveUpPattern(text: string): boolean {
  const lower = text.toLowerCase()
  return GIVE_UP_PATTERNS.some((p) => lower.includes(p))
}

type OutcomeInput = {
  isAutomated: boolean
  messageCount: number
  endedWithRole: 'user' | 'assistant' | ''
  finalFailureStreak: number
  lastAssistantText: string
  lastActivityTs: number | null
}

function classifyOutcome(inp: OutcomeInput, now: number): OutcomeResult {
  if (inp.isAutomated) return { outcome: 'unknown', confidence: 'low', isRecent: false }
  if (inp.messageCount === 2 && inp.endedWithRole === 'assistant') {
    return { outcome: 'completed', confidence: 'medium', isRecent: false }
  }
  if (inp.messageCount < 3) return { outcome: 'unknown', confidence: 'low', isRecent: false }

  const recent = inp.lastActivityTs !== null && now - inp.lastActivityTs < RECENCY_WINDOW_MS
  if (recent) return { outcome: 'unknown', confidence: 'low', isRecent: true }

  if (inp.endedWithRole === 'user') {
    return { outcome: 'abandoned', confidence: inp.messageCount >= 10 ? 'high' : 'medium', isRecent: false }
  }
  if (inp.finalFailureStreak >= 3) return { outcome: 'errored', confidence: 'medium', isRecent: false }
  if (inp.endedWithRole === 'assistant') {
    return { outcome: 'completed', confidence: hasGiveUpPattern(inp.lastAssistantText) ? 'low' : 'medium', isRecent: false }
  }
  return { outcome: 'unknown', confidence: 'low', isRecent: false }
}

// ── Penalty model ───────────────────────────────────────────────────────────────

function capPenalty(raw: number, max: number): number {
  return raw > max ? max : raw
}

type ScoreInput = {
  outcome: SessionOutcome
  hasToolCalls: boolean
  failureSignalCount: number
  retryCount: number
  editChurnCount: number
  consecutiveFailMax: number
  hasContextData: boolean
  compactionCount: number
  midTaskCompactionCount: number
  pressureMax: number | null
  heuristics: HeuristicSignals
}

function hasPromptQualitySignals(s: HeuristicSignals): boolean {
  return (
    s.shortPromptCount > 0 ||
    s.unstructuredStart ||
    s.missingSuccessCriteriaCount > 0 ||
    s.missingVerificationCount > 0 ||
    s.duplicatePromptCount > 0
  )
}

function isStuckReask(inp: ScoreInput): boolean {
  if (inp.heuristics.duplicatePromptCount <= 0) return false
  return (
    inp.outcome === 'errored' ||
    inp.outcome === 'abandoned' ||
    inp.failureSignalCount > 0 ||
    inp.retryCount > 0 ||
    inp.consecutiveFailMax >= 3 ||
    inp.heuristics.runawayToolLoopCount > 0
  )
}

function computePenalties(inp: ScoreInput): Record<string, number> {
  const p: Record<string, number> = {}

  // Outcome.
  if (inp.outcome === 'errored') p.outcome_errored = 30
  else if (inp.outcome === 'abandoned') p.outcome_abandoned = 15

  // Tool health.
  const failure = capPenalty(inp.failureSignalCount * 3, 30)
  if (failure > 0) p.tool_failure_signals = failure
  const retries = capPenalty(inp.retryCount * 5, 25)
  if (retries > 0) p.tool_retries = retries
  const churn = capPenalty(inp.editChurnCount * 4, 20)
  if (churn > 0) p.edit_churn = churn
  if (inp.consecutiveFailMax >= 3) p.consecutive_failures = 10

  // Context.
  if (inp.compactionCount >= 2) {
    const extra = capPenalty((inp.compactionCount - 1) * 5, 15)
    if (extra > 0) p.compactions = extra
  }
  if (inp.midTaskCompactionCount > 0) {
    const mid = capPenalty(inp.midTaskCompactionCount * 8, 18)
    if (mid > 0) p.mid_task_compactions = mid
  }
  if (inp.pressureMax !== null && inp.pressureMax > 0.9) p.context_pressure_high = 10

  // Prompt/workflow heuristics (small, capped).
  const s = inp.heuristics
  if (s.unstructuredStart) p.constraintless_first_prompt = 1
  if (s.missingSuccessCriteriaCount > 0 && s.unstructuredStart) p.missing_success_criteria = 1
  if (isStuckReask(inp)) {
    const stuck = capPenalty(s.duplicatePromptCount * 2, 4)
    if (stuck > 0) p.stuck_repeated_prompts = stuck
  }
  if (s.noCodeContextCount > 0) p.code_task_without_context = 4
  const runaway = capPenalty(s.runawayToolLoopCount * 5, 5)
  if (runaway > 0) p.repeated_failing_tool_cycles = runaway

  return p
}

function gradeFromScore(score: number): HealthGrade {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 60) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

function buildBasis(inp: ScoreInput): string[] {
  const basis: string[] = []
  if (inp.outcome !== 'unknown') basis.push('outcome')
  if (inp.hasToolCalls) basis.push('tool_health')
  if (inp.hasContextData) basis.push('context')
  if (hasPromptQualitySignals(inp.heuristics)) basis.push('prompt_quality')
  return basis
}

function canScore(inp: ScoreInput, basis: string[]): boolean {
  // Need at least one real signal family beyond a bare "unknown" outcome.
  if (basis.length === 0) return false
  if (basis.length === 1 && basis[0] === 'outcome' && inp.outcome === 'unknown') return false
  return true
}

// ── Archetype ───────────────────────────────────────────────────────────────────

function sessionShapeLabel(userMsgs: number): SessionArchetype {
  if (userMsgs <= 5) return 'quick'
  if (userMsgs <= 15) return 'standard'
  if (userMsgs <= 50) return 'deep'
  return 'marathon'
}

export function computeArchetype(userMessages: number, isAutomated: boolean): SessionArchetype {
  if (isAutomated) return 'automation'
  return sessionShapeLabel(userMessages)
}

// ── Public entry point ──────────────────────────────────────────────────────────

/**
 * Compute a deterministic health report for a session. Returns a null score
 * when there is insufficient signal (very short or still-active sessions).
 *
 * `now` defaults to the current time and only affects the "still active"
 * recency gate; pass an explicit value for deterministic tests.
 */
export function computeHealthReport(input: AnalyticsInput | null, now: number = Date.now()): HealthReport {
  const empty: HealthReport = {
    score: null,
    grade: '',
    basis: [],
    penalties: {},
    outcome: { outcome: 'unknown', confidence: 'low', isRecent: false },
    archetype: 'quick',
  }
  if (!input) return empty

  const threaded = input.threadedMessages ?? []
  const model = input.info?.currentModel ?? ''
  // We have no first-class automation flag; treat sessions with no user
  // messages as automation so they are excluded from quality scoring.
  const userMessages = threaded.filter((m) => m.role === 'user').length
  const isAutomated = userMessages === 0 && threaded.length > 0

  const calls = extractToolCalls(threaded)
  const heuristicMsgs = extractHeuristicMessages(threaded)
  const toolHealth = computeToolHealth(calls)
  const pressure = computeContextPressure(threaded, model)
  const midTask = countMidTaskCompactions(pressure.boundaryOrdinals, calls)
  const heuristics = analyzeHeuristics(heuristicMsgs, calls)

  // Outcome inputs.
  let endedWithRole: 'user' | 'assistant' | '' = ''
  let lastAssistantText = ''
  let lastActivityTs: number | null = null
  for (const m of threaded) {
    if (m.role === 'user' || m.role === 'assistant') endedWithRole = m.role
    if (m.role === 'assistant') lastAssistantText = messageText(m)
    const ts = m.timestamp ? Date.parse(m.timestamp) : NaN
    if (Number.isFinite(ts)) lastActivityTs = ts
  }

  const outcome = classifyOutcome(
    {
      isAutomated,
      messageCount: threaded.length,
      endedWithRole,
      finalFailureStreak: toolHealth.finalFailureStreak,
      lastAssistantText,
      lastActivityTs,
    },
    now,
  )

  const archetype = computeArchetype(userMessages, isAutomated)

  const scoreInput: ScoreInput = {
    outcome: outcome.outcome,
    hasToolCalls: calls.length > 0,
    failureSignalCount: toolHealth.failureSignalCount,
    retryCount: toolHealth.retryCount,
    editChurnCount: toolHealth.editChurnCount,
    consecutiveFailMax: toolHealth.consecutiveFailureMax,
    hasContextData: pressure.compactionCount > 0 || pressure.pressureMax !== null,
    compactionCount: pressure.compactionCount,
    midTaskCompactionCount: midTask,
    pressureMax: pressure.pressureMax,
    heuristics,
  }

  const basis = buildBasis(scoreInput)
  if (!canScore(scoreInput, basis)) {
    return { score: null, grade: '', basis, penalties: {}, outcome, archetype }
  }

  const penalties = computePenalties(scoreInput)
  let score = 100
  for (const v of Object.values(penalties)) score -= v
  if (score < 0) score = 0

  return { score, grade: gradeFromScore(score), basis, penalties, outcome, archetype }
}

// ── Display helpers ─────────────────────────────────────────────────────────────

const PENALTY_LABELS: Record<string, string> = {
  outcome_errored: 'Session ended in an error state',
  outcome_abandoned: 'Session looks abandoned (ended on a user turn)',
  tool_failure_signals: 'Tool calls failed',
  tool_retries: 'Identical tool calls retried',
  edit_churn: 'Repeated edits to the same file',
  consecutive_failures: 'Long run of consecutive tool failures',
  compactions: 'Multiple context compactions',
  mid_task_compactions: 'Compaction interrupted active work',
  context_pressure_high: 'Context window near its limit',
  constraintless_first_prompt: 'Opening prompt lacked structure or constraints',
  missing_success_criteria: 'No success criteria stated',
  stuck_repeated_prompts: 'Same prompt repeated while stuck',
  code_task_without_context: 'Code task started without file context',
  repeated_failing_tool_cycles: 'Repeated failing tool cycles',
}

export function penaltyLabel(key: string): string {
  return PENALTY_LABELS[key] ?? key
}

export function archetypeLabel(a: SessionArchetype): string {
  switch (a) {
    case 'automation':
      return 'Automation'
    case 'quick':
      return 'Quick'
    case 'standard':
      return 'Standard'
    case 'deep':
      return 'Deep'
    case 'marathon':
      return 'Marathon'
  }
}
