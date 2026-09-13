// The per-provider seam. Every backend read op used to be a chain of
// `if (provider === 'codex') … if (provider === 'opencode') …` inside
// lib/sessionBackend.ts; those branch bodies now live one-per-file under
// lib/adapters/ and sessionBackend.ts routes to them.
//
// The rule that keeps this honest: an op a provider genuinely cannot do is an
// *omitted method*, never a stub returning `[]` or `null`. lib/provider.ts's
// SessionCapabilities stays the declaration of what exists, and
// lib/adapters/registry.ts asserts the two agree at startup — so a capability
// flag can't drift away from the method that backs it.
//
// Adapters are resolved through the request-scoped provider instance
// (lib/providerRequest.ts / lib/providerInstances.ts), not per provider kind:
// two Claude instances pointed at different CLAUDE_CONFIG_DIRs must not share
// state. Keep adapter modules stateless for that reason — any warm resource
// belongs in the existing per-instance pools (claudePool, acpClientPool, …).

import type { ContextTier as CopilotContextTier } from '@github/copilot-sdk'
import type {
  AgentProvider,
  ContextUsage,
  Session,
  SessionComposerOptions,
  SessionDiagnosticSection,
  SessionInfo,
  SessionMessage,
  SessionModelInfo,
  SubagentSummary,
} from '../types'

export type ListParams = {
  limit: number
  offset: number
  dir?: string
  includeWorktrees?: boolean
  provider?: AgentProvider | 'all'
  providerInstanceId?: string
}

export type MessageListParams = {
  limit: number
  offset: number
  tail?: boolean
  /** The uuid the caller believes sits at `offset`.
   *
   *  `offset` is a positional index into a transcript that is re-derived from
   *  the provider on every read, so it is not a stable cursor: a provider that
   *  compacts or rewrites history can leave a caller's offset pointing at a
   *  different message than it did last time. Length checks only catch the
   *  transcript *shrinking*; a rewrite that keeps or grows the length passes
   *  them and the caller silently splices misaligned history.
   *
   *  Passing the expected uuid turns that into a detectable condition: on a
   *  mismatch the window comes back as a `replace` tail instead of a window
   *  the caller would merge incorrectly. */
  expectUuid?: string
}

export type SessionMessageWindow = {
  offset: number
  total: number
  messages: SessionMessage[]
  /** This window is a fresh bounded tail, not a continuation — the caller must
   *  discard what it has rather than merging. Set when the caller's cursor was
   *  found to be stale (see `expectUuid`) or too far behind to catch up on
   *  incrementally. */
  replace?: boolean
  // Codex only: another Codex client currently holds the rollout writer lock,
  // so `messages` is a stale cached snapshot rather than a fresh read — the
  // UI should tell the user this transcript may lag until that client's turn
  // finishes (see readCodexMessagesAll).
  externalWriter?: boolean
}

export type SessionModels = {
  models: SessionModelInfo[]
  currentModel: string | null
  currentContextTier?: CopilotContextTier | null
  contextUsage: ContextUsage | null
}

export type SlashCommand = {
  command: string
  description: string
  argumentHint?: string
}

export type SessionDiagnostics = {
  sections: SessionDiagnosticSection[]
  currentModel: string | null
}

/** One provider's read/metadata surface.
 *
 *  Every method is optional, and *how* an omission behaves is stated per
 *  method below — some ops have a real empty answer (a provider with no
 *  subagents genuinely has none), while others must raise, because silently
 *  returning nothing would read as "this session is empty" when the truth is
 *  "this provider cannot answer". Getting that distinction wrong is the main
 *  regression risk in routing through this interface, so it is spelled out
 *  rather than left to the router's discretion.
 *
 *  Adapters return the provider's own data and nothing else. Instance
 *  decoration, inbox ordering, search-index sync, and persisted-index removal
 *  are the router's job and must not be repeated here. */
export interface SessionAdapter {
  readonly provider: AgentProvider

  /** Raw provider listing, already limit/offset-applied.
   *  Omitted → empty list. ACP omits it: its sessions are transient and
   *  in-memory, so there is nothing to enumerate, and that is a true answer. */
  listSessions?(params: ListParams): Promise<Session[]>

  /** Omitted → `null` (treated as "no such session"). */
  readSessionInfo?(sessionId: string): Promise<SessionInfo | null>

  /** `null` clears the title. Providers that cannot mutate their own metadata
   *  persist it locally instead (see <provider>Tags.ts / <provider>Metadata.ts).
   *  Omitted → raises. */
  setTitle?(sessionId: string, title: string | null): Promise<void>
  /** Omitted → raises. */
  setTag?(sessionId: string, tag: string | null): Promise<void>

  /** Provider-side delete only — the router removes the persisted index entry
   *  afterwards. Omitted → raises, and `SessionCapabilities.deleteSession`
   *  must be false to match (registry.ts asserts the pair). */
  deleteSession?(sessionId: string): Promise<void>

  /** The whole transcript, oldest-first. The router stamps the instance id,
   *  syncs the search index, and slices the requested window — so this returns
   *  everything, not a page. `externalWriter` is Codex's stale-snapshot flag.
   *  Omitted → raises: an empty transcript and an unreadable one must not look
   *  alike. */
  readAllMessages?(sessionId: string): Promise<{ messages: SessionMessage[]; externalWriter?: boolean }>

  /** Transcript of one spawned subagent. Omitted → empty list: a provider
   *  without subagents has none, which is a real answer. */
  readSubagentMessages?(sessionId: string, agentId: string): Promise<SessionMessage[]>
  /** Omitted → empty list, same reasoning as readSubagentMessages. */
  readSubagentSummaries?(sessionId: string): Promise<SubagentSummary[]>

  /** Omitted → empty model list with a null current model; the composer's
   *  picker degrades to "no choices" rather than failing the whole view. */
  readModels?(sessionId: string): Promise<SessionModels>
  /** Omitted → the provider-managed default (a `native` permission mode with
   *  no agent or mode picker), which is the honest answer for a provider whose
   *  CLI owns its own approval policy and exposes no knob for us to drive. */
  readComposerOptions?(sessionId: string): Promise<SessionComposerOptions>
  /** Omitted → empty list. */
  readSlashCommands?(sessionId: string): Promise<SlashCommand[]>
  readDiagnostics?(sessionId: string): Promise<SessionDiagnostics>
}

/** Ops a provider may decline. Kept as a named union so registry.ts can
 *  cross-check each against lib/provider.ts's SessionCapabilities. */
export type SessionAdapterOp = keyof Omit<SessionAdapter, 'provider'>
