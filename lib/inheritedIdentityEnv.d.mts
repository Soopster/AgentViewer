export declare const INHERITED_AGENT_IDENTITY_KEYS: readonly string[]
export declare const INHERITED_TERMINAL_IDENTITY_KEYS: readonly string[]
export declare function scrubInheritedAgentIdentity(env?: NodeJS.ProcessEnv): string[]
export declare function hostedTerminalEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
