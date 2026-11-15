// Tool names that have a dedicated card in both renderers. A call to anything
// else reads as a generic card (an MCP tool gets the generic MCP card), which
// is what "unrendered" means for the block.unrendered runtime event. Keep it in
// step with ToolThreadCard (components/MessageItem.tsx) and canonicalToolName
// (components/message-item/toolModel.ts); a name missing here is reported as
// unrendered although a card draws it, which costs a redundant suggestion, never
// a hidden card.
const NATIVE = new Set([
  'bash', 'shell', 'local_shell', 'powershell', 'run_in_terminal', 'command', 'command_execution',
  'read', 'read_file', 'open_file', 'view_file', 'cat', 'ls', 'list_dir', 'fs_read',
  'grep', 'grep_search', 'search', 'semantic_search', 'find', 'find_text', 'rg', 'glob', 'find_files', 'file_search',
  'edit', 'str_replace_editor', 'replace_string_in_file', 'insert_edit_into_file', 'update_file', 'multiedit', 'multi_edit',
  'write', 'write_file', 'create_file', 'filechange', 'file_change', 'notebookedit', 'notebook_edit',
  'todowrite', 'todo_write', 'todo', 'agent', 'task', 'subtask', 'task_create', 'taskcreate', 'task_status', 'taskstatus',
  'task_get', 'taskget', 'task_update', 'taskupdate', 'task_list', 'tasklist', 'task_stop', 'taskstop',
  'websearch', 'web_search', 'webfetch', 'web_fetch', 'toolsearch', 'tool_search',
  'enterplanmode', 'exitplanmode', 'skill', 'askuserquestion', 'enterworktree', 'exitworktree',
  'croncreate', 'cronlist', 'crondelete', 'listmcpresourcestool', 'readmcpresourcetool',
])

/** Whether a dedicated card draws this tool. */
export function hasNativeToolCard(toolName: string): boolean {
  return NATIVE.has(toolName.trim().toLowerCase().replace(/[-\s]/g, '_'))
}
