import type { SystemMessagePayload, ToolResultBlock } from './types'

export type ClaudeReadFileKind = 'text' | 'image' | 'notebook' | 'pdf' | 'parts' | 'file_unchanged' | 'unknown'

export type ClaudeReadFileSummary = {
  kind: ClaudeReadFileKind
  filePath?: string
  content: string
  numLines?: number
  startLine?: number
  totalLines?: number
  originalSize?: number
  mimeType?: string
  dimensions?: { originalWidth?: number; originalHeight?: number; displayWidth?: number; displayHeight?: number }
  cellCount?: number
  pageCount?: number
  outputDir?: string
  truncatedByTokenCap: boolean
  structured: boolean
}

export type ClaudeBackgroundTaskSummary = {
  id: string
  type: string
  status: string
  description: string
  command?: string
  agent_type?: string
  server?: string
  tool?: string
  name?: string
}

export type ClaudeSessionCronSummary = {
  id: string
  schedule: string
  recurring: boolean
  prompt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function lineCount(value: string): number {
  if (!value) return 0
  const lines = value.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') return lines.length - 1
  return lines.length
}

function formatBytes(value: number | undefined): string | null {
  if (value == null || value < 0) return null
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function readMetadataLine(summary: ClaudeReadFileSummary): string {
  const name = summary.filePath ?? 'file'
  switch (summary.kind) {
    case 'image': {
      const dimensions = summary.dimensions
      const width = dimensions?.displayWidth ?? dimensions?.originalWidth
      const height = dimensions?.displayHeight ?? dimensions?.originalHeight
      return [
        `image: ${name}`,
        summary.mimeType,
        width && height ? `${width}x${height}` : null,
        formatBytes(summary.originalSize),
      ].filter(Boolean).join(' · ')
    }
    case 'notebook':
      return [`notebook: ${name}`, summary.cellCount != null ? `${summary.cellCount} cells` : null].filter(Boolean).join(' · ')
    case 'pdf':
      return [`pdf: ${name}`, formatBytes(summary.originalSize)].filter(Boolean).join(' · ')
    case 'parts':
      return [
        `pdf pages: ${name}`,
        summary.pageCount != null ? `${summary.pageCount} page${summary.pageCount === 1 ? '' : 's'}` : null,
        summary.outputDir ? `output: ${summary.outputDir}` : null,
        formatBytes(summary.originalSize),
      ].filter(Boolean).join(' · ')
    case 'file_unchanged':
      return `file unchanged: ${name}`
    default:
      return name
  }
}

export function extractClaudeReadFileSummary(
  result: ToolResultBlock | null | undefined,
  fallbackFilePath?: string,
): ClaudeReadFileSummary | null {
  if (!result) return null
  const { content } = result
  if (typeof content === 'string') {
    return {
      kind: 'text',
      filePath: fallbackFilePath,
      content,
      truncatedByTokenCap: false,
      structured: false,
    }
  }
  if (!Array.isArray(content)) return null

  const textParts: string[] = []
  const metadataParts: string[] = []
  let kind: ClaudeReadFileKind = 'text'
  let structured = false
  let filePath = fallbackFilePath
  let numLines: number | undefined
  let startLine: number | undefined
  let totalLines: number | undefined
  let originalSize: number | undefined
  let mimeType: string | undefined
  let dimensions: ClaudeReadFileSummary['dimensions']
  let cellCount: number | undefined
  let pageCount: number | undefined
  let outputDir: string | undefined
  let truncatedByTokenCap = false

  for (const block of content) {
    if (!isRecord(block) || typeof block.type !== 'string') continue
    const record = block as Record<string, unknown>

    const file = isRecord(record.file) ? record.file : null
    if (file) {
      structured = true
      filePath = stringValue(file.filePath) ?? filePath
      originalSize = numberValue(file.originalSize) ?? originalSize
    }

    if (record.type === 'text') {
      const fileContent = file ? stringValue(file.content) : undefined
      if (file && fileContent !== undefined) {
        kind = 'text'
        textParts.push(fileContent)
        numLines = numberValue(file.numLines) ?? numLines
        startLine = numberValue(file.startLine) ?? startLine
        totalLines = numberValue(file.totalLines) ?? totalLines
        truncatedByTokenCap = booleanValue(file.truncatedByTokenCap) ?? truncatedByTokenCap
        continue
      }

      const text = stringValue(record.text)
      if (text !== undefined) textParts.push(text)
      continue
    }

    if (record.type === 'image') {
      kind = 'image'
      mimeType = file ? stringValue(file.type) ?? mimeType : mimeType
      dimensions = file && isRecord(file.dimensions) ? {
        originalWidth: numberValue(file.dimensions.originalWidth),
        originalHeight: numberValue(file.dimensions.originalHeight),
        displayWidth: numberValue(file.dimensions.displayWidth),
        displayHeight: numberValue(file.dimensions.displayHeight),
      } : dimensions
    } else if (record.type === 'notebook') {
      kind = 'notebook'
      const cells = file && Array.isArray(file.cells) ? file.cells : null
      cellCount = cells ? cells.length : cellCount
    } else if (record.type === 'pdf') {
      kind = 'pdf'
    } else if (record.type === 'parts') {
      kind = 'parts'
      pageCount = file ? numberValue(file.count) ?? pageCount : pageCount
      outputDir = file ? stringValue(file.outputDir) ?? outputDir : outputDir
    } else if (record.type === 'file_unchanged') {
      kind = 'file_unchanged'
    } else {
      kind = kind === 'text' ? 'unknown' : kind
    }
  }

  if (textParts.length === 0 && structured) {
    const metadataSummary: ClaudeReadFileSummary = {
      kind,
      filePath,
      content: '',
      originalSize,
      mimeType,
      dimensions,
      cellCount,
      pageCount,
      outputDir,
      truncatedByTokenCap,
      structured,
    }
    metadataParts.push(readMetadataLine(metadataSummary))
  }

  if (textParts.length === 0 && metadataParts.length === 0) return null

  return {
    kind,
    filePath,
    content: textParts.length > 0 ? textParts.join('\n\n') : metadataParts.join('\n'),
    numLines,
    startLine,
    totalLines,
    originalSize,
    mimeType,
    dimensions,
    cellCount,
    pageCount,
    outputDir,
    truncatedByTokenCap,
    structured,
  }
}

export function formatClaudeReadKind(summary: ClaudeReadFileSummary): string | null {
  if (!summary.structured || summary.kind === 'text') return null
  switch (summary.kind) {
    case 'image': return 'image'
    case 'notebook': return 'notebook'
    case 'pdf': return 'pdf'
    case 'parts': return summary.pageCount != null ? `${summary.pageCount} pages` : 'pdf pages'
    case 'file_unchanged': return 'unchanged'
    default: return 'structured'
  }
}

export function formatClaudeReadMetadata(summary: ClaudeReadFileSummary): string[] {
  const lines: string[] = []
  const range = formatClaudeReadRange(summary)
  if (range) lines.push(range)
  const kind = formatClaudeReadKind(summary)
  if (kind) lines.push(kind)
  const size = formatBytes(summary.originalSize)
  if (size) lines.push(size)
  if (summary.outputDir) lines.push(`output ${summary.outputDir}`)
  if (summary.truncatedByTokenCap) lines.push('token cap')
  return lines
}

export function formatClaudeReadRange(summary: ClaudeReadFileSummary): string | null {
  if (summary.startLine == null) return null
  const count = summary.numLines ?? lineCount(summary.content)
  if (count <= 0) return null
  const endLine = summary.startLine + count - 1
  if (summary.totalLines != null) {
    return `lines ${summary.startLine}-${endLine} of ${summary.totalLines}`
  }
  return `lines ${summary.startLine}-${endLine}`
}

function getClaudeBackgroundTasks(payload: SystemMessagePayload): ClaudeBackgroundTaskSummary[] {
  const raw = payload.background_tasks
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => {
      if (!isRecord(entry)) return []
      const id = stringValue(entry.id)
      const type = stringValue(entry.type)
      const status = stringValue(entry.status)
      const description = stringValue(entry.description)
      if (!id || !type || !status || !description) return []
      return [{
        id,
        type,
        status,
        description,
        command: stringValue(entry.command),
        agent_type: stringValue(entry.agent_type),
        server: stringValue(entry.server),
        tool: stringValue(entry.tool),
        name: stringValue(entry.name),
      }]
    })
  }

  // `background_tasks_changed` (SDK 0.3.203+) is a level signal: `tasks` is the
  // full live set (task_id/task_type/description only, no per-task status), sent
  // whenever membership changes. Treat every listed non-ambient task as
  // currently running; SDK 0.3.247+ marks housekeeping that should not keep the
  // user-facing activity indicator busy.
  if (payload.subtype === 'background_tasks_changed' && Array.isArray(payload.tasks)) {
    return payload.tasks.flatMap((entry) => {
      if (!isRecord(entry)) return []
      if (entry.ambient === true) return []
      const id = stringValue(entry.task_id)
      const type = stringValue(entry.task_type)
      const description = stringValue(entry.description)
      if (!id || !type || !description) return []
      return [{ id, type, status: 'running', description }]
    })
  }

  return []
}

