// Opt-in AI coaching insights — privacy-preserving by construction.
//
// Ported from agentsview's `internal/insight` canned-template approach: we send
// ONLY a deterministic aggregate of the session (counts, costs, health
// penalties) to the coaching model — never raw transcript text, file contents,
// or prompts. The model fills fixed templates and may not recompute the
// canonical health score.
//
// This module is pure (no SDK, no network) so it is safe to import anywhere and
// to unit-test. The actual model call lives in the insights API route.

import type { Analytics } from './analytics'
import { fmtCost } from './analytics'
import type { HealthReport } from './healthScore'
import { archetypeLabel, penaltyLabel } from './healthScore'

export type CoachKind =
  | 'prompt_maturity'
  | 'context_setup'
  | 'workflow_hygiene'
  | 'tool_reliability'
  | 'cost_hygiene'

type CoachTemplate = { kind: CoachKind; title: string; focus: string }

// Faithful to agentsview's canned templates (canned.go).
export const COACH_TEMPLATES: CoachTemplate[] = [
  {
    kind: 'prompt_maturity',
    title: 'Prompt Maturity Review',
    focus:
      'Review prompt maturity using only the supplied deterministic aggregates and health penalties. ' +
      'Focus on missing constraints, unstructured starts, repeated/stuck prompts, success criteria, and verification gaps.',
  },
  {
    kind: 'context_setup',
    title: 'Context Setup Review',
    focus:
      'Review context setup using only the supplied deterministic aggregates. ' +
      'Focus on compactions, mid-task context loss, context pressure, and whether code tasks started with file context.',
  },
  {
    kind: 'workflow_hygiene',
    title: 'Workflow Hygiene Review',
    focus:
      'Review workflow hygiene using only the supplied deterministic aggregates. ' +
      'Focus on the session outcome, abandonment, retries, repeated work, and sessions that likely needed tighter loops.',
  },
  {
    kind: 'tool_reliability',
    title: 'Tool Reliability Review',
    focus:
      'Diagnose tool reliability using only the supplied deterministic aggregates. ' +
      'Focus on failure signals, retries, edit churn, and likely process or environment causes.',
  },
  {
    kind: 'cost_hygiene',
    title: 'Model and Cost Hygiene Review',
    focus:
      'Review model and cost hygiene using only the supplied deterministic aggregates. ' +
      'Focus on token mix, cache behavior, expensive turns, and cost controls.',
  },
]

/**
 * Deterministic, transcript-free aggregate of a session. This is the entire
 * payload sent to the coaching model — keep it free of any free-text content.
 */
export type CoachAggregate = {
  session: {
    provider: string
    model: string
    archetype: string
    messages: number
    userMessages: number
    assistantMessages: number
    turns: number
    durationLabel: string
  }
  health: {
    score: number | null
    grade: string
    outcome: string
    penalties: Array<{ signal: string; label: string; points: number }>
  }
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
    cacheHitRatePct: number
  }
  cost: {
    totalUsd: string
    perTurnUsd: string
  }
  tools: {
    uses: number
    errors: number
    errorRatePct: number
    perTurn: number
    top: Array<{ name: string; count: number; errors: number }>
  }
  files: {
    touched: number
    reads: number
    edits: number
    writes: number
    linesAdded: number
    linesRemoved: number
  }
  pace: {
    medianFirstResponseMs: number | null
    idleMs: number
    activeMs: number
    thinkingBlocks: number
  }
}

