import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SCHEDULE_RUN_HISTORY_MAX, type Schedule, type ScheduleRun, type ScheduleState } from './types'

/**
 * Not debounced, and not cached: the daemon, a TUI and the CLI all read and write this
 * file, so each operation is a read-modify-write on disk. A torn write reads back as
 * "no schedules", so it is temp-and-rename.
 */

function dataDir(): string {
  return process.env.AGENT_VIEWER_SCHEDULES_DIR ?? path.join(process.cwd(), '.agent-viewer-data')
}

export function schedulesFile(): string {
  return path.join(dataDir(), 'schedules.json')
}

function emptyState(): ScheduleState {
  return { schedules: [], runs: [] }
}

export function readScheduleState(): ScheduleState {
  try {
    const file = schedulesFile()
    if (!existsSync(file)) return emptyState()
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<ScheduleState> & { version?: number }
    if (parsed.version !== 1) return emptyState()
    return {
      schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    }
  } catch {
    return emptyState()
  }
}

function writeScheduleState(state: ScheduleState): void {
  const file = schedulesFile()
  mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify({ version: 1, ...state }, null, 2), { encoding: 'utf-8', mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, file)
}

export function updateScheduleState(mutate: (state: ScheduleState) => void): ScheduleState {
  const state = readScheduleState()
  mutate(state)
  if (state.runs.length > SCHEDULE_RUN_HISTORY_MAX) state.runs = state.runs.slice(-SCHEDULE_RUN_HISTORY_MAX)
  writeScheduleState(state)
  return state
}

export function listSchedules(): Schedule[] {
  return readScheduleState().schedules
}

export function runsFor(scheduleId: string, limit = 10): ScheduleRun[] {
  return readScheduleState().runs.filter(run => run.scheduleId === scheduleId).slice(-limit).reverse()
}

export function appendRun(run: ScheduleRun): void {
  updateScheduleState(state => {
    state.runs.push(run)
  })
}
