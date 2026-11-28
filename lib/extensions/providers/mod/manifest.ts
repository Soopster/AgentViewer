import type { ProviderManifest } from '../types'

export const manifest = {
  apiVersion: 1,
  id: "mod",
  displayName: "Mods",
  assistantLabel: "MOD",
  transport: 'native',
  indexable: true,
  newSession: true,
  // One instance per provider mod (lib/modProvider.ts); every call is routed by the instance.
  supportsInstances: true,
  // Native attachments are opt-in. Other representable inputs use portable text.
  attachments: { types: [] },
  capabilities: {
    messageFork: false, resumeAtMessage: false, fileRewind: false,
    rollback: false, deleteSession: false, shareSession: false,
    unshareSession: false, summarizeSession: false, unrevertSession: false,
    respondToPermission: false, activeSteering: false, inPlaceRewind: false,
  },
} as const satisfies ProviderManifest
