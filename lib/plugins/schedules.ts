import type { ScheduleInput, ScheduleListing } from '../schedules/service'

/** The schedules a host knows, and the actions a person may take on one. */
export type PluginSchedulesService = {
  readonly list: (signal?: AbortSignal) => Promise<ScheduleListing[]>
  readonly setEnabled: (id: string, enabled: boolean) => Promise<void>
  readonly runNow: (id: string) => Promise<void>
  readonly remove: (id: string) => Promise<void>
  readonly create: (input: ScheduleInput) => Promise<void>
}
