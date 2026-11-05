// The app's own surfaces, registered into the root's slots.
//
// Imported for side effects by App.tsx. Registration happens at module load
// rather than from an effect so a surface is present on the very first render
// — a slot that fills in one frame later would flash empty.
import { createElement } from 'react'
import { CoordinatorSidebar } from './CoordinatorSidebar'
import { registerSlot } from './slots'

registerSlot('sidebar_content', {
  id: 'coordinator-rail',
  order: 100,
  render: (props) => createElement(CoordinatorSidebar, props),
})
