import { useState } from 'react'

export function useMessageViewPanels() {
  const [preferencesHydrated, setPreferencesHydrated] = useState(false)
  const [showVisualizer, setShowVisualizer] = useState(false)
  return { preferencesHydrated, setPreferencesHydrated, showVisualizer, setShowVisualizer }
}
