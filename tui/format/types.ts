import type { AnsiRun } from '../../lib/ansiOutput'
import type { ThreadedMessage } from '../../lib/threading'
import type { SubagentActivity } from '../../lib/types'
import type { FileEditStat } from '../../lib/turnEditStats'

export type TuiTranscriptLineTone =
  | 'default'
  | 'muted'
  | 'dim'
  | 'tool'
  | 'agent'
  | 'result_ok'
  | 'result_error'
  | 'thinking'
  | 'system'
  | 'diff_add'
  | 'diff_remove'
  | 'diff_meta'

export type TuiTranscriptCardLine = {
  /** A sub-agent record: clicking the row opens that agent's transcript. */
  subagent?: SubagentActivity
  text: string
  tone: TuiTranscriptLineTone
  /** Terminal colours the line's text carried (`text` is the same characters without the escapes). */
  runs?: AnsiRun[]
}

export type TuiTranscriptCardCategory = 'conversation' | 'technical' | 'diff' | 'system' | 'insight'

export type TuiTranscriptCodeBlock = {
  key: string
  lang: string
  filetype?: string
  content: string
  filePath?: string
  lineNumbers?: string[]
  maxVisibleLines?: number
}

export type TuiTranscriptCard = {
  thinkingTranscript?: boolean
  images?: string[]
  asyncQuestions?: import('../../lib/permissions').PendingQuestion[]
  /** The tools this message called, by their real names (at most 12): what a card interaction is about. */
  toolNames?: string[]
  key: string
  role: ThreadedMessage['role']
  provider?: ThreadedMessage['provider']
  label: string
  category: TuiTranscriptCardCategory
  autoFold: boolean
  compactSummary: string
  usageSummary?: string
  /** Elapsed wall-clock ms for this message's turn (see computeTurnDurationsMs), already formatted for display. */
  durationLabel?: string
  timestamp?: string
  timestampMs?: number
  dayKey?: string
  dayLabel?: string
  lines: TuiTranscriptCardLine[]
  expandedLines: TuiTranscriptCardLine[]
  searchText: string
  searchHaystackLower: string
  codeBlocks?: TuiTranscriptCodeBlock[]
  editDiff?: string
  markdownContent?: string
  hasMermaidDiagrams?: boolean
  /** Spawn-chain depth for subagent messages (1 = spawned by main loop). */
  subagentDepth?: number
  /**
   * Why this card's turn is the automatic re-run of a turn a worker restart
   * interrupted (see SessionMessage.resumeReason). Without it the re-run's reply
   * reads as the same turn answered twice.
   */
  resumeReason?: string
  /**
   * A tool on this card has been called but hasn't reported a result yet —
   * true only while a turn streams. Renderers use it to mark the card as
   * still running rather than complete.
   */
  pending?: boolean
  /** Set when the card is nothing but sub-agent records (see mergeSubagentCards). */
  subagents?: SubagentActivity[]
  /** Files this card's tool calls changed, with line counts (see lib/turnEditStats.ts). */
  fileEdits?: FileEditStat[]
  /** Tool calls on this card that reported how long they ran (Bash `duration_ms`). */
  toolTimings?: ToolTiming[]
}

/** The status line of a command that simply worked. Renderers leave it out: the green marker says it. */
export const BASH_OK_LINE = '✓ OK'

export type ToolTiming = { name: string; label: string; durationMs: number }
