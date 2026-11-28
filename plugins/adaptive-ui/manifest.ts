import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
// Cards for tool calls nothing draws specially, designed as data (lib/plugins/cardTemplates.ts),
// reviewed here as drafts and saved as files to be reused. This plugin ships no renderer code:
// the hosts draw the blocks a rule makes.
// Operations an agent can call through the MCP bridge (handlers: ./tools.ts). Inline: a manifest imports only lib/plugins/types.
const TOOLS: PluginManifest['tools'] = [
  { name: 'list_shapes', scope: 'read', description: 'List the tools whose calls are drawn by a generic card (no card yet), busiest first, with what past sessions say about each. Start here to choose a tool to design a card for.', fields: { limit: { t: 'number', int: true, min: 1, max: 50, optional: true, description: 'How many to list (default 15)' } } },
  { name: 'profile', scope: 'read', description: 'What past calls of one tool looked like: which result fields are present how often, their values and list lengths, how often it fails. Design from this, not from one example.', fields: { tool: { t: 'string', min: 1, max: 200, description: 'The tool name, as list_shapes gives it' } } },
  { name: 'schema', scope: 'read', description: 'The card vocabulary: the blocks, bindings and formatters a card rule may use, and what each is for.', fields: {} },
  { name: 'show_rule', scope: 'read', description: 'Read one of the person\'s card rules as JSON, with its revision (needed to patch it).', fields: { id: { t: 'string', min: 1, max: 64 } } },
  { name: 'propose_rule', scope: 'write', description: 'Propose a card rule. `rule_json` is one JSON object (see schema). It is checked against the grammar and against past calls of the tool; if it is refused the reasons come back so you can fix and propose again. If accepted it is saved as a DRAFT the person reviews: you cannot enable it.', fields: { rule_json: { t: 'string', min: 2, max: 20_000, description: 'The rule as a JSON object' } } },
  { name: 'patch_rule', scope: 'write', description: 'Change a rule by patch: { "baseRevision": N, "operations": [set-title, set-tone, replace-block, insert-block, remove-block, set-rationale] }. A patch against an old revision is refused (read it again). The rule returns to draft.', fields: { id: { t: 'string', min: 1, max: 64 }, patch_json: { t: 'string', min: 2, max: 20_000 } } },
  { name: 'preview_rule', scope: 'read', description: 'Render a rule against its stored samples and check it against past calls: what the card will show, and which fields it reads that history never had.', fields: { id: { t: 'string', min: 1, max: 64 } } },
]

export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'adaptive-ui', title: 'Adaptive UI',
  description: 'Design, review and reuse transcript cards for tool calls that nothing draws specially.',
  renderers: ['web', 'tui'], stateVersion: 1,
  surfaces: [{ id: 'adaptive-ui', title: 'Adaptive UI', pin: null, single: true, keys: 'window', placements: ['overlay', 'window', 'panel'], panelOrder: 230, windowLabel: 'Adaptive UI in a window', services: ['adaptive-ui'], optionalServices: ['composer', 'notices'] }],
  commands: [{ id: 'adaptive-ui', label: 'Adaptive UI cards', category: 'View', opens: 'adaptive-ui', requires: null, scope: 'application', renderers: ['web', 'tui'], keywords: ['cards', 'render', 'recipes', 'adaptive', 'tool', 'transcript', 'design'] }],
  behavior: { hooks: ['toolCard', 'transcriptCard', 'runtimeEvent'], order: 90 },
  tools: TOOLS,
} as const satisfies PluginManifest
