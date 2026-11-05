// What the Coordinator writes into a conversation, read back out of it.
//
// A coordinated agent's transcript is mostly text the Coordinator composed:
// the standing brief it repeats at the top of every delivered turn, and the
// teammates' mail (`formatInbox` / `formatProtocolMailboxMessage` in
// agentProtocol.ts). Rendered as the prose it arrives as, a turn opens with a
// screen of instructions and the mail is a run of `[team message <uuid> from …
// kind=… priority=…]` headers with the words that matter trailing after them.
// This finds those regions so a transcript can show who said what.
//
// Node-free: it runs in the browser, the TUI and the threading worker alike.

export type CoordinatorMailMessage = {
  id: string
  from: string
  kind: string
  priority: string
  urgent: boolean
  replyRequired: boolean
  correlationId: string | null
  inReplyTo: string | null
  body: string
}

export type CoordinatorTranscriptRegion =
  | {
      kind: 'coordinator_mail'
      start: number
      end: number
      /** The delivery batch, when the mail arrived in a lead's delivery envelope. */
      deliveryId: string | null
      /** Lines the Coordinator added about the mail itself (e.g. how many were shortened). */
      notes: string[]
      messages: CoordinatorMailMessage[]
    }
  | {
      kind: 'coordinator_brief'
      start: number
      end: number
      role: string
      agentName: string | null
      runId: string | null
      text: string
    }

const DELIVERY_RE = /--- Coordinator delivery (\S+) ---\n?([\s\S]*?)\n?--- end Coordinator delivery ---/g
// The header `formatProtocolMailboxMessage` writes. A sender's name may hold
// spaces; `kind=` is always the first of the metadata that follows it.
const MAIL_HEADER_RE = /^(?:- )?\[team message (\S+) from (.+?) (kind=[^\]\n]*)\][ \t]?/gm
const LEAD_BRIEF_RE = /You are the interactive Coordinator lead for run (\S+?)\. /
const AGENT_BRIEF_RE = /Continue Coordinator run (\S+) as (.+?) \(([\w-]+)\)\./

function metadataValue(metadata: string, key: string): string | null {
  return new RegExp(`(?:^| )${key}=(\\S+)`).exec(metadata)?.[1] ?? null
}

export function parseCoordinatorMail(text: string): { notes: string[]; messages: CoordinatorMailMessage[] } {
  const headers = [...text.matchAll(MAIL_HEADER_RE)]
  const lead = headers.length > 0 ? text.slice(0, headers[0]!.index) : text
  const notes = lead.split('\n').map((line) => line.trim()).filter((line) => line && line !== '(empty)')
  const messages = headers.map((header, index): CoordinatorMailMessage => {
    const metadata = header[3]!
    const bodyStart = header.index! + header[0].length
    const bodyEnd = index + 1 < headers.length ? headers[index + 1]!.index! : text.length
    return {
      id: header[1]!,
      from: header[2]!,
      kind: metadataValue(metadata, 'kind') ?? 'message',
      priority: metadataValue(metadata, 'priority') ?? 'normal',
      urgent: / URGENT\b/.test(metadata) || metadataValue(metadata, 'priority') === 'urgent',
      replyRequired: / reply-required\b/.test(metadata),
      correlationId: metadataValue(metadata, 'correlation_id'),
      inReplyTo: metadataValue(metadata, 'in_reply_to'),
      body: text.slice(bodyStart, bodyEnd).trim(),
    }
  })
  return { notes, messages }
}

/** Coordinator-written regions of one message's text, in order, never overlapping. */
export function findCoordinatorRegions(text: string): CoordinatorTranscriptRegion[] {
  // Every form below names itself; a transcript without them pays one scan.
  if (!text.includes('Coordinator') && !text.includes('[team message ')) return []
  const regions: CoordinatorTranscriptRegion[] = []

  for (const match of text.matchAll(DELIVERY_RE)) {
    regions.push({
      kind: 'coordinator_mail',
      start: match.index!,
      end: match.index! + match[0].length,
      deliveryId: match[1]!,
      ...parseCoordinatorMail(match[2] ?? ''),
    })
  }
  const firstMail = regions[0]?.start ?? text.length

  // A message steered into a live turn is the bare header and its body.
  if (regions.length === 0) {
    const bare = /^\s*(?:- )?\[team message \S+ from /.exec(text)
    if (bare) {
      const parsed = parseCoordinatorMail(text)
      if (parsed.messages.length > 0) {
        return [{ kind: 'coordinator_mail', start: 0, end: text.length, deliveryId: null, ...parsed }]
      }
    }
  }

  // The lead's brief sits between the prompt and the delivery it introduces.
  const lead = LEAD_BRIEF_RE.exec(text)
  if (lead && lead.index < firstMail) {
    regions.push({
      kind: 'coordinator_brief',
      start: lead.index,
      end: firstMail,
      role: 'lead',
      agentName: null,
      runId: lead[1]!,
      text: text.slice(lead.index, firstMail).trim(),
    })
  } else {
    // A teammate's turn is the brief and nothing else: there is no prompt of
    // the user's in it to keep.
    const agent = AGENT_BRIEF_RE.exec(text)
    if (agent && text.slice(0, agent.index).trim() === '') {
      regions.push({
        kind: 'coordinator_brief',
        start: agent.index,
        end: firstMail,
        role: agent[3]!,
        agentName: agent[2]!,
        runId: agent[1]!,
        text: text.slice(agent.index, firstMail).trim(),
      })
    }
  }

  return regions.sort((a, b) => a.start - b.start)
}
