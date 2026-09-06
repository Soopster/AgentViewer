import type {
  AgentDefinition,
  AgentMcpServerSpec,
  Options,
  PermissionMode,
  SandboxSettings,
} from '@anthropic-ai/claude-agent-sdk'
import type { ReasoningEffortLevel } from './types'
import { parseClaudeDynamicMcpServers } from './claudeDynamicMcp'

export type ClaudeAgentPermissionMode = Extract<PermissionMode, 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk'>

const PERMISSION_MODES = new Set<ClaudeAgentPermissionMode>([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
])

const EFFORTS = new Set<ReasoningEffortLevel>([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

export type ClaudeAgentPolicy = {
  /** Stable role/agent name used for the SDK's main-thread AgentDefinition. */
  name?: string
  description?: string
  prompt?: string
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[]
  model?: string
  mcpServers?: AgentMcpServerSpec[]
  criticalSystemReminder?: string
  initialPrompt?: string
  maxTurns?: number
  background?: boolean
  memory?: 'user' | 'project' | 'local'
  effort?: ReasoningEffortLevel
  permissionMode?: ClaudeAgentPermissionMode
  observer?: string
  observerMessage?: string
  sandbox?: SandboxSettings
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean))]
  return values.length > 0 || value.length === 0 ? values : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function sandboxSettings(value: unknown): SandboxSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  // The SDK validates the full nested schema at option intake. Keep the parser
  // forward-compatible with new SDK sandbox keys while refusing non-objects.
  return { ...(value as SandboxSettings) }
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function agentMcpServers(value: unknown): AgentMcpServerSpec[] | undefined {
  if (!Array.isArray(value)) return undefined
  const servers = value.flatMap((entry): AgentMcpServerSpec[] => {
    if (typeof entry === 'string' && entry.trim()) return [entry.trim()]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    try {
      return [parseClaudeDynamicMcpServers(entry)]
    } catch {
      return []
    }
  })
  return servers.length > 0 || value.length === 0 ? servers : undefined
}

/**
 * Parse the Coordinator-to-runtime policy boundary. Unknown fields are ignored
 * so an older Agent Viewer can safely receive policy produced by a newer lead.
 */
export function parseClaudeAgentPolicy(value: unknown): ClaudeAgentPolicy | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const permissionMode = typeof input.permissionMode === 'string'
    && PERMISSION_MODES.has(input.permissionMode as ClaudeAgentPermissionMode)
    ? input.permissionMode as ClaudeAgentPermissionMode
    : undefined
  const effort = typeof input.effort === 'string'
    && EFFORTS.has(input.effort as ReasoningEffortLevel)
    ? input.effort as ReasoningEffortLevel
    : undefined
  const policy: ClaudeAgentPolicy = {
    name: optionalString(input.name),
    description: optionalString(input.description),
    prompt: optionalString(input.prompt),
    tools: stringArray(input.tools),
    disallowedTools: stringArray(input.disallowedTools),
    skills: stringArray(input.skills),
    model: optionalString(input.model),
    mcpServers: agentMcpServers(input.mcpServers),
    criticalSystemReminder: optionalString(input.criticalSystemReminder),
    initialPrompt: optionalString(input.initialPrompt),
    maxTurns: positiveInteger(input.maxTurns),
    background: typeof input.background === 'boolean' ? input.background : undefined,
    memory: input.memory === 'user' || input.memory === 'project' || input.memory === 'local' ? input.memory : undefined,
    effort,
    permissionMode,
    observer: optionalString(input.observer),
    observerMessage: optionalString(input.observerMessage),
    sandbox: sandboxSettings(input.sandbox),
  }
  return Object.values(policy).some((entry) => entry !== undefined) ? policy : undefined
}

/** Immutable SDK options represented by a role policy. */
export function claudeAgentPolicyOptions(policy: ClaudeAgentPolicy | undefined): Partial<Options> {
  if (!policy) return {}
  const agentName = policy.name ?? (policy.prompt || policy.description ? 'agent-viewer-role' : undefined)
  let agents: Record<string, AgentDefinition> | undefined
  if (agentName) {
    agents = {
      [agentName]: {
        description: policy.description ?? `Agent Viewer ${agentName} role`,
        prompt: policy.prompt ?? `Act as the ${agentName} role and follow the assigned task and coordination contract.`,
        ...(policy.tools ? { tools: policy.tools } : {}),
        ...(policy.disallowedTools ? { disallowedTools: policy.disallowedTools } : {}),
        ...(policy.skills ? { skills: policy.skills } : {}),
        ...(policy.model ? { model: policy.model } : {}),
        ...(policy.mcpServers ? { mcpServers: policy.mcpServers } : {}),
        ...(policy.criticalSystemReminder ? { criticalSystemReminder_EXPERIMENTAL: policy.criticalSystemReminder } : {}),
        ...(policy.initialPrompt ? { initialPrompt: policy.initialPrompt } : {}),
        ...(policy.maxTurns ? { maxTurns: policy.maxTurns } : {}),
        ...(policy.background !== undefined ? { background: policy.background } : {}),
        ...(policy.memory ? { memory: policy.memory } : {}),
        ...(policy.effort && policy.effort !== 'off' && policy.effort !== 'minimal'
          ? { effort: policy.effort }
          : {}),
        ...(policy.permissionMode ? { permissionMode: policy.permissionMode } : {}),
        ...(policy.observer ? { observer: policy.observer } : {}),
        ...(policy.observerMessage ? { observerMessage: policy.observerMessage } : {}),
      },
    }
  }
  return {
    ...(agentName ? { agent: agentName } : {}),
    ...(agents ? { agents } : {}),
    ...(policy.tools ? { tools: policy.tools } : {}),
    ...(policy.disallowedTools ? { disallowedTools: policy.disallowedTools } : {}),
    ...(policy.skills ? { skills: policy.skills } : {}),
    ...(policy.sandbox ? { sandbox: policy.sandbox } : {}),
  }
}

/** Stable compatibility key for immutable pooled-query policy options. */
export function claudeAgentPolicyKey(policy: ClaudeAgentPolicy | undefined): string {
  return policy ? JSON.stringify(policy) : ''
}

/** Shared cold/pooled query budget options; keeps both execution paths exact. */
export function claudeQueryBudgetOptions(
  taskBudgetTokens: number | undefined,
  maxBudgetUsd: number | undefined,
): Pick<Options, 'taskBudget' | 'maxBudgetUsd'> {
  return {
    ...(taskBudgetTokens && taskBudgetTokens > 0 ? { taskBudget: { total: Math.floor(taskBudgetTokens) } } : {}),
    ...(maxBudgetUsd && Number.isFinite(maxBudgetUsd) && maxBudgetUsd > 0 ? { maxBudgetUsd } : {}),
  }
}
