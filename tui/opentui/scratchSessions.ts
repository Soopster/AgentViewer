import type { Session } from '../../lib/types'

// A scratch session is a throwaway probe — "Reply with the single word: pong",
// "This is a formatting test…", a bare "hi" — the kind smoke runs and quick
// provider checks leave behind by the dozen. They bury real work in the rail,
// so the sidebar can hide them (⇧Y). The test is the prompt's shape alone, and
// it is deliberately narrow: hiding a real conversation is worse than showing
// a probe, so anything the user named, pinned, or that is still doing
// something is never scratch (see `hideScratchSessions`).
const SCRATCH_PROMPT_PATTERNS: readonly RegExp[] = [
  /^(?:reply|respond|answer) with (?:only |just |exactly )?(?:the |a )?(?:single |one )?(?:word|literal|text|number)\b/i,
  /^(?:say|print|output|echo|return) (?:only |just |exactly )?(?:the )?(?:literal|single word|word)\b/i,
  /^output the literal\b/i,
  /^this is a (?:formatting |smoke |quick )?test\b/i,
  /^(?:hi|hello|hey|ping|test|testing)[\s.!?]*$/i,
]

export function isScratchSession(session: Session): boolean {
  if (session.customTitle?.trim()) return false
  const prompt = (session.summary ?? session.firstPrompt ?? '').trim()
  if (!prompt) return false
  return SCRATCH_PROMPT_PATTERNS.some((pattern) => pattern.test(prompt))
}

/**
 * The sessions the rail shows with scratch hidden, and how many were hidden.
 * `keep` protects a session whatever its prompt says — the caller passes the
 * live, selected and team-marked ones. Returns the input array itself when
 * nothing is hidden, so identity-keyed memos downstream do not churn.
 */
export function hideScratchSessions(
  sessions: Session[],
  keep: (session: Session) => boolean,
): { sessions: Session[]; hidden: number } {
  let hidden = 0
  const shown: Session[] = []
  for (const session of sessions) {
    if (isScratchSession(session) && !session.isPinned && session.inbox?.pinnedAt === undefined && !keep(session)) {
      hidden += 1
      continue
    }
    shown.push(session)
  }
  return hidden === 0 ? { sessions, hidden: 0 } : { sessions: shown, hidden }
}
