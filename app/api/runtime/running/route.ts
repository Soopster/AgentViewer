import { NextResponse } from 'next/server'
import { listRunningSessions } from '@/lib/sessionRuntime'

export async function GET() {
  try {
    return NextResponse.json({ sessions: listRunningSessions() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
