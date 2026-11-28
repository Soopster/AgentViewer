import { NextRequest, NextResponse } from 'next/server'
import { readPstack, savePstackRole } from '@/lib/pstack/service'

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get('cwd')
  if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 })
  try {
    return NextResponse.json(await readPstack(cwd))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read pstack' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { cwd?: string; role?: string; line?: string } | null
  if (!body?.cwd || !body.role || typeof body.line !== 'string') return NextResponse.json({ error: 'cwd, role and line are required' }, { status: 400 })
  try {
    return NextResponse.json(await savePstackRole(body.cwd, body.role, body.line))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save the role' }, { status: 400 })
  }
}
