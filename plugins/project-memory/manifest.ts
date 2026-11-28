import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
// Agents keep this memory themselves: in-app sessions by writing memory tags in a reply (read back by afterTurn),
// agents in other programs through the MCP bridge tools below (handlers: ./server.ts). Inline: a manifest imports only lib/plugins/types.
const project = { t: 'string', min: 1, max: 4096, optional: true, description: 'Absolute path of the project, when it is not the directory you were started in' } as const
const TOOLS: PluginManifest['tools'] = [
  { name: 'recall', scope: 'read', description: 'Read this project\'s persistent memory: decisions, conventions and lessons earlier sessions (yours or other agents\') recorded. Call it when starting a task. With a query, returns the most relevant memories in full; without one, lists every memory by title.', fields: { query: { t: 'string', max: 2000, optional: true, description: 'What you are working on, in a few words' }, limit: { t: 'number', int: true, min: 1, max: 20, optional: true, description: 'How many memories to return in full (default 8)' }, project } },
  { name: 'remember', scope: 'write', description: 'Save something a future session would otherwise have to rediscover: a decision and its reason, a project convention, a gotcha or a fix that took effort. Reusing a title updates that memory. Never store secrets or progress on the current task.', fields: { title: { t: 'string', min: 1, max: 200, description: 'Short, unique title' }, body: { t: 'string', min: 1, max: 4000, description: 'The memory, self-contained' }, kind: { t: 'enum', values: ['decision', 'convention', 'lesson'], optional: true, description: 'Default lesson' }, project } },
  { name: 'forget', scope: 'write', description: 'Delete one of the agent-written memories that has become wrong or outdated, by its title. Memories a person wrote cannot be deleted this way.', fields: { title: { t: 'string', min: 1, max: 200 }, project } },
]
export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'project-memory', title: 'Shared Project Memory', description: 'Memory agents keep for a project across sessions and providers, beside decisions, conventions and lessons people review.', renderers: ['web', 'tui'], stateVersion: 1,
  surfaces: [{ id: 'project-memory', title: 'Shared Project Memory', pin: 'cwd', single: false, keys: 'window', placements: ['overlay', 'window', 'panel'], panelOrder: 220, windowLabel: 'Project Memory in a window', services: ['repository', 'project-memory'], optionalServices: ['session', 'session-transcript', 'session-navigation'] }],
  commands: [{ id: 'project-memory', label: 'Shared Project Memory', category: 'Session', opens: 'project-memory', requires: 'repository', scope: 'repository', renderers: ['web', 'tui'], keywords: ['memory', 'knowledge', 'decisions', 'lessons', 'conventions', 'recall', 'remember'] }],
  behavior: { hooks: ['beforeTurn', 'afterTurn'], order: 50 },
  tools: TOOLS,
  // Drawn as cards instead of raw tags. The recalled block comes first so the protocol text inside it is folded away with it.
  blocks: [
    { kind: 'recalled', pattern: '<agent_viewer_project_memory>[\\s\\S]{0,30000}?</agent_viewer_project_memory>', title: 'Project memory recalled', tone: 'info' },
    { kind: 'remembered', pattern: '<memory\\s+title="([^"\\n]{1,200})"[^>\\n]{0,40}>([\\s\\S]{0,4000}?)</memory>', title: 'Remembered: {1}', lines: ['{2}'], tone: 'success' },
    { kind: 'forgot', pattern: '<forget\\s+title="([^"\\n]{1,200})"\\s*/?>(?:</forget>)?', title: 'Forgot: {1}', tone: 'info' },
  ],
} as const satisfies PluginManifest