function getClaudeSessionCrons(payload: SystemMessagePayload): ClaudeSessionCronSummary[] {
  const raw = payload.session_crons
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const id = stringValue(entry.id)
    const schedule = stringValue(entry.schedule)
    const recurring = booleanValue(entry.recurring)
    const prompt = stringValue(entry.prompt)
    if (!id || !schedule || recurring == null || !prompt) return []
    return [{ id, schedule, recurring, prompt }]
  })
}

export function formatClaudeRuntimeCounts(payload: SystemMessagePayload): string[] {
  const tasks = getClaudeBackgroundTasks(payload)
  const crons = getClaudeSessionCrons(payload)
  const parts: string[] = []
  if (tasks.length > 0) parts.push(`${tasks.length} background task${tasks.length === 1 ? '' : 's'}`)
  if (crons.length > 0) parts.push(`${crons.length} scheduled wakeup${crons.length === 1 ? '' : 's'}`)
  return parts
}

function formatClaudeBackgroundTaskSummary(task: ClaudeBackgroundTaskSummary, index?: number): string {
  const prefix = index == null ? '' : `${index + 1}. `
  const serverTool = [task.server, task.tool].filter(Boolean).join('/')
  const detail = task.command ?? task.agent_type ?? (serverTool || task.name) ?? ''
  const label = [task.type, task.status].filter(Boolean).join(' ')
  const suffix = detail ? ` - ${detail}` : ''
  return `${prefix}${label}: ${task.description}${suffix}`
}

function formatClaudeSessionCronSummary(cron: ClaudeSessionCronSummary, index?: number): string {
  const prefix = index == null ? '' : `${index + 1}. `
  const mode = cron.recurring ? 'recurring' : 'one-shot'
  return `${prefix}${mode} ${cron.schedule}: ${cron.prompt}`
}

export function formatClaudeRuntimeDetailLines(payload: SystemMessagePayload): string[] {
  const tasks = getClaudeBackgroundTasks(payload)
  const crons = getClaudeSessionCrons(payload)
  const lines: string[] = []

  if (tasks.length > 0) {
    lines.push('Background tasks:')
    for (const [index, task] of tasks.entries()) {
      lines.push(`- ${formatClaudeBackgroundTaskSummary(task, index)}`)
    }
  }

  if (crons.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('Scheduled wakeups:')
    for (const [index, cron] of crons.entries()) {
      lines.push(`- ${formatClaudeSessionCronSummary(cron, index)}`)
    }
  }

  return lines
}
