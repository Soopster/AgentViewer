/** @jsxImportSource @opentui/react */
import React, { useMemo, useState } from 'react'

/** Bounded previews: protocol=auto uses terminal graphics or colored blocks. */
function TranscriptImage({ source, width, muted }: { source: string; width: number; muted: string }) {
  const [failed, setFailed] = useState(false)
  const bytes = useMemo(() => Buffer.from(source.slice(source.indexOf(',') + 1), 'base64'), [source])
  if (failed) return <text fg={muted}>Image preview unavailable</text>
  return <image source={bytes} width={Math.max(1, Math.min(width, 80))} height={12} fit="fit" protocol="auto" onError={() => setFailed(true)} />
}

export function TranscriptImages({ sources, width, muted }: { sources: string[]; width: number; muted: string }) {
  return <box flexDirection="column" flexShrink={0}>
    {sources.map((source, index) => <TranscriptImage key={index} source={source} width={width} muted={muted} />)}
  </box>
}
