import { composer } from './composer'
import type { ProviderManifest } from '../types'

export const manifest = {
  apiVersion: 1,
  id: 'codex',
  displayName: 'Codex',
  assistantLabel: 'CODEX',
  composer,
  supportsInstances: true,
  newSession: true,
  attachments: { types: ['file', 'directory', 'image', 'mention', 'skill', 'blob'], remotePaths: true, imageBlobsOnly: true },
  capabilities: {
    messageFork: false,
    resumeAtMessage: false,
    fileRewind: false,
    rollback: true,
    deleteSession: false,
    shareSession: false,
    unshareSession: false,
    summarizeSession: false,
    unrevertSession: false,
    respondToPermission: true,
    activeSteering: true,
    inPlaceRewind: true,
  },
  transport: 'native',
  indexable: true,
} as const satisfies ProviderManifest
