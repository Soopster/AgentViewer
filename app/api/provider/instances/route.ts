import { NextResponse } from 'next/server'
import { listProviderInstanceSummaries } from '@/lib/providerInstances'

export async function GET() {
  try {
    return NextResponse.json({ instances: await listProviderInstanceSummaries() })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to read provider instances',
    }, { status: 500 })
  }
}
