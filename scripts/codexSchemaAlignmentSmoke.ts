import type { ClientRequest } from '../lib/codex-schema'
import { CODEX_INITIALIZE_CAPABILITIES } from '../lib/codexClient'
import { isCodexActiveWriterError, isCodexMissingRolloutError } from '../lib/sessionBackend'
import type {
  BrowserUseRequirements,
  FeedbackRequirements,
  Thread,
  ThreadItem,
} from '../lib/codex-schema/v2'
import {
  currentCodexModelValue,
  mapCodexThreadToMessages,
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
  {
    method: 'thread/queue/add',
    id: 'queue-for-active-writer',
    params: {
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Queued prompt', text_elements: [] }],
      clientUserMessageId: 'message-1',
    },
  },
] satisfies ClientRequest[]

if (CODEX_INITIALIZE_CAPABILITIES.experimentalApi !== true) {
  throw new Error('Codex dynamic tools require initialize.capabilities.experimentalApi')
}
if (!isCodexActiveWriterError(new Error('thread thread-1 already has an active writer'))) {
  throw new Error('Codex active-writer conflicts must remain a recoverable session-detail condition')
}
if (!isCodexMissingRolloutError(new Error('thread not found: thread-1'))) {
  throw new Error('Codex turn/start thread-not-found errors must invalidate the resume cache')
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
  cliVersion: '0.149.0',
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

const guardianSession = mapCodexThreadToSession({
  ...thread,
  id: 'guardian-thread',
  parentThreadId: thread.id,
  source: { subAgent: { other: 'guardian' } },
}, null)
if (guardianSession.parentSessionId !== undefined) {
  throw new Error('Codex internal Guardian threads must not appear as nested subagent sessions')
}

const spawnedSession = mapCodexThreadToSession({
  ...thread,
  id: 'spawned-thread',
  parentThreadId: null,
  source: {
    subAgent: {
      thread_spawn: {
        parent_thread_id: thread.id,
        depth: 1,
        agent_path: '/root/worker',
        agent_nickname: 'Worker',
        agent_role: 'worker',
      },
    },
  },
}, null)
if (spawnedSession.parentSessionId !== thread.id) {
  throw new Error('Codex AgentControl thread_spawn sessions must retain their parent session')
}

const modelCatalog = [
  { model: 'gpt-default', isDefault: true },
  { model: 'gpt-session', isDefault: false },
]
if (currentCodexModelValue(modelCatalog, 'gpt-session') !== 'gpt-session') {
  throw new Error('Codex resumed session model must outrank the catalog default')
}
if (currentCodexModelValue(modelCatalog, null) !== 'gpt-default') {
  throw new Error('Codex catalog default must fill model metadata when an active writer prevents resume')
}

const orderedMessages = mapCodexThreadToMessages({
  ...thread,
  turns: [{
    id: '01999999-0000-7000-8000-000000000000',
    items: [{
      type: 'userMessage',
      id: '01999999-0001-7000-8000-000000000000',
      clientId: 'client-message-1',
      content: [{ type: 'text', text: 'Prompt first', text_elements: [] }],
    }, commandItem, {
      type: 'agentMessage',
      id: 'msg-without-a-sortable-timestamp',
      text: 'Reply last',
      phase: null,
      memoryCitation: null,
      delivery: null,
    }],
    itemsView: 'full',
    status: 'completed',
    error: null,
    startedAt: 1_700_000_000,
    completedAt: 1_700_000_010,
    durationMs: 10_000,
  }],
})
if (orderedMessages[0]?.type !== 'user' || orderedMessages.at(-1)?.type !== 'assistant') {
  throw new Error('Codex transcript mapping must preserve the provider-native turn/item sequence')
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
console.log('Codex 0.149.0 schema alignment smoke passed')
