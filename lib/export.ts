import { marked, Renderer } from 'marked'
import { diffLines } from 'diff'
import type { Session, SessionMessage, ToolResultBlock, ImageBlock } from './types'
import { buildThreadedMessages } from './threading'
import { getAssistantLabel } from './provider'
import { pathBasename } from './projectPaths'
import { getPrimarySessionTag } from './sessionTags'
import type {
  ThreadedBlock,
  ThreadedMessage,
  ToolThread,
  TaskNotificationBlock,
  SystemReminderBlock,
  SlashCommandBlock,
  LocalCommandStdoutBlock,
  ClaudeSystemBlock,
} from './threading'
import type { TextBlock, ThinkingBlock, SystemMessagePayload } from './types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Escape raw HTML blocks instead of passing them through verbatim.
// marked's default behavior lets <script> tags in agent output survive
// into the exported file, enabling stored XSS when the export is opened.
const safeRenderer = new Renderer()
safeRenderer.html = ({ text }: { text: string }) => escapeHtml(text)

function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, renderer: safeRenderer }) as string
  return `<div class="text-block">${html}</div>`
}

const TOOL_COLORS_HEX: Record<string, string> = {
  Bash:         '#eaaa40',
  Edit:         '#2dd4a0',
  MultiEdit:    '#2dd4a0',
  Write:        '#38d9f5',
  Read:         '#60a8ff',
  Grep:         '#ff9048',
  Glob:         '#a885f8',
  Agent:        '#f472b6',
  WebSearch:    '#38d9f5',
  WebFetch:     '#60a8ff',
  NotebookEdit: '#2dd4a0',
}
function toolColorHex(name: string): string {
  return TOOL_COLORS_HEX[name] ?? '#7b8db0'
}

function resultToString(content: string | ToolResultBlock['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(b => {
      if (b.type === 'text') return (b as { type: 'text'; text: string }).text
      return ''
    })
    .join('\n')
}

function truncateLines(text: string, max: number): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length <= max) return text
  return lines.slice(0, max).join('\n') + `\n[… ${lines.length - max} more lines]`
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ts
  }
}

// ── Diff view ─────────────────────────────────────────────────────────────────

function renderDiffView(oldStr: string, newStr: string): string {
  const changes = diffLines(oldStr, newStr)
  const MAX_LINES = 500
  let lineCount = 0
  const rows: string[] = []
  let truncated = false

  outer: for (const change of changes) {
    const lines = change.value.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()

    const isAdd = !!change.added
    const isDel = !!change.removed
    const rowCls  = isAdd ? ' diff-add' : isDel ? ' diff-del' : ''
    const color   = isAdd ? '#2dd4a0'  : isDel ? '#f06060'  : '#3a4c6a'
    const gutter  = isAdd ? 'rgba(45,212,160,0.15)' : isDel ? 'rgba(240,96,96,0.15)' : 'transparent'
    const sign    = isAdd ? '+' : isDel ? '−' : ' '

    for (const line of lines) {
      if (++lineCount > MAX_LINES) { truncated = true; break outer }
      rows.push(
        `<div class="diff-line${rowCls}">` +
        `<span class="diff-gutter" style="color:${color};background:${gutter}">${sign}</span>` +
        `<span class="diff-line-content" style="color:${color}">${escapeHtml(line)}</span>` +
        `</div>`
      )
    }
  }

  if (truncated) {
    rows.push(`<div style="padding:4px 10px;font-size:11px;color:#3a4c6a;font-family:'IBM Plex Mono',monospace">[… diff truncated at ${MAX_LINES} lines]</div>`)
  }

  return `<div class="diff-view">${rows.join('')}</div>`
}

// ── Tool result section ───────────────────────────────────────────────────────

function imageDataUri(block: ImageBlock): string {
  if (block.source?.type === 'base64') {
    return `data:${block.source.media_type};base64,${block.source.data}`
  }
  if (block.file?.base64) {
    return `data:${block.file.type};base64,${block.file.base64}`
  }
  return ''
}

