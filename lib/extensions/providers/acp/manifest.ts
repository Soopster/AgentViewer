import { composer } from './composer'
import type { ProviderManifest } from '../types'

export const manifest = {
  apiVersion: 1,
  id: 'acp',
  displayName: 'ACP agent',
  assistantLabel: 'ACP',
  composer,
  supportsInstances: true,
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
