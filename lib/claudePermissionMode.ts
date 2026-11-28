const modes = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions', 'dontAsk'] as const

export function isClaudeComposerPermissionMode(value: unknown): value is (typeof modes)[number] {
  return modes.some(mode => mode === value)
}

export type ClaudeComposerPermissionMode = (typeof modes)[number]

export function claudePermissionModeFromFrame(frame: Record<string, unknown>): ClaudeComposerPermissionMode | undefined {
  if (frame.type === 'system' && (frame.subtype === 'init' || frame.subtype === 'status')
    && isClaudeComposerPermissionMode(frame.permissionMode)) return frame.permissionMode
}
