import type { ThreadedBlock, ToolThread } from '../../lib/threading'
import { readableContextText } from '../../lib/composerContext'
import { pathBasename } from '../../lib/projectPaths'
import { detectTuiCodeFiletypeFromPath, normalizeTuiCodeFiletype } from '../codeFiletypes'
import type { TuiTranscriptCardLine, TuiTranscriptCodeBlock } from './types'
import { line, sanitizeLine, ANSI_ESCAPE_PATTERN, CODE_FENCE_RE } from './text'
import { normalizeToolThreadForTui, mcpToolIdForThread, readSummaryOf, resultRawTextOf } from './tools'
import { textLinesForProtocolAwareBlock } from './protocol'
import { MERMAID_LANGS, renderMermaidForTui } from './mermaid'

/** The caller supplies tool/block presentation without exposing card assembly. */
export type ExpandedBlockFormatter = (block: ThreadedBlock) => TuiTranscriptCardLine[]

export function extractMarkdownContent(blocks: ThreadedBlock[]): string | undefined {
  // The markdown renderer shows this string in place of a card's lines, and it
  // is built from the text blocks alone. A coordinated turn's mail lives in its
  // own blocks, so handing over the prompt's markdown would drop the mail.
  if (blocks.some((block) => block.type === 'coordinator_mail' || block.type === 'coordinator_brief')) return undefined
  const chunks: string[] = []
  for (const block of blocks) {
    if (block.type === 'text' && block.text.trim()) {
      chunks.push(readableContextText(block.text).trim())
    }
  }
  return chunks.length > 0 ? chunks.join('\n\n') : undefined
}

function displayLanguageFromPath(filePath?: string): string {
  if (!filePath) return 'text'
  const name = pathBasename(filePath)
  const dot = name.lastIndexOf('.')
  if (dot === -1) return 'text'
  return name.slice(dot + 1).toLowerCase() || 'text'
}

function parseReadResultLines(raw: string): Array<{ num: string; code: string }> {
  const lines = raw.replace(ANSI_ESCAPE_PATTERN, '').replace(/\r/g, '').split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.map((entry) => {
    const tab = entry.indexOf('\t')
    if (tab === -1) return { num: '', code: sanitizeLine(entry).trimEnd() }
    return {
      num: entry.slice(0, tab).trim(),
      code: sanitizeLine(entry.slice(tab + 1)).trimEnd(),
    }
  })
}

function readCodeBlockFromTool(thread: ToolThread, key: string): TuiTranscriptCodeBlock | null {
  if (!thread.result || thread.result.is_error) return null
  const summary = readSummaryOf(thread)
  if (summary && summary.kind !== 'text') return null
  const raw = resultRawTextOf(thread)
  if (!raw) return null
  const input = thread.toolUse.input as { file_path?: string }
  const filePath = summary?.filePath ?? (typeof input.file_path === 'string' ? input.file_path : undefined)
  const parsed = parseReadResultLines(raw)
  const content = parsed.map((entry) => entry.code).join('\n')
  if (!content.trim()) return null
  const lineNumbers = parsed.map((entry) => entry.num)
  const hasLineNumbers = lineNumbers.length > 0 && lineNumbers.every((num) => /^\d+$/.test(num))
  const structuredLineNumbers = summary?.startLine != null
    ? parsed.map((_, index) => String(summary.startLine! + index))
    : undefined
  return {
    key,
    lang: displayLanguageFromPath(filePath),
    filetype: detectTuiCodeFiletypeFromPath(filePath),
    content,
    filePath,
    lineNumbers: structuredLineNumbers ?? (hasLineNumbers ? lineNumbers : undefined),
  }
}

export function extractCodeBlocksFromBlocks(blocks: ThreadedBlock[], formatExpandedBlock: ExpandedBlockFormatter): {
  processedLines: TuiTranscriptCardLine[]
  codeBlocks: TuiTranscriptCodeBlock[]
  hasMermaidDiagrams: boolean
} {
  const all: TuiTranscriptCodeBlock[] = []
  let n = 0
  const lines: TuiTranscriptCardLine[] = []
  let hasMermaidDiagrams = false

  for (const originalBlock of blocks) {
    const block = originalBlock.type === 'tool_thread'
      ? normalizeToolThreadForTui(originalBlock)
      : originalBlock

    if (block.type === 'tool_thread' && block.toolUse.name === 'Read') {
      const readBlock = readCodeBlockFromTool(block, `read${n++}`)
      if (readBlock) all.push(readBlock)
      lines.push(...formatExpandedBlock(block).filter((l) => l.text.trim()))
      continue
    }

    if (block.type === 'tool_thread' && mcpToolIdForThread(block)) {
      const rawLines = formatExpandedBlock(block).filter((l) => l.text.trim())
      const lifted: TuiTranscriptCardLine[] = []
      let i = 0
      while (i < rawLines.length) {
        const cur = rawLines[i]
        const openMatch = cur.text.match(/^```(\S*)/)
        if (openMatch) {
          const lang = (openMatch[1] || 'text').toLowerCase()
          let j = i + 1
          const contentLines: string[] = []
          while (j < rawLines.length && rawLines[j].text.trim() !== '```') {
            contentLines.push(rawLines[j].text)
            j++
          }
          if (j < rawLines.length) {
            const content = contentLines.join('\n')
            all.push({ key: `mcp${n++}`, lang, filetype: normalizeTuiCodeFiletype(lang), content })
            lifted.push(line(`[code: ${lang}]`, 'dim'))
            i = j + 1
            continue
          }
        }
        lifted.push(cur)
        i++
      }
      lines.push(...lifted)
      continue
    }

    if (block.type !== 'text' || !block.text.trim()) {
      lines.push(...formatExpandedBlock(block).filter((l) => l.text.trim()))
      continue
    }
    const protocolLines = textLinesForProtocolAwareBlock(block.text, true)
    if (protocolLines) {
      lines.push(...protocolLines.filter((l) => l.text.trim()))
      continue
    }
    const contextText = readableContextText(block.text)
    const matches = Array.from(contextText.matchAll(CODE_FENCE_RE))
    let replaced = contextText
    for (const match of matches) {
      const lang = ((match[1] ?? '').trim() || 'text').toLowerCase()
      const content = (match[2] ?? '').trimEnd()
      if (MERMAID_LANGS.has(lang)) {
        hasMermaidDiagrams = true
        replaced = replaced.replace(match[0], renderMermaidForTui(content))
      } else {
        all.push({ key: `cb${n++}`, lang, filetype: normalizeTuiCodeFiletype(lang), content })
        replaced = replaced.replace(match[0], `[code: ${lang}]`)
      }
    }
    const processed = sanitizeLine(replaced).trim().split('\n')
      .map((l) => line(l.trimEnd()))
      .filter((l) => l.text.trim().length > 0)
    lines.push(...processed)
  }

  return { processedLines: lines, codeBlocks: all, hasMermaidDiagrams }
}
