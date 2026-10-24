import { forModel, callJson, bindingKey, registry, piRegistry, copilotRegistry, jsonSchemaParams } from './coordinatorProviderBindings'
export { resolveCoordinatorToolCall } from './coordinatorProviderBindings'
export { getCoordinatorMcpServers, unregisterCoordinatorMcpServer, getCoordinatorPiTools, unregisterCoordinatorPiTools, getCoordinatorCopilotTools, unregisterCoordinatorCopilotTools, getCoordinatorCodexIdentity, registerCoordinatorCodexTools, unregisterCoordinatorCodexTools, dispatchCoordinatorCodexToolCall, getCoordinatorOpenCodeToolMask, registerCoordinatorOpenCodeTools, unregisterCoordinatorOpenCodeTools, dispatchCoordinatorOpenCodeToolCall, getCoordinatorAcpMcpServers, registerCoordinatorAcpTools, unregisterCoordinatorAcpTools, unregisterCoordinatorRunTools } from './coordinatorProviderBindings'
/**
 * In-process Coordinator tools for internally-hosted (pooled) agent sessions
 * — the SDK-tool counterpart to bin/agent-viewer-mcp.mjs's stdio tool set.
 * External CLIs reach the coordinator over stdio + HTTP; a pooled session
 * lives in this same process, so its tools call `executeExternalCoordinatorAction`
 * directly (no IPC, no fenced-block text protocol, no prompt-engineered
 * grammar to re-explain every turn).
 *
 * Every provider's native SDK has its own shape for "a locally-executed
 * custom tool," so coordinatorToolContract.mjs is the single source of truth for
 * the coord_* contract (name, fields, the coordinator action + arg mapping)
 * and each provider gets a small converter from that shared spec to its own
 * tool type — buildCoordinatorSdkTools (Claude, zod shapes), buildCoordinatorPiTools
 * (Pi, TypeBox), buildCoordinatorCopilotTools (Copilot, zod objects). Codex
 * doesn't have an SDK tool type at all — see registerCoordinatorCodexTools
 * for its dynamicTools + server-request flow.
 *
 * A run's controller registers a provider instance + session id → identity binding per
 * Claude/Pi/Copilot/Codex agent (see the register* functions below) and each
 * provider's client looks the binding up by session id at the point it
 * actually starts/resumes that session.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { currentProviderInstanceId } from './providerInstances';
import type { AgentProvider } from './types';
import { z } from 'zod';
import { Type, type TSchema } from 'typebox';
import type { ToolDefinition as PiToolDefinition } from '@earendil-works/pi-coding-agent';
import type { DynamicToolSpec } from './codex-schema/v2';
import type { JsonValue } from './codex-schema/serde_json/JsonValue';
import type { ExternalProtocolIdentity } from './agentProtocol';
import { coordinatorModelResult } from './coordinatorModelResult.mjs';
import { COORD_TOOL_SPECS, coordinatorToolSpecsForRole, type FieldSpec } from './coordinatorToolContract.mjs';
export { COORD_FINDING_DETAIL_MAX_CHARS } from './coordinatorToolContract.mjs';
function textResult(value: unknown) {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    };
}
function errorResult(error: unknown) {
    return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true as const,
    };
}
// Deferred: agentCoordinationExternal.ts pulls in agentCoordination.ts, which
// pulls in sessionBackend.ts/claudePool.ts/piClient.ts/copilotClient.ts/codexClient.ts,
// which import this module at their top level to look up registered tools —
// a static import here would close that into a cycle. Node resolves a
// runtime import() after every module's own top-level body has finished
// evaluating, so this stays a leaf module for bundling purposes while still
// reaching the real dispatcher when called.
async function call(identity: ExternalProtocolIdentity, action: string, args: Record<string, unknown> = {}) {
    try {
        const { executeExternalCoordinatorAction } = await import('./agentCoordinationExternal');
        const result = await executeExternalCoordinatorAction({
            action,
            runId: identity.runId,
            agentId: identity.agentId,
            token: identity.token,
            requestId: randomUUID(),
            ...args,
        });
        return textResult(forModel(action, result));
    }
    catch (error) {
        return errorResult(error);
    }
}
// ---- Shared coord_* tool contract -----------------------------------------
function zodField(f: FieldSpec): z.ZodTypeAny {
    let base: z.ZodTypeAny;
    switch (f.t) {
        case 'string': {
            let s = z.string();
            if (f.min !== undefined)
                s = s.min(f.min);
            if (f.max !== undefined)
                s = s.max(f.max);
            base = s;
            break;
        }
        case 'enum':
            base = z.enum(f.values);
            break;
        case 'number': {
            let n = z.number();
            if (f.int)
                n = n.int();
            if (f.min !== undefined)
                n = n.min(f.min);
            if (f.max !== undefined)
                n = n.max(f.max);
            base = n;
            break;
        }
        case 'boolean':
            base = z.boolean();
            break;
        case 'stringArray': {
            let arr = z.array(z.string().min(1));
            if (f.min !== undefined)
                arr = arr.min(f.min);
            if (f.max !== undefined)
                arr = arr.max(f.max);
            base = arr;
            break;
        }
    }
    return f.optional ? base.optional() : base;
}
function zodShape(fields: Record<string, FieldSpec>): Record<string, z.ZodTypeAny> {
    return Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, zodField(spec)]));
}
/** Build the coord_* tool set bound to one participant identity (Claude Agent SDK). */
export function buildCoordinatorSdkTools(identity: ExternalProtocolIdentity) {
    return coordinatorToolSpecsForRole(identity.role).map((spec) => tool(spec.name, spec.description, zodShape(spec.fields), async (args: Record<string, any>) => call(identity, spec.action, spec.mapArgs(args))));
}
/**
 * Bind a session id to a Coordinator identity's tool set for its whole lifetime.
 * Re-registering the same identity keeps the existing record: the Claude pool
 * compares this object by identity to decide whether a warm subprocess still
 * carries the right binding, and a fresh object per turn would respawn it every turn.
 */
