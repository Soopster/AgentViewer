'use client'

import Link from 'next/link'
import { ArrowLeft, Radio, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MessagingWorkspace } from './MessagingWorkspace'
import { useCrossSessionMessaging, type MessagingOptions } from './useCrossSessionMessaging'

export default function StandaloneMessaging({ initialRecipient, onRecipientChange, useState, service }: MessagingOptions) {
  const messaging = useCrossSessionMessaging({ initialRecipient, onRecipientChange, useState, service })
  return <main className="av-messaging-page">
    <a href="#messaging-workspace" className="sr-only focus:not-sr-only">Skip to Messaging Workspace</a>
    <nav className="av-messaging-nav" aria-label="Cross-session messaging navigation">
      <Button asChild variant="ghost" size="sm" className="av-messaging-back">
        <Link href="/"><ArrowLeft data-icon="inline-start" />Back to Sessions</Link>
      </Button>
      <div className="av-messaging-nav-meta">
        <span><Radio aria-hidden="true" /> Local Transport</span>
        <Button variant="outline" size="sm" className="av-hover-control" onClick={() => { void messaging.refresh() }} disabled={messaging.loading}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" />{messaging.loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
    </nav>
    <MessagingWorkspace messaging={messaging} />
  </main>
}
