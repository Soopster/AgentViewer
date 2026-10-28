import { composer } from './composer'
import type { ProviderManifest } from '../types'

export const manifest = {
  apiVersion: 1,
  id: 'lmstudio',
  displayName: 'LM Studio',
  assistantLabel: 'LM STUDIO',
  composer,
  supportsInstances: false,
  newSession: true,
  attachments: { types: [], remotePaths: false, imageBlobsOnly: false },
  capabilities: {
    messageFork: false,
    resumeAtMessage: false,
    fileRewind: false,
    rollback: false,
    deleteSession: true,
    shareSession: false,
    unshareSession: false,
    summarizeSession: false,
    unrevertSession: false,
    respondToPermission: false,
    activeSteering: false,
    inPlaceRewind: false,
  },
  transport: 'native',
  indexable: true,
} as const satisfies ProviderManifest
