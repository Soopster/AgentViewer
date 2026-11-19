// Provider architecture extraction: SDK behavior preserved from the session backend.
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { currentProviderInstanceId } from "./providerInstances";
import type { AgentProvider } from "./types";
import type { ToolDefinition as PiToolDefinition } from '@earendil-works/pi-coding-agent';
import type { ExternalProtocolIdentity } from "./agentProtocol";
import { coordinatorModelResult } from "./coordinatorModelResult.mjs";
import { COORD_TOOL_SPECS, coordinatorToolSpecsForRole, type FieldSpec } from "./coordinatorToolContract.mjs";
// A wait already answers with the events since the cursor and the actionable
// digest; the whole board rides along for the supervisor that schedules on it.
// The stdio bridge drops it before a model sees it, and so must this path —
// it was about half of a 90KB result.
export const forModel = coordinatorModelResult;
export async function callJson(identity: ExternalProtocolIdentity, action: string, args: Record<string, unknown> = {}): Promise<{
    text: string;
    isError: boolean;
}> {
    try {
        const { executeExternalCoordinatorAction } = await import("./agentCoordinationExternal");
        const result = await executeExternalCoordinatorAction({
            action,
            runId: identity.runId,
            agentId: identity.agentId,
            token: identity.token,
            requestId: randomUUID(),
            ...args,
        });
        return { text: JSON.stringify(forModel(action, result)), isError: false };
    }
    catch (error) {
        return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
}
/** Never infer a binding from another account when no scoped binding exists. */
export function bindingKey(provider: AgentProvider, sessionId: string, instanceId = currentProviderInstanceId(provider)): string {
    return JSON.stringify([provider, instanceId, sessionId]);
}
export const registry = new Map<string, {
    identity: ExternalProtocolIdentity;
    servers: Record<string, McpServerConfig>;
}>();
export function getCoordinatorMcpServers(sessionId: string, providerInstanceId?: string): Record<string, McpServerConfig> | undefined {
    return registry.get(bindingKey('claude', sessionId, providerInstanceId))?.servers;
}
export function unregisterCoordinatorMcpServer(sessionId: string, providerInstanceId?: string): void {
    registry.delete(bindingKey('claude', sessionId, providerInstanceId));
}
export const piRegistry = new Map<string, {
    identity: ExternalProtocolIdentity;
    tools: PiToolDefinition[];
}>();
/** Pi's createAgentSession/customTools option needs the built tool array, not just the identity. */
export function getCoordinatorPiTools(sessionId: string, providerInstanceId?: string): PiToolDefinition[] | undefined {
    return piRegistry.get(bindingKey('pi', sessionId, providerInstanceId))?.tools;
}
export function unregisterCoordinatorPiTools(sessionId: string, providerInstanceId?: string): void {
    piRegistry.delete(bindingKey('pi', sessionId, providerInstanceId));
}
export const copilotRegistry = new Map<string, {
    identity: ExternalProtocolIdentity;
    tools: unknown[];
}>();
export function getCoordinatorCopilotTools(sessionId: string, providerInstanceId?: string): unknown[] | undefined {
    return copilotRegistry.get(bindingKey('copilot', sessionId, providerInstanceId))?.tools;
}
export function unregisterCoordinatorCopilotTools(sessionId: string, providerInstanceId?: string): void {
    copilotRegistry.delete(bindingKey('copilot', sessionId, providerInstanceId));
}
// ---- Codex (JSON-schema dynamicTools + item/tool/call) --------------------
export function jsonSchemaField(f: FieldSpec): Record<string, unknown> {
    switch (f.t) {
        case 'string':
            return { type: 'string', ...(f.min !== undefined ? { minLength: f.min } : {}), ...(f.max !== undefined ? { maxLength: f.max } : {}) };
        case 'enum':
            return { type: 'string', enum: [...f.values] };
        case 'number':
            return { type: f.int ? 'integer' : 'number', ...(f.min !== undefined ? { minimum: f.min } : {}), ...(f.max !== undefined ? { maximum: f.max } : {}) };
        case 'boolean':
            return { type: 'boolean' };
        case 'stringArray':
            return { type: 'array', items: { type: 'string', minLength: 1 }, ...(f.min !== undefined ? { minItems: f.min } : {}), ...(f.max !== undefined ? { maxItems: f.max } : {}) };
    }
}
export function jsonSchemaParams(fields: Record<string, FieldSpec>): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, spec] of Object.entries(fields)) {
        properties[key] = jsonSchemaField(spec);
        if (!spec.optional)
            required.push(key);
    }
    return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}