function renderToolResult(result: ToolResultBlock | null, _toolName: string): string {
  if (!result) {
    return `<div class="result-pending">⌛ pending</div>`
  }

  // Check for image content block
  if (Array.isArray(result.content)) {
    const imgBlock = result.content.find(b => b.type === 'image') as ImageBlock | undefined
    if (imgBlock) {
      const uri = imageDataUri(imgBlock)
      if (uri) {
        return `<div class="image-block"><img src="${uri}" alt="" /></div>`
      }
    }
  }

  const raw = resultToString(result.content)
  if (result.is_error) {
    return (
      `<div class="result-err">✗ ERROR</div>` +
      `<pre class="result-pre" style="color:#f06060;max-height:300px;overflow-y:auto">${escapeHtml(truncateLines(raw, 200))}</pre>`
    )
  }

  if (!raw.trim()) {
    return `<div class="result-ok">✓ OK</div>`
  }

  return (
    `<div class="result-ok">✓ OK</div>` +
    `<pre class="result-pre">${escapeHtml(truncateLines(raw, 200))}</pre>`
  )
}

// ── Block renderers ───────────────────────────────────────────────────────────

function renderText(block: TextBlock): string {
  // Detect ★ Insight blocks
  const insightRe = /`★ Insight\s*[─\-]+([\s\S]*?)`[─\-]+`/g
  const insightPlain = /★ Insight\s*[─\-]+\n([\s\S]*?)\n[─\-]+/g
  if (insightRe.test(block.text) || insightPlain.test(block.text)) {
    // Render the whole text normally — markdown will format it; insight styling
    // in the export is just the amber code-fence look which marked preserves
  }
  return renderMarkdown(block.text)
}

function renderThinking(block: ThinkingBlock): string {
  const words = block.thinking.split(/\s+/).length
  return (
    `<div class="thinking-block">` +
    `<div class="thinking-header">` +
    `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8b80f0;font-weight:600;letter-spacing:0.1em;background:rgba(139,128,240,0.10);border:1px solid rgba(139,128,240,0.22);border-radius:3px;padding:1px 5px;flex-shrink:0">THINK</span>` +
    `<span style="flex:1"></span>` +
    `<span style="color:#3a4c6a;font-size:11px;font-family:'IBM Plex Mono',monospace">${words} words</span>` +
    `</div>` +
    `<div class="thinking-body"><p class="thinking-text">${escapeHtml(block.thinking)}</p></div>` +
    `</div>`
  )
}

function renderImageBlock(block: ImageBlock): string {
  const uri = imageDataUri(block)
  if (!uri) return ''
  return `<div class="image-block"><img src="${uri}" alt="" /></div>`
}

// ── Tool card renderers ───────────────────────────────────────────────────────

function cardShell(color: string, header: string, body: string, result: ToolResultBlock | null, toolName: string): string {
  return (
    `<div class="card" style="border-left:2px solid ${color}">` +
    header +
    (body ? `<div class="card-body">${body}</div>` : '') +
    renderToolResult(result, toolName) +
    `</div>`
  )
}

