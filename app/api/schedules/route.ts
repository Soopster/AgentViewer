import { NextRequest, NextResponse } from 'next/server'
import { ensureScheduleEngine, runScheduleNow } from '@/lib/schedules/engine'
import {
  createSchedule,
  deleteSchedule,
  listSchedulesWithRuns,
  setScheduleEnabled,
  updateSchedule,
  type ScheduleInput,
} from '@/lib/schedules/service'

// Schedules fire from the process that holds the lease; the first request here
// starts this process's engine so a daemon with no TUI still fires.

export async function GET() {
  ensureScheduleEngine()
  return NextResponse.json({ schedules: listSchedulesWithRuns() })
}

type Body = { action?: string; id?: string; schedule?: ScheduleInput; patch?: Partial<ScheduleInput> }

export async function POST(request: NextRequest) {
  ensureScheduleEngine()
  const body = await request.json().catch(() => null) as Body | null
  if (!body?.action) return NextResponse.json({ error: 'action is required' }, { status: 400 })
  try {
    if (body.action === 'create') {
      if (!body.schedule) return NextResponse.json({ error: 'schedule is required' }, { status: 400 })
      return NextResponse.json({ schedule: createSchedule(body.schedule) })
    }
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    switch (body.action) {
      case 'update':
        return NextResponse.json({ schedule: updateSchedule(body.id, body.patch ?? {}) })
      case 'delete':
        deleteSchedule(body.id)
        return NextResponse.json({ deleted: true })
      case 'pause':
        return NextResponse.json({ schedule: setScheduleEnabled(body.id, false) })
      case 'resume':
        return NextResponse.json({ schedule: setScheduleEnabled(body.id, true) })
      case 'run-now':
        await runScheduleNow(body.id)
        return NextResponse.json({ ran: true })
      default:
        return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 })
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 })
  }
}
