'use client'

import { MessagingWorkspace } from './MessagingWorkspace'
import { useCrossSessionMessaging } from './useCrossSessionMessaging'

export default function CrossSessionMessaging() {
  const messaging = useCrossSessionMessaging()
  return <section className="av-messaging-page" aria-label="Cross-session messaging">
    <MessagingWorkspace messaging={messaging} />
  </section>
}
