// Provider architecture extraction: SDK behavior preserved from the session backend.
import type { AgentProvider, SendAttachment, ReasoningEffortLevel } from "../../types";
export const REASONING_EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'max', 'xhigh'] as const;
export function parseEffort(body: Record<string, unknown>): ReasoningEffortLevel | undefined {
    const effort = typeof body.effort === 'string' ? body.effort.trim() : '';
    return REASONING_EFFORT_LEVELS.includes(effort as typeof REASONING_EFFORT_LEVELS[number])
        ? effort as typeof REASONING_EFFORT_LEVELS[number]
        : undefined;
}
export function parseTurnRequestId(body: Record<string, unknown>): string {
    return typeof body.turnRequestId === 'string' && body.turnRequestId.trim()
        ? body.turnRequestId.trim()
        : crypto.randomUUID();
}
export function parseQuestionAnswers(value: unknown): Record<string, string[]> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const answers: Record<string, string[]> = {};
    for (const [key, rawAnswer] of Object.entries(value as Record<string, unknown>)) {
        if (typeof rawAnswer === 'string') {
            answers[key] = [rawAnswer];
            continue;
        }
        if (Array.isArray(rawAnswer) && rawAnswer.every((entry) => typeof entry === 'string')) {
            answers[key] = rawAnswer;
        }
    }
    return answers;
}
export function parseAttachmentPayload(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}
export function parseAttachments(body: Record<string, unknown>): SendAttachment[] {
    const raw = body.attachments;
    if (!Array.isArray(raw))
        return [];
    return raw.flatMap((entry): SendAttachment[] => {
        if (!entry || typeof entry !== 'object')
            return [];
        const record = entry as Record<string, unknown>;
        const type = typeof record.type === 'string' ? record.type : '';
        if (!['file', 'directory', 'selection', 'image', 'mention', 'skill', 'blob', 'agent', 'extension_context'].includes(type))
            return [];
        return [{
                id: typeof record.id === 'string' ? record.id : undefined,
                type: type as SendAttachment['type'],
                path: typeof record.path === 'string' ? record.path.trim() : undefined,
                filePath: typeof record.filePath === 'string' ? record.filePath.trim() : undefined,
                displayName: typeof record.displayName === 'string' ? record.displayName.trim() : undefined,
                text: typeof record.text === 'string' ? record.text : undefined,
                data: typeof record.data === 'string' ? record.data : undefined,
                mimeType: typeof record.mimeType === 'string' ? record.mimeType.trim() : undefined,
                extensionId: typeof record.extensionId === 'string' ? record.extensionId.trim() : undefined,
                canvasId: typeof record.canvasId === 'string' ? record.canvasId.trim() : undefined,
                instanceId: typeof record.instanceId === 'string' ? record.instanceId.trim() : undefined,
                capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt.trim() : undefined,
                payload: parseAttachmentPayload(record.payload),
                selection: normalizeSelection(record.selection),
            }];
    }).slice(0, 12);
}
export function normalizeSelection(value: unknown): SendAttachment['selection'] | undefined {
    if (!value || typeof value !== 'object')
        return undefined;
    const record = value as Record<string, unknown>;
    const start = normalizePosition(record.start);
    const end = normalizePosition(record.end);
    return start && end ? { start, end } : undefined;
}
export function normalizePosition(value: unknown): {
    line: number;
    character: number;
} | undefined {
    if (!value || typeof value !== 'object')
        return undefined;
    const record = value as Record<string, unknown>;
    const line = Number(record.line);
    const character = Number(record.character);
    return Number.isFinite(line) && Number.isFinite(character)
        ? { line, character }
        : undefined;
}
export function turnUsageToEventData(outputTokens: number): string {
    return `event: turn-usage\ndata: ${JSON.stringify({ outputTokens })}\n\n`;
}
/**
 * Emits the composer status line's live output-token counter.
 *
 * Every provider computes its own turn total differently — Codex advances a
 * usage struct, OpenCode keys by message id, Copilot dedupes by usage-event
 * id, Pi and LM Studio read a final per-message count, Claude sums the latest
 * cumulative count per message. What the `turn-usage` frame means must NOT
 * vary with that: it is always the ABSOLUTE total so far, and the client only
 * ever assigns it. Route every provider through this reporter so none of them
 * can drift back to emitting a delta, and so an unchanged total doesn't cost
 * an SSE frame and a status-line re-render.
 *
 * Exported for turnUsageReporterSmoke.ts.
 */
