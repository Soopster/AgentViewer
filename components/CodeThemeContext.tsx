'use client'

import { createContext, use, useEffect, useState } from 'react'
import { CODE_THEMES, DEFAULT_CODE_THEME_ID, STORAGE_KEY, type CodeThemeId, type CodeThemeStyle } from '@/lib/codeThemes'

type CodeThemeContextValue = {
  themeId: CodeThemeId
  style: CodeThemeStyle
  setTheme: (id: CodeThemeId) => void
}

const defaultTheme = CODE_THEMES.find(t => t.id === DEFAULT_CODE_THEME_ID)!

const CodeThemeContext = createContext<CodeThemeContextValue>({
  themeId: DEFAULT_CODE_THEME_ID,
  style: defaultTheme.style,
  setTheme: () => {},
})

export function CodeThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<CodeThemeId>(DEFAULT_CODE_THEME_ID)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && CODE_THEMES.some(t => t.id === saved)) {
      setThemeId(saved as CodeThemeId)
    }
  }, [])

  function setTheme(id: CodeThemeId) {
    setThemeId(id)
    localStorage.setItem(STORAGE_KEY, id)
  }

  const style = CODE_THEMES.find(t => t.id === themeId)!.style

  return (
    <CodeThemeContext.Provider value={{ themeId, style, setTheme }}>
      {children}
    </CodeThemeContext.Provider>
  )
}

export function useCodeTheme() {
  return use(CodeThemeContext)
}
