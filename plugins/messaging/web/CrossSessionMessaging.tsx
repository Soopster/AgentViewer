'use client'

import { MessagingWorkspace } from './MessagingWorkspace'
import { useCrossSessionMessaging, type MessagingOptions } from './useCrossSessionMessaging'

export default function CrossSessionMessaging({ useState, service }: Pick<MessagingOptions, 'useState' | 'service'>) {
  const messaging = useCrossSessionMessaging({ useState, service })
  return <section className="av-messaging-page" aria-label="Cross-session messaging">
    <MessagingWorkspace messaging={messaging} />
  </section>
}
