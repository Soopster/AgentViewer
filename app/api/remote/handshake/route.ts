import { NextRequest, NextResponse } from 'next/server'
import { REMOTE_ACCESS_COOKIE, isValidRemoteBearer } from '@/lib/remoteAuth'

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days; rotating/revoking invalidates sooner

/** One-time exchange: a paired client presents its bearer token once here,
 *  and gets back an httpOnly cookie that its browser/WebView then attaches
 *  automatically to every same-origin request afterward — including
 *  EventSource streams, which can't carry an Authorization header at all. */
export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization')
  if (!(await isValidRemoteBearer(authorization))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
  }
  const token = (authorization as string).slice('Bearer '.length)

  const response = NextResponse.json({ ok: true })
  response.cookies.set(REMOTE_ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  })
  return response
}
