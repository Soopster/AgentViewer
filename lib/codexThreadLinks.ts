/** Native Codex conversation links always refer to the originating app server. */
export function codexThreadIdFromLink(href: string | undefined): string | undefined {
  return /^codex:\/\/threads\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.exec(href ?? '')?.[1]
}
