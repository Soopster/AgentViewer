import { NextResponse } from 'next/server'
import { readInteractiveAttention } from '@/lib/agentCoordination'

/** Teammate attention per conversation, for the session list. Ledger-only. */
export async function GET() {
  try {
    return NextResponse.json({ attention: await readInteractiveAttention() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read teammate attention' }, { status: 500 })
  }
}
