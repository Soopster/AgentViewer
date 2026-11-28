
export type TerminalSelectionCopyDestination = 'none' | 'osc52' | 'host'

export function terminalSelectionCopyDestination(options: {
  isDragging: boolean
  nativeOscEnabled: boolean
  osc52Supported: boolean
  windowsClipboard: boolean
}): TerminalSelectionCopyDestination {
  if (options.isDragging) return 'none'
  if (options.nativeOscEnabled && options.osc52Supported) return 'osc52'
  if (options.windowsClipboard) return 'host'
  return 'none'
}