import { mappedMessagesCacheDiagnostics } from './mappedMessagesCache'
import { persistSignatureCacheDiagnostics } from './sessionReads'
import { projectSessionsCache } from './sessionIndexOperations'
import { copilotLiveTranscripts, piLiveTranscripts } from './liveTranscripts'
import { pendingPiUiRequestCount } from './piExtensionUi'
import { getSessionRuntimeDiagnostics } from './sessionRuntime'
import { readProviderDiagnostics } from './providerDiagnostics'
import { registerDiagnosticsReporter } from './runtimeDiagnostics'

export function getServerMemoryDiagnostics(): Record<string, number> {
  const mapped = mappedMessagesCacheDiagnostics()
  const persisted = persistSignatureCacheDiagnostics()
  return {
    sessionInfoCache: 0,
    mappedMessageCache: mapped.entries, mappedMessageCacheMessages: mapped.messages,
    persistedMessagesSignature: persisted.messages, persistedSessionListSignatures: persisted.sessionLists,
    projectSessionsCache: projectSessionsCache.size,
    copilotLiveTranscripts: copilotLiveTranscripts.size, piLiveTranscripts: piLiveTranscripts.size,
    pendingClaudePermissions: 0, pendingClaudeElicitations: 0, pendingClaudeDialogs: 0,
    pendingCopilotPermissions: 0, pendingCopilotElicitations: 0, pendingCodexApprovals: 0,
    pendingPiUiRequests: pendingPiUiRequestCount(),
    claudePool: 0, piPool: 0, piOperations: 0, piEntryCacheSessions: 0, piEntryCacheEntries: 0,
    copilotPool: 0, acpPool: 0,
    ...getSessionRuntimeDiagnostics(), ...readProviderDiagnostics(),
  }
}

registerDiagnosticsReporter(getServerMemoryDiagnostics)
