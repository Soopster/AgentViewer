'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, LoaderCircle, PackageOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PiActivitySnapshot } from '@/lib/piActivity'

const READY_VISIBILITY_MS = 12_000
const ACTIVITY_TIME_FORMATTER = new Intl.DateTimeFormat('en-AU', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'UTC',
  timeZoneName: 'short',
})

function initialSnapshot(): PiActivitySnapshot {
  return {
    revision: 0,
    active: false,
    stage: 'idle',
    headline: 'Pi is idle',
    updatedAt: 0,
    events: [],
  }
}

export default function PiActivityPopover() {
  const [snapshot, setSnapshot] = useState<PiActivitySnapshot>(initialSnapshot)
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const wasActive = useRef(false)

  useEffect(() => {
    const source = new EventSource('/api/pi/activity')
    source.addEventListener('activity', (event) => {
      try { setSnapshot(JSON.parse((event as MessageEvent<string>).data) as PiActivitySnapshot) } catch { /* malformed frame */ }
    })
    return () => source.close()
  }, [])

  useEffect(() => {
    if (snapshot.active && !wasActive.current) setOpen(true)
    wasActive.current = snapshot.active
  }, [snapshot.active])

  useEffect(() => {
    if (snapshot.active || snapshot.stage === 'idle') return
    const remaining = Math.max(0, READY_VISIBILITY_MS - (Date.now() - snapshot.updatedAt))
    const timeout = window.setTimeout(() => setNow(Date.now()), remaining + 20)
    return () => window.clearTimeout(timeout)
  }, [snapshot.active, snapshot.stage, snapshot.updatedAt])

  const visible = snapshot.active
    || snapshot.stage === 'error'
    || (snapshot.stage === 'ready' && now - snapshot.updatedAt < READY_VISIBILITY_MS)
  if (!visible) return null

  const StatusIcon = snapshot.active ? LoaderCircle : snapshot.stage === 'error' ? AlertCircle : CheckCircle2
  const recentEvents = snapshot.events.slice(-8)

  return (
    <div className="fixed bottom-5 right-5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Show Pi loading activity">
            <StatusIcon data-icon="inline-start" className={snapshot.active ? 'animate-spin' : undefined} />
            {snapshot.active ? 'Pi loading' : snapshot.stage === 'error' ? 'Pi error' : 'Pi ready'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex flex-col gap-3" aria-live="polite">
          <div className="flex items-start gap-3">
            <PackageOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-sm font-medium">{snapshot.headline}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Pi checks configured extensions while creating a session. Missing packages may invoke npm with <code>--legacy-peer-deps</code>.
              </p>
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto rounded-lg border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
            {recentEvents.map((event) => (
              <div key={event.id} className={event.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
                <span className="select-none opacity-60">{ACTIVITY_TIME_FORMATTER.format(event.timestamp)} </span>
                {event.message}
              </div>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Raw npm output is still mirrored to the server terminal by Pi.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  )
}
