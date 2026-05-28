import type { Metadata } from 'next'
import './globals.css'
import { THEMES } from '@/lib/themes'

export const metadata: Metadata = {
  title: 'Agent Viewer',
  description: 'Browse Claude Code sessions and messages',
}

// Runs synchronously before first paint — prevents a flash of the wrong theme and layout.
// Safe: this is a static literal, not user-supplied content.
const themeScript = `(function(){try{var v=${JSON.stringify(THEMES)};var t=localStorage.getItem('theme');if(t&&v.indexOf(t)>=0){document.documentElement.dataset.theme=t;}if(localStorage.getItem('agentViewer:messagePaneCollapsed')==='1'){document.documentElement.dataset.msgPane='collapsed';}}catch(e){}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Intentional blocking inline script: must run synchronously before first paint to prevent theme FOUC. Content is a static literal, not user input. */}
        {/* eslint-disable-next-line react-doctor/no-danger, react-doctor/nextjs-no-native-script */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
