declare module 'react-syntax-highlighter/dist/esm/highlight' {
  import type { ComponentType } from 'react'
  import type { SyntaxHighlighterProps } from 'react-syntax-highlighter'
  const highlight: (
    astGenerator: unknown,
    defaultStyle?: object,
  ) => ComponentType<SyntaxHighlighterProps>
  export default highlight
}

declare module 'refractor/core' {
  export const refractor: {
    register: (syntax: unknown) => void
    alias: (name: string, aliases: string | string[]) => void
    languages: Record<string, unknown>
    highlight: (code: string, language: string) => unknown
    registered: Record<string, unknown>
  }
}