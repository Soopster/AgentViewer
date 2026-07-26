// Shared permission/approval parsing for every provider, consumed by both the
// web composer (components/MessageView.tsx) and the OpenTUI composer
// (tui/opentui/App.tsx) so the two surfaces agree on how a pending approval is
// extracted from the SSE stream and what payload it carries.
//
// Pure functions only — no React, no Node/DOM APIs — so it loads in both the
// Next.js and Bun/OpenTUI bundles.

import type { AgentProvider, SendAttachment } from './types'

// A single AskUserQuestion prompt the user must answer interactively. Mirrors
// the Claude SDK AskUserQuestionInput shape (one entry per question).
export type PendingQuestionOption = { label: string; description?: string; preview?: string }
export type PendingQuestion = {
  id?: string
  question: string
  header?: string
  multiSelect?: boolean
  options: PendingQuestionOption[]
}

export type PendingPermission = {
  id: string
  sessionId?: string
  provider?: AgentProvider
  title: string
  detail?: string
  canApproveAlways?: boolean
  // Structured payload so the approval surface can show the same context the
  // native CLI does — the full command, an edit's diff, the target paths/url,
  // and the model's stated reason — instead of one ellipsized line.
  toolName?: string
  command?: string
  diff?: string
  paths?: string[]
  url?: string
  reason?: string
  // Present only for AskUserQuestion: the structured questions to render as an
  // interactive picker. When set, the surface collects answers and replies with
  // the `respondQuestion` action instead of an allow/deny permission decision.
  questions?: PendingQuestion[]
  // Present only for ExitPlanMode: render a plan-approval card. `plan` is the
  // plan markdown; `allowedPrompts` are the prompt-based permissions the plan
  // needs (pre-approved when the plan is approved). Approving exits plan mode.
  plan?: string
  allowedPrompts?: string[]
}

export type PermissionResponse = 'once' | 'always' | 'reject'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function objectField(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function codexPathLabel(value: unknown): string | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  if (record.type === 'path') return stringField(record, 'path')
  if (record.type === 'glob_pattern') {
    const pattern = stringField(record, 'pattern')
    return pattern ? `glob ${pattern}` : undefined
  }
  if (record.type !== 'special') return undefined
  const special = asRecord(record.value)
  if (!special) return undefined
  const subpath = stringField(special, 'subpath')
  switch (special.kind) {
    case 'root':
      return ':root'
    case 'minimal':
      return ':minimal'
    case 'project_roots':
      return subpath ? `:workspace_roots/${subpath}` : ':workspace_roots'
    case 'tmpdir':
      return ':tmpdir'
    case 'slash_tmp':
      return '/tmp'
    case 'unknown': {
      const path = stringField(special, 'path')
      if (!path) return undefined
      return subpath ? `${path}/${subpath}` : path
    }
    default:
      return undefined
  }
}

function codexPermissionRule(value: unknown): string | undefined {
  const permissions = asRecord(value)
  if (!permissions) return undefined
  const parts: string[] = []
  const network = asRecord(permissions.network)
  if (network?.enabled === true) parts.push('network')

  const fileSystem = asRecord(permissions.fileSystem)
  if (fileSystem) {
    const entries = Array.isArray(fileSystem.entries) ? fileSystem.entries : []
    for (const access of ['read', 'write', 'deny'] as const) {
      const paths = entries.flatMap((entry) => {
        const entryRecord = asRecord(entry)
        if (!entryRecord || entryRecord.access !== access) return []
        const label = codexPathLabel(entryRecord.path)
        return label ? [label] : []
      })
      if (paths.length > 0) parts.push(`${access === 'deny' ? 'deny read' : access} ${paths.join(', ')}`)
    }

    const legacyRead = Array.isArray(fileSystem.read)
      ? fileSystem.read.filter((entry): entry is string => typeof entry === 'string')
      : []
    if (legacyRead.length > 0) parts.push(`read ${legacyRead.join(', ')}`)
    const legacyWrite = Array.isArray(fileSystem.write)
      ? fileSystem.write.filter((entry): entry is string => typeof entry === 'string')
      : []
    if (legacyWrite.length > 0) parts.push(`write ${legacyWrite.join(', ')}`)
  }

  return parts.length > 0 ? parts.join('; ') : undefined
}

export function copilotPermissionSummary(permission: Record<string, unknown>): { title: string; detail?: string; canApproveAlways?: boolean } {
  const kind = stringField(permission, 'kind') ?? 'permission'
  const canApproveAlways = permission.canOfferSessionApproval === true
  const intention = stringField(permission, 'intention')
  switch (kind) {
    case 'commands':
    case 'shell':
      return { title: 'Copilot wants to run a command', detail: stringField(permission, 'fullCommandText') ?? intention, canApproveAlways }
    case 'write':
      return { title: 'Copilot wants to write a file', detail: [stringField(permission, 'fileName'), intention].filter(Boolean).join(' - ') || undefined, canApproveAlways }
    case 'read':
    case 'path': {
      const paths = Array.isArray(permission.paths) ? permission.paths.filter((path): path is string => typeof path === 'string') : []
      return { title: 'Copilot wants to read files', detail: stringField(permission, 'path') ?? (paths.length > 0 ? paths.join(', ') : intention), canApproveAlways }
    }
    case 'url':
      return { title: 'Copilot wants to access a URL', detail: stringField(permission, 'url') ?? intention, canApproveAlways }
    case 'mcp':
      return { title: 'Copilot wants to use an MCP tool', detail: [stringField(permission, 'serverName'), stringField(permission, 'toolTitle') ?? stringField(permission, 'toolName')].filter(Boolean).join(' / ') || undefined, canApproveAlways }
    case 'custom-tool':
      return { title: 'Copilot wants to use a tool', detail: [stringField(permission, 'toolName'), stringField(permission, 'toolDescription')].filter(Boolean).join(' - ') || undefined, canApproveAlways }
    case 'memory':
      return { title: 'Copilot wants to update memory', detail: stringField(permission, 'fact') ?? stringField(permission, 'subject'), canApproveAlways }
    case 'hook':
      return { title: 'Copilot wants approval', detail: stringField(permission, 'hookMessage') ?? stringField(permission, 'toolName'), canApproveAlways }
    case 'extension-management':
      return { title: 'Copilot wants to manage an extension', detail: [stringField(permission, 'operation'), stringField(permission, 'extensionName')].filter(Boolean).join(' - ') || undefined, canApproveAlways }
    case 'extension-permission-access':
      return { title: 'Copilot wants extension permission access', detail: stringField(permission, 'extensionName'), canApproveAlways }
    default:
      return { title: `Copilot requests ${kind} permission`, detail: intention, canApproveAlways }
  }
}

// Build a simple +/- diff body from an edit/write tool input so the approval
// surface can show what will change (lines starting with +/- are colored).
export function buildPermissionDiff(toolName: string | undefined, input: Record<string, unknown> | null): string | undefined {
  if (!input) return undefined
  const oldStr = stringField(input, 'old_string')
  const newStr = stringField(input, 'new_string')
  if (typeof oldStr === 'string' && typeof newStr === 'string') {
    const minus = oldStr.split('\n').map((line) => `- ${line}`).join('\n')
    const plus = newStr.split('\n').map((line) => `+ ${line}`).join('\n')
    return `${minus}\n${plus}`
  }
  const content = stringField(input, 'content')
  if (typeof content === 'string' && (!toolName || /write/i.test(toolName))) {
    return content.split('\n').map((line) => `+ ${line}`).join('\n')
  }
  return undefined
}

// Pull whatever structured fields a Copilot permission carries, independent of
// its `kind`. These fields only appear when relevant, so reading them all is safe.
export function copilotPermissionPayload(permission: Record<string, unknown>): Pick<PendingPermission, 'command' | 'diff' | 'paths' | 'url'> {
  const command = stringField(permission, 'fullCommandText') ?? stringField(permission, 'commandText')
  const diff = stringField(permission, 'diff')
  const url = stringField(permission, 'url')
  const rawPaths = permission.paths
  const single = stringField(permission, 'path') ?? stringField(permission, 'fileName')
  const paths = Array.isArray(rawPaths)
    ? rawPaths.filter((entry): entry is string => typeof entry === 'string')
    : single
    ? [single]
    : undefined
  return { command, diff, url, paths }
}

export function extractOpenCodePermission(payload: unknown): PendingPermission | null {
  const record = asRecord(payload)
  if (!record || record.type !== 'opencode_event') return null
  const eventRecord = asRecord(record.event)
  if (!eventRecord || eventRecord.type !== 'permission.updated') return null
  const permissionRecord = asRecord(eventRecord.properties)
  if (!permissionRecord) return null
  const id = stringField(permissionRecord, 'id')
  if (!id) return null
  const pattern = permissionRecord.pattern
  const patternText = Array.isArray(pattern)
    ? pattern.filter((entry): entry is string => typeof entry === 'string').join(', ')
    : typeof pattern === 'string'
    ? pattern
    : undefined
  const toolName = stringField(permissionRecord, 'type')
  const metadata = asRecord(permissionRecord.metadata)
  const diff = metadata ? stringField(metadata, 'diff') : undefined
  const filepath = metadata ? stringField(metadata, 'filepath') : undefined
  const metaCommand = metadata ? stringField(metadata, 'command') : undefined
  const isShell = typeof toolName === 'string' && /bash|shell|command/i.test(toolName)
  return {
    id,
    provider: 'opencode',
    toolName,
    title: stringField(permissionRecord, 'title') ?? 'Permission requested',
    detail: patternText,
    command: metaCommand ?? (isShell ? patternText : undefined),
    diff,
    paths: filepath ? [filepath] : undefined,
  }
}

export function extractOpenCodePermissionReply(payload: unknown): string | null {
  const record = asRecord(payload)
  if (!record || record.type !== 'opencode_event') return null
  const eventRecord = asRecord(record.event)
  if (!eventRecord || eventRecord.type !== 'permission.replied') return null
  const properties = asRecord(eventRecord.properties)
  return properties ? stringField(properties, 'permissionID') ?? null : null
}

export function extractCopilotPermission(payload: unknown): PendingPermission | null {
  const record = asRecord(payload)
  if (!record || record.type !== 'copilot_event') return null
  const eventRecord = asRecord(record.event)
  if (!eventRecord || eventRecord.type !== 'permission.requested') return null
  const data = asRecord(eventRecord.data)
  if (!data || data.resolvedByHook === true) return null
  const id = stringField(data, 'requestId')
  if (!id) return null
  const permission = asRecord(data.promptRequest) ?? asRecord(data.permissionRequest)
  if (!permission) return { id, provider: 'copilot', title: 'Copilot requests permission' }
  return {
    id,
    provider: 'copilot',
    toolName: stringField(permission, 'kind'),
    reason: stringField(permission, 'intention'),
    ...copilotPermissionSummary(permission),
    ...copilotPermissionPayload(permission),
  }
}

export function extractCopilotPermissionCompletion(payload: unknown): string | null {
  const record = asRecord(payload)
  if (!record || record.type !== 'copilot_event') return null
  const eventRecord = asRecord(record.event)
  if (!eventRecord || eventRecord.type !== 'permission.completed') return null
  const data = asRecord(eventRecord.data)
  return data ? stringField(data, 'requestId') ?? null : null
}

export function extractCopilotPushedAttachments(payload: unknown): SendAttachment[] {
  const record = asRecord(payload)
  if (!record || record.type !== 'copilot_event') return []
  const eventRecord = asRecord(record.event)
  if (!eventRecord || eventRecord.type !== 'session.extensions.attachments_pushed') return []
  const data = asRecord(eventRecord.data)
  const rawAttachments = Array.isArray(data?.attachments) ? data.attachments : []
  return rawAttachments.flatMap((attachment, index): SendAttachment[] => {
    const attachmentRecord = asRecord(attachment)
    if (!attachmentRecord || attachmentRecord.type !== 'extension_context') return []
    const name = stringField(attachmentRecord, 'title') ?? stringField(attachmentRecord, 'name')
    const extensionId = stringField(attachmentRecord, 'extensionId')
    const capturedAt = stringField(attachmentRecord, 'capturedAt')
    if (!name || !extensionId || !capturedAt) return []
    return [{
      id: [
        'copilot-extension',
        extensionId,
        stringField(attachmentRecord, 'instanceId') ?? stringField(attachmentRecord, 'canvasId') ?? capturedAt,
        index,
      ].join(':'),
      type: 'extension_context',
      displayName: name,
      text: `@${name}`,
      extensionId,
      canvasId: stringField(attachmentRecord, 'canvasId'),
      instanceId: stringField(attachmentRecord, 'instanceId'),
      capturedAt,
      payload: objectField(attachmentRecord, 'payload'),
    }]
  })
}

// Parse AskUserQuestion tool input into the structured questions the picker
// renders. Tolerant of partial/streaming input — drops malformed entries.
export function parsePendingQuestions(input: Record<string, unknown> | null | undefined): PendingQuestion[] | undefined {
  const rawQuestions = input?.questions
  if (!Array.isArray(rawQuestions)) return undefined
  const questions: PendingQuestion[] = []
  for (const rawQuestion of rawQuestions) {
    const q = asRecord(rawQuestion)
    if (!q) continue
    const question = typeof q.question === 'string' ? q.question : ''
    if (!question) continue
    const rawOptions = Array.isArray(q.options) ? q.options : []
    const options: PendingQuestionOption[] = []
    for (const rawOption of rawOptions) {
      const o = asRecord(rawOption)
      if (!o) continue
      const label = typeof o.label === 'string' ? o.label : ''
      if (!label) continue
      options.push({
        label,
        description: typeof o.description === 'string' ? o.description : undefined,
        preview: typeof o.preview === 'string' ? o.preview : undefined,
      })
    }
    if (options.length === 0) continue
    questions.push({
      id: typeof q.id === 'string' ? q.id : undefined,
      question,
      header: typeof q.header === 'string' ? q.header : undefined,
      multiSelect: q.multiSelect === true,
      options,
    })
  }
  return questions.length > 0 ? questions : undefined
}

export function extractClaudePermission(payload: unknown): PendingPermission | null {
  const record = asRecord(payload)
  if (!record || record.type !== 'claude_permission') return null
  const eventRecord = asRecord(record.event)
  if (!eventRecord || eventRecord.type !== 'permission.requested') return null
  const data = asRecord(eventRecord.data)
  if (!data) return null
  const id = stringField(data, 'requestId')
  if (!id) return null
  const toolName = stringField(data, 'toolName')
  const input = asRecord(data.input)
  // AskUserQuestion is not a permission to allow/deny — it's a question to
  // answer. Surface its structured questions so the picker takes over.
  if (toolName === 'AskUserQuestion') {
    const questions = parsePendingQuestions(input)
    if (questions) {
      return {
        id,
        sessionId: stringField(data, 'sessionId'),
        provider: 'claude',
        toolName,
        title: questions.length === 1 ? questions[0].question : `Claude has ${questions.length} questions`,
        questions,
      }
    }
  }
  // ExitPlanMode is a plan-approval gate, not a generic allow/deny. Surface the
  // plan + the prompt-based permissions it needs so the surface can render a
  // plan-approval card (approving exits plan mode).
  if (toolName === 'ExitPlanMode') {
    const plan = input ? stringField(input, 'plan') : undefined
    const rawPrompts = input?.allowedPrompts
    const allowedPrompts = Array.isArray(rawPrompts)
      ? rawPrompts
          .map((entry) => {
            const r = asRecord(entry)
            if (!r) return undefined
            const tool = stringField(r, 'tool')
            const prompt = stringField(r, 'prompt')
            return prompt ? (tool ? `${tool}: ${prompt}` : prompt) : undefined
          })
          .filter((s): s is string => !!s)
      : undefined
    return {
      id,
      sessionId: stringField(data, 'sessionId'),
      provider: 'claude',
      toolName,
      title: 'Claude finished planning',
      plan,
      allowedPrompts: allowedPrompts && allowedPrompts.length > 0 ? allowedPrompts : undefined,
    }
  }
  const command = input ? stringField(input, 'command') : undefined
  const url = input ? stringField(input, 'url') : undefined
  const path = input ? (stringField(input, 'file_path') ?? stringField(input, 'path')) : undefined
  const diff = buildPermissionDiff(toolName, input)
  const reason = stringField(data, 'description') ?? stringField(data, 'decisionReason') ?? stringField(data, 'blockedPath')
  const detail = reason ?? command ?? path
  const suggestions = data.suggestions
  return {
    id,
    sessionId: stringField(data, 'sessionId'),
    provider: 'claude',
    toolName,
    title: stringField(data, 'title') ?? stringField(data, 'displayName') ?? `Claude requests ${toolName ?? 'tool'} permission`,
    detail,
    command,
    url,
    diff,
    paths: path ? [path] : undefined,
    reason,
    canApproveAlways: Array.isArray(suggestions) && suggestions.length > 0,
  }
}

