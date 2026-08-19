import type { ClientRequest } from '../lib/codex-schema'
import { CODEX_INITIALIZE_CAPABILITIES } from '../lib/codexClient'
import { isCodexActiveWriterError } from '../lib/sessionBackend'
import type {
  BrowserUseRequirements,
  FeedbackRequirements,
  Thread,
  ThreadItem,
} from '../lib/codex-schema/v2'
import {
  mapCodexThreadToSession,
  mapCodexThreadToSessionInfo,
  normalizeCodexStreamThreadedMessage,
} from '../lib/codexMapper'

const newRequests = [
  {
    method: 'externalAgentConfig/import/recordHistory',
    id: 'record-history',
    params: { providerId: 'codex', itemTypeResults: [] },
  },
  {
    method: 'thread/metadata/update',
    id: 'assign-project',
    params: { threadId: 'thread-1', projectId: 'project-1' },
  },
  {
    method: 'thread/realtime/start',
    id: 'realtime-prefixes',
    params: {
      threadId: 'thread-1',
      outputModality: 'text',
      codexResponseHandoffChannelPrefixes: {
        analysis: ['[ANALYSIS]'],
        commentary: ['[COMMENTARY]'],
        final: ['[FINAL]'],
      },
    },
  },
] satisfies ClientRequest[]

if (CODEX_INITIALIZE_CAPABILITIES.experimentalApi !== true) {
  throw new Error('Codex dynamic tools require initialize.capabilities.experimentalApi')
}
if (!isCodexActiveWriterError(new Error('thread thread-1 already has an active writer'))) {
  throw new Error('Codex active-writer conflicts must remain a recoverable session-detail condition')
}

const generatedRequirementAdditions: {
  browser: BrowserUseRequirements | null
  feedback: FeedbackRequirements | null
} = { browser: null, feedback: null }

const commandItem = {
  type: 'commandExecution',
  id: 'command-1',
  pluginId: 'first-party-plugin',
  scriptPath: 'scripts/check.ts',
  command: 'bun scripts/check.ts',
  cwd: '/workspace',
  processId: 'process-1',
  source: 'agent',
  status: 'completed',
  commandActions: [],
  aggregatedOutput: 'ok',
  exitCode: 0,
  durationMs: 25,
} satisfies ThreadItem

const thread = {
  id: 'thread-1',
  extra: null,
  sessionId: 'session-1',
  forkedFromId: null,
  parentThreadId: null,
  preview: 'Schema alignment smoke',
  ephemeral: false,
  section: null,
  sectionEnteredAt: null,
  projectId: null,
  historyMode: 'paginated',
  modelProvider: 'openai',
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_100,
  recencyAt: 1_700_000_100,
  status: { type: 'idle' },
  path: '/tmp/thread-1.jsonl',
  cwd: '/workspace',
  cliVersion: '0.146.0',
  source: 'appServer',
  canAcceptDirectInput: true,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: 'Schema alignment thread',
  turns: [],
} satisfies Thread

const session = mapCodexThreadToSession(thread, null)
const info = mapCodexThreadToSessionInfo(thread, null, 'gpt-5.6-codex')
if (session.isPinned !== false || info.isPinned !== false) {
  throw new Error('Codex session mapper unexpectedly reported a pin state (isPinned was removed from the app-server protocol)')
}

const message = normalizeCodexStreamThreadedMessage({
  type: 'codex_item_completed',
  threadId: thread.id,
  turnId: 'turn-1',
  completedAtMs: 1_700_000_100_000,
  item: commandItem,
})
const tool = message?.blocks.find((block) => block.type === 'tool_thread')
if (
  !tool
  || tool.type !== 'tool_thread'
  || tool.toolUse.input.pluginId !== commandItem.pluginId
  || tool.toolUse.input.scriptPath !== commandItem.scriptPath
) {
  throw new Error('Codex command plugin provenance was not preserved by the transcript mapper')
}

void newRequests
void generatedRequirementAdditions
console.log('Codex 0.146.0 schema alignment smoke passed')