function cardHeader(color: string, label: string, preview: string, extra = ''): string {
  return (
    `<div class="card-header" style="background:linear-gradient(to right,${color}20 0%,#0c1028 55%)">` +
    `<span class="card-label" style="color:${color}">${escapeHtml(label)}</span>` +
    `<span class="card-preview">${escapeHtml(preview)}</span>` +
    (extra ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#3a4c6a;flex-shrink:0">${extra}</span>` : '') +
    `</div>`
  )
}

const basename = pathBasename

function renderEditCard(thread: ToolThread): string {
  const input = thread.toolUse.input as { file_path?: string; old_string?: string; new_string?: string }
  const c = toolColorHex(thread.toolUse.name)
  const filePath = input.file_path ?? ''
  const oldStr   = input.old_string ?? ''
  const newStr   = input.new_string ?? ''
  const delta    = newStr.replace(/\r\n/g, '\n').split('\n').length - oldStr.replace(/\r\n/g, '\n').split('\n').length
  const sign     = delta > 0 ? `+${delta}` : String(delta)

  const header = cardHeader(c, thread.toolUse.name, basename(filePath), `${filePath} · ${sign} lines`)
  const diff   = renderDiffView(oldStr, newStr)
  return (
    `<div class="card" style="border-left:2px solid ${c}">` +
    header + diff +
    renderToolResult(thread.result, thread.toolUse.name) +
    `</div>`
  )
}

function renderWriteCard(thread: ToolThread): string {
  const input = thread.toolUse.input as { file_path?: string; content?: string }
  const c = toolColorHex(thread.toolUse.name)
  const filePath = input.file_path ?? ''
  const content  = input.content ?? ''
  const lines    = content.split('\n')
  const preview  = truncateLines(content, 40)

  const header = cardHeader(c, 'Write', basename(filePath), `${filePath} · ${lines.length} lines`)
  return cardShell(c, header, escapeHtml(preview), thread.result, thread.toolUse.name)
}

function renderBashCard(thread: ToolThread): string {
  const input = thread.toolUse.input as { command?: string; description?: string }
  const c = toolColorHex('Bash')
  const cmd  = input.command ?? ''
  const desc = input.description ?? ''
  const preview = desc || cmd.slice(0, 80)

  const header = cardHeader(c, 'Bash', preview)
  const body   = escapeHtml(truncateLines(cmd, 60))
  return cardShell(c, header, body, thread.result, 'Bash')
}

function renderReadCard(thread: ToolThread): string {
  const input = thread.toolUse.input as { file_path?: string }
  const c = toolColorHex('Read')
  const filePath = input.file_path ?? ''

  const header = cardHeader(c, 'Read', basename(filePath), filePath)

  // Line-numbered result
  let body = ''
  if (thread.result) {
    const raw = resultToString(thread.result.content)
    const lines = raw.split('\n').slice(0, 200)
    const numbered = lines
      .map((line, i) =>
        `<span style="color:#3a4c6a;user-select:none;min-width:36px;display:inline-block;text-align:right;padding-right:12px;border-right:1px solid #1e2a44;margin-right:10px">${i + 1}</span>${escapeHtml(line)}`
      )
      .join('\n')
    const truncNote = raw.split('\n').length > 200 ? `\n[… ${raw.split('\n').length - 200} more lines]` : ''
    body = `<pre class="result-pre" style="background:#07091c;border-top:1px solid #1e2a44">${numbered}${escapeHtml(truncNote)}</pre>`
    return (
      `<div class="card" style="border-left:2px solid ${c}">` +
      header + body +
      `</div>`
    )
  }
  return cardShell(c, header, '', thread.result, 'Read')
}

function renderGrepCard(thread: ToolThread): string {
  const input = thread.toolUse.input as { pattern?: string; path?: string }
  const c = toolColorHex('Grep')
  const preview = input.pattern ?? ''
  const header = cardHeader(c, 'Grep', preview, input.path ?? '')
  return cardShell(c, header, '', thread.result, 'Grep')
}

function renderGlobCard(thread: ToolThread): string {
  const input = thread.toolUse.input as { pattern?: string; path?: string }
  const c = toolColorHex('Glob')
  const preview = input.pattern ?? ''
  const header = cardHeader(c, 'Glob', preview, input.path ?? '')
  return cardShell(c, header, '', thread.result, 'Glob')
}

function renderGenericCard(thread: ToolThread): string {
  const c = toolColorHex(thread.toolUse.name)
  const inputVals = Object.values(thread.toolUse.input ?? {})
  const previewVal = inputVals.find(v => typeof v === 'string') as string | undefined
  const preview = previewVal?.slice(0, 80) ?? ''
  const body = JSON.stringify(thread.toolUse.input, null, 2)

  const header = cardHeader(c, thread.toolUse.name, preview)
  return cardShell(c, header, escapeHtml(truncateLines(body, 60)), thread.result, thread.toolUse.name)
}

function renderToolThread(thread: ToolThread): string {
  switch (thread.toolUse.name) {
    case 'Edit':
    case 'MultiEdit':  return renderEditCard(thread)
    case 'Write':      return renderWriteCard(thread)
    case 'Bash':       return renderBashCard(thread)
    case 'Read':       return renderReadCard(thread)
    case 'Grep':       return renderGrepCard(thread)
    case 'Glob':       return renderGlobCard(thread)
    default:           return renderGenericCard(thread)
  }
}

// ── Special block renderers ───────────────────────────────────────────────────

function renderTaskNotification(block: TaskNotificationBlock): string {
  const { summary, result, usage, status } = block
  const hasResult = result.trim().length > 0
  return (
    `<div class="task-notification">` +
    `<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;background:linear-gradient(to right,rgba(139,128,240,0.14),#0c1028)">` +
    `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8b80f0;font-weight:500;letter-spacing:0.06em;flex-shrink:0">TASK</span>` +
    `<span style="flex:1;color:#dde3f5;font-family:'IBM Plex Sans',sans-serif;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(summary)}</span>` +
    `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#2dd4a0;flex-shrink:0">${escapeHtml(status)}</span>` +
    `</div>` +
    ((usage.totalTokens != null || usage.toolUses != null || usage.durationMs != null) ?
      `<div style="display:flex;gap:16px;padding:3px 12px;border-top:1px solid #1e2a44;background:#0c1028;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#3a4c6a">` +
      (usage.totalTokens != null ? `<span>⬡ ${usage.totalTokens.toLocaleString()} tok</span>` : '') +
      (usage.toolUses    != null ? `<span>⚙ ${usage.toolUses} tools</span>` : '') +
      (usage.durationMs  != null ? `<span>⏱ ${(usage.durationMs / 1000).toFixed(1)}s</span>` : '') +
      `</div>` : '') +
    (hasResult ?
      `<pre style="margin:0;padding:10px 14px;border-top:1px solid #1e2a44;background:#0c1028;color:#7b8db0;font-size:13px;line-height:1.6;white-space:pre-wrap;font-family:'IBM Plex Mono',monospace;max-height:300px;overflow-y:auto">${escapeHtml(truncateLines(result, 100))}</pre>`
      : '') +
    `</div>`
  )
}

function renderSystemReminder(block: SystemReminderBlock): string {
  const firstLine = block.content.split('\n')[0]
  return (
    `<details class="system-reminder">` +
    `<summary style="display:flex;align-items:center;gap:8px;padding:4px 10px;cursor:pointer;list-style:none;background:#0c1028">` +
    `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#3a4c6a;font-weight:500;letter-spacing:0.08em;flex-shrink:0">SYSTEM</span>` +
    `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#3a4c6a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escapeHtml(firstLine)}</span>` +
    `</summary>` +
    `<pre style="margin:0;padding:8px 12px;border-top:1px solid #1e2a44;background:#0c1028;font-family:'IBM Plex Mono',monospace;font-size:12px;line-height:1.6;color:#3a4c6a;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto">${escapeHtml(block.content)}</pre>` +
    `</details>`
  )
}

function renderSlashCommand(block: SlashCommandBlock): string {
  return (
    `<div class="slash-command">` +
    `<div style="display:flex;align-items:center;gap:10px;padding:7px 14px;background:linear-gradient(to right,rgba(56,217,245,0.10),#0c1028)">` +
    `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#38d9f5;font-weight:600;letter-spacing:0.08em;background:rgba(56,217,245,0.10);border:1px solid rgba(56,217,245,0.22);border-radius:3px;padding:1px 6px;flex-shrink:0">CMD</span>` +
    `<span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#38d9f5;font-weight:600;flex-shrink:0">${escapeHtml(block.command)}</span>` +
    (block.args ? `<span style="font-family:'IBM Plex Sans',sans-serif;font-size:13px;color:#7b8db0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(block.args)}</span>` : '') +
    `</div>` +
    `</div>`
  )
}

function renderLocalCommandStdout(block: LocalCommandStdoutBlock): string {
  return (
    `<div class="local-stdout">` +
    `<div style="display:flex;align-items:center;gap:8px;padding:4px 10px;background:#0c1028">` +
    `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#3a4c6a;font-weight:500;letter-spacing:0.08em;flex-shrink:0">STDOUT</span>` +
    `<span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#7b8db0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(block.stdout)}</span>` +
    `</div>` +
    `</div>`
  )
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function renderClaudeSystem(block: ClaudeSystemBlock): string {
  const payload = block.payload as SystemMessagePayload
  const subtype = block.subtype
  const content = typeof payload.content === 'string' ? payload.content : ''
  const tone = payload.level === 'warning'
    ? '#fbbf24'
    : subtype === 'compact_boundary'
    ? '#8b80f0'
    : subtype === 'tool_progress' || subtype === 'tool_use_summary'
    ? '#38d9f5'
    : '#7b8db0'
  const badges = [
    typeof payload.status === 'string' ? payload.status : null,
    typeof payload.task_id === 'string' ? payload.task_id.slice(0, 8) : null,
    typeof payload.tool_use_id === 'string' ? payload.tool_use_id.slice(0, 8) : null,
    typeof payload.tool_name === 'string' ? payload.tool_name : null,
  ].filter((badge): badge is string => Boolean(badge))

  return (
    `<details class="claude-system">` +
    `<summary style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;list-style:none;background:linear-gradient(to right,${tone}18,#0c1028)">` +
    `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:${tone};font-weight:600;letter-spacing:0.08em;flex-shrink:0">SYSTEM</span>` +
    `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:${tone};font-weight:500;letter-spacing:0.04em;flex-shrink:0">${escapeHtml(subtype.replace(/_/g, ' ').toUpperCase())}</span>` +
    `<span style="font-family:'IBM Plex Sans',sans-serif;font-size:13px;color:#dde3f5;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(content || 'Claude system event')}</span>` +
    `${badges.map((badge) => `<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:${tone};background:#151c38;border:1px solid ${tone}33;border-radius:999px;padding:1px 7px;flex-shrink:0">${escapeHtml(badge)}</span>`).join('')}` +
    `</summary>` +
    `<div style="display:grid;gap:10px;padding:10px 12px;border-top:1px solid #1e2a44;background:#0c1028">` +
    (content
      ? `<pre style="margin:0;font-family:'IBM Plex Mono',monospace;font-size:12px;line-height:1.6;color:#7b8db0;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow-y:auto">${escapeHtml(content)}</pre>`
      : '') +
    `<pre style="margin:0;padding:10px 12px;background:#151c38;border:1px solid #1e2a44;border-radius:6px;font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.55;color:#3a4c6a;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow-y:auto">${escapeHtml(safeJson(payload))}</pre>` +
    `</div>` +
    `</details>`
  )
}

function renderBlock(block: ThreadedBlock): string {
  switch (block.type) {
    case 'tool_thread':           return renderToolThread(block as ToolThread)
    case 'text':                  return renderText(block as TextBlock)
    case 'thinking':              return renderThinking(block as ThinkingBlock)
    case 'image':                 return renderImageBlock(block as ImageBlock)
    case 'task_notification':     return renderTaskNotification(block as TaskNotificationBlock)
    case 'system_reminder':       return renderSystemReminder(block as SystemReminderBlock)
    case 'claude_system':         return renderClaudeSystem(block as ClaudeSystemBlock)
    case 'slash_command':         return renderSlashCommand(block as SlashCommandBlock)
    case 'local_command_stdout':  return renderLocalCommandStdout(block as LocalCommandStdoutBlock)
    default:                      return ''
  }
}

function renderMessage(msg: ThreadedMessage): string {
  const dotCls = msg.role === 'assistant'
    ? 'message-dot-claude'
    : msg.role === 'system'
    ? 'message-dot-system'
    : 'message-dot-user'
  const labelCls = msg.role === 'assistant'
    ? 'label-claude'
    : msg.role === 'system'
    ? 'label-system'
    : 'label-user'
  const label = msg.role === 'assistant'
    ? getAssistantLabel(msg.provider)
    : msg.role === 'system'
    ? 'SYSTEM'
    : 'USER'

  const ts = msg.timestamp ? formatTimestamp(msg.timestamp) : ''

  return (
    `<div class="message">` +
    `<div class="message-dot"><div class="message-dot-inner ${dotCls}"></div></div>` +
    `<div class="message-body">` +
    `<div class="message-label">` +
    `<span class="${labelCls}">${label}</span>` +
    (ts ? `<span class="label-time">${ts}</span>` : '') +
    `</div>` +
    `<div class="message-blocks">${msg.blocks.map(renderBlock).join('\n')}</div>` +
    `</div>` +
    `</div>`
  )
}

// ── HTML document shell ───────────────────────────────────────────────────────

function buildHtmlDocument(
  title: string,
  session: Session,
  turnCount: number,
  eventCount: number,
  messagesHtml: string,
): string {
  const cwd = session.cwd ?? ''
  const exportedAt = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — ${escapeHtml(getAssistantLabel(session.provider))} Session</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Oxanium:wght@500;600;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: #07091c;
  background-image:
    radial-gradient(ellipse at 16% 50%, rgba(139,128,240,0.055) 0%, transparent 52%),
    radial-gradient(ellipse at 84% 14%, rgba(56,217,245,0.035) 0%, transparent 44%),
    radial-gradient(circle, rgba(50,70,140,0.13) 1px, transparent 1px);
  background-size: auto, auto, 28px 28px;
  color: #dde3f5;
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

.page-header {
  padding: 0 32px;
  height: 52px;
  border-bottom: 1px solid #1e2a44;
  display: flex;
  align-items: center;
  gap: 14px;
  background: linear-gradient(to right, rgba(139,128,240,0.05) 0%, #0c1028 40%);
  position: sticky;
  top: 0;
  z-index: 10;
}
.header-title {
  font-family: 'Oxanium', monospace;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: #dde3f5;
  text-transform: uppercase;
  flex-shrink: 0;
}
.header-path {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: #3a4c6a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.header-stats {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: #3a4c6a;
  flex-shrink: 0;
}
.header-badge {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: #3a4c6a;
  background: rgba(58,76,106,0.2);
  border: 1px solid rgba(58,76,106,0.3);
  border-radius: 20px;
  padding: 2px 10px;
  flex-shrink: 0;
}

.timeline {
  max-width: 920px;
  margin: 0 auto;
  padding: 32px 32px 80px;
}
.timeline-track {
  position: relative;
}
.timeline-track::before {
  content: '';
  position: absolute;
  left: 9px; top: 10px; bottom: 0; width: 1px;
  background: linear-gradient(to bottom, #2d3f66 0%, #1e2a44 60%, transparent 100%);
  pointer-events: none;
}

.message { display: flex; gap: 18px; margin-bottom: 36px; }
.message-dot { width: 20px; flex-shrink: 0; padding-top: 3px; }
.message-dot-inner { width: 13px; height: 13px; border-radius: 50%; margin: 0 auto; }
.message-dot-claude { background: #8b80f0; box-shadow: 0 0 0 2px #07091c, 0 0 10px 3px rgba(139,128,240,0.18); }
.message-dot-system { background: #fbbf24; box-shadow: 0 0 0 2px #07091c, 0 0 10px 3px rgba(251,191,36,0.16); }
.message-dot-user   { background: #38d9f5; box-shadow: 0 0 0 2px #07091c, 0 0 10px 3px rgba(56,217,245,0.12); }
.message-body { flex: 1; min-width: 0; }
.message-label { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.label-claude { font-family: 'Oxanium', monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; color: #8b80f0; }
.label-system { font-family: 'Oxanium', monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; color: #fbbf24; }
.label-user   { font-family: 'Oxanium', monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; color: #38d9f5; }
.label-time   { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #3a4c6a; }
.message-blocks { display: flex; flex-direction: column; gap: 8px; }

.card { border: 1px solid #1e2a44; border-radius: 6px; overflow: hidden; font-size: 13px; margin-top: 4px; }
.card-header { display: flex; align-items: center; gap: 8px; padding: 8px 14px; }
.card-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 500; letter-spacing: 0.06em; flex-shrink: 0; }
.card-preview { font-family: 'IBM Plex Mono', monospace; color: #7b8db0; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.card-body {
  padding: 10px 14px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
  color: #7b8db0;
  background: #0c1028;
  overflow-x: auto;
  white-space: pre;
  line-height: 1.6;
  border-top: 1px solid #1e2a44;
  max-height: 300px;
  overflow-y: auto;
}

.result-ok      { padding: 3px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 500; letter-spacing: 0.06em; color: #2dd4a0; background: rgba(45,212,160,0.05); border-top: 1px solid #1e2a44; }
.result-err     { padding: 3px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 500; letter-spacing: 0.06em; color: #f06060; background: rgba(240,96,96,0.06); border-top: 1px solid rgba(240,96,96,0.25); }
.result-pending { padding: 3px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #3a4c6a; border-top: 1px solid #1e2a44; }
.result-pre {
  padding: 8px 14px;
  margin: 0;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
  color: #7b8db0;
  background: #0c1028;
  overflow-x: auto;
  white-space: pre;
  line-height: 1.6;
  max-height: 400px;
  overflow-y: auto;
}

.diff-view { font-family: 'IBM Plex Mono', monospace; font-size: 13px; line-height: 1.6; overflow-x: auto; background: #0c1028; border-top: 1px solid #1e2a44; }
.diff-line { display: flex; }
.diff-add  { background: rgba(45,212,160,0.07); }
.diff-del  { background: rgba(240,96,96,0.07); }
.diff-gutter { width: 26px; flex-shrink: 0; text-align: center; font-size: 11px; line-height: 1.55em; border-right: 1px solid #1e2a44; user-select: none; }
.diff-line-content { padding: 0 10px; white-space: pre; }

.thinking-block { border: 1px solid rgba(139,128,240,0.2); border-left: 2px solid #8b80f0; border-radius: 6px; overflow: hidden; font-size: 13px; margin-top: 4px; }
.thinking-header { display: flex; align-items: flex-start; gap: 8px; padding: 7px 12px; background: linear-gradient(to right, rgba(139,128,240,0.18), transparent); }
.thinking-body { padding: 12px 14px; background: linear-gradient(180deg, rgba(139,128,240,0.04) 0%, #0c1028 40px); border-top: 1px solid rgba(139,128,240,0.15); }
.thinking-text { font-family: 'IBM Plex Sans', sans-serif; font-size: 14px; color: rgba(180,170,255,0.75); line-height: 1.75; font-style: italic; white-space: pre-wrap; margin: 0; }

.image-block { background: #07091c; padding: 12px; border-top: 1px solid #1e2a44; }
.image-block img { max-width: 100%; max-height: 480px; display: block; border-radius: 4px; border: 1px solid #1e2a44; }

.text-block { font-size: 15px; word-break: break-word; line-height: 1.75; }
.text-block p  { margin: 0 0 12px; line-height: 1.75; color: #dde3f5; }
.text-block h1 { margin: 20px 0 10px; font-size: 19px; font-weight: 700; font-family: 'Oxanium', monospace; letter-spacing: 0.04em; color: #dde3f5; border-bottom: 1px solid #1e2a44; padding-bottom: 6px; }
.text-block h2 { margin: 16px 0 8px; font-size: 17px; font-weight: 600; font-family: 'Oxanium', monospace; color: #dde3f5; }
.text-block h3 { margin: 12px 0 6px; font-size: 15px; font-weight: 600; color: #dde3f5; }
.text-block strong { font-weight: 600; color: #dde3f5; }
.text-block em { font-style: italic; color: #7b8db0; }
.text-block a { color: #8b80f0; text-decoration: underline; }
.text-block blockquote { margin: 10px 0; padding-left: 14px; border-left: 2px solid #2d3f66; color: #7b8db0; }
.text-block ul, .text-block ol { margin: 6px 0 12px; padding-left: 22px; color: #dde3f5; }
.text-block li { margin-bottom: 4px; line-height: 1.7; }
.text-block hr { border: none; border-top: 1px solid #1e2a44; margin: 16px 0; }
.text-block table { border-collapse: collapse; font-size: 14px; color: #dde3f5; width: 100%; margin-bottom: 12px; }
.text-block th { padding: 6px 14px; border-bottom: 1px solid #2d3f66; text-align: left; font-weight: 600; color: #7b8db0; font-family: 'IBM Plex Mono', monospace; font-size: 13px; }
.text-block td { padding: 6px 14px; border-bottom: 1px solid #1e2a44; }
.text-block code { font-family: 'IBM Plex Mono', monospace; font-size: 13px; background: #151c38; color: #8b80f0; padding: 2px 6px; border-radius: 3px; }
.text-block pre { margin: 10px 0; border-radius: 6px; overflow: hidden; border: 1px solid #1e2a44; }
.text-block pre code { display: block; padding: 12px 16px; background: #0c1028; color: #dde3f5; font-size: 13px; line-height: 1.65; overflow-x: auto; border-radius: 0; }

.task-notification { border: 1px solid #1e2a44; border-left: 2px solid #8b80f0; border-radius: 6px; overflow: hidden; font-size: 13px; margin-top: 4px; }
.claude-system { border: 1px solid #1e2a44; border-left: 2px solid #7b8db0; border-radius: 6px; overflow: hidden; font-size: 13px; margin-top: 4px; }
.claude-system summary::-webkit-details-marker { display: none; }
.system-reminder { border: 1px solid #1e2a44; border-left: 2px solid #3a4c6a; border-radius: 6px; overflow: hidden; font-size: 13px; margin-top: 4px; opacity: 0.7; }
.system-reminder summary::-webkit-details-marker { display: none; }
.slash-command { border: 1px solid #1e2a44; border-left: 2px solid #38d9f5; border-radius: 6px; overflow: hidden; font-size: 13px; margin-top: 4px; }
.local-stdout  { border: 1px solid #1e2a44; border-left: 2px solid #3a4c6a; border-radius: 6px; overflow: hidden; font-size: 13px; margin-top: 4px; opacity: 0.85; }

::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #2d3f66; border-radius: 2px; }
</style>
</head>
<body>
<div class="page-header">
  <span class="header-title">${escapeHtml(title)}</span>
  ${cwd ? `<span class="header-path">${escapeHtml(cwd)}</span>` : ''}
  <span class="header-stats">${turnCount} turns · ${eventCount} events</span>
  <span class="header-badge">EXPORTED ${escapeHtml(exportedAt)}</span>
</div>
<div class="timeline">
  <div class="timeline-track">
    ${messagesHtml}
  </div>
</div>
</body>
</html>`
}

// ── Public API ────────────────────────────────────────────────────────────────

export function exportSessionToHtml(session: Session, messages: SessionMessage[]): string {
  const threaded = buildThreadedMessages(messages)
  const dirName  = session.customTitle ?? session.summary ?? getPrimarySessionTag(session.tag) ?? (session.cwd ? basename(session.cwd) : undefined) ?? session.sessionId
  const messagesHtml = threaded.map(renderMessage).join('\n')
  return buildHtmlDocument(dirName, session, threaded.length, messages.length, messagesHtml)
}

export function downloadHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
