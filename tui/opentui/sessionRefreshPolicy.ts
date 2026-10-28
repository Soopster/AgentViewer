import type { Session } from '../../lib/types'

/** Activity is for ordering/display. Metadata or an in-progress turn can change
 * a transcript without advancing that clock (Codex recencyAt is turn start). */
export function sessionTranscriptUpdatedAt(session: Session, latest?: Session): number | undefined {
  return session.transcriptUpdatedAt ?? latest?.transcriptUpdatedAt
    ?? session.lastModified ?? latest?.lastModified
}
