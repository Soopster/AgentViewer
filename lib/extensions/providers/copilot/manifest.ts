import { composer } from './composer'
import type { ProviderManifest } from '../types'

export const manifest = {
  apiVersion: 1,
  id: 'copilot',
  displayName: 'Copilot',
  assistantLabel: 'COPILOT',
  composer,
  supportsInstances: false,
  newSession: true,
  attachments: { types: ['file', 'image', 'mention', 'directory', 'blob', 'extension_context', 'selection'], remotePaths: false, imageBlobsOnly: false },
  capabilities: {
    messageFork: false,
    resumeAtMessage: false,
    fileRewind: true,
    rollback: false,
    deleteSession: true,
    shareSession: false,
    unshareSession: false,
    summarizeSession: false,
    unrevertSession: false,
    respondToPermission: true,
    activeSteering: true,
    inPlaceRewind: false,
  },
  transport: 'native',
  indexable: true,
} as const satisfies ProviderManifest
