export type TerminalAgentState = 'working' | 'blocked' | 'idle' | 'unknown';
/** Where on the screen a rule looks. Counts are of non-empty lines. */
export type ScreenRegion = {
    kind: 'title';
} | {
    kind: 'whole';
} | {
    kind: 'bottom';
    lines: number;
} | {
    kind: 'top';
    lines: number;
} | {
    kind: 'after-last-rule';
};
export type ScreenPredicate = {
    /** Every substring must appear (case-insensitive). */
    contains?: string[];
    /** At least one of these must hold. */
    any?: ScreenPredicate[];
    /** Every one of these must hold. */
    all?: ScreenPredicate[];
    /** None of these may hold. */
    not?: ScreenPredicate[];
    /** A regular expression (JS flags `im`) matched against the region. */
    regex?: string;
    /** A regular expression that some single line of the region must match. */
    lineRegex?: string;
};
export type DetectionRule = ScreenPredicate & {
    id: string;
    state: TerminalAgentState;
    priority: number;
    region: ScreenRegion;
    /** The rule describes a view that says nothing about the agent (a transcript pager). */
    keepState?: boolean;
};
export type AgentManifest = {
    id: string;
    aliases?: string[];
    rules: DetectionRule[];
};
export type ScreenSnapshot = {
    lines: readonly string[];
    title?: string;
};
export type Detection = {
    state: TerminalAgentState;
    ruleId: string | null;
    keepState: boolean;
};
/** The highest-priority rule that matches, or `unknown` with no rule. Ties go to the earlier rule. */
export declare function classifyScreen(manifest: AgentManifest, screen: ScreenSnapshot): Detection;
/** Why a screen was classified as it was: every rule that matched, best first. */
export declare function explainScreen(manifest: AgentManifest, screen: ScreenSnapshot): {
    winner: Detection;
    matched: Array<{
        id: string;
        state: TerminalAgentState;
        priority: number;
    }>;
};
export declare const CLAUDE_MANIFEST: AgentManifest;
export declare const CODEX_MANIFEST: AgentManifest;
export declare const AGENT_MANIFESTS: readonly AgentManifest[];
export declare function findAgentManifest(name: string): AgentManifest | null;
/** The manifest for whatever program a terminal is running, by executable name. */
export declare function manifestForProgram(program: string): AgentManifest | null;
/**
 * The agent a screen belongs to when the program is not known: every manifest
 * classifies it and the rule with the highest priority wins. Rules name footers
 * only their own agent draws, so a screen another agent owns matches nothing here.
 */
export declare function classifyAnyAgent(screen: ScreenSnapshot): {
    agent: string;
    detection: Detection;
} | null;
