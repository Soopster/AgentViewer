import { NextRequest, NextResponse } from 'next/server'
import { readChiefOfStaff, saveChiefOfStaffRules, startChiefOfStaff } from '@/lib/chiefOfStaff/service'

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get('cwd')
  if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 })
  try {
    return NextResponse.json(await readChiefOfStaff(cwd))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read the Chief of Staff' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { action?: string; cwd?: string; provider?: string; request?: string; rules?: unknown } | null
  if (body?.action === 'save-rules') {
    if (!body.cwd || !Array.isArray(body.rules)) return NextResponse.json({ error: 'cwd and rules are required' }, { status: 400 })
    try {
      return NextResponse.json(await saveChiefOfStaffRules(body.cwd, body.rules))
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save the rules' }, { status: 400 })
    }
  }
  if (!body?.cwd || !body.provider) return NextResponse.json({ error: 'cwd and provider are required' }, { status: 400 })
  try {
    return NextResponse.json(await startChiefOfStaff({ cwd: body.cwd, provider: body.provider, request: body.request }))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not start the Chief of Staff' }, { status: 500 })
  }
}
