/** Browser-safe Instructions Manager contract. Inventory describes known files, not runtime activation. */
export type InstructionFile = {
  id: string; path: string; label: string; scope: 'user' | 'project' | 'nested' | 'ancestor'
  consumers: string[]; applies: string; exists: boolean; writable: boolean; linked: boolean; note?: string
}
export type InstructionReceipt = { requestId: string; previewHash: string; path: string; status: 'created' | 'updated' | 'unchanged'; backup?: string; createdAt: number }
export type InstructionsSnapshot = { cwd: string; project: string; files: InstructionFile[]; diagnostics: string[]; receipts: InstructionReceipt[] }
export type InstructionContent = { file: InstructionFile; text: string; hash: string | null; metadata: string; references: string[] }
export type InstructionChange = { path: string; text: string; expectedHash: string | null; source?: { path: string; hash: string } }
export type InstructionPreview = { hash: string; change: InstructionChange; file: InstructionFile; before: string; status: 'create' | 'replace' | 'same'; notices: string[] }
export type InstructionsManagerService = {
  scan(cwd: string, signal?: AbortSignal): Promise<InstructionsSnapshot>
  read(cwd: string, file: string, signal?: AbortSignal): Promise<InstructionContent>
  preview(cwd: string, change: InstructionChange, signal?: AbortSignal): Promise<InstructionPreview>
  apply(cwd: string, requestId: string, previewHash: string, change: InstructionChange, replace: boolean, signal?: AbortSignal): Promise<InstructionReceipt>
}
export const INSTRUCTION_SCOPE_HELP = 'Known instruction locations on disk. Provider versions, settings, path rules and runtime state determine what is actually loaded.'
