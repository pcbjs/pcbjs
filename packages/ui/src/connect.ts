// Every event a page takes, in one place: the session's over its transport, the browser's own, and the page around a frame. A board on
// a page of its own, a live `?pcb:board`, takes its facets, invalidates and heartbeat through the same live path. See docs/viewer.md.
import { effectScope, markRaw, nextTick, watch, watchEffect } from 'vue'
import type { SiteData } from '@pcbjs/core/site-data'
import { facetSet } from '@pcbjs/core/site-facets'
import {
  snapshotId,
  type Desync,
  type FacetMsg,
  type HoverMsg,
  type Invalidate,
  type LoadStatus,
  type Observe,
  type PagePost,
  type SelectMsg,
  type StateMsg,
} from '@pcbjs/core/protocol'
import { selectParam } from '@pcbjs/core/internal/selection'
import type { BoardStore } from './board-store'
import type { Mode, PaneState } from './pane'
import type { Shell } from './shell'
import type { Transport } from './transport'
import { deepKey, isMac } from './context'
import { keyInit } from './keys'
import { applyEndFocus } from './ends'
import { editNote } from './board-store'
import { editClient, sessionMismatch, writtenText } from './edit-client'
import { pushStep, undoKey, undoProject } from './undo'
import { createSync, remoteHover } from './sync'
import { connectLibrary } from './layout'
import { fromWire, toWire } from './refs'
import { boardKey, compareState, hashOf, heldRun, keyOfSite, repeated, seqTracker, unknownIn, type LiveBoard } from './live'
import { embedGate, embedHover, embedViews, parseIdeQuery, parseIdeRequest } from './ide'
import { lastPainted, onPainted } from './ready'
import { parseViewQuery, selectSearch, sideSearch } from './query'
import { isAppPath } from './variants'
import { parseAgents, sendNotice } from './agents'

/** ms between two resyncs at most, about one heartbeat */
const RESYNC_MS = 2000
const TIMELINE_MS = 60_000

/** Wire a page to the browser, to the session over `t` in dev, and to the page around it in a frame, then open `t`; before the app mounts. Returns the disconnect. */
export function connect(shell: Shell, t: Transport | null): () => void {
  const scope = effectScope(true)
  const off = new AbortController()
  scope.run(() => {
    page(shell, !t, off.signal)
    if (t) {
      // ?select= and ?isolate= keep the first board's selection, so the session does not send it its own
      const q = parseViewQuery(location.search)
      session(shell, t)
      live(t, shellLive(shell), !!(q.select || q.isolate))
      sync(shell, t)
      connectLibrary(t, () => { const b = shell.shown.value; return b && ['2d', '3d', 'sch'].includes(shell.pane(b.name).mode) ? b : null })
      agents(shell, t)
    }
    if (window.parent !== window) frame(shell, off.signal)
  })
  t?.open()
  return () => {
    scope.stop()
    off.abort()
  }
}

/** A board on a page of its own taking its facets, invalidates and heartbeat over `t`, as a page's boards do, then opening `t`. Returns the disconnect. */
export function connectBoard(board: BoardStore, t: Transport): () => void {
  const scope = effectScope(true)
  scope.run(() => { live(t, boardLive(board)); connectLibrary(t, () => board.wanted.has('layers') || board.wanted.has('model') || board.wanted.has('sch') ? board : null) })
  t.open()
  return () => scope.stop()
}

// ---- the browser: IDE mode, the URL, links, keys and the title ----