export function registerCoordinatorMcpServer(sessionId: string, identity: ExternalProtocolIdentity, providerInstanceId?: string): void {
    const current = registry.get(bindingKey('claude', sessionId, providerInstanceId))?.identity;
    if (current && current.runId === identity.runId && current.agentId === identity.agentId && current.token === identity.token && current.role === identity.role)
        return;
    registry.set(bindingKey('claude', sessionId, providerInstanceId), {
        identity,
        servers: {
            'agent-viewer': createSdkMcpServer({
                name: 'agent-viewer',
                tools: buildCoordinatorSdkTools(identity),
            }),
        },
    });
}
// ---- Pi (TypeBox customTools) ----------------------------------------------
function typeboxField(f: FieldSpec): TSchema {
    let base: TSchema;
    switch (f.t) {
        case 'string':
            base = Type.String(f.min !== undefined || f.max !== undefined ? { minLength: f.min, maxLength: f.max } : undefined);
            break;
        case 'enum':
            base = Type.Union(f.values.map((value) => Type.Literal(value)));
            break;
        case 'number':
            base = f.int
                ? Type.Integer(f.min !== undefined || f.max !== undefined ? { minimum: f.min, maximum: f.max } : undefined)
                : Type.Number(f.min !== undefined || f.max !== undefined ? { minimum: f.min, maximum: f.max } : undefined);
            break;
        case 'boolean':
            base = Type.Boolean();
            break;
        case 'stringArray':
            base = Type.Array(Type.String({ minLength: 1 }), f.min !== undefined || f.max !== undefined ? { minItems: f.min, maxItems: f.max } : undefined);
            break;
    }
    return f.optional ? Type.Optional(base) : base;
}
function typeboxParams(fields: Record<string, FieldSpec>): TSchema {
    return Type.Object(Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, typeboxField(spec)])));
}
/** Build the coord_* tool set bound to one participant identity (Pi's customTools). */
export function buildCoordinatorPiTools(identity: ExternalProtocolIdentity): PiToolDefinition[] {
    return coordinatorToolSpecsForRole(identity.role).map((spec) => ({
        name: spec.name,
        label: spec.name,
        description: spec.description,
        parameters: typeboxParams(spec.fields),
        async execute(_toolCallId: string, params: Record<string, any>) {
            const { text, isError } = await callJson(identity, spec.action, spec.mapArgs(params));
            return {
                content: [{ type: 'text' as const, text }],
                details: isError ? { error: text } : undefined,
            };
        },
    }));
}
export function registerCoordinatorPiTools(sessionId: string, identity: ExternalProtocolIdentity, providerInstanceId?: string): void {
    piRegistry.set(bindingKey('pi', sessionId, providerInstanceId), { identity, tools: buildCoordinatorPiTools(identity) });
}
// ---- Copilot (zod-schema Tool[]) -------------------------------------------
/** Build the coord_* tool set bound to one participant identity (Copilot SDK's Tool[]). */
export function buildCoordinatorCopilotTools(identity: ExternalProtocolIdentity): unknown[] {
    return coordinatorToolSpecsForRole(identity.role).map((spec) => ({
        name: spec.name,
        description: spec.description,
        parameters: z.object(zodShape(spec.fields)),
        skipPermission: true,
        async handler(args: Record<string, any>) {
            const { text, isError } = await callJson(identity, spec.action, spec.mapArgs(args));
            if (isError)
                throw new Error(text);
            return text;
        },
    }));
}
export function registerCoordinatorCopilotTools(sessionId: string, identity: ExternalProtocolIdentity, providerInstanceId?: string): void {
    copilotRegistry.set(bindingKey('copilot', sessionId, providerInstanceId), { identity, tools: buildCoordinatorCopilotTools(identity) });
}
/** Codex's ThreadStartParams.dynamicTools shape — {type:'function', name, description, inputSchema}. */
export function buildCoordinatorCodexDynamicTools(role?: ExternalProtocolIdentity['role']): DynamicToolSpec[] {
    return coordinatorToolSpecsForRole(role).map((spec) => ({
        type: 'function' as const,
        name: spec.name,
        description: spec.description,
        // jsonSchemaParams only ever nests string/number/boolean/array/plain-object
        // literals we control above — structurally a JsonValue, just not provably
        // so to a Record<string, unknown> return type.
        inputSchema: jsonSchemaParams(spec.fields) as unknown as JsonValue,
    }));
}
