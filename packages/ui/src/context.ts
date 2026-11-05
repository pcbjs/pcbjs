// What a view or a panel draws from: the board, the pane it shows in, the view preferences and the command bus, and the page around it
// when there is one. A board page provides it; a component on its own gets its board's, shared by every component of that board.
import { inject, onBeforeUnmount, onMounted, type InjectionKey } from 'vue'
import type { BoardStore } from './board-store'
import type { PaneState } from './pane'
import type { CommandBus } from './keys'
import type { Shell } from './shell'
import type { SourceKind, SourceTarget } from './source'

export type Theme = 'light' | 'dark'

/** What every view of a page shares: the grid and the ratsnest, cmd or ctrl held for a deep-select, and the theme set, null following the system. */
export interface ViewPrefs {
  grid: boolean
  ratsnest: boolean
  deep: boolean
  theme: Theme | null
}

export interface PaneContext {
  board: BoardStore
  pane: PaneState
  prefs: ViewPrefs
  commands: CommandBus
  /** the page around, null for a component on its own */
  shell: Shell | null
  theme(): Theme
  toggle(pref: 'grid' | 'ratsnest'): void
  /** A word to the reader, as the page's toast shows it. */
  say(text: string, err?: boolean): void
  /** Open a source location: the editor in dev, the repository host in a built site. */
  open(t: SourceTarget | null, quiet?: boolean, external?: boolean): Promise<void>
}

export type { SourceKind }

/** A global symbol, so a hot reload of this file still finds what a page provided. */
export const PANE = Symbol.for('pcbjs:pane') as InjectionKey<PaneContext>

/** The context provided around this component, null outside a board page. */
export const injectPane = (): PaneContext | null => inject(PANE, null)

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
/** The deep-select key, cmd on macOS and ctrl elsewhere. */
export const deepKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey)
/** A pointer event's modifiers as the selection reads them. */
export const modsOf = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey?: boolean }) => ({ shift: e.shiftKey, deep: deepKey(e), alt: !!e.altKey })

/** A component's handlers for the key map's commands, while it is mounted; the keys reach them through the bus. */
export function useCommands(bus: CommandBus, handlers: Record<string, () => boolean>): void {
  let offs: (() => void)[] = []
  onMounted(() => {
    bus.listen(window, isMac)
    offs = Object.entries(handlers).map(([id, fn]) => bus.on(id, fn))
  })
  onBeforeUnmount(() => offs.forEach(off => off()))
}

// storage can throw in private windows or with blocked site data, so every access is guarded
export function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export function save(key: string, value: string | null) {
  try {
    value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value)
  } catch {
    /* not persisted */
  }
}
