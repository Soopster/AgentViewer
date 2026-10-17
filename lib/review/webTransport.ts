import type { ReviewTransport } from './useReview'

async function json(response: Response) {
  if (response.status === 204) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Review request failed')
  return data
}
export const webReviewTransport: ReviewTransport = {
  read: (cwd, source, after) => fetch(`/api/review?${new URLSearchParams({ cwd, source, ...(after !== undefined ? { after: String(after) } : {}) })}`, { cache: 'no-store' }).then(json),
  mutate: request => fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }).then(json),
}