function page(shell: Shell, built: boolean, signal: AbortSignal) {
  const { state, edit } = shell
  const on = <K extends keyof WindowEventMap>(k: K, fn: (e: WindowEventMap[K]) => void, o: AddEventListenerOptions = {}) => addEventListener(k, fn, { ...o, signal })
  // ?ide=1 is read before the first render, never during one; a page made without it still enters IDE mode here
  if (!shell.ide.on) {
    const q = parseIdeQuery(location.search)
    if (q.ide) shell.enterIde(q.theme, location.search)
  }
  // only the editor or the page around the page may post requests
  if ((shell.ide.on || shell.embed.on) && window.parent !== window)
    on('message', e => {
      if (e.source === window.parent && !built && e.data?.type === 'pcbjs:devtools' && typeof e.data.enabled === 'boolean') {
        const board = shell.shown.value
        if (board) shell.pane(board.name).devtools = e.data.enabled
        return
      }
      const r = e.source === window.parent ? parseIdeRequest(e.data) : null
      if (r) void shell.applyRequest(r)
    })
  // a built site without the inlined data: boards.json next to index.html, then each board's JSON
  if (built && !shell.groups.value.length && !Object.keys(state.errors).length) fetchBoards(shell)
  on('popstate', () => {
    state.path = location.pathname
  })
  // the current board's side, mirror and selection follow into the URL, so a reload or a copied link keeps them
  watch(
    () => {
      const b = shell.current.value
      if (!b) return null
      const v = shell.pane(b.name),
        s = shell.board(b.name)
      return [v.side, v.mirror, selectParam(s.sel), b.name, s.sel.isolate?.ref ?? null, s.sel.finding ?? null, s.sel.isolate?.mode ?? null, v.mode] as const
    },
    (look, was) => {
      if (!look) return
      // a selection made on this board, not one the board brings along when it shows
      const side = sideSearch(location.search, look[0], look[1])
      let search = was && was[3] === look[3] && (was[2] !== look[2] || was[4] !== look[4] || was[5] !== look[5] || was[6] !== look[6]) ? selectSearch(side, look[2], look[4], look[5], look[6]) : side
      if (was && was[3] === look[3] && was[7] !== look[7]) {
        const query = new URLSearchParams(search)
        query.set('view', look[7])
        search = `?${query}`
      }
      if (search === location.search) return
      history.replaceState(history.state, '', location.pathname + search + location.hash)
      if (shell.ide.on) shell.ide.search = search
      if (shell.embed.on) shell.embed.search = search
    },
  )
  // links to routes stay real <a href> for middle-click and copy link; a plain click navigates in place
  document.addEventListener(
    'click',
    e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.href)
      if (url.origin !== location.origin || !isAppPath(url.pathname, shell.base)) return
      e.preventDefault()
      shell.go(url.pathname)
    },
    { signal },
  )
  // cmd or ctrl held: a hover shows what a deep-select would pick
  const deep = (e: KeyboardEvent | MouseEvent) => {
    const d = deepKey(e)
    if (d !== shell.prefs.deep) shell.prefs.deep = d
  }
  on('keydown', deep)
  on('keyup', deep)
  on('pointermove', deep, { passive: true })
  on('blur', () => {
    shell.prefs.deep = false
  })
  // the key map's page commands; the views add theirs as they mount, and run first
  const onBoard = (fn: (b: BoardStore, v: PaneState) => void) => () => {
    const b = shell.shown.value
    if (!b) return false
    fn(b, shell.pane(b.name))
    return true
  }
  const commands: Record<string, () => boolean> = {
    palette: () => ((shell.page.palette = true), true),
    help: () => ((shell.page.keymap = !shell.page.keymap), true),
    grid: () => (shell.toggleGrid(), true),
    ratsnest: () => (shell.toggleRatsnest(), true),
    view: onBoard((b, v) => {
      const modes: Mode[] = b.site?.schematic.drawing ? ['2d', '3d', 'sch', 'checks'] : ['2d', '3d', 'checks']
      v.mode = modes[(modes.indexOf(v.mode) + 1) % modes.length]
    }),
    up: onBoard(b => {
      if (shell.page.palette || shell.page.keymap) shell.page.palette = shell.page.keymap = false
      else if (!edit.dragging) b.escapeSel()
    }),
    isolate: onBoard(b => b.toggleIsolate()),
    undo: () => shell.undoEdit(false),
    redo: () => shell.undoEdit(true),
  }
  for (const [id, fn] of Object.entries(commands)) shell.commands.on(id, fn)
  // in an editor's pane, the chords no view takes go to the editor, cmd or ctrl P among them
  if (shell.ide.on && window.parent !== window) shell.commands.forward(e => window.parent.postMessage({ type: 'pcbjs:key', ...keyInit(e) }, '*'))
  shell.commands.listen(window, isMac)
  watchEffect(() => {
    document.title = shell.pageTitle.value
  })
}

