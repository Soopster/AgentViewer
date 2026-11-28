/** What a sub-agent is called on screen: the last part of its path. */
export function subagentName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}
