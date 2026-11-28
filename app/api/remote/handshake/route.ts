import { NextRequest, NextResponse } from 'next/server'
import { REMOTE_ACCESS_COOKIE, consumePairing } from '@/lib/remoteAuth'

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days; revoking invalidates sooner

/** One-time exchange: a client presents its single-use pairing token once
 *  here and gets back a *per-device* credential as an httpOnly cookie, which
 *  its browser/WebView then attaches automatically to every same-origin
 *  request afterward — including EventSource streams, which can't carry an
 *  Authorization header at all.
 *
 *  The pairing token burns here, so the QR cannot pair a second device and a
 *  copy of it lifted from history or a log is already spent. */
export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? ''
  const token = /^Bearer /i.test(authorization) ? authorization.slice(7) : ''
  const paired = token
    ? await consumePairing(token, { userAgent: request.headers.get('user-agent') })
    : null

  if (!paired) {
    return NextResponse.json(
      { error: 'Pairing token is invalid, expired, or already used' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    )
  }

  const response = NextResponse.json({ ok: true, scope: paired.session.scope, device: paired.session })
  response.cookies.set(REMOTE_ACCESS_COOKIE, paired.credential, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  })
  return response
}