export function buildCoachAggregate(a: Analytics, health: HealthReport): CoachAggregate {
  return {
    session: {
      provider: a.provider ?? 'unknown',
      model: a.model,
      archetype: archetypeLabel(health.archetype),
      messages: a.messages,
      userMessages: a.userMessages,
      assistantMessages: a.assistantMessages,
      turns: a.turns,
      durationLabel: a.durationMs ? `${Math.round(a.durationMs / 60_000)}m` : 'unknown',
    },
    health: {
      score: health.score,
      grade: health.grade || 'not scored',
      outcome: health.outcome.outcome,
      penalties: Object.entries(health.penalties)
        .sort((x, y) => y[1] - x[1])
        .map(([signal, points]) => ({ signal, label: penaltyLabel(signal), points })),
    },
    tokens: {
      input: a.inputTokens,
      output: a.outputTokens,
      cacheRead: a.cacheReadTokens,
      cacheWrite: a.cacheWriteTokens,
      total: a.totalTokens,
      cacheHitRatePct: Math.round(a.cacheHitRate * 100),
    },
    cost: {
      totalUsd: fmtCost(a.cost),
      perTurnUsd: fmtCost(a.costPerTurn),
    },
    tools: {
      uses: a.toolUses,
      errors: a.toolErrors,
      errorRatePct: Math.round(a.errorRate * 100),
      perTurn: Number(a.toolsPerTurn.toFixed(1)),
      top: a.tools.slice(0, 8).map((t) => ({ name: t.name, count: t.count, errors: t.errors })),
    },
    files: {
      touched: a.ops.filesTouched.size,
      reads: a.ops.reads,
      edits: a.ops.edits + a.ops.multiEdits,
      writes: a.ops.writes,
      linesAdded: a.ops.linesAdded,
      linesRemoved: a.ops.linesRemoved,
    },
    pace: {
      medianFirstResponseMs: a.medianFirstResponseMs,
      idleMs: a.idleMs,
      activeMs: a.activeMs,
      thinkingBlocks: a.thinkingBlocks,
    },
  }
}

/**
 * Build the single combined prompt. The model returns a JSON array with one
 * object per requested template. We deliberately forbid transcript inspection
 * and score recomputation, mirroring agentsview's canned-prompt guardrails.
 */
export function buildCoachPrompt(aggregate: CoachAggregate, templates: CoachTemplate[] = COACH_TEMPLATES): string {
  const lines: string[] = []
  lines.push('You are generating opt-in coaching recommendations for a single AI coding-agent session.')
  lines.push('Use ONLY the deterministic aggregate JSON supplied below.')
  lines.push('You have NO access to the raw transcript, prompts, file contents, or code. Do not invent or infer specifics you cannot derive from the aggregate.')
  lines.push('Do not recalculate, override, or dispute the supplied health score, grade, or penalties — treat them as ground truth.')
  lines.push('Be concrete and actionable. If the data for a template looks healthy, say so briefly rather than inventing problems.')
  lines.push('')
  lines.push('Produce a JSON array. Each element MUST be an object of the form:')
  lines.push('{ "kind": <template kind>, "summary": <1-2 sentence plain-text assessment>, "recommendations": [<0-4 short imperative suggestions>] }')
  lines.push('Output JSON ONLY — no prose, no markdown fences, no commentary outside the JSON.')
  lines.push('')
  lines.push('Templates to fill (one array element each):')
  for (const t of templates) {
    lines.push(`- kind="${t.kind}" (${t.title}): ${t.focus}`)
  }
  lines.push('')
  lines.push('Aggregate JSON:')
  lines.push(JSON.stringify(aggregate, null, 2))
  return lines.join('\n')
}

export type CoachInsight = {
  kind: CoachKind
  title: string
  summary: string
  recommendations: string[]
}

const KIND_TITLES: Record<CoachKind, string> = Object.fromEntries(
  COACH_TEMPLATES.map((t) => [t.kind, t.title]),
) as Record<CoachKind, string>

const VALID_KINDS = new Set<string>(COACH_TEMPLATES.map((t) => t.kind))

/** Extract the JSON array from a model response that may include stray text. */
function extractJsonArray(raw: string): unknown {
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // Fall back to slicing the outermost array.
    const start = trimmed.indexOf('[')
    const end = trimmed.lastIndexOf(']')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

export function parseCoachInsights(raw: string): CoachInsight[] {
  const parsed = extractJsonArray(raw)
  if (!Array.isArray(parsed)) return []
  const out: CoachInsight[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const kind = typeof obj.kind === 'string' ? obj.kind : ''
    if (!VALID_KINDS.has(kind)) continue
    const summary = typeof obj.summary === 'string' ? obj.summary.trim() : ''
    if (!summary) continue
    const recommendations = Array.isArray(obj.recommendations)
      ? obj.recommendations.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).map((r) => r.trim()).slice(0, 4)
      : []
    out.push({ kind: kind as CoachKind, title: KIND_TITLES[kind as CoachKind], summary, recommendations })
  }
  return out
}
