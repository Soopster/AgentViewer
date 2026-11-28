import { NextRequest, NextResponse } from 'next/server'
import { readMattSkills } from '@/lib/mattSkills/service'

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get('cwd')
  if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 })
  try {
    return NextResponse.json(await readMattSkills(cwd))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read the skills' }, { status: 500 })
  }
}
