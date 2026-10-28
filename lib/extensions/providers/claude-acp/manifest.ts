import { composer } from '../claude/composer'
import type { ProviderManifest } from '../types'

export const manifest = {
  apiVersion: 1,
  id: 'claude-acp',
  displayName: 'Claude (ACP)',
  assistantLabel: 'CLAUDE (ACP)',
  composer,
  supportsInstances: false,
  newSession: false,
  attachments: { types: ['file', 'image', 'mention', 'directory', 'blob', 'extension_context', 'selection'], remotePaths: false, imageBlobsOnly: false },
  capabilities: {
    messageFork: false,
    resumeAtMessage: false,
    fileRewind: false,
    rollback: false,
    deleteSession: false,
    shareSession: false,
    unshareSession: false,
    summarizeSession: false,
    unrevertSession: false,
    respondToPermission: true,
    activeSteering: false,
    inPlaceRewind: false,
  },
  transport: 'acp',
  indexable: false,
} as const satisfies ProviderManifest
