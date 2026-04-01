export type CodexJsonRpcRequest = {
  jsonrpc: '2.0'
  id: string
  method: string
  params?: unknown
}

export type CodexJsonRpcResponse = {
  id?: string
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
  method?: string
  params?: unknown
}

export type CodexThreadStatus = 'idle' | 'running' | 'errored' | 'completed' | string

export type CodexPatchApplyStatus = 'inProgress' | 'completed' | 'failed' | 'declined' | string

export type CodexUserInput =
  | { type: 'text'; text: string; text_elements: Array<unknown> }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string }
  | { type: 'skill'; name: string; path: string }
  | { type: 'mention'; name: string; path: string }

export type CodexFileUpdateChange = {
  path: string
  kind: string
  diff: string
}

export type CodexThreadItem =
  | { type: 'userMessage'; id: string; content: CodexUserInput[] }
  | { type: 'hookPrompt'; id: string; fragments: Array<unknown> }
  | { type: 'agentMessage'; id: string; text: string; phase: string | null; memoryCitation: unknown }
  | { type: 'plan'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | {
      type: 'commandExecution'
      id: string
      command: string
      cwd: string
      processId: string | null
      source: string
      status: string
      commandActions: Array<unknown>
      aggregatedOutput: string | null
      exitCode: number | null
      durationMs: number | null
    }
  | {
      type: 'fileChange'
      id: string
      changes: CodexFileUpdateChange[]
      status: CodexPatchApplyStatus
    }
  | {
      type: 'mcpToolCall'
      id: string
      server: string
      tool: string
      status: string
      arguments: unknown
      result: { content: unknown[]; structuredContent: unknown | null } | null
      error: unknown
      durationMs: number | null
    }
  | {
      type: 'dynamicToolCall'
      id: string
      tool: string
      arguments: unknown
      status: string
      contentItems: Array<{ type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string }> | null
      success: boolean | null
      durationMs: number | null
    }
  | {
      type: 'collabAgentToolCall'
      id: string
      tool: string
      status: string
      senderThreadId: string
      receiverThreadIds: string[]
      prompt: string | null
      model: string | null
      reasoningEffort: string | null
      agentsStates: Record<string, unknown>
    }
  | { type: 'webSearch'; id: string; query: string; action: unknown }
  | { type: 'imageView'; id: string; path: string }
  | { type: 'imageGeneration'; id: string; status: string; revisedPrompt: string | null; result: string; savedPath?: string }
  | { type: 'enteredReviewMode'; id: string; review: string }
  | { type: 'exitedReviewMode'; id: string; review: string }
  | { type: 'contextCompaction'; id: string }

export type CodexTurn = {
  id: string
  items: CodexThreadItem[]
  status: string
  error: string | null
}

export type CodexThread = {
  id: string
  preview: string
  ephemeral: boolean
  modelProvider: string
  createdAt: number
  updatedAt: number
  status: CodexThreadStatus
  path: string | null
  cwd: string
  cliVersion: string
  source: unknown
  agentNickname: string | null
  agentRole: string | null
  gitInfo: { branch?: string | null } | null
  name: string | null
  turns: CodexTurn[]
}

export type CodexThreadListResponse = {
  data: CodexThread[]
  nextCursor: string | null
}

export type CodexThreadReadResponse = {
  thread: CodexThread
}

export type CodexThreadResumeResponse = {
  thread: CodexThread
  model: string
  modelProvider: string
  cwd: string
  approvalPolicy: string
  approvalsReviewer: unknown
  sandbox: unknown
  reasoningEffort: string | null
}

export type CodexThreadForkResponse = {
  thread: CodexThread
  model: string
  modelProvider: string
  cwd: string
  approvalPolicy: string
  approvalsReviewer: unknown
  sandbox: unknown
  reasoningEffort: string | null
}

export type CodexThreadRollbackResponse = {
  thread: CodexThread
}

export type CodexTurnStartResponse = {
  turn: CodexTurn
}

export type CodexModel = {
  model: string
  displayName: string
  description: string
  supportedReasoningEfforts?: string[] | null
  defaultReasoningEffort?: string | null
  isDefault?: boolean
}

export type CodexModelListResponse = {
  data: CodexModel[]
  nextCursor: string | null
}

export type CodexMcpServerStatus = {
  name: string
  tools?: number | null
  resources?: number | null
  resourceTemplates?: number | null
  authStatus?: string | null
}

export type CodexMcpServerListResponse = {
  data: CodexMcpServerStatus[]
  nextCursor: string | null
}

export type CodexExperimentalFeature = {
  name: string
  stage?: string | null
  displayName?: string | null
  description?: string | null
  enabled?: boolean
  defaultEnabled?: boolean
}

export type CodexExperimentalFeatureListResponse = {
  data: CodexExperimentalFeature[]
  nextCursor: string | null
}

export type CodexSkillsListResponse = {
  data: Array<{ cwd: string; skills: Array<{ name?: string; description?: string }>; errors?: string[] }>
}

export type CodexAppsListResponse = {
  data: Array<{ name: string; id?: string }>
  nextCursor: string | null
}

export type CodexThreadTokenUsage = {
  total?: {
    totalTokens?: number
    inputTokens?: number
    cachedInputTokens?: number
    outputTokens?: number
    reasoningOutputTokens?: number
  }
  last?: {
    totalTokens?: number
    inputTokens?: number
    cachedInputTokens?: number
    outputTokens?: number
    reasoningOutputTokens?: number
  }
  modelContextWindow?: number
}

export type CodexNotification =
  | { method: 'turn/started'; params: { threadId: string; turnId?: string; turn?: Pick<CodexTurn, 'id' | 'status' | 'error'> | null } }
  | { method: 'turn/completed'; params: { threadId: string; turnId?: string; turn?: Pick<CodexTurn, 'id' | 'status' | 'error'> | null } }
  | { method: 'item/started'; params: { threadId: string; turnId: string; item: CodexThreadItem } }
  | { method: 'item/completed'; params: { threadId: string; turnId: string; item: CodexThreadItem } }
  | { method: 'item/agentMessage/delta'; params: { threadId: string; turnId: string; itemId: string; delta: string } }
  | { method: 'item/plan/delta'; params: { threadId: string; turnId: string; itemId: string; delta: string } }
  | { method: 'item/reasoning/summaryTextDelta'; params: { threadId: string; turnId: string; itemId: string; delta: string; summaryIndex: number } }
  | { method: 'item/reasoning/textDelta'; params: { threadId: string; turnId: string; itemId: string; delta: string; contentIndex: number } }
  | { method: 'thread/realtime/transcriptUpdated'; params: { threadId: string; role: string; text: string } }
  | { method: 'thread/realtime/itemAdded'; params: { threadId: string; item: Record<string, unknown> } }
  | { method: 'thread/tokenUsage/updated'; params: { threadId: string; turnId: string; tokenUsage: CodexThreadTokenUsage } }
  | { method: string; params: Record<string, unknown> }
