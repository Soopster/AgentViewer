'use client'
import { useState } from 'react'

// Compact thinking-token estimate for the live preview (e.g. 12345 → "12.3k").
export function formatLiveThinkingTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`
}
export function useLazyRef<T>(create: () => T): { current: T}  {
  const [ref] = useState(() => ({ current: create() }))
  return ref
}
