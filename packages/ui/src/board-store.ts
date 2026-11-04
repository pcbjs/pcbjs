// One board as every pane of it shares it: its targets' facets and the data joined from them, what the last edit made stale, the
// selection, the finding in focus, the hovers and the edit session. A page holds one per board in its Shell; `useBoard` one per
// BoardRef or site data. Free of the DOM.
import { computed, effectScope, markRaw, reactive, shallowReactive, watch } from 'vue'
import type { SiteData, SiteFinding } from '@pcbjs/core/site-data'
import type { BoardRef, FacetName, FacetSet } from '@pcbjs/core/site-facets'
import type { AssistContext, EditModeMsg, FacetMsg, Invalidate, Run, ToolId } from '@pcbjs/core/protocol'
import { emptySelection, normalizeSelection, parseSelectParam, selectParam, type Selection, type SetBy } from '@pcbjs/core/internal/selection'
import { refNet } from '@pcbjs/core/ref'
import {
  anchorGroup,
  layoutGroup,
  anchorPart,
  click,
  drawnOf,
  enter,
  escape,
  isolate,
  isolationView,
  showInstance,
  withoutRef,
  type Hit,
  type IsolationView,
  type Mods,
} from './selection'
import { refocus, siteTarget, targetBox, type FindingFocus } from './refs'
import { endIso, endsOf, type EndsCtx } from './ends'
import { heldRun, keyOfSite, mergeLive, NONE, runN, siteOfLive, staleOf, takeFacet, takeInvalidate, type LiveBoard, type Stale } from './live'
import { pickTarget, sameEntry, upsertEntry } from './variants'
import { boardIndex, type BoardIndex } from './scene/index'
import type { EditClient } from './edit-client'
import type { EditStep } from './undo'
import type { HoverTarget, RemoteHover } from './sync'

type Box = [number, number, number, number]
type Drawn = ReturnType<typeof drawnOf>
export type SourceState = 'poster' | 'loading' | 'ready' | 'failed'

/** The editing tools of one connection to the session: its channel and mode, the tool chosen, the drag, undo and the assist context; no client in a built site or an embed. */
export interface EditSession {
  client: EditClient | null
  mode: EditModeMsg | null
  /** the tool chosen, null for the anchor's default */
  tool: ToolId | null
  /** where the drag writes, from the last plan */
  note: string | null
  dragging: boolean
  /** the file the last commit wrote */
  last: string | null
  /** the banner when the session is older than this viewer */
  mismatch: string | null
  /** the chip's word on the last write: the session's confirmation for a second, or why it failed for three */
  written: { text: string; err: boolean; n: number } | null
  /** the commits made from this page, for undo and redo */
  done: EditStep[]
  undone: EditStep[]
  /** Last applied source files, scoped by project and board for native editor history. */
  undoFiles: Map<string, string[]>
  /** the grid an editor hover lit, for 3 s */
  lit: { board: string; grid: string } | null
  /** the editor cursor waits for an argument here: the assist mode's context */
  assist: AssistContext | null
  /** Escape left assist mode until the editor gives a new context */
  assistOff: boolean
  /** the route end the editor's completion list has in focus, lit as a hover */
  endFocus: { board: string; handle: string } | null
}

export const editSession = (): EditSession =>
  reactive({
    client: null,
    mode: null,
    tool: null,
    note: null,
    dragging: false,
    last: null,
    mismatch: null,
    written: null,
    done: [],
    undone: [],
    undoFiles: markRaw(new Map<string, string[]>()),
    lit: null,
    assist: null,
    assistOff: false,
    endFocus: null,
  }) as EditSession

let noteN = 0
const noteTimers = new WeakMap<EditSession, ReturnType<typeof setTimeout>>()
/** The chip's word on the last write: its confirmation for a second, or why it failed, nothing written, for three. */
export function editNote(e: EditSession, text: string, err = false): void {
  e.written = { text, err, n: ++noteN }
  clearTimeout(noteTimers.get(e))
  noteTimers.set(
    e,
    setTimeout(
      () => {
        e.written = null
      },
      err ? 3000 : 1000,
    ),
  )
}

