/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import React from 'react'
import { type SelectOption } from '@opentui/core'
import { getThemePalette, type TuiThemeMode } from '../../../theme'
import { type ProviderSelection, type Session } from '../../../../lib/types'
import { fitText } from '../../textLayout'
import { type ModelPickerOption, type TuiCopilotContextTier, type ModelPickerFocus } from '../types'
import { isLightThemeMode } from '../themes'

export function SelectMenusOverlay({ themeMode, theme, providerMenuOpen, presentationFocusMode, providerOptions, providerMenuIndex, setProviderMenuIndex, chooseProvider, modelPickerOpen, width, height, composerAccentColor, modelPickerTarget, modelPickerPermissionLabel, modelPickerOptions, modelPickerIndex, composerCopilotContextTier, modelPickerFocus, filteredModelPickerOptions, modelPickerLoading, modelPickerError, modelPickerQuery, setModelPickerQuery, setModelPickerIndex, applyModelPickerOption, compactModelPickerEffortOptions, modelPickerEffortIndex, setModelPickerEffortIndex, applyModelPickerEffort, compactModelPickerPermissionOptions, modelPickerPermissionIndex, setModelPickerPermissionIndex, applyModelPickerPermission, modelPickerFocusedLabel, modelPickerFocusedOption, modelPickerFocusedDescription }: {
  themeMode: TuiThemeMode
  theme: TuiThemePalette
  providerMenuOpen: boolean
  presentationFocusMode: boolean
  providerOptions: SelectOption[]
  providerMenuIndex: number
  setProviderMenuIndex: React.Dispatch<React.SetStateAction<number>>
  chooseProvider: (nextProvider: ProviderSelection, targetSession?: Session | null, nextInstanceId?: string | null) => Promise<void>
  modelPickerOpen: boolean
  width: number
  height: number
  composerAccentColor: string
  modelPickerTarget: Session | null
  modelPickerPermissionLabel: 'APPROVALS' | 'PERMISSIONS'
  modelPickerOptions: ModelPickerOption[]
  modelPickerIndex: number
  composerCopilotContextTier: TuiCopilotContextTier
  modelPickerFocus: ModelPickerFocus
  filteredModelPickerOptions: ModelPickerOption[]
  modelPickerLoading: boolean
  modelPickerError: string | null
  modelPickerQuery: string
  setModelPickerQuery: React.Dispatch<React.SetStateAction<string>>
  setModelPickerIndex: React.Dispatch<React.SetStateAction<number>>
  applyModelPickerOption: (selectedOption?: ModelPickerOption) => void
  compactModelPickerEffortOptions: { name: string; value: any; description: string; }[]
  modelPickerEffortIndex: number
  setModelPickerEffortIndex: React.Dispatch<React.SetStateAction<number>>
  applyModelPickerEffort: (value: string | undefined) => void
  compactModelPickerPermissionOptions: { name: string; value: any; description: string; }[]
  modelPickerPermissionIndex: number
  setModelPickerPermissionIndex: React.Dispatch<React.SetStateAction<number>>
  applyModelPickerPermission: (value: string | undefined) => void
  modelPickerFocusedLabel: 'APPROVALS' | 'PERMISSIONS' | 'MODEL' | 'EFFORT'
  modelPickerFocusedOption: SelectOption
  modelPickerFocusedDescription: string
}) {
  return (
    (() => {
          // All floating select overlays share this palette so light-themed
          // backgrounds never wash out the overlay text.
          const ot = isLightThemeMode(themeMode) ? getThemePalette('dark') : theme
          return (<>
            {providerMenuOpen ? (
              <box
                position="absolute"
                top={presentationFocusMode ? 1 : 3}
                right={2}
                width={34}
                height={14}
                border
                borderStyle="single"
                borderColor={ot.border2}
                backgroundColor={ot.surface}
                zIndex={20}
                flexDirection="column"
              >
                <box paddingX={1} paddingTop={1}>
                  <text fg={ot.text}>PROVIDERS</text>
                </box>
                <box flexGrow={1} paddingX={1} paddingBottom={1}>
                  <select
                    style={{ height: 10 }}
                    focused
                    options={providerOptions}
                    selectedIndex={providerMenuIndex}
                    selectedBackgroundColor={ot.surface3}
                    selectedTextColor={ot.text}
                    textColor={ot.muted}
                    descriptionColor={ot.dim}
                    selectedDescriptionColor={ot.cyan}
                    backgroundColor={ot.surface}
                    focusedBackgroundColor={ot.surface}
                    showScrollIndicator={false}
                    itemSpacing={0}
                    onChange={(index) => setProviderMenuIndex(index)}
                    onSelect={(_, option) => {
                      const [nextProvider, nextInstanceId] = String(option?.value ?? '').split('|') as [ProviderSelection | '', string | undefined]
                      if (nextProvider) void chooseProvider(nextProvider, null, nextInstanceId ?? null)
                    }}
                  />
                </box>
              </box>
            ) : null}

            {modelPickerOpen ? (() => {
              const overlayWidth = Math.min(78, Math.max(width - 4, 44))
              const overlayHeight = Math.min(24, Math.max(height - 2, 14))
              const contentWidth = Math.max(overlayWidth - 5, 38)
              const headerWidth = Math.max(overlayWidth - 4, 40)
              const modelWidth = Math.max(Math.floor(contentWidth * 0.58), 22)
              const effortWidth = Math.max(contentWidth - modelWidth - 1, 15)
              const detailHeight = overlayHeight >= 18 ? 2 : 1
              const settingsContentHeight = Math.max(overlayHeight - detailHeight - 5, 8)
              const effortListHeight = Math.max(Math.min(Math.floor((settingsContentHeight - 2) * 0.45), 6), 3)
              const permissionListHeight = Math.max(settingsContentHeight - effortListHeight - 2, 3)
              return (
                <box
                  position="absolute"
                  top={Math.max(1, Math.floor((height - overlayHeight) / 2))}
                  left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
                  width={overlayWidth}
                  height={overlayHeight}
                  border
                  borderStyle="single"
                  borderColor={ot.border2}
                  backgroundColor={ot.surface}
                  zIndex={70}
                  flexDirection="column"
                  title=" Composer settings "
                  titleColor={composerAccentColor}
                  titleAlignment="left"
                >
                  <box height={2} paddingX={1} flexDirection="column">
                    <text fg={ot.text} wrapMode="none">
                      {fitText(
                        `${String(modelPickerTarget?.provider ?? 'session').toUpperCase()} · MODEL · EFFORT · ${modelPickerPermissionLabel}`,
                        headerWidth,
                      )}
                    </text>
                    <text fg={ot.dim} wrapMode="none">
                      {fitText(
                        modelPickerTarget?.provider === 'copilot' && (modelPickerOptions[modelPickerIndex]?.supportsLongContext ?? false)
                          ? `type to filter · ↑/↓ choose · tab/←/→ switch · enter apply · ⌃L context:${composerCopilotContextTier === 'long_context' ? 'long' : 'default'} · esc close`
                          : 'type to filter · ↑/↓ choose · tab/←/→ switch · enter apply · esc close',
                        headerWidth,
                      )}
                    </text>
                  </box>
                  <box height={settingsContentHeight} paddingX={1} flexDirection="row" gap={1}>
                    <box width={modelWidth} flexDirection="column">
                      <text fg={modelPickerFocus === 'model' ? ot.cyan : ot.dim} wrapMode="none">
                        {`${modelPickerFocus === 'model' ? '▸' : ' '} MODEL · ${filteredModelPickerOptions.length}/${modelPickerOptions.length}`}
                      </text>
                      {modelPickerLoading ? (
                        <text fg={ot.dim} wrapMode="none">Loading provider models…</text>
                      ) : modelPickerError ? (
                        <text fg={ot.red} wrapMode="word">{modelPickerError}</text>
                      ) : modelPickerOptions.length === 0 ? (
                        <text fg={ot.dim} wrapMode="none">No models available</text>
                      ) : (
                        <>
                          <box height={1} flexDirection="row">
                            <text fg={modelPickerFocus === 'model' ? ot.cyan : ot.dim}>/ </text>
                            <input
                              style={{ flexGrow: 1 }}
                              focused={modelPickerFocus === 'model'}
                              value={modelPickerQuery}
                              placeholder="Search name or model ID..."
                              maxLength={80}
                              onInput={(value) => {
                                setModelPickerQuery(value)
                                setModelPickerIndex(0)
                              }}
                              onSubmit={() => applyModelPickerOption()}
                            />
                          </box>
                          {filteredModelPickerOptions.length === 0 ? (
                            <text fg={ot.dim} wrapMode="none">No matching models</text>
                          ) : (
                            <select
                              style={{ height: Math.max(settingsContentHeight - 2, 5) }}
                              focused={false}
                              options={filteredModelPickerOptions}
                              selectedIndex={modelPickerIndex}
                              selectedBackgroundColor={modelPickerFocus === 'model' ? ot.surface3 : ot.surface}
                              selectedTextColor={modelPickerFocus === 'model' ? ot.text : ot.muted}
                              textColor={ot.muted}
                              descriptionColor={ot.dim}
                              selectedDescriptionColor={ot.cyan}
                              backgroundColor={ot.surface}
                              focusedBackgroundColor={ot.surface}
                              showScrollIndicator={false}
                              itemSpacing={0}
                              onChange={(index) => setModelPickerIndex(index)}
                              onSelect={(_, option) => {
                                if (option) applyModelPickerOption(option as ModelPickerOption)
                              }}
                            />
                          )}
                        </>
                      )}
                    </box>
                    <box width={effortWidth} flexDirection="column">
                      <text fg={modelPickerFocus === 'effort' ? ot.cyan : ot.dim} wrapMode="none">
                        {modelPickerFocus === 'effort' ? '▸ EFFORT' : '  EFFORT'}
                      </text>
                      <select
                        style={{ height: effortListHeight }}
                        focused={modelPickerFocus === 'effort'}
                        options={compactModelPickerEffortOptions}
                        selectedIndex={modelPickerEffortIndex}
                        selectedBackgroundColor={modelPickerFocus === 'effort' ? ot.surface3 : ot.surface}
                        selectedTextColor={modelPickerFocus === 'effort' ? ot.text : ot.muted}
                        textColor={ot.muted}
                        descriptionColor={ot.dim}
                        selectedDescriptionColor={ot.cyan}
                        backgroundColor={ot.surface}
                        focusedBackgroundColor={ot.surface}
                        showScrollIndicator={false}
                        itemSpacing={0}
                        onChange={(index) => setModelPickerEffortIndex(index)}
                        onSelect={(_, option) => {
                          const value = option?.value
                          applyModelPickerEffort(typeof value === 'string' ? value : undefined)
                        }}
                      />
                      <text fg={modelPickerFocus === 'permissions' ? ot.cyan : ot.dim} wrapMode="none">
                        {modelPickerFocus === 'permissions' ? `▸ ${modelPickerPermissionLabel}` : `  ${modelPickerPermissionLabel}`}
                      </text>
                      <select
                        style={{ height: permissionListHeight }}
                        focused={modelPickerFocus === 'permissions'}
                        options={compactModelPickerPermissionOptions}
                        selectedIndex={modelPickerPermissionIndex}
                        selectedBackgroundColor={modelPickerFocus === 'permissions' ? ot.surface3 : ot.surface}
                        selectedTextColor={modelPickerFocus === 'permissions' ? ot.text : ot.muted}
                        textColor={ot.muted}
                        descriptionColor={ot.dim}
                        selectedDescriptionColor={ot.cyan}
                        backgroundColor={ot.surface}
                        focusedBackgroundColor={ot.surface}
                        showScrollIndicator={false}
                        itemSpacing={0}
                        onChange={(index) => setModelPickerPermissionIndex(index)}
                        onSelect={(_, option) => {
                          const value = option?.value
                          applyModelPickerPermission(typeof value === 'string' ? value : undefined)
                        }}
                      />
                    </box>
                  </box>
                  <box height={detailHeight} paddingX={1} flexDirection="column" backgroundColor={ot.surface2}>
                    <text fg={ot.cyan} wrapMode="none">
                      {fitText(`${modelPickerFocusedLabel} · ${modelPickerFocusedOption?.name ?? '—'}`, headerWidth)}
                    </text>
                    {detailHeight > 1 ? (
                      <text fg={ot.dim} wrapMode="none">
                        {fitText(modelPickerFocusedDescription || 'No additional details', headerWidth)}
                      </text>
                    ) : null}
                  </box>
                </box>
              )
            })() : null}
          </>)
        })()
  )
}
