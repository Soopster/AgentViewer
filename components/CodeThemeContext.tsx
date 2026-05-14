'use client'

import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'
import { CODE_THEMES, DEFAULT_CODE_THEME_ID, STORAGE_KEY, type CodeThemeId } from '@/lib/codeThemes'

type CodeThemeContextValue = {
  themeId: CodeThemeId
  setTheme: (id: CodeThemeId) => void
}

const codeThemeIds = new Set<CodeThemeId>(CODE_THEMES.map((theme) => theme.id))

function isCodeThemeId(value: string | null): value is CodeThemeId {
  return !!value && codeThemeIds.has(value as CodeThemeId)
}

const CodeThemeContext = createContext<CodeThemeContextValue>({
  themeId: DEFAULT_CODE_THEME_ID,
  setTheme: () => {},
})

export function CodeThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<CodeThemeId>(DEFAULT_CODE_THEME_ID)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isCodeThemeId(saved)) {
      setThemeId(saved)
    }
  }, [])

  const setTheme = useCallback((id: CodeThemeId) => {
    setThemeId(id)
    localStorage.setItem(STORAGE_KEY, id)
  }, [])

  const value = useMemo(() => ({ themeId, setTheme }), [setTheme, themeId])

  return (
    <CodeThemeContext.Provider value={value}>
      {children}
    </CodeThemeContext.Provider>
  )
}

export function useCodeTheme() {
  return use(CodeThemeContext)
}
