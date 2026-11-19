import { NextRequest, NextResponse } from 'next/server'
import { getConfiguredTuiCustomViews, setConfiguredTuiCustomViews } from '@/lib/tuiState'
import { normalizeBuiltinViewOverrides, normalizeCustomViews } from '@/tui/viewSpec'

// Custom transcript views and edits to the built-ins, shared by the web and the
// TUI: both read the same tui.json entries, so a view made in one is listed in
// the other. Which view is shown stays per surface (the TUI's in tui.json, the
// web's in the browser), so choosing one here never switches the terminal.

export async function GET() {
  try {
    const { views, builtins } = await getConfiguredTuiCustomViews()
    return NextResponse.json({ views, builtins })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null) as { views?: unknown; builtins?: unknown } | null
  if (!body || (body.views === undefined && body.builtins === undefined)) {
    return NextResponse.json({ error: 'views or builtins is required' }, { status: 400 })
  }
  try {
    // Validated field by field, as the TUI reads them: an unknown field or value is dropped.
    const views = body.views === undefined ? undefined : normalizeCustomViews(body.views)
    const builtins = body.builtins === undefined ? undefined : normalizeBuiltinViewOverrides(body.builtins)
    await setConfiguredTuiCustomViews({ ...(views ? { views } : {}), ...(builtins ? { builtins } : {}) })
    const stored = await getConfiguredTuiCustomViews()
    return NextResponse.json({ views: stored.views, builtins: stored.builtins })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
