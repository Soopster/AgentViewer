// Tool cards are registrations: the native cards resolve by name exactly as the old
// if-chain chose them, a plugin's registration overrides one and unregistering
// brings the native card back, and a predicate catches names no exact entry has.
import assert from 'node:assert/strict'
import { registerToolCard, resolveToolCard, subscribeToolCards, toolCardsVersion } from '../components/message-view/toolCardRegistry'
await import('../components/MessageItem')

const expected: Record<string, string> = {
  Edit: 'EditToolCard', MultiEdit: 'MultiEditCard', FileChange: 'FileChangeCard', Write: 'WriteToolCard', Bash: 'BashCard', Read: 'ReadCard',
  Grep: 'GrepCard', Glob: 'GlobCard', TodoWrite: 'TodoWriteCard', Agent: 'AgentCard', task: 'OpenCodeTaskCard', task_status: 'OpenCodeTaskCard',
  EnterPlanMode: 'PlanModeCard', ExitPlanMode: 'PlanModeCard', Skill: 'SkillCard', AskUserQuestion: 'AskUserQuestionCard', ToolSearch: 'ToolSearchCard',
  WebSearch: 'WebSearchCard', WebFetch: 'WebFetchCard', NotebookEdit: 'NotebookEditCard', EnterWorktree: 'WorktreeCard', ExitWorktree: 'WorktreeCard',
  TaskCreate: 'TaskCard', TaskList: 'TaskCard', TaskGet: 'TaskCard', TaskUpdate: 'TaskCard', TaskStop: 'TaskCard',
  CronCreate: 'CronCard', CronList: 'CronCard', CronDelete: 'CronCard', ListMcpResourcesTool: 'McpCard', ReadMcpResourceTool: 'McpCard',
  mcp__server__tool: 'McpToolCard',
}
for (const [tool, component] of Object.entries(expected)) assert.equal(resolveToolCard(tool)?.name, component, tool)
assert.equal(resolveToolCard('SomethingNobodyDraws'), null, 'an unknown tool falls through to the generic card')

const Custom = function CustomBash() { return null }
const Newer = function NewerBash() { return null }
let notified = 0
const stop = subscribeToolCards(() => { notified++ })
const before = toolCardsVersion()
const unregisterCustom = registerToolCard(['Bash'], Custom)
assert.equal(resolveToolCard('Bash'), Custom, 'a registration overrides the native card')
const unregisterNewer = registerToolCard(['Bash', 'Fresh'], Newer)
assert.equal(resolveToolCard('Bash'), Newer, 'the newest registration wins')
assert.equal(resolveToolCard('Fresh'), Newer, 'a new name resolves')
unregisterCustom()
assert.equal(resolveToolCard('Bash'), Newer, 'removing an older registration keeps the newer one')
unregisterNewer()
assert.equal(resolveToolCard('Bash')?.name, 'BashCard', 'the native card returns')
assert.equal(resolveToolCard('Fresh'), null)
const unregisterPredicate = registerToolCard(name => name.startsWith('acme_'), Custom)
assert.equal(resolveToolCard('acme_widget'), Custom)
assert.equal(resolveToolCard('Bash')?.name, 'BashCard', 'an exact name outranks a predicate')
unregisterPredicate()
assert.equal(resolveToolCard('acme_widget'), null)
assert.equal(notified, 6)
assert.equal(toolCardsVersion(), before + 6)
stop()

// The HTML exporter has the same two registries: tool cards by name, blocks by type.
import { exportSessionToHtml } from '../lib/export'
import { registerExportBlock, registerExportToolCard, resolveExportBlock, resolveExportToolCard } from '../lib/exportRegistry'
for (const tool of ['Edit', 'MultiEdit', 'FileChange', 'Write', 'Bash', 'Read', 'Grep', 'Glob']) assert.ok(resolveExportToolCard(tool), `export card for ${tool}`)
for (const type of ['tool_thread', 'text', 'thinking', 'image', 'task_notification', 'system_reminder', 'claude_system', 'slash_command', 'local_command_stdout', 'bash_input', 'bash_output', 'coordinator_brief', 'coordinator_mail']) assert.ok(resolveExportBlock(type), `export block for ${type}`)
assert.equal(resolveExportToolCard('Mystery'), null)
let n = 0
const message = (content: unknown[], role: 'user' | 'assistant' = 'assistant'): never => ({ type: role, uuid: `u${++n}`, session_id: 's', parent_tool_use_id: null, message: { role, content } }) as never
const conversation = [message([{ type: 'tool_use', id: 't', name: 'Mystery', input: { a: 1 } }]), message([{ type: 'tool_result', tool_use_id: 't', content: 'out' }], 'user')]
const plain = exportSessionToHtml({ sessionId: 's', summary: 'S' }, conversation)
assert.ok(!plain.includes('MYSTERY-CARD'))
const drop = registerExportToolCard(['Mystery'], () => '<div>MYSTERY-CARD</div>')
assert.ok(exportSessionToHtml({ sessionId: 's', summary: 'S' }, conversation).includes('MYSTERY-CARD'), 'a plugin draws its tool in an export')
drop()
assert.equal(exportSessionToHtml({ sessionId: 's', summary: 'S' }, conversation), plain, 'unregistering restores the generic card')
const dropBlock = registerExportBlock(['text'], () => 'TEXT-OVERRIDE')
assert.ok(exportSessionToHtml({ sessionId: 's', summary: 'S' }, [message([{ type: 'text', text: 'hi' }])]).includes('TEXT-OVERRIDE'))
dropBlock()
console.log('tool card registry smoke passed')
