// Plain data so the manifest can import it without pulling in the service (and through it, the send path).
export const COS_DIGEST_PROMPTS = {
  morning: 'Morning digest: review the board and the user\'s recent work. List what is in flight, what finished overnight, what is blocked, and the three things that need me first today.',
  stale: 'Check the board. Anything blocked, failed or silent for a long time? If a teammate is stuck, unblock or reassign it. Only tell me if something needs me; otherwise reply "all clear".',
  eod: 'End-of-day report: what each workstream finished today, what is still open, and what you recommend starting tomorrow.',
} as const
export type CosDigestKind = keyof typeof COS_DIGEST_PROMPTS
