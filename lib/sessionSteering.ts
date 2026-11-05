// Provider architecture extraction: SDK behavior preserved from the session backend.
import { planFeature } from "./providerDegradation";
import { getRunningSession, interruptRunningSession, steerRunningSessionIdempotent } from "./sessionRuntime";
import { isNativeComposerCommandText } from "./composerCommands";
import type { AgentProvider } from "./types";
export async function steerViewSession(sessionId: string, body: Record<string, unknown>, resolvedProvider: AgentProvider): Promise<Record<string, unknown>> {
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const turnRequestId = typeof body.turnRequestId === 'string' && body.turnRequestId.trim()
        ? body.turnRequestId.trim()
        : undefined;
    const steerRequestId = typeof body.steerRequestId === 'string' && body.steerRequestId.trim()
        ? body.steerRequestId.trim()
        : undefined;
    if (!message)
        throw new Error('message is required');
    if (steerRequestId && steerRequestId.length > 256)
        throw new Error('steerRequestId is too long');
    if (isNativeComposerCommandText(message))
        return { delivered: false };
    try {
        const steered = await steerRunningSessionIdempotent(sessionId, message, turnRequestId, steerRequestId);
        if (!steered.delivered && body.allowInterrupt !== false && getRunningSession(sessionId)) {
            // A runtime that cannot take input mid-turn is steered by ending the
            // turn: the caller queues this message as `delivered: false` already
            // asks, and the interrupt is what lets that queue run now instead of
            // after the whole turn.
            const plan = planFeature(resolvedProvider, 'steer');
            if (plan.mode === 'fallback' && plan.strategy === 'interrupt_restart') {
                await interruptRunningSession(sessionId, turnRequestId);
                return { delivered: false, interrupted: true };
            }
        }
        return { delivered: steered.delivered, messageUuid: steered.messageUuid };
    }
    catch {
        return body.allowInterrupt === false ? { delivered: false, deliveryUncertain: true } : { delivered: false };
    }
}

