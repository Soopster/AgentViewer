import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Agent Viewer',
  description: 'Browse Claude Code sessions and messages',
}

// Runs synchronously before first paint — prevents a flash of the wrong theme.
// Safe: this is a static literal, not user-supplied content.
const themeScript = `(function(){var t=localStorage.getItem('theme');if(t==='light'||t==='dark'||t==='terminal'||t==='paper'){document.documentElement.dataset.theme=t;}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