export function extractClaudePermissionCompletion(payload: unknown): string | null {
  const record = asRecord(payload)
  if (!record || record.type !== 'claude_permission') return null
  const eventRecord = asRecord(record.event)
  if (!eventRecord || eventRecord.type !== 'permission.completed') return null
  const data = asRecord(eventRecord.data)
  return data ? stringField(data, 'requestId') ?? null : null
}

// Codex sends exec/patch/permission approval requests mid-turn. createCodexStream
// surfaces them as `codex_approval` frames; the user's decision is POSTed back via
// respondPermission (mapped to the codex decision vocabulary server-side).
export function extractCodexApproval(payload: unknown): PendingPermission | null {
  const record = asRecord(payload)
  if (!record || record.type !== 'codex_approval') return null
  const eventRecord = asRecord(record.event)
  if (!eventRecord || eventRecord.type !== 'approval.requested') return null
  const id = stringField(eventRecord, 'requestId')
  const method = stringField(eventRecord, 'method')
  if (!id || !method) return null
  const params = asRecord(eventRecord.params) ?? {}
  const questions = method === 'item/tool/requestUserInput' ? parsePendingQuestions(params) : undefined
  const command = stringField(params, 'command')
  const cwd = stringField(params, 'cwd')
  const reason = stringField(params, 'reason')
  const requestedPermissionRule = codexPermissionRule(params.permissions)
  const additionalPermissionRule = codexPermissionRule(params.additionalPermissions)
  const paths = [cwd ? `cwd: ${cwd}` : undefined, requestedPermissionRule, additionalPermissionRule]
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  const title = method.includes('commandExecution')
    ? 'Codex wants to run a command'
    : method.includes('fileChange')
    ? 'Codex wants to apply a file change'
    : method.includes('permissions')
    ? 'Codex requests additional permissions'
    : questions
    ? (questions.length === 1 ? questions[0].question : `Codex has ${questions.length} questions`)
    : 'Codex requests approval'
  return {
    id,
    sessionId: stringField(eventRecord, 'threadId'),
    provider: 'codex',
    toolName: method,
    title,
    reason: reason ?? undefined,
    command: command ?? undefined,
    paths: paths.length > 0 ? paths : undefined,
    detail: command ?? requestedPermissionRule ?? additionalPermissionRule ?? reason ?? undefined,
    canApproveAlways: true,
    questions,
  }
}

// Convenience: try every provider's extractor in turn. Returns the pending
// permission a frame describes, or null.
export function extractPendingPermission(payload: unknown): PendingPermission | null {
  return extractOpenCodePermission(payload)
    ?? extractCopilotPermission(payload)
    ?? extractClaudePermission(payload)
    ?? extractCodexApproval(payload)
}

export function extractPendingPermissions(
  payloads: unknown[],
  fallback: { sessionId: string; provider: AgentProvider },
): PendingPermission[] {
  return payloads.flatMap((payload) => {
    const permission = extractPendingPermission(payload)
    return permission ? [{
      ...permission,
      provider: permission.provider ?? fallback.provider,
      sessionId: permission.sessionId ?? fallback.sessionId,
    }] : []
  })
}

// Convenience: try every provider's "this permission was resolved" extractor.
// Returns the resolved permission id, or null.
export function extractPermissionReply(payload: unknown): string | null {
  return extractOpenCodePermissionReply(payload)
    ?? extractCopilotPermissionCompletion(payload)
    ?? extractClaudePermissionCompletion(payload)
}
