'use client'

import { ViewTransition } from 'react'

export function RouteTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{ route: 'fade-in', default: 'none' }}
      exit={{ route: 'fade-out', default: 'none' }}
      default="none"
    >
      {children}
    </ViewTransition>
  )
}
