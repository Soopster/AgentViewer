import { NextResponse } from 'next/server'
import { blameFileProvenance } from '@/lib/provenance'

// Code-side provenance: GET /api/provenance/blame?file=<path>&cwd=<dir>
// Attributes the file's current lines to the agent sessions that wrote them.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const file = searchParams.get('file')?.trim()
  const cwd = searchParams.get('cwd')?.trim() || null
  if (!file) {
    return NextResponse.json({ error: 'file query parameter is required' }, { status: 400 })
  }
  try {
    const result = await blameFileProvenance({ file, cwd })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