/** The boards of a built site that inlined none: boards.json, then each board's JSON, taken as every board is. */
function fetchBoards(shell: Shell) {
  const { state } = shell
  state.loading = true
  fetch(shell.asset('boards.json'))
    .then(r => r.json())
    .then(async (idx: { boards: { name: string; file: string; entry: string }[]; single: boolean }) => {
      state.single = idx.single
      state.entries = Object.fromEntries(idx.boards.map(b => [b.name, b.entry]))
      const sites = await Promise.all(idx.boards.map(b => fetch(shell.asset(b.file)).then(r => r.json() as Promise<SiteData>)))
      shell.takeSets(sites.map(facetSet), null)
    })
    .catch(() => {})
    .finally(() => {
      state.loading = false
    })
}

// ---- the session: boards, focus, scopes, errors, the editor's context and the edit channel ----

function session(shell: Shell, t: Transport) {
  const { state, edit } = shell
  t.on('pcbjs:boards', p => shell.takeBoards(p))
  t.on('pcbjs:focus', e => shell.onFocus(e))
  t.on('pcbjs:scopes', i => shell.onScopes(i))
  t.on('pcbjs:error', e => {
    state.errors = { ...state.errors, [e.entry]: e.text || e.message }
  })
  let litTimer: ReturnType<typeof setTimeout> | undefined
  t.on('pcbjs:grid', m => {
    edit.lit = m?.grid ? { board: m.board, grid: m.grid } : null
    clearTimeout(litTimer)
    litTimer = setTimeout(() => {
      edit.lit = null
    }, 3000)
  })
  t.on('pcbjs:assist', m => {
    edit.assist = m?.assist ? markRaw(m.assist) : null
    edit.assistOff = false
  })
  t.on('pcbjs:assist:focus', m => {
    edit.endFocus = applyEndFocus(edit.endFocus, m)
  })
  // the mode is the connection's; a session older than this viewer misses frames it sends: one banner rather than tools that silently fail
  t.on('pcbjs:ide:ready', r => {
    edit.mode = { mode: r.mode, editor: edit.mode?.editor ?? false }
    edit.mismatch = sessionMismatch(r)
  })
  t.on('pcbjs:editor', m => {
    edit.mode = { mode: edit.mode?.mode ?? 'ro', editor: m.attached }
  })
  if (shell.embed.on) return
  edit.client = markRaw(
    editClient(
      t,
      (r, owner) => {
        pushStep(edit, r)
        const applied = r.written.filter(w => w.applied)
        if (!owner || r.error || !applied.length || !applied.every(w => w.via === 'editor')) return
        const files = [...new Set(applied.map(w => w.file))]
        edit.undoFiles.set(undoKey(owner.board, owner.project), files)
        if (shell.ide.on && window.parent !== window) window.parent.postMessage({ type: 'pcbjs:edit-written', ...owner, files }, '*')
      },
      files => editNote(edit, writtenText(files)),
      board => ({ board, project: undoProject(shell.workspace.info, shell.workspace.scope) }),
    ),
  )
}

// ---- the live boards: facets and invalidates in, the heartbeat and every frame number checked, a resync, the demand out ----

