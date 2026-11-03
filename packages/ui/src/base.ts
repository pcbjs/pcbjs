// What every entry of @pcbjs/ui shares: the page, board and pane stores, the connection to the session and the helpers the viewer app
// builds on. The entries add their components: `.` all of them, `./view2d`, `./view3d` and `./sch` one view and its editor pane each,
// `./panels` the side panels; a page loading one carries no other view.
export { useBoard, usePane, boardContext, type BoardInput } from './board'
export { createBoard, editSession, type BoardStore, type EditSession, type SourceState } from './board-store'
export { createPane, mountedViews, VIEW_FACETS, type PaneState, type Mode, type Tab, type Focus } from './pane'
export { PANE, injectPane, useCommands, modsOf, isMac, load, save, type PaneContext, type ViewPrefs, type Theme } from './context'
export { configure } from './env'
export type { ThemeName } from './theme'
export type { Hover, View, ViewProps } from './view'
export { createViewer, STORE, useShell, afterMount, scopeOfPath, checkSummary, drcSummary, type Shell, type StoreInit, type SiteState, type Route, type Card } from './shell'
export type { SourceKind, SourceTarget } from './source'

export { clearReady, lastPainted, onPainted, setReady, READY_EVENT } from './ready'
export { createSync, remoteHover, type HoverTarget } from './sync'
export { connect, connectBoard, selectMessage } from './connect'
export { sessionSocket, sessionUrl, type Frame, type Transport } from './transport'
export { fromWire, toWire, siteTarget } from './refs'
export { boardKey, compareState, hashOf, heldRun, keyOfSite, repeated, seqTracker, unknownIn } from './live'
export { embedGate, embedHover, embedViews, parseIdeQuery } from './ide'
export { EXPLODE_MAX, findLayer, hasViewQuery, parseViewQuery, queryMode, soloHidden } from './query'
export { click, drawnOf, emptySelection, selectRefs, type Hit, type Mods } from './selection'
export type { Selection } from '@pcbjs/core/internal/selection'
