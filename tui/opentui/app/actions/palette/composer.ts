/** @jsxImportSource @opentui/react */
// Palette commands of one group, registered into the host command registry (../hostCommands.ts).
import { registerHostCommand } from '../hostCommands'
import type { ExecuteCommandPaletteContext } from '../commandPalette'

registerHostCommand(['composer'], (ctx, id, locals) => {
    const { setComposerActive, setComposerHidden } = ctx
    switch (id) {
      case 'composer':
        setComposerHidden(false)
        setComposerActive(true)
        break
    }
})

registerHostCommand(['composer-window'], (ctx, id, locals) => {
    const { openComposerWindow } = ctx
    switch (id) {
      case 'composer-window':
        openComposerWindow()
        break
    }
})

registerHostCommand(['clipboard-paste'], (ctx, id, locals) => {
    const { pasteSystemClipboardToComposer, setComposerActive } = ctx
    switch (id) {
      case 'clipboard-paste':
        setComposerActive(true)
        void pasteSystemClipboardToComposer()
        break
    }
})

registerHostCommand(['composer-toggle'], (ctx, id, locals) => {
    const { toggleComposerHidden } = ctx
    switch (id) {
      case 'composer-toggle':
        toggleComposerHidden()
        break
    }
})

registerHostCommand(['composer-stash'], (ctx, id, locals) => {
    const { stashComposerPrompt } = ctx
    switch (id) {
      case 'composer-stash':
        stashComposerPrompt()
        break
    }
})

registerHostCommand(['composer-stash-pop'], (ctx, id, locals) => {
    const { popComposerStash } = ctx
    switch (id) {
      case 'composer-stash-pop':
        popComposerStash()
        break
    }
})

registerHostCommand(['composer-stash-list'], (ctx, id, locals) => {
    const { openComposerStashList } = ctx
    switch (id) {
      case 'composer-stash-list':
        openComposerStashList()
        break
    }
})

registerHostCommand(['workflow'], (ctx, id, locals) => {
    const { setComposerEnableWorkflow, showToggleOutcome } = ctx
    switch (id) {
      case 'workflow':
        setComposerEnableWorkflow((current) => {
          const next = !current
          showToggleOutcome('Workflow tool (next send)', next)
          return next
        })
        break
    }
})

registerHostCommand(['cli'], (ctx, id, locals) => {
    const { copyCliCommand } = ctx
    switch (id) {
      case 'cli':
        void copyCliCommand()
        break
    }
})
