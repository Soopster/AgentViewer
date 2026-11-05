import { readReviewIfChanged, mutateReview } from './store'
import type { ReviewTransport } from './useReview'
export const localReviewTransport: ReviewTransport = { read: readReviewIfChanged, mutate: mutateReview }
