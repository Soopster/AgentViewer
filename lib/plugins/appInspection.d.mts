import type { ModAppSnapshot } from './modApp'
import type { ModDiagnostic } from './modDiagnostics'
export type AppInspection = { version: 1; revision?: number; pid: number; daemon: { pid: number; port: string | null } | null; updatedAt: number; stale?: boolean; app: ModAppSnapshot; mods: readonly { id: string; title: string; enabled: boolean }[]; diagnostics: readonly ModDiagnostic[]; refused?: readonly { id: string | null; dir: string; problems: readonly string[] }[] }
export const INSPECTION_STALE_MS: number
export function inspectionDir(): string
export function writeAppInspection(value: Pick<AppInspection, 'app' | 'mods' | 'diagnostics'> & Partial<Pick<AppInspection, 'refused' | 'revision'>>): void
export function readAppInspections(instanceId?: string, now?: number): AppInspection[]