/** What the live path reads and writes: a page's boards, or one board on a page of its own. */
interface Live {
  take(m: FacetMsg): { bad?: boolean }
  invalidate(m: Invalidate): void
  status(st: LoadStatus): void
  /** every target held, by board key */
  held(): Map<string, LiveBoard>
  site(board: string, key: string): SiteData | undefined
  observing(): Observe
  /** the board a resync that names none is about */
  shown(): { board: string; target: string | null } | null
  hold(h: StateMsg['hold']): void
  notice(repeated: boolean): void
  /** the session kept the incident of a resync */
  incident(m: { file: string; url: string }): void
}

function shellLive(shell: Shell): Live {
  const { live } = shell
  return {
    take: m => shell.take(m),
    invalidate: m => shell.invalidate(m),
    status: st => shell.status(st),
    held: () => shell.held(),
    site: (board, key) => shell.boards.get(board)?.targets.find(t => keyOfSite(t) === key),
    observing: () => shell.observing(),
    shown: () => {
      const b = shell.current.value
      return b ? { board: b.name, target: b.variant?.name ?? null } : null
    },
    hold: h => (live.hold = h ?? null),
    notice: rep => (live.notice = { repeated: rep, url: null, file: null, n: (live.notice?.n ?? 0) + 1 }),
    incident: m => live.notice && Object.assign(live.notice, { url: m.url, file: m.file }),
  }
}

function boardLive(board: BoardStore): Live {
  const mine = (b: string, target: string | null | undefined) => b === board.name && (target ?? null) === (board.ref?.target ?? board.target)
  return {
    take: m => (mine(m.board, m.target) ? board.take(m) : {}),
    invalidate: m => mine(m.board, m.target) && board.invalidate(m),
    status: st => st.phase === 'idle' && board.settle(),
    held: () => board.held,
    site: (_, key) => board.targets.find(t => keyOfSite(t) === key),
    observing: () => ({
      board: board.name,
      target: board.target,
      ...(board.ref?.session?.scope ? { scope: board.ref.session.scope } : {}),
      facets: Object.keys(board.facets) as Observe['facets'],
    }),
    shown: () => ({ board: board.name, target: board.target }),
    hold: () => {},
    notice: rep => console.warn(`pcbjs: ${board.name} ${rep ? 'cannot stay in sync' : 'resynced after falling out of sync'}`),
    incident: () => {},
  }
}

function live(t: Transport, l: Live, own = false) {
  const seq = seqTracker()
  const timeline: { t: number; event: string; seq?: number; run?: number; facet?: string; board?: string; hash?: string }[] = []
  const times: number[] = []
  let last = 0
  // every frame the session sends this page is numbered, answers included
  t.frames(f => {
    if (f.event) {
      const at = Date.now()
      const d = f.data
      timeline.push({ t: at, event: f.event, seq: f.seq, run: d?.run ?? undefined, facet: d?.facet, board: d?.board, hash: d?.hash })
      while (timeline.length && timeline[0].t < at - TIMELINE_MS) timeline.shift()
    }
    const gap = seq.see(f.seq)
    if (gap) resync({ condition: 'seq', ...gap })
  })
  t.on('pcbjs:facet', m => {
    if (l.take(m).bad) resync({ condition: 'hash', board: m.board, target: m.target ?? null, run: m.run, facet: m.facet })
  })
  t.on('pcbjs:invalidate', m => {
    l.invalidate(m)
    const k = boardKey(m.board, m.target)
    const d = unknownIn(l.held().get(k), l.site(m.board, k), m)
    if (d) resync(d)
  })
  t.on('pcbjs:status', st => l.status(st))
  t.on('session/state', st => {
    l.hold(st.hold)
    const d = compareState(l.held(), st, l.observing())
    if (d) resync(d)
  })
  const hashes = (board: string | null, target: string | null) =>
    Object.fromEntries(Object.entries((board ? l.held().get(boardKey(board, target)) : undefined)?.facets ?? {}).map(([f, x]) => [f, hashOf(x!)]))

  /** Ask again for everything held of the board, and leave the incident with the session; three in a minute say so. */
  function resync(d: Desync) {
    const now = Date.now()
    if (now - last < RESYNC_MS) return
    last = now
    times.push(now)
    const cur = l.shown()
    const board = d.board ?? cur?.board ?? null
    const target = d.board ? (d.target ?? null) : (cur?.target ?? null)
    l.notice(repeated(times, now))
    void t.request('session/resync', { ...d, board, target, held: hashes(board, target), timeline: [...timeline] }).then(l.incident, () => undefined)
  }

  // the view shown is the demand: the session compiles what it needs and sends what this page lacks of it
  watch(
    () => JSON.stringify(l.observing()),
    () => {
      const o = l.observing()
      void t.request('session/observe', { ...o, held: hashes(o.board, o.target), ...(own ? { select: false } : {}) }).catch(() => undefined)
      own = false
    },
    { immediate: true },
  )
}

