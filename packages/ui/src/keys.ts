// The key map: one table of every key and gesture the views honour, the command each runs, the bus the views answer commands on, and
// the Markdown docs/keys.md is generated from, so the docs and the code cannot drift. Free of Vue and the DOM.
// The rule: the views take only the keys of this table; every other chord, cmd or ctrl P among them, passes untouched, with no
// preventDefault and no stopPropagation, and a preview pane hands each such chord to its editor, which binds it.

/** Where a binding acts: everywhere, in the board views, on the anchor's tools, during a drag, while the editor waits in assist mode, or in the code editor. */
export type KeyScope = 'Everywhere' | 'Board views' | 'Tools' | 'Drag' | 'Assist' | 'Selection' | 'Editor'

/** The views a binding acts in. */
export type KeyView = '2D' | '3D' | 'Schematic' | 'DRC/ERC'
const ALL: readonly KeyView[] = ['2D', '3D', 'Schematic']
const ANY: readonly KeyView[] = [...ALL, 'DRC/ERC']
/** the board views: the tools, the drags and the assist mode act alike in both */
const BOARD: readonly KeyView[] = ['2D', '3D']

export interface KeyDef {
  /** the command, as the palette and the bus name it */
  id: string
  /** what is pressed: a key, `Mod+Z` with cmd on a Mac and ctrl elsewhere, or a pointer gesture such as `Shift+Click` */
  keys: string[]
  title: string
  scope: KeyScope
  /** the views it acts in, none for a key of the code editor */
  views: readonly KeyView[]
  /** a gesture, no key: listed but never dispatched */
  gesture?: boolean
  /** a key of the code editor: the extension's command and its `when`, never dispatched by the views */
  editor?: { command: string; when: string }
}

