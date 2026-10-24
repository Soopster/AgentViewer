import { composer } from './composer'
import type { ProviderManifest } from '../types'

export const manifest = {
  apiVersion: 1,
  id: 'claude',
  displayName: 'Claude',
  assistantLabel: 'CLAUDE',
  composer,
  supportsInstances: true,
  newSession: true,
  attachments: { types: ['image', 'blob'], remotePaths: false, imageBlobsOnly: true },
  capabilities: {
    messageFork: true,
    resumeAtMessage: true,
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