// ---- the hover and selection relay between the viewers of a board ----

function sync(shell: Shell, t: Transport) {
  const relay = createSync(
    {
      select: m => void t.request('session/select', m).catch(() => undefined),
      hover: m => t.notify('session/hover', m),
    },
    cb => requestAnimationFrame(cb),
  )
  const name = () => shell.current.value?.name ?? null
  // another board: another viewer's hover goes, and whatever this page selects there is news to the session
  watch(name, n => {
    if (n) shell.board(n).remote = null
    relay.reset()
  })
  // a board switch shows that board's own selection, which is not news to the others; one set by ?select= is
  watch(
    () => {
      const n = name()
      return n ? ([n, shell.board(n).sel] as const) : null
    },
    (now, was) => {
      if (now && (now[0] === was?.[0] || now[1].by === 'url')) relay.select(now[0], now[1], shell.pane(now[0]).mode)
    },
  )
  // sent after the frame that draws the hover, so its wire form and the send stay off the pointer's frame
  let after = 0
  watch(
    () => shell.shown.value?.hover.item,
    () => {
      cancelAnimationFrame(after)
      after = requestAnimationFrame(() =>
        setTimeout(() => {
          const b = shell.current.value
          if (b) relay.hover(b.name, toWire(b, shell.board(b.name).hover.item))
        }),
      )
    },
  )
  t.on('pcbjs:select', (m: SelectMsg) => {
    if (m?.selection && m.board === name()) {
      const selection = relay.receive(m)
      shell.selectTarget(m.board, selection.target)
      shell.board(m.board).takeSel(selection)
    }
  })
  t.on('pcbjs:sync:hover', (m: HoverMsg) => {
    const b = shell.current.value
    if (!b || m.board !== b.name) return
    const s = shell.board(b.name)
    s.remote = remoteHover(s.remote, { ...m, hover: fromWire(b, m.hover) })
  })
}

// ---- send to agent: the agents the session lists, and on a standalone page the send and its replies as toasts ----

function agents(shell: Shell, t: Transport) {
  t.on('pcbjs:agents', d => (shell.agents.list = parseAgents(d)))
  const notice = (m: Parameters<typeof sendNotice>[0]) => {
    const n = sendNotice(m)
    if (n) shell.showToast(n.text, n.err)
  }
  // message id to the agent's name, until its `delivered`
  const sent = new Map<string, string>()
  t.on('session/event', e => {
    const name = e.kind === 'delivered' ? sent.get(e.data.message) : undefined
    if (e.kind !== 'delivered' || !name) return
    sent.delete(e.data.message)
    notice({ name, ...(e.data.returned ? { returned: true } : { read: true }) })
  })
  let session: string | null = null
  t.on('pcbjs:ide:ready', r => (session = r.session))
  // the snapshot the page shows of the board, for the agent to read the same one
  const shown = (board: string, target: string | null) => {
    const run = heldRun(shell.boards.get(board)?.held.get(boardKey(board, target)) ?? { key: '', facets: {} })
    return session && run !== null ? { snapshot: snapshotId(session, run) } : {}
  }
  let following: Promise<unknown> | null = null
  shell.agents.send = (to, req, comment) => {
    following ??= t.request('session/events', { follow: true, kind: ['delivered'] }).catch(() => (following = null))
    void following
      .then(() => t.request('session/send', { to, comment, ...req, ...shown(req.board, req.target), ranges: [] }))
      .then(
        r => {
          sent.set(r.id, r.to.name)
          notice({ name: r.to.name })
        },
        (e: Error) => notice({ error: e.message }),
      )
  }
}

