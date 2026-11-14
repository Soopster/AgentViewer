import { composer } from './composer'
import type { ProviderManifest } from '../types'

export const manifest = {
  apiVersion: 1,
  id: 'pi',
  displayName: 'Pi',
  assistantLabel: 'PI',
  composer,
  supportsInstances: false,
  newSession: true,
  attachments: { types: ['image', 'blob'], remotePaths: false, imageBlobsOnly: true },
  capabilities: {
    messageFork: true,
    resumeAtMessage: false,
    fileRewind: false,
    rollback: false,
    deleteSession: true,
    shareSession: false,
    unshareSession: false,
    summarizeSession: true,
    unrevertSession: false,
    respondToPermission: true,
    activeSteering: true,
    inPlaceRewind: false,
  },
  transport: 'native',
  indexable: true,
} as const satisfies ProviderManifest
