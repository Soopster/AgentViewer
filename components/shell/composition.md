# Shell composition

The page coordinates feature state and I/O. Layout components consume children
and callbacks without owning catalog, provider, or transcript lifecycles.

- `DashboardViews` owns the dashboard navigation chrome and validates selected
  view values. `DashboardView` composes each feature screen as a child. Inactive
  views follow the underlying Tabs lifecycle. The sidebar receives one exclusive
  dashboard selection instead of independent selection booleans.
- `ReaderPane`, `ReaderPaneCollapseButton`, and `CollapsedReaderPane` compose
  expanded/collapsed presentation explicitly. The page supplies content and the
  presentation hook supplies actions; the layout does not restore preferences.
- `RightPanel` owns panel width, tab chrome, launchers, and the effective active
  surface. Each `RightPanelContent` child keeps its surface mounted while hiding
  inactive content. The tab's accessible pressed state follows the same effective
  selection as the displayed content, including fallback from an invalid ID.
- `PanelPluginSurface` adapts live capability props for the shared plugin host.
  Repository, composer, coordination, and browser-location values remain explicit.
  The host continues to own plugin state, loading, errors, and window treatment.

The content slot/context module stays separate from the heavy panel component so
composing slots does not defeat the panel's dynamic import. Presentation helpers
also stay separate from component exports for Fast Refresh.

```sh
node scripts/webShellCompositionBrowserSmoke.mjs
node --import tsx scripts/webSidebarBoundariesSmoke.tsx
npx tsc --noEmit
npm run build
node scripts/webProductionCompositionBrowserSmoke.mjs
```

The focused Chrome fixture checks dashboard activation and keyboard navigation,
reader controls, fallback selection, mounted inactive state, and panel closure.
The production check uses the actual Files plugin with mocked file responses to
verify its repository/session capabilities update after selecting another project
and provider. It does not read real files or contact provider runtimes.
