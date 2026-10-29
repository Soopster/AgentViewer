import type { ThreadedMessage } from '../../lib/threading'
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
  text: string
  tone: TuiTranscriptLineTone
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
  images?: string[]
  asyncQuestions?: import('../../lib/permissions').PendingQuestion[]
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
  /** Files this card's tool calls changed, with line counts (see lib/turnEditStats.ts). */
  fileEdits?: FileEditStat[]
}
