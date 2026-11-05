import { useState } from 'react'

export function useMessageViewPanels() {
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [preferencesHydrated, setPreferencesHydrated] = useState(false)
  const [showVisualizer, setShowVisualizer] = useState(false)
  return { showDiagnostics, setShowDiagnostics, preferencesHydrated, setPreferencesHydrated, showVisualizer, setShowVisualizer }
}
