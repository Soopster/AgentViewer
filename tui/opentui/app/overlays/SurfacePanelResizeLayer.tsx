/** @jsxImportSource @opentui/react */
import React from 'react'
import { RGBA } from '@opentui/core'

export function SurfacePanelResizeLayer({ surfacePanelResizing, width, height, surfacePanelResizeFromRef, surfacePanelAtBottom, resizeSurfacePanelBy, setSurfacePanelResizing }: {
  surfacePanelResizing: boolean
  width: number
  height: number
  surfacePanelResizeFromRef: React.RefObject<number | null>
  surfacePanelAtBottom: boolean
  resizeSurfacePanelBy: (delta: number) => void
  setSurfacePanelResizing: React.Dispatch<React.SetStateAction<boolean>>
}) {
  return (
    surfacePanelResizing ? (
        // Takes the whole drag once it leaves the one-cell border: transparent,
        // but hit-testable, so the first motion event captures this layer.
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          zIndex={1000}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0)}
          onMouseDrag={(event: { x: number; y: number }) => {
            const last = surfacePanelResizeFromRef.current
            if (last === null) return
            const position = surfacePanelAtBottom ? event.y : event.x
            if (position === last) return
            surfacePanelResizeFromRef.current = position
            resizeSurfacePanelBy(last - position)
          }}
          onMouseUp={() => {
            surfacePanelResizeFromRef.current = null
            setSurfacePanelResizing(false)
          }}
        />
      ) : null
  )
}
