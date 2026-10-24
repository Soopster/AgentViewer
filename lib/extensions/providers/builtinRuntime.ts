// Temporary compatibility implementation for the existing SDK integrations.
// New extensions implement ProviderRuntime directly, without backend branches.
// This entry is deliberately separate from provider read adapters.
import {
  builtinCreateNewViewSession,
  builtinStreamViewSessionTurn,
  builtinPrewarmViewSession,
  builtinRunViewSessionAction,
  builtinForkViewSessionUnrecorded,
  builtinRewindOrRollbackViewSession,
  builtinCloseViewSession,
  builtinListPendingProviderPermissionPayloads,
} from '../../sessionBackend'
import type { ProviderRuntime } from './types'

export const builtinRuntime = {
  createSession: builtinCreateNewViewSession,
  streamTurn: builtinStreamViewSessionTurn,
  prewarm: builtinPrewarmViewSession,
  runAction: builtinRunViewSessionAction,
  forkSession: builtinForkViewSessionUnrecorded,
  rewindSession: builtinRewindOrRollbackViewSession,
  closeSession: builtinCloseViewSession,
  listPendingPermissions: builtinListPendingProviderPermissionPayloads,
} satisfies ProviderRuntime
