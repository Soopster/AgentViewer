import { NextRequest, NextResponse } from 'next/server'
import {
  getConfiguredTuiHideScratchSessions, getConfiguredTuiShowSettledSessions, getConfiguredTuiSidebarSort,
  setConfiguredTuiHideScratchSessions, setConfiguredTuiShowSettledSessions, setConfiguredTuiSidebarSort,
} from '@/lib/tuiState'
import type { SharedSidebarPreferences } from '@/lib/sessionSidebarModel'

// The session sidebar settings the web and the TUI share (tui.json): sort,
// scratch hiding and settled visibility. One store, so flipping one in either
// UI is what the other reads.

async function read(): Promise<SharedSidebarPreferences> {
  const [sort, hideScratch, showSettled] = await Promise.all([
    getConfiguredTuiSidebarSort(), getConfiguredTuiHideScratchSessions(), getConfiguredTuiShowSettledSessions(),
  ])
  return { sort, hideScratch, showSettled }
}

export async function GET() {
  try {
    return NextResponse.json(await read())
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null) as Partial<SharedSidebarPreferences> | null
  if (!body) return NextResponse.json({ error: 'a JSON body is required' }, { status: 400 })
  try {
    if (body.sort === 'project' || body.sort === 'time') await setConfiguredTuiSidebarSort(body.sort)
    if (typeof body.hideScratch === 'boolean') await setConfiguredTuiHideScratchSessions(body.hideScratch)
    if (typeof body.showSettled === 'boolean') await setConfiguredTuiShowSettledSessions(body.showSettled)
    return NextResponse.json(await read())
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