export const KEYS: readonly KeyDef[] = [
  { id: 'palette', keys: ['/'], title: 'Open the command palette', scope: 'Everywhere', views: ANY },
  { id: 'help', keys: ['?'], title: 'Show the key map', scope: 'Everywhere', views: ANY },
  { id: 'view', keys: ['V'], title: 'Cycle the view: 2D, 3D, schematic, DRC/ERC', scope: 'Everywhere', views: ANY },
  { id: 'grid', keys: ['G'], title: 'Show or hide the grid', scope: 'Everywhere', views: ALL },
  { id: 'ratsnest', keys: ['N'], title: 'Show or hide the ratsnest and the connection indicators', scope: 'Everywhere', views: ALL },
  { id: 'fit', keys: ['F'], title: 'Fit the board or the sheet', scope: 'Board views', views: ALL },
  { id: 'zoomIn', keys: ['+', '='], title: 'Zoom in', scope: 'Board views', views: ALL },
  { id: 'zoomOut', keys: ['-'], title: 'Zoom out', scope: 'Board views', views: ALL },
  { id: 'up', keys: ['Escape'], title: 'Cancel a drag, leave assist mode, go up inside an isolation, leave it, else clear the selection', scope: 'Selection', views: ALL },
  { id: 'isolate', keys: ['I'], title: 'Isolate: edit the definition of the selected instance, or leave it for the board', scope: 'Selection', views: ALL },
  { id: 'extend', keys: ['Shift+Click'], title: 'Add to the selection or take out of it', scope: 'Selection', views: ALL, gesture: true },
  { id: 'deep', keys: ['Mod+Click'], title: 'Select the leaf under the pointer, past its groups', scope: 'Selection', views: ALL, gesture: true },
  {
    id: 'definition',
    keys: ['Alt+Click'],
    title: 'Open the definition of what a click selects, its factory or declaration, in the editor; the selection stays',
    scope: 'Selection',
    views: ALL,
    gesture: true,
  },
  {
    id: 'enter',
    keys: ['Double-click'],
    title: 'Enter the definition of the instance under the pointer, the part clicked selected; a click on the selected instance does the same',
    scope: 'Selection',
    views: ALL,
    gesture: true,
  },
  { id: 'move', keys: ['M'], title: 'Move tool', scope: 'Tools', views: BOARD },
  { id: 'rotate', keys: ['R'], title: 'Rotate the anchor 90 degrees', scope: 'Tools', views: BOARD },
  { id: 'side', keys: ['L'], title: 'Put the anchor on the other side', scope: 'Tools', views: BOARD },
  { id: 'points', keys: ['P'], title: 'Control point tool of a route', scope: 'Tools', views: BOARD },
  { id: 'delete', keys: ['Delete', 'Backspace'], title: 'Delete the picked control point', scope: 'Tools', views: BOARD },
  { id: 'undo', keys: ['Mod+Z'], title: 'Undo: source document history in the editor, else this page’s last edit', scope: 'Tools', views: ALL },
  { id: 'redo', keys: ['Mod+Shift+Z'], title: 'Redo: source document history in the editor, else this page’s last undo', scope: 'Tools', views: ALL },
  { id: 'fine', keys: ['Shift+Drag'], title: 'Move or point: no snapping; ring: 5 degree stops', scope: 'Drag', views: BOARD, gesture: true },
  { id: 'free', keys: ['Mod+Drag'], title: 'Move or point: lock to one axis; ring: no snapping', scope: 'Drag', views: BOARD, gesture: true },
  { id: 'allDots', keys: ['Shift'], title: 'Every grid dot; a pick writes l when its trace is clean, else X', scope: 'Assist', views: BOARD, gesture: true },
  { id: 'pick', keys: ['Click'], title: 'Write the dot as the argument the editor waits for', scope: 'Assist', views: BOARD, gesture: true },
  ...(['2D', '3D', 'Schematic', 'Checks'] as const).flatMap((v): KeyDef[] => {
    const k = v === 'Checks' ? '4' : v === 'Schematic' ? 'S' : v[0]
    return [
      {
        id: `open${v}Beside`,
        keys: [`Mod+Alt+${k}`],
        title: `Open the ${v === 'Checks' ? 'DRC/ERC' : v === 'Schematic' ? 'schematic' : v} view beside the code`,
        scope: 'Editor',
        views: [],
        editor: { command: `pcbjs.open${v}Beside`, when: 'pcbjs.active' },
      },
      {
        id: `open${v}New`,
        keys: [`Mod+Alt+Shift+${k}`],
        title: `Open another ${v === 'Checks' ? 'DRC/ERC' : v === 'Schematic' ? 'schematic' : v} view beside the code`,
        scope: 'Editor',
        views: [],
        editor: { command: `pcbjs.open${v}New`, when: 'pcbjs.active' },
      },
    ]
  }),
  {
    id: 'restartClean',
    keys: ['Mod+Shift+R'],
    title: 'Restart the server and clear every cache, while a preview tab is active',
    scope: 'Editor',
    views: [],
    editor: { command: 'pcbjs.restartClean', when: "activeWebviewPanelId == 'pcbjs.preview'" },
  },
]

const SCOPES: readonly KeyScope[] = ['Everywhere', 'Board views', 'Selection', 'Tools', 'Drag', 'Assist', 'Editor']

/** A binding the views dispatch: no gesture and no editor key. */
export const dispatched = (d: KeyDef) => !d.gesture && !d.editor

type KeyEv = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey?: boolean }
/** The name of a key event as the table writes it: `G`, `/`, `Escape`, `Mod+Z`, `Mod+Shift+Z`; shift is named only with cmd or ctrl, since it makes `?` of `/`. */
export function keyName(e: KeyEv, mac: boolean): string {
  const mod = mac ? e.metaKey : e.ctrlKey
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key
  return `${mod ? 'Mod+' : ''}${e.altKey ? 'Alt+' : ''}${mod && e.shiftKey ? 'Shift+' : ''}${k}`
}

/** The command a key event runs, null when the table has none. */
export function commandOf(e: KeyEv, mac: boolean): KeyDef | null {
  const name = keyName(e, mac)
  return KEYS.find(d => dispatched(d) && d.keys.includes(name)) ?? null
}

/** A key as the user reads it on this machine: `⌘Z` on a Mac, `Ctrl+Z` elsewhere. */
export const shown = (k: string, mac: boolean) => k.replace(/^Mod\+/, mac ? '⌘' : 'Ctrl+')

/** The commands a search finds: every word in the title, the id or a key. */
export function search(q: string, defs: readonly KeyDef[] = KEYS): KeyDef[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  return defs.filter(d => words.every(w => `${d.title} ${d.id} ${d.keys.join(' ')} ${d.scope}`.toLowerCase().includes(w)))
}

