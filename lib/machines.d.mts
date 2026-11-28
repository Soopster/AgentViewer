export type StoredMachine = {
  name: string
  baseUrl: string
  credential: string
  scope: 'read-only' | 'full'
  addedAt: string
}
export declare function machinesFile(root?: string): string
export declare function readMachines(root?: string): StoredMachine[]
export declare function writeMachines(machines: StoredMachine[], root?: string): void
export declare function validateMachineName(name: string): string
export declare function parsePairingUrl(raw: string): { origin: string; token: string }
export declare function addMachine(options: {
  name: string
  pairingUrl: string
  root?: string
  fetchImpl?: typeof fetch
}): Promise<{ name: string; baseUrl: string; scope: 'read-only' | 'full' }>
export declare function removeMachine(name: string, root?: string): boolean
export declare function machineHeaders(machine: Pick<StoredMachine, 'credential'>): Record<string, string>
