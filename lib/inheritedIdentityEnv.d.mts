type Env = Record<string, string | undefined>
export declare const INHERITED_AGENT_IDENTITY_KEYS: readonly string[]
export declare const INHERITED_TERMINAL_IDENTITY_KEYS: readonly string[]
export declare function scrubInheritedAgentIdentity(env?: Env): string[]
export declare function hostedTerminalEnv<E extends Env = NodeJS.ProcessEnv>(env?: E): E