/** The key map as Markdown tables, one per scope, as docs/keys.md carries it. */
export function keysMarkdown(): string {
  return SCOPES.map(s => {
    const rows = KEYS.filter(d => d.scope === s).map(d => `| ${d.keys.map(k => `\`${k}\``).join(' or ')} | ${d.title} | ${d.views.join(', ') || 'VS Code'} |`)
    return `### ${s}\n\n| Key | Does | Views |\n| --- | --- | --- |\n${rows.join('\n')}\n`
  }).join('\n')
}

/** A key as VS Code's manifest writes it: `Mod+Alt+Shift+S` is `cmd+alt+shift+s` on a Mac. */
const vscodeKey = (k: string, mac: boolean) =>
  k
    .split('+')
    .map(p => (p === 'Mod' ? (mac ? 'cmd' : 'ctrl') : p.toLowerCase()))
    .join('+')

/** The extension's `contributes.keybindings`, generated from the editor keys of the table. */
export function vscodeKeybindings(): { command: string; key: string; mac: string; when: string }[] {
  return KEYS.flatMap(d => (d.editor ? d.keys.map(k => ({ command: d.editor!.command, key: vscodeKey(k, false), mac: vscodeKey(k, true), when: d.editor!.when })) : []))
}

/** A key its host may bind: a chord with cmd, ctrl or alt, or a function key; a text field keeps its own editing chords. */
export function forHost(e: KeyEv, inField: boolean): boolean {
  const mod = e.metaKey || e.ctrlKey
  if (!mod && !e.altKey && !/^F\d{1,2}$/.test(e.key)) return false
  return !(inField && mod && /^[acvxyz]$/i.test(e.key))
}

/** The fields of a key event a host needs to dispatch it again, as `new KeyboardEvent('keydown', init)` takes them. */
export const keyInit = (e: KeyEv & { code: string; keyCode: number; shiftKey: boolean; repeat: boolean }) => ({
  key: e.key,
  code: e.code,
  keyCode: e.keyCode,
  metaKey: e.metaKey,
  ctrlKey: e.ctrlKey,
  altKey: e.altKey,
  shiftKey: e.shiftKey,
  repeat: e.repeat,
})

type Handler = () => boolean
export interface KeyTarget {
  addEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void): void
}
/** The commands the views answer: the newest handler first, the first that takes the command ends it. */
export function commandBus() {
  const handlers = new Map<string, Handler[]>()
  let listening = false
  let pass: ((e: KeyboardEvent) => void) | null = null
  const run = (id: string): boolean => {
    for (const fn of handlers.get(id) ?? []) if (fn()) return true
    return false
  }
  const forwardKey = (e: KeyboardEvent): void => {
    const t = e.target as { closest?: (s: string) => unknown } | null
    const field = !!t?.closest?.('input, textarea, select, [contenteditable]')
    if (pass && !e.defaultPrevented && forHost(e, field)) pass(e)
  }
  return {
    /** Dispatch the table's keys to the handlers, once per bus, never while typing in a field; a chord no handler took goes to `forward`. */
    listen(target: KeyTarget, mac: boolean): void {
      if (listening) return
      listening = true
      target.addEventListener('keydown', e => {
        if (e.defaultPrevented) return
        const t = e.target as { closest?: (s: string) => unknown } | null
        const field = !!t?.closest?.('input, textarea, select, [contenteditable]')
        const def = field ? null : commandOf(e, mac)
        if (def && run(def.id)) {
          e.preventDefault()
          e.stopImmediatePropagation()
        } else forwardKey(e)
      })
    },
    /** Where the chords no view takes go, such as the editor around a preview pane. */
    forward(fn: (e: KeyboardEvent) => void): void {
      pass = fn
    },
    on(id: string, fn: Handler): () => void {
      handlers.set(id, [fn, ...(handlers.get(id) ?? [])])
      return () =>
        handlers.set(
          id,
          (handlers.get(id) ?? []).filter(f => f !== fn),
        )
    },
    run,
    /** A modal forwards host chords without dispatching board commands or taking native field editing. */
    forwardModal(e: KeyboardEvent, mac: boolean): void {
      if (!commandOf(e, mac)) forwardKey(e)
    },
    has: (id: string) => !!handlers.get(id)?.length,
  }
}
export type CommandBus = ReturnType<typeof commandBus>
