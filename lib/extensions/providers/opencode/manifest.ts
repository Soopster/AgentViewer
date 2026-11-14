import { composer } from './composer'
import type { ProviderManifest } from '../types'

export const manifest = {
  apiVersion: 1,
  id: 'opencode',
  displayName: 'OpenCode',
  assistantLabel: 'OPENCODE',
  composer,
  supportsInstances: false,
  newSession: true,
  attachments: { types: ['file', 'image', 'mention', 'blob', 'agent'], remotePaths: true, imageBlobsOnly: true },
  capabilities: {
    messageFork: true,
    resumeAtMessage: true,
    fileRewind: true,
    rollback: false,
    deleteSession: true,
    shareSession: true,
    unshareSession: true,
    summarizeSession: true,
    unrevertSession: true,
    respondToPermission: true,
    activeSteering: true,
    inPlaceRewind: true,
  },
  transport: 'native',
  indexable: true,
} as const satisfies ProviderManifest