// ---- a frame: what it posts to the page around it, see ide.ts ----

/** Post ready once the first view has painted the board, a view each time a switch has painted, and every hover and click selection. */
function frame(shell: Shell, signal: AbortSignal) {
  const post = (m: PagePost) => window.parent.postMessage(m, '*')
  watch(() => shell.shown.value ? shell.pane(shell.shown.value.name).devtools : false, enabled => post({ type: 'pcbjs:devtools', enabled }))
  // an editor's pane: the selection goes to the page around, which hands it to the extension's tree
  if (shell.ide.on)
    watch(
      () => (shell.current.value ? shell.board(shell.current.value.name).selection() : null),
      () => post(selectMessage(shell)),
    )
  if (!shell.embed.on) return
  // each facet the dev server streams, so the page around can follow the rebuild
  watch(
    () => shell.live.last,
    f => f && post({ type: 'pcbjs:facet', ...f }),
  )
  let started = false
  watch(
    () => shell.current.value,
    b => {
      if (!b || started) return
      started = true
      // after the view query has applied, so the view it opens is the one ready waits for
      void nextTick(() => gate(shell, b.name, embedViews(!!b.schematic.drawing), post, signal))
    },
    { immediate: true },
  )
}

function gate(shell: Shell, board: string, views: ReturnType<typeof embedViews>, post: (m: PagePost) => void, signal: AbortSignal) {
  const v = shell.pane(board)
  const g = embedGate(board, views, () => ({ side: v.side, mirror: v.mirror }))
  let following = false
  const send = (m: PagePost | null) => {
    if (!m) return
    post(m)
    if (!following) follow(shell, post)
    following = true
  }
  // in dev the board comes facet by facet: ready waits for the compile streaming it to end
  const busy = () => shell.live.status?.phase === 'compiling' || shell.live.status?.phase === 'routing'
  const again = () => {
    const p = lastPainted()
    if (p && !busy()) send(g.painted(p))
  }
  signal.addEventListener(
    'abort',
    onPainted(view => !busy() && send(g.painted(view))),
  )
  watch(busy, again)
  watch(
    () => v.mode,
    mode => {
      g.shown(mode)
      again()
    },
    { immediate: true },
  )
}

function follow(shell: Shell, post: (m: PagePost) => void) {
  const { embed } = shell
  const relay = createSync({ hover: m => post(embedHover(m.hover)) }, cb => requestAnimationFrame(cb))
  watch(
    () => shell.shown.value?.hover.item ?? null,
    h => {
      const b = shell.current.value
      if (b) relay.hover(b.name, toWire(b, h))
    },
  )
  watch(
    () => (shell.current.value ? shell.board(shell.current.value.name).selection() : null),
    text => {
      const asked = embed.asked.ref === text
      embed.asked.ref = undefined
      if (!asked) post(selectMessage(shell))
    },
  )
}

/** The selection as a frame posts it: the members in joining order and the anchor. */
export function selectMessage(shell: Shell): PagePost {
  const b = shell.current.value
  const s = b ? shell.board(b.name).sel : null
  return { type: 'pcbjs:select', refs: [...(s?.refs ?? [])], anchor: s?.anchor ?? null }
}