/** Fetches a board's facets as its views want them; a BoardRef's, from its URLs or its compile in the page. */
export interface Loader {
  want(facets: readonly FacetName[]): void
  /** a newer ref from the dev server */
  refresh?(next: BoardRef): void
}

/** A board held as plain data: boards are only ever replaced whole, and reading rings through a deep proxy costs about forty times more. */
const keep = (s: SiteData): SiteData => markRaw(s)

/** One board as every pane of it shares it. */
export interface BoardStore {
  readonly name: string
  /** one per target, in the order of their variants */
  targets: SiteData[]
  /** the target shown, by variant name; null for the first, and for a board without variants */
  target: string | null
  libraryState: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported'
  libraryError: string | null
  libraryN: number
  library: { ref: string; target: string | null; run: Run | null; site: SiteData } | null
  /** the target shown */
  readonly site: SiteData | null
  readonly layoutSite: SiteData | null
  readonly layoutDrawn: Drawn | null
  /** the board's run of the session's snapshots, the one edits are made against */
  run: Run | null
  /** the facets held per target, plain: what reads them follows `rev` */
  readonly held: Map<string, LiveBoard>
  /** what each edit made stale, by target key, until the compile that resolves it ends */
  invalid: Record<string, Invalidate>
  /** bumped when a facet comes in */
  rev: number
  /** each facet held of the target shown, as data */
  readonly facets: Partial<Record<FacetName, unknown>>
  /** what the last edit made stale on the target shown, until the facets that remake it come */
  readonly stale: Stale
  ref: BoardRef | null
  /** a BoardRef's: the poster until its first facets, `failed` when they cannot come */
  state: SourceState
  error: string | null
  sel: Selection
  /** the finding in focus, by exact id, with its fingerprint and position to find it again after a recompile */
  finding: FindingFocus | null
  /** counts focus changes of a finding, so the panes open its tab even for the same one */
  findingN: number
  /** what the pointer is on in a pane of this page, and the net or parts a panel hovers */
  hover: { item: HoverTarget | null; net: string | null; refs: string[] }
  /** what a click in the 2D view would select now, for the schematic */
  probe: HoverTarget | null
  /** what the pointer is on in another viewer of this board, drawn as a hover without the bubble */
  remote: RemoteHover | null
  /** what ?select= or an isolation asks the views to frame: a part by ref, else an area in board mm */
  frame: { ref: string | null; box: Box | null; owner?: string } | null
  readonly edit: EditSession
  /** what the selection draws, the anchor's part and group, and the whole nets it holds */
  readonly drawn: Drawn | null
  readonly activeRef: string | null
  readonly activeCircuit: string | null
  readonly netMembers: Set<string>
  /** the route end slot the editor waits on, with its candidates */
  readonly ends: EndsCtx | null
  /** the selection's isolation, its definition in its own frame; else a route end slot isolates its candidates */
  readonly iso: IsolationView | null
  /** The board's item index by id, part, net and route; null before its first facets. */
  index(): BoardIndex | null
  /** Fetch the facets a view shows, once each per run. */
  want(facets: readonly FacetName[]): void
  readonly wanted: Set<FacetName>
  /** Each facet as it comes in; returns the unsubscribe. */
  on(fn: (f: FacetMsg) => void): () => void
  /** What fetches the facets of a BoardRef. */
  load(l: Loader): void
  /** A newer ref from the dev server. */
  refresh(next: BoardRef): void
  /** One facet of a target: taken unless older than the one held; the target shows from its first `meta`. */
  take(m: FacetMsg): ReturnType<typeof takeFacet>
  /** Every target as its facets came whole at `run`; a target held of a newer run stays. */
  takeSets(sets: readonly FacetSet[], run: Run | null): void
  /** What an edit makes stale, drawn half-opaque until the stages that remake it end. */
  invalidate(m: Invalidate): void
  /** A compile ended: it resolved every edit before it. */
  settle(): void
  setSel(next: Selection, by?: SetBy): void
  takeSel(next: Selection): void
  selection(): string | null
  selectRef(text: string | null, frame?: boolean, by?: SetBy): string | null
  pick(hit: Hit | null, mods: Mods): void
  enterAt(hit: Hit | null): void
  escapeSel(): void
  dropMember(ref: string): void
  toggleIsolate(): void
  chooseIsolation(mode: 'instance' | 'library' | null): void
  isolateRef(ref: string): void
  isolateInstance(ref: string): void
  focusFinding(m: SiteFinding): void
  note(text: string, err?: boolean): void
  stop(): void
}

