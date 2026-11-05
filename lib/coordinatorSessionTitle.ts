// A chat started by the Coordinator is titled from its first prompt, so the rail shows
// "Coordinator run chat-98451e…" for every one of them. The run's own goal says what the chat is for.

export type CoordinatorSessionTitle = { runId: string | null; agent: string | null }

/** Reads the titles the brief produces: `Coordinator run <id> [as NAME | NAME teammate]`. Null for any other title. */
export function parseCoordinatorSessionTitle(title: string): CoordinatorSessionTitle | null {
  const match = /^(?:Continue )?Coordinator run(?: (?!as\b)(\S+))?(?: as (\S+?))?(?: (\S+) teammate)?[.…\s]*$/.exec(title.trim())
  if (!match) return null
  const [, runId, asName, teammateName] = match
  return { runId: runId ?? null, agent: asName ?? teammateName ?? null }
}

const oneLine = (text: string, max: number) => {
  const line = text.split('\n').map(part => part.trim()).find(Boolean) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** The goal of the run (and the agent, when named) in place of a hash; the title unchanged when it is not a Coordinator one. */
export function retitleCoordinatorSession(title: string, goals: ReadonlyMap<string, string>): string {
  const parsed = parseCoordinatorSessionTitle(title)
  if (!parsed) return title
  const goal = parsed.runId ? goals.get(parsed.runId) : undefined
  const goalText = goal ? oneLine(goal, 56) : ''
  if (goalText) return parsed.agent ? `${goalText} · ${parsed.agent}` : goalText
  return parsed.agent ? `Coordinator · ${parsed.agent}` : title
}
