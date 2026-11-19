import type { ScheduleFireResult } from './engine'

/**
 * Plugin commands a schedule can run with nobody at a keyboard. A UI command needs a surface, so only
 * commands that are server work are listed here, each loaded when it fires. Anything else is refused
 * with the reason, never silently skipped.
 */
const UNATTENDED: Record<string, () => Promise<ScheduleFireResult>> = {
  'chief-of-staff:morning': () => digest('morning'),
  'chief-of-staff:stale': () => digest('stale'),
  'chief-of-staff:eod': () => digest('eod'),
}

async function digest(kind: 'morning' | 'stale' | 'eod'): Promise<ScheduleFireResult> {
  const { runChiefOfStaffDigest } = await import('../chiefOfStaff/service')
  const { sent, failed } = await runChiefOfStaffDigest(kind)
  if (failed.length) return { outcome: 'failed', error: failed.join('; ').slice(0, 300) }
  // No Chief of Staff exists yet: nothing to do is a skip, not a success.
  return sent === 0 ? { outcome: 'skipped', error: 'No Chief of Staff has been started in any repository' } : { outcome: 'ok' }
}

export function runUnattendedPluginCommand(command: string): Promise<ScheduleFireResult> {
  const run = UNATTENDED[command]
  return run ? run() : Promise.resolve({ outcome: 'failed', error: `Plugin command "${command}" cannot run unattended` })
}