export const codexRegistry = new Map<string, ExternalProtocolIdentity>();
/** Bind a Codex thread id to a Coordinator identity so the item/tool/call server-request handler (lib/codexClient.ts) can dispatch by name. */
export function registerCoordinatorCodexTools(threadId: string, identity: ExternalProtocolIdentity, providerInstanceId?: string): void {
    codexRegistry.set(bindingKey('codex', threadId, providerInstanceId), identity);
}
export function getCoordinatorCodexIdentity(threadId: string, providerInstanceId?: string): ExternalProtocolIdentity | undefined {
    return codexRegistry.get(bindingKey('codex', threadId, providerInstanceId));
}
export function unregisterCoordinatorCodexTools(threadId: string, providerInstanceId?: string): void {
    codexRegistry.delete(bindingKey('codex', threadId, providerInstanceId));
}
export async function dispatchByRegistry(registry: Map<string, ExternalProtocolIdentity>, sessionId: string, toolName: string, args: Record<string, unknown>): Promise<{
    text: string;
    isError: boolean;
} | null> {
    const identity = registry.get(sessionId);
    const invocation = resolveCoordinatorToolCall(toolName, args);
    if (!identity || !invocation)
        return null;
    return callJson(identity, invocation.action, invocation.args);
}
/** Resolve the shared provider-facing tool contract into a Coordinator action. */
export function resolveCoordinatorToolCall(toolName: string, args: Record<string, unknown>): {
    action: string;
    args: Record<string, unknown>;
} | null {
    const spec = COORD_TOOL_SPECS.find((entry) => entry.name === toolName);
    return spec ? { action: spec.action, args: spec.mapArgs(args) } : null;
}
/** Dispatch a codex item/tool/call for a registered thread. Returns null if the tool name isn't one of ours. */
export function dispatchCoordinatorCodexToolCall(threadId: string, toolName: string, args: Record<string, unknown>, providerInstanceId?: string): Promise<{
    text: string;
    isError: boolean;
} | null> {
    return dispatchByRegistry(codexRegistry, bindingKey('codex', threadId, providerInstanceId), toolName, args);
}
// ---- OpenCode (plugin file + local HTTP bridge) ----------------------------
// OpenCode's server is a genuinely separate OS process (createOpencodeServer
// shells out via cross-spawn — lib/opencodeClient.ts), and its plugin API has
// no per-session tool registration hook (Hooks.tool is one static map for the
// whole server) — so identity resolution has to happen here, keyed by
// sessionID, when the plugin's HTTP bridge call for a tool arrives (see
// lib/coordinatorBridgeServer.ts and lib/opencodePlugin/agentViewerCoordinator.mjs).
export const opencodeRegistry = new Map<string, ExternalProtocolIdentity>();
export function registerCoordinatorOpenCodeTools(sessionId: string, identity: ExternalProtocolIdentity, providerInstanceId?: string): void {
    opencodeRegistry.set(bindingKey('opencode', sessionId, providerInstanceId), identity);
}
/** OpenCode's plugin catalog is server-wide; filter only this session's model tools. */
export function getCoordinatorOpenCodeToolMask(sessionId: string, providerInstanceId?: string): Record<string, boolean> | undefined {
    const identity = opencodeRegistry.get(bindingKey('opencode', sessionId, providerInstanceId));
    if (!identity?.role)
        return undefined;
    const allowed = new Set(coordinatorToolSpecsForRole(identity.role).map(spec => spec.name));
    return Object.fromEntries(COORD_TOOL_SPECS.map(spec => [spec.name, allowed.has(spec.name)]));
}
export function unregisterCoordinatorOpenCodeTools(sessionId: string, providerInstanceId?: string): void {
    opencodeRegistry.delete(bindingKey('opencode', sessionId, providerInstanceId));
}
/** Dispatch an OpenCode coordinator-plugin tool call for a registered session. Returns null if the session isn't a coordinator participant or the tool name isn't one of ours. */
export function dispatchCoordinatorOpenCodeToolCall(sessionId: string, toolName: string, args: Record<string, unknown>): Promise<{
    text: string;
    isError: boolean;
} | null> {
    return dispatchByRegistry(opencodeRegistry, bindingKey('opencode', sessionId), toolName, args);
}
// ---- ACP agents (a stdio MCP server the agent spawns) -----------------------
// An ACP agent is its own process and takes tools only as MCP servers named in
// `session/new`, so binding is two steps: remember the identity here, then the
// send path asks for the server entry when it starts the session.
export const acpRegistry = new Map<string, ExternalProtocolIdentity>();
export function registerCoordinatorAcpTools(sessionId: string, identity: ExternalProtocolIdentity, providerInstanceId?: string): void {
    acpRegistry.set(bindingKey('acp', sessionId, providerInstanceId), identity);
}
export function unregisterCoordinatorAcpTools(sessionId: string, providerInstanceId?: string): void {
    acpRegistry.delete(bindingKey('acp', sessionId, providerInstanceId));
}
/** The MCP servers to declare for this session, or none when it is not a Coordinator participant. */
export async function getCoordinatorAcpMcpServers(sessionId: string, directory: string, providerInstanceId?: string) {
    const identity = acpRegistry.get(bindingKey('acp', sessionId, providerInstanceId));
    if (!identity)
        return undefined;
    const [{ writeCoordinatorAcpMcpServer }, { getCoordinatorBridgeUrl }] = await Promise.all([
        import("./coordinatorAcpMcp"),
        import("./coordinatorBridgeServer"),
    ]);
    const tools = coordinatorToolSpecsForRole(identity.role).map((spec) => ({ name: spec.name, description: spec.description, inputSchema: jsonSchemaParams(spec.fields) }));
    return [await writeCoordinatorAcpMcpServer(directory, await getCoordinatorBridgeUrl(), identity, tools)];
}
/** Teardown all aliases for this run, including bindings restored without a controller. */
export function unregisterCoordinatorRunTools(runId: string, sessionId?: string, providerInstanceId?: string): void {
    function remove<T>(bindings: Map<string, T>, identityFor: (value: T) => ExternalProtocolIdentity) {
        for (const [key, value] of bindings) {
            if (identityFor(value).runId !== runId)
                continue;
            const [, instance, nativeSession] = JSON.parse(key) as string[];
            if (sessionId !== undefined && nativeSession !== sessionId)
                continue;
            if (providerInstanceId !== undefined && instance !== providerInstanceId)
                continue;
            bindings.delete(key);
        }
    }
    remove(registry, value => value.identity);
    remove(piRegistry, value => value.identity);
    remove(copilotRegistry, value => value.identity);
    for (const bindings of [codexRegistry, opencodeRegistry, acpRegistry])
        remove(bindings, value => value);
}