/** A board named `name`, its targets taken as facets or whole; `edit` is the connection's edit session, its own by default. */
export function createBoard(name: string, edit: EditSession = editSession()): BoardStore {
  const scope = effectScope(true)
  return scope.run(() => makeBoard(name, edit, () => scope.stop()))!
}

function makeBoard(name: string, edit: EditSession, stop: () => void): BoardStore {
  // the facets held per target, plain: what reads them follows `rev`
  const held = markRaw(new Map<string, LiveBoard>())
  const listeners = new Set<(f: FacetMsg) => void>()
  let loader: Loader | null = null

  const s: BoardStore = reactive({
    name,
    /** one per target, in the order of their variants */
    targets: shallowReactive<SiteData[]>([]),
    /** the target shown, by variant name; null for the first, and for a board without variants */
    target: null as string | null,
    library: null as BoardStore['library'],
    libraryState: 'idle' as BoardStore['libraryState'],
    libraryError: null as string | null,
    libraryN: 0,
    /** the board's run of the session's snapshots, the one edits are made against */
    run: null as Run | null,
    held,
    wanted: new Set<FacetName>(),
    /** what each edit made stale, by target key, until the compile that resolves it ends */
    invalid: {} as Record<string, Invalidate>,
    /** bumped when a facet comes in, for what reads the held facets */
    rev: 0,
    ref: null as BoardRef | null,
    /** a BoardRef's: the poster until its first facets, `failed` when they cannot come */
    state: 'ready' as SourceState,
    error: null as string | null,
    sel: emptySelection(name) as Selection,
    /** the finding in focus, by exact id, with its fingerprint and position to find it again after a recompile */
    finding: null as FindingFocus | null,
    /** counts focus changes of a finding, so the panes open its tab even for the same one */
    findingN: 0,
    /** what the pointer is on in a pane of this page, and the net or parts a panel hovers */
    hover: { item: null as HoverTarget | null, net: null as string | null, refs: [] as string[] },
    /** what a click in the 2D view would select now, for the schematic */
    probe: null as HoverTarget | null,
    /** what the pointer is on in another viewer of this board, drawn as a hover without the bubble */
    remote: null as RemoteHover | null,
    /** what ?select= or an isolation asks the views to frame: a part by ref, else an area in board mm */
    frame: null as { ref: string | null; box: Box | null; owner?: string } | null,
    edit,
    site: computed<SiteData | null>(() => pickTarget(s.targets, s.target)),
    layoutSite: computed<SiteData | null>(() => {
      const base = pickTarget(s.targets, s.target)
      const iso = s.sel.isolate
      if (!base || iso?.mode !== 'library') return base
      if (s.library?.ref === iso.ref && s.library.target === s.target && s.library.run === s.run) return s.library.site
      if (s.edit.client) return null
      return base.edit?.some(n => n.owned && (n.owned === iso.ref || n.owned.startsWith(iso.ref + '/'))) ? null : base
    }),
    /** what the last edit made stale on the target shown, until the facets that remake it come */
    stale: computed<Stale>(() => {
      void s.rev
      const b = s.site
      return b ? staleOf(held.get(keyOfSite(b)), b, s.invalid[keyOfSite(b)]) : NONE
    }),
    /** each facet held of the target shown, as data */
    facets: computed<Partial<Record<FacetName, unknown>>>(() => {
      void s.rev
      const b = s.site
      const h = b ? held.get(keyOfSite(b)) : undefined
      return Object.fromEntries(Object.entries(h?.facets ?? {}).map(([f, x]) => [f, x!.data]))
    }),
    /** what the selection draws, the anchor's part and group, and the whole nets it holds */
    drawn: computed(() => (s.site ? drawnOf(s.site, s.sel) : null)),
    activeRef: computed(() => (s.site ? anchorPart(s.site, s.sel) : null)),
    activeCircuit: computed(() => (s.site ? anchorGroup(s.site, s.sel) : null)),
    netMembers: computed(() => new Set(s.sel.refs.flatMap(r => refNet(r) ?? []))),
    /** the route end slot the editor waits on, with its candidates */
    ends: computed(() => (s.site ? endsOf(edit, s.site, s.sel.isolate) : null)),
    /** the selection's isolation, its definition in its own frame; else a route end slot isolates its candidates */
    layoutDrawn: computed(() => (s.layoutSite ? drawnOf(s.layoutSite, s.sel) : null)),
    iso: computed(() => (s.layoutSite && s.sel.isolate ? isolationView(s.layoutSite, s.sel.isolate) : s.ends && s.site ? endIso(s.site, s.ends) : null)),

    /** The board's item index by id, part, net and route; null before its first facets. */
    index: () => (s.site ? boardIndex(s.site) : null),
    /** Fetch the facets a view shows, once each per run. */
    want(list: readonly FacetName[]) {
      for (const name of list) s.wanted.add(name)
      loader?.want(list)
    },
    /** Each facet as it comes in; returns the unsubscribe. */
    on(fn: (f: FacetMsg) => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    /** What fetches the facets of a BoardRef. */
    load(l: Loader) {
      loader = l
    },
    /** A newer ref from the dev server. */
    refresh(next: BoardRef) {
      loader?.refresh?.(next)
    },

    /** One facet of a target: taken unless older than the one held; the target shows from its first `meta`. */
    take(m: FacetMsg): ReturnType<typeof takeFacet> {
      const r = takeFacet(held, { ...m, data: markRaw(m.data) })
      if (r.site) put([...withTarget(s.targets, keep(r.site))])
      if (!r.dropped && !r.bad) {
        if (s.facets.meta) s.state = 'ready'
        for (const fn of listeners) fn(m)
      }
      s.rev++
      return r
    },
    /** Every target as its facets came whole at `run`; a target held of a newer run stays. */
    takeSets(sets: readonly FacetSet[], run: Run | null) {
      const n = runN(run)
      const next = sets.map(set => {
        const key = facetKey(set.board, set.target)
        const mine = s.targets.find(o => keyOfSite(o) === key)
        const h = held.get(key)
        const merged = mergeLive(h, set, run)
        held.set(key, merged.live)
        return merged.changed || !mine ? keep(siteOfLive(merged.live)) : mine
      })
      // a target only facets have drawn so far, its first compile one of some views
      for (const o of s.targets) {
        const h = held.get(keyOfSite(o))
        if (!next.some(b => sameEntry(b, o)) && h && runN(heldRun(h)) > n) upsertEntry(next, o)
      }
      put(next)
      s.run = run
      if (s.facets.meta) s.state = 'ready'
      s.rev++
    },
    /** What an edit makes stale, drawn half-opaque until the stages that remake it end. */
    invalidate(m: Invalidate) {
      takeInvalidate(held, m)
      s.invalid[keyOf(m.target)] = m
      s.rev++
    },
    /** A compile ended: it resolved every edit before it. */
    settle() {
      if (Object.keys(s.invalid).length) s.invalid = {}
    },

    /** The selection, set by `by`; the session stamps `seq` and `client` in dev. */
    setSel(next: Selection, by: SetBy = 'viewer') {
      if (!next.anchor && !next.refs.length) next = { ...next, finding: null }
      const was = s.sel
      next = normalizeSelection(next, [...(s.site?.drc ?? []), ...(s.site?.erc ?? [])], was)
      s.sel = { ...next, board: name, by, client: null }
      syncFrame(was)
      syncFinding(s.sel.finding ?? null)
    },
    /** A selection from the session or another view, taken as it is. */
    takeSel(next: Selection) {
      const was = s.sel
      s.target = next.target
      s.sel = normalizeSelection(next, undefined, was)
      syncFrame(was)
      syncFinding(next.finding ?? null)
    },
    /** The selection as `?select=` lists it, anchor first; null for none. */
    selection: (): string | null => selectParam(s.sel),
    /** Select every reference of a comma list as ?select= does, the first the anchor; null clears; `frame` frames the anchor. The reasons some name nothing, null when all applied. */
    selectRef(text: string | null, frame = false, by: SetBy = 'viewer'): string | null {
      const b = s.site
      if (!b) return 'no board yet'
      if (text == null) {
        s.setSel({ ...s.sel, refs: [], anchor: null, finding: null }, by)
        s.finding = null
        return null
      }
      const { refs, anchor } = parseSelectParam(text)
      const why: string[] = []
      const ok = refs.filter(ref => {
        try {
          const t = siteTarget(b, ref)
          if (t.kind === 'finding') s.focusFinding(t.marker)
          return true
        } catch (e) {
          why.push((e as Error).message)
          return false
        }
      })
      if (!ok.length) return why.join('; ')
      const a = anchor && ok.includes(anchor) ? anchor : ok[ok.length - 1]
      s.setSel({ ...s.sel, refs: ok, anchor: a, level: s.sel.isolate?.ref ?? null }, by)
      if (frame) {
        const t = siteTarget(b, a)
        s.frame = t.kind === 'finding' ? s.frame : { ref: t.kind === 'part' || t.kind === 'pad' ? t.ref : null, box: targetBox(b, t), owner: a }
      }
      return why.length ? why.join('; ') : null
    },
    /** A click in a view: what it selects, a click inside a selected group entering its definition. */
    pick(hit: Hit | null, mods: Mods) {
      if (s.layoutSite) setIso(click(s.sel, s.layoutSite, hit, mods))
    },
    /** A double-click: a group's definition entered with the entity under the pointer selected, a part's pad or a route's point. */
    enterAt(hit: Hit | null) {
      if (s.layoutSite) setIso(enter(s.sel, s.layoutSite, hit))
    },
    /** Escape cancels a finding, then ascends or leaves isolation, then clears selection. */
    escapeSel() {
      if (s.sel.isolateChoice) return s.chooseIsolation(null)
      if (s.sel.finding) return s.setSel({ ...s.sel, finding: null, refs: [], anchor: null })
      if (s.site) setIso(escape(s.sel, s.site))
    },
    /** Drop one member; the anchor passes to the one before it. */
    dropMember(ref: string) {
      s.setSel(withoutRef(s.sel, ref))
    },
    /** Isolate on what the selection names, or off; the views frame what it shows. */
    toggleIsolate() {
      if (s.site) setIso(isolate(s.sel, s.site))
    },
    chooseIsolation(mode: 'instance' | 'library' | null) {
      if (!mode) return s.setSel({ ...s.sel, isolateChoice: null })
      const base = pickTarget(s.targets, s.target)
      if (!base) return
      const choice = s.sel.isolateChoice ?? s.sel.isolate ?? isolate(s.sel, base).isolate
      if (!choice || !layoutGroup(base, { ...s.sel, isolate: choice })) return
      s.setSel({ ...s.sel, isolateChoice: null, isolate: { ...choice, mode }, level: choice.ref })
      if (mode === 'library' && !s.edit.client && base.edit?.some(n => n.owned && (n.owned === choice.ref || n.owned.startsWith(choice.ref + '/')))) {
        s.libraryState = 'error'
        s.libraryError = 'Connect to a live session to load this library layout.'
      }
    },
    /** Isolate the instance a reference names, as ?isolate= does. */
    isolateRef(ref: string) {
      if (!s.site) return
      const next = isolate({ ...s.sel, isolate: null, level: null, refs: [ref], anchor: ref }, s.site)
      if (!next.isolate) return console.warn(`pcbjs: ?isolate=${ref} on ${name}: names no group or part`)
      setIso(next, 'url')
    },
    /** Show the isolated definition with another instance's values. */
    isolateInstance(ref: string) {
      const next = showInstance(s.sel, ref)
      s.setSel(next)
    },
    /** Put a finding in focus; the panes open its tab. */
    focusFinding(m: SiteFinding) {
      s.setSel({ ...s.sel, finding: m.id ?? null, refs: m.id ? [m.id] : [], anchor: m.id ?? null })
    },
    /** The chip's word on the last write. */
    note(text: string, err = false) {
      editNote(edit, text, err)
    },
    stop,
  }) as unknown as BoardStore

  function syncFinding(id: string | null) {
    if (s.finding?.id === id || (!s.finding && !id)) return
    const m = id ? [...(s.site?.drc ?? []), ...(s.site?.erc ?? [])].find(f => f.id === id) : null
    s.finding = m?.id ? { id: m.id, fingerprint: m.fingerprint, at: m.at ? [m.at[0], m.at[1]] : null } : null
    s.findingN++
  }

  const keyOf = (target: string | null | undefined) => facetKey(name, target)
  function put(list: SiteData[]) {
    s.targets = shallowReactive(list.length > 1 ? [...list].sort((a, b) => (a.variant?.index ?? 0) - (b.variant?.index ?? 0)) : list)
  }
  /** Entering isolation fits its layout; leaving clears the request so views restore their checkpoint. */
  function setIso(next: Selection, by: SetBy = 'viewer') {
    s.setSel({ ...next, isolate: next.isolate ? { ...next.isolate, mode: next.isolate.mode ?? 'instance' } : null, isolateChoice: null }, by)
  }
  function syncFrame(was: Selection) {
    if (JSON.stringify(s.sel.isolate) !== JSON.stringify(was.isolate)) frameIsolation(s.sel)
    else if (s.frame?.owner && !s.sel.finding && s.sel.anchor !== s.frame.owner) s.frame = null
  }
  function frameIsolation(next: Selection) {
    const b = s.layoutSite
    if (!b) return
    const box = next.isolate ? isolationView(b, next.isolate).box : null
    const m = box ? Math.max(1.5, Math.max(box[2], box[3]) / 6) : 0
    s.frame = box ? { ref: null, box: [box[0] - m, box[1] - m, box[2] + 2 * m, box[3] + 2 * m] } : null
  }

  watch(
    () => s.target,
    target => {
      if (s.sel.target !== target) s.sel = { ...s.sel, target }
    },
    { flush: 'sync' },
  )

  watch(
    () => s.layoutSite,
    () => {
      if (s.sel.isolate?.mode === 'library') frameIsolation(s.sel)
    },
  )

  // hovers go with an update, and a recompile renumbers findings: the one in focus is found again by its fingerprint, nearest its position
  watch(
    () => s.site,
    b => {
      if (!b) return
      s.hover.net = null
      s.hover.refs = []
      if (held.has(keyOfSite(b)) && !s.facets.findings) return
      if (!s.finding) {
        syncFinding(s.sel.finding ?? null)
        return
      }
      const m = refocus(s.finding, [...b.drc, ...b.erc])
      const old = s.sel.finding
      const id = m?.id ?? null
      s.setSel({ ...s.sel, finding: id, refs: s.sel.refs.flatMap(ref => (ref === old ? (id ? [id] : []) : [ref])), anchor: s.sel.anchor === old ? id : s.sel.anchor })
    },
  )
  return s
}

function withTarget(list: readonly SiteData[], site: SiteData): SiteData[] {
  const out = [...list]
  upsertEntry(out, site)
  return out
}

/** The key of a facet stream: a board and its target. */
export const facetKey = (board: string, target: string | null | undefined): string =>
  keyOfSite({ name: board, variant: target ? ({ name: target } as SiteData['variant']) : undefined })

/** The facets a ref names that a loader fetches; meta always. */
export const wanted = (list: readonly FacetName[]): FacetName[] => [...new Set<FacetName>(['meta', ...list])]