export function createTurnUsageReporter(enqueue: (chunk: string) => void) {
    let lastEmitted = -1;
    return (outputTokens: number | null | undefined) => {
        if (typeof outputTokens !== 'number' || !Number.isFinite(outputTokens))
            return;
        const total = Math.max(0, Math.trunc(outputTokens));
        if (total === lastEmitted)
            return;
        lastEmitted = total;
        enqueue(turnUsageToEventData(total));
    };
}
// How many inconclusive probes (provider unreachable / status unknown) to
// tolerate after a silence window before giving up and resolving the turn so
// the request can never hang indefinitely.
export const WATCHDOG_MAX_UNKNOWN_PROBES = 3;
export type TurnWatchdogVerdict = 'idle' | 'running' | 'unknown';
/**
 * Backstop for a send stream whose provider can miss its own terminal signal
 * (a dropped/reconnected event subscription that swallows session.idle, a
 * heuristic completion timer that never fires, etc.). The timer resets on every
 * outbound SSE frame; after `idleTimeoutMs` of total silence it asks the
 * provider — authoritatively — whether the turn is actually still running.
 *
 * Crucially it only resolves the turn when the probe CONFIRMS idle, so a long
 * but silent tool call (e.g. a multi-minute build that emits no frames between
 * tool start and result) is never killed while the agent is still working — the
 * probe reports 'running' and the watchdog simply waits again. Only after the
 * provider says idle, or after several inconclusive probes, does it fire
 * `onResolved`, which the caller uses to synthesize a terminal frame and close.
 */
export function startTurnWatchdog(opts: {
    label: string;
    idleTimeoutMs: number;
    /** Test seam; production callers retain the one-second floor. */
    minimumDelayMs?: number;
    isClosed: () => boolean;
    lastActivityAt: () => number;
    probe: () => Promise<TurnWatchdogVerdict>;
    onResolved: (reason: string) => void;
}): () => void {
    const { label, idleTimeoutMs, isClosed, lastActivityAt, probe, onResolved } = opts;
    let cancelled = false;
    let probing = false;
    let unknownStreak = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = (fromNow = false) => {
        if (cancelled)
            return;
        const elapsed = Date.now() - lastActivityAt();
        // After a probe, wait a complete silence window before probing again.
        // Reusing the original activity timestamp here caused a confirmed-running
        // provider (or a transiently unreachable one) to be hammered every second.
        const minimumDelayMs = opts.minimumDelayMs ?? 1000;
        const wait = fromNow
            ? Math.max(idleTimeoutMs, minimumDelayMs)
            : Math.max(idleTimeoutMs - elapsed, minimumDelayMs);
        timer = setTimeout(() => { void tick(); }, wait);
        if (typeof timer === 'object' && timer && 'unref' in timer) {
            (timer as {
                unref: () => void;
            }).unref();
        }
    };
    const tick = async () => {
        timer = null;
        if (cancelled || isClosed())
            return;
        // Activity arrived while the timer was pending — not silent after all.
        if (Date.now() - lastActivityAt() < idleTimeoutMs) {
            arm();
            return;
        }
        if (probing) {
            arm();
            return;
        }
        probing = true;
        let verdict: TurnWatchdogVerdict = 'unknown';
        try {
            verdict = await probe();
        }
        catch {
            verdict = 'unknown';
        }
        finally {
            probing = false;
        }
        if (cancelled || isClosed())
            return;
        if (verdict === 'idle') {
            onResolved(`${label}: turn idle confirmed after ${idleTimeoutMs}ms of silence`);
            return;
        }
        if (verdict === 'running') {
            unknownStreak = 0;
            arm(true);
            return;
        }
        unknownStreak += 1;
        if (unknownStreak >= WATCHDOG_MAX_UNKNOWN_PROBES) {
            onResolved(`${label}: no terminal signal and ${unknownStreak} inconclusive probes after silence`);
            return;
        }
        arm(true);
    };
    arm();
    return () => {
        cancelled = true;
        if (timer != null) {
            clearTimeout(timer);
            timer = null;
        }
    };
}
// Generic command-result frame for any provider that executes a slash command
// natively (e.g. /compact) instead of sending it as prompt text. The clients
// render the `message` field as a session notice.
export function commandResultEvent(provider: AgentProvider, data: Record<string, unknown>): string {
    return `event: command-result\ndata: ${JSON.stringify({ provider, transcriptExpected: true, ...data })}\n\n`;
}
// A non-fatal banner shown mid-turn (e.g. an MCP elicitation prompt). Distinct
// from command-result, which the client treats as a turn-ending result and uses
// to clear the live overlay.
export function turnNoticeEvent(message: string): string {
    return `event: turn-notice\ndata: ${JSON.stringify({ message })}\n\n`;
}

