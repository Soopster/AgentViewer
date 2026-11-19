export function listWorkerRecords(root?: string, options?: { readOnly?: boolean; runId?: string }): Promise<Array<Record<string, any>>>
export function writeWorkerRecord(identityFile: string, patch: Record<string, unknown>): Promise<Record<string, any>>
export function workerRecordPath(identityFile: string): string
export function processAlive(pid: number): boolean
