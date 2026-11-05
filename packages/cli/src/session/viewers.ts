// The viewer methods of a session, docs/viewer.md: what each viewer page observes, its resyncs and their incidents, the selection held
// per board, hover between the viewers of a board, the editor's assist, and the tools' edit transactions and history. A viewer is a
// session client like any other; every event to it goes to the viewers of its project and board.
import { sourcePath } from '../project/files.js'
import { isAbsolute, join } from 'node:path'
import type { Board } from '@pcbjs/core/model'
import type { EditorSelection } from '@pcbjs/lsp'
import type { Selection, SetBy } from '@pcbjs/core/internal/selection'
import { cursorOf, parseSnapshot, type AssistContext, type By, type Events, type HoverMsg, type Observe, type Params, type Result, type Run } from '@pcbjs/core/protocol'
import { refsSelection, validateSelection } from './selection.js'
import { FACET_NAMES } from '@pcbjs/core/site-facets'
import { liveSlots } from '../project/boards.js'
import type { ViewMethod } from './plugin.js'
import { loadLsp } from './lsp.js'
import type { Client, Handler, Handlers } from './clients.js'
import { editTxns } from './edit.js'
import { facetFrame } from './facet-store.js'
import { editHistory } from './history.js'
import type { Hub, ToolHooks } from './hub.js'
import { CONDITIONS, issueUrl, ownVersion, writeIncident, type Condition } from './incident.js'
import type { ProjectRuntime } from './runtime.js'
import { boardOnly, editorContext, isView, netDecl, pcbRange, selectionRanges, selectionStore, type MemberRange, type View as SelView } from './selection.js'

type EditMethod = 'session/edit/lock' | 'session/edit/begin' | 'session/edit/update' | 'session/edit/commit' | 'session/edit/cancel' | 'session/edit/undo' | 'session/edit/redo'

/** A viewer's `observe` checked: a board, its target, the scope it shows and known facet names. */
export function observeOf(d: any): Observe | null {
  if (!d || typeof d !== 'object' || !Array.isArray(d.facets)) return null
  return {
    board: typeof d.board === 'string' ? d.board : null,
    target: typeof d.target === 'string' ? d.target : null,
    ...(typeof d.scope === 'string' ? { scope: d.scope } : {}),
    facets: FACET_NAMES.filter(f => d.facets.includes(f)),
  }
}

/** A viewer's own timeline, its known fields only, so nothing else it sent reaches the incident. */
const timelineOf = (v: unknown, n: number) =>
  (Array.isArray(v) ? v.slice(-n) : []).map((e: any) =>
    Object.fromEntries(
      ['t', 'event', 'seq', 'run', 'facet', 'board', 'hash'].flatMap(k => (typeof e?.[k] === 'number' || (typeof e?.[k] === 'string' && e[k].length < 200) ? [[k, e[k]]] : [])),
    ),
  )
const hashes = (v: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([k, h]) => typeof k === 'string' && typeof h === 'string' && k.length < 200 && h.length < 64))
const isViewer = (c: Client) => c.hello?.role === 'viewer'

/** The viewer tools of a session: the viewer, selection and edit methods, and the hooks the language servers and the connections call. */
export function viewerTools(h: Hub): ToolHooks & { views: Pick<Handlers, ViewMethod>; clients(): unknown[]; atOf(r: MemberRange): Promise<MemberRange> } {
  const { shared } = h

  // --- the project of a board

  /** Explicit project ownership wins over board-name lookup. */
  const runtimeOfBoard = (name: string, prefer?: ProjectRuntime | null): ProjectRuntime | null => {
    const has = (rt: ProjectRuntime) => liveSlots(rt.state.slots).some(sl => sl.compiled!.some(c => c.board.name === name))
    if (prefer) return prefer
    return h.runtimes().find(has) ?? prefer ?? null
  }
  const runtimeOfClient = h.runtimeOfClient

  /** The board model of a board shown now, its first target. */
  const boardModel = (rt: ProjectRuntime | null, name: string, target: string | null = null): Board | null =>
    rt
      ? (liveSlots(rt.state.slots)
          .flatMap(sl => sl.compiled ?? [])
          .find(c => c.board.name === name && (target ? c.board.variant?.name === target : !c.board.variant || c.board.variant.index === 0))?.board ?? null)
      : null
  /** The board model as the views show it: a board compiled only for the views shown, or not yet, compiles in full first, so an edit or a jump never reads an older one. A view drawn from those facets still holds the run before them, which is returned, null when nothing compiled. */
  const freshModel = async (rt: ProjectRuntime | null, name: string, target: string | null = null): Promise<Run | null> => {
    if (!rt) return null
    if (boardModel(rt, name, target) && !rt.stale()) return null
    const drew = rt.current()?.run ?? null
    await rt.compiledOnce()
    return drew
  }
  /** The text of a file as the session has it, the editor's when one holds it. */
  const textOf = (file: string): string | null => h.sources.read(file)?.text ?? null
  /** A placement element's range narrowed to its `at` value, where the editor cursor lands; any other range as it is. */
  const atOf = async (root: string, r: MemberRange): Promise<MemberRange> => {
    if (!r.place) return r
    const file = isAbsolute(r.file) ? r.file : join(root, r.file)
    const text = textOf(file)
    if (!text) return r
    const lsp = await loadLsp()
    const doc = lsp.docOf(file, text)
    const el = lsp.elementAt(doc.sf(), doc.span(r).start)
    const span = el?.at ? (el.at.value ?? { start: el.at.start + 'at='.length, end: el.at.end }) : null
    return span ? { file, ...doc.siteOf(span) } : r
  }
  /** Where a net is declared, in the module that exports it or the board's entry. */
  const decl = (rt: ProjectRuntime, model: Board) => (net: string) =>
    netDecl(model, net, textOf, liveSlots(rt.state.slots).find(sl => sl.compiled?.some(c => c.board.name === model.name))?.entry.file ?? null, rt.root)

  // --- the selection, per project and board

  type Layout = import('../project/project.js').Library & { run: Run | null }
  const layouts = new Map<string, Promise<Layout>>()
  const libraryBoards = new Map<string, Board>()
  const libraryKey = (rt: ProjectRuntime, board: string, target: string | null, ref: string) => JSON.stringify([rt.root, rt.current()?.run, board, target, ref])
  const loadLayout = async (rt: ProjectRuntime, board: string, target: string | null, ref: string): Promise<Layout> => {
    await rt.compiledOnce()
    const model = boardModel(rt, board, target)
    if (!model || !model.schematic?.circuits.some(c => c.path.join('/') === ref)) throw new Error(`no layout ${ref} on ${board}`)
    const slot = liveSlots(rt.state.slots).find(sl => sl.compiled?.some(b => b.board === model))!
    const key = libraryKey(rt, board, target, ref)
    const run = rt.current()?.run ?? null
    let pending = layouts.get(key)
    if (!pending) {
      for (const k of layouts.keys()) {
        const [root, run] = JSON.parse(k)
        if (root === rt.root && run !== rt.current()?.run) layouts.delete(k)
      }
      pending = rt
        .compiler()
        .layout(slot.entry, board, target, ref)
        .then(v => {
          if (key === libraryKey(rt, board, target, ref)) {
            for (const k of libraryBoards.keys()) {
              const [root, run] = JSON.parse(k)
              if (root === rt.root && run !== rt.current()?.run) libraryBoards.delete(k)
            }
            libraryBoards.set(key, v.board)
            if (libraryBoards.size > 16) libraryBoards.delete(libraryBoards.keys().next().value!)
          }
          return { ...v, run }
        })
      layouts.set(key, pending)
      if (layouts.size > 16) layouts.delete(layouts.keys().next().value!)
      pending.catch(() => {
        if (layouts.get(key) === pending) layouts.delete(key)
      })
    }
    const loaded = await pending
    return loaded.run === (rt.current()?.run ?? null) ? loaded : loadLayout(rt, board, target, ref)
  }
  const stores = new Map<string, ReturnType<typeof selectionStore>>()
  const selectionsOf = (rt: ProjectRuntime) => {
    let st = stores.get(rt.root)
    if (!st)
      stores.set(
        rt.root,
        (st = selectionStore(s => {
          const b = boardModel(rt, s.board, s.target)
          return b?.drc && b.erc ? [...b.drc, ...b.erc] : undefined
        })),
      )
    return st
  }
  /** Publish canonical state to viewers, findings panels and source editors. */
  const selected = (rt: ProjectRuntime, sel: Selection, by: By | null, was?: Selection | null, view?: SelView | null) => {
    for (const c of h.viewersOf(rt.root)) if ((c.observe?.board ?? sel.board) === sel.board) c.event('pcbjs:select', { board: sel.board, selection: sel })
    shared.feed?.selection(rt.root, { board: sel.board, refs: sel.refs, anchor: sel.anchor, level: sel.level, isolate: sel.isolate?.ref ?? null }, by)
    if (by && shared.clients?.get(by.client)?.mode === 'ro') return
    const model = boardModel(rt, sel.board, sel.target)
    const finding = sel.finding ? [...(model?.drc ?? []), ...(model?.erc ?? [])].find(f => f.id === sel.finding) : null
    shared.clients?.relay('pcbjs:ide:finding', {
      project: rt.root,
      board: sel.board,
      target: sel.target,
      snapshot: sel.snapshot,
      finding: finding?.id ? { ...finding, id: finding.id, refs: finding.refs ?? [] } : null,
      refs: sel.refs,
      anchor: sel.anchor,
    })
    if (finding && (!sel.anchor || sel.anchor === finding.id)) return
    if (sel.by === 'editor' || !h.lsp()) return
    void toEditors(rt, sel, was, view).catch(() => undefined)
  }
  /** Wait for current geometry before resolving source; discard superseded selections. */
  const toEditors = async (rt: ProjectRuntime, sel: Selection, was?: Selection | null, view?: SelView | null) => {
    await freshModel(rt, sel.board, sel.target)
    if (selectionsOf(rt).get(sel.board)?.seq !== sel.seq) return
    const model = sel.isolate?.mode === 'library' ? (await loadLayout(rt, sel.board, sel.target, sel.isolate.ref)).board : boardModel(rt, sel.board, sel.target)
    if (selectionsOf(rt).get(sel.board)?.seq !== sel.seq) return
    const found = model
      ? selectionRanges(model, sel.finding ? { ...sel, refs: sel.refs.filter(ref => ref !== sel.finding) } : sel, {
          view,
          decl: decl(rt, model),
          text: file => textOf(isAbsolute(file) ? file : join(rt.root, file)),
        })
      : []
    const lsp = h.lsp()
    if (!found.length || !lsp) return
    const reveal = sel.anchor !== was?.anchor || sel.target !== was?.target
    const ranges = found.map(r => ({ ...r, file: isAbsolute(r.file) ? r.file : join(rt.root, r.file) }))
    for (const k of lsp.keys()) lsp.select(k, ranges, reveal)
  }
  /** Empty editor focus clears only a selection owned by the editor. */
  const editorSelect = (rt: ProjectRuntime, b: EditorSelection, by: By | null) => {
    const st = selectionsOf(rt)
    const was = st.get(b.board)
    const model = boardModel(rt, b.board, was?.target)
    if (!b.refs.length && !b.marks && !b.library && was?.by !== 'editor') return
    const change = model ? editorContext(model, b, was, rt.root) : { refs: b.refs, anchor: b.anchor, marks: b.marks, level: null }
    const sel = st.set(b.board, change, 'editor', by)
    if (sel) selected(rt, sel, by, was)
  }
  /** A board reference alone opens the board's entry in every editor with the cursor on its `<PCB`, focus given with `focus`; the selection stays. */
  const openEntry = (rt: ProjectRuntime, board: string, focus: boolean): boolean => {
    const file = liveSlots(rt.state.slots).find(sl => sl.compiled?.some(c => c.board.name === board))?.entry.file
    const text = file ? textOf(file) : null
    const at = file && text ? pcbRange(file, text) : null
    const lsp = h.lsp()
    if (!at || !lsp) return false
    for (const k of lsp.keys()) lsp.select(k, [at], true, focus)
    return true
  }
  /** A view's whole selection, offered against the seq it changed; null when it is dropped or shows nothing new. */
  const offer = (p: any, c: Client) => {
    if (typeof p?.board !== 'string' || !p.selection || !Array.isArray(p.selection.refs)) throw new Error('session/select needs { board, selection, base?, view? }')
    const rt = p.project ? h.runtimes().find(rt => rt.root === p.project) : runtimeOfClient(c)
    if (!rt) throw new Error(`no project ${p.project ?? 'for this client'} in this session`)
    const model = boardModel(rt, p.board, p.selection.target)
    if (!model) throw new Error(`no board ${p.board} or target ${p.selection.target ?? 'default'} in project ${rt.root}`)
    const by = c.by()
    const commit = selectionsOf(rt).begin(c, p, by)
    if (!commit) return null
    const accept = (focused = model) => {
      const selection = validateSelection(boardModel(rt, p.board, p.selection.target) ?? model, p.selection, focused)
      const snapshot = parseSnapshot(selection.snapshot)
      if (snapshot && shared.session?.id && snapshot.session !== shared.session.id) throw new Error('selection belongs to another session; resync the view')
      const sel = commit(selection)
      if (sel) selected(rt, sel, by, undefined, isView(p.view) ? p.view : null)
      return sel
    }
    if (p.selection.isolate?.mode !== 'library') return accept()
    return loadLayout(rt, p.board, p.selection.target, p.selection.isolate.ref).then(({ board, run }) => (run !== (rt.current()?.run ?? null) ? null : accept(board)))
  }
  /** `session/select`: a selection named by references, or with `board:<name>` alone a jump to the board's entry. */
  const select = async (p: any, by: By | null, setBy: SetBy, prefer: ProjectRuntime | null) => {
    if (typeof p?.board !== 'string' || !Array.isArray(p.refs) || !p.refs.every((r: unknown) => typeof r === 'string'))
      throw new Error('session/select needs { board, refs: string[], anchor?, level?, focus? }')
    for (const field of ['target', 'finding', 'anchor', 'level'])
      if (p[field] !== undefined && p[field] !== null && typeof p[field] !== 'string') throw new Error(`session/select ${field} must be a string or null`)
    // the first compile may still run: the board is waited for
    if (p.project !== undefined) {
      prefer = h.runtimes().find(rt => rt.root === p.project) ?? null
      if (!prefer) throw new Error(`no project ${p.project} in this session`)
      if (!boardModel(prefer, p.board)) await prefer.compiledOnce()
      if (!boardModel(prefer, p.board)) throw new Error(`no board ${p.board} in project ${p.project}`)
    }
    let rt = runtimeOfBoard(p.board, prefer)
    if (rt && !boardModel(rt, p.board)) await rt.compiledOnce()
    rt = runtimeOfBoard(p.board, prefer)
    const model = rt ? boardModel(rt, p.board, p.target !== undefined ? p.target : selectionsOf(rt).get(p.board)?.target) : null
    if (!rt || !model) throw new Error(`no board ${p.board} in this session`)
    if (p.refs.length === 1 && boardOnly(p.refs[0]) === p.board) {
      openEntry(rt, p.board, p.focus === true)
      return selectionsOf(rt).get(p.board)
    }
    const st = selectionsOf(rt)
    const was = st.get(p.board)
    const iso = was?.isolate
    const focused = was && iso?.mode === 'library' && (p.target === undefined || p.target === was.target) ? (await loadLayout(rt, p.board, was.target, iso.ref)).board : model
    if (st.get(p.board) !== was) return st.get(p.board)
    const latest = boardModel(rt, p.board, p.target !== undefined ? p.target : was?.target) ?? model
    const sel = st.set(p.board, refsSelection(latest, was, p, focused), setBy, by)
    if (sel) selected(rt, sel, by, was)
    return sel ?? st.get(p.board)
  }

  // --- the editor's assist, per project and board

  const assists = new Map<string, Map<string, AssistContext>>()
  const endFocused = new Map<string, Map<string, { file: string; handle: string }>>()
  const toBoard = <E extends 'pcbjs:assist' | 'pcbjs:assist:focus' | 'pcbjs:grid'>(project: string, board: string, event: E, data: Events[E]) => {
    h.sendTo(project, event, data, board)
  }
  const assist: ToolHooks['assist'] = (file, contexts) => {
    const valid = contexts.filter(c => c.file === file && h.runtimes().some(rt => rt.root === c.project && rt.reaches(h.realOf(file))))
    for (const [project, boards] of assists) {
      for (const [board, was] of boards)
        if (was.file === file && !valid.some(c => c.project === project && c.board === board)) {
          boards.delete(board)
          toBoard(project, board, 'pcbjs:assist', { board, assist: null })
        }
      if (!boards.size) assists.delete(project)
    }
    for (const { project, ...c } of valid) {
      let boards = assists.get(project)
      if (!boards) assists.set(project, (boards = new Map()))
      if (JSON.stringify(boards.get(c.board)) === JSON.stringify(c)) continue
      boards.set(c.board, c)
      toBoard(project, c.board, 'pcbjs:assist', { board: c.board, assist: c })
    }
  }
  const endFocus: ToolHooks['endFocus'] = (file, focus) => {
    const valid = (focus ?? []).filter(f => h.runtimes().some(rt => rt.root === f.project && rt.reaches(h.realOf(file))))
    for (const [project, boards] of endFocused) {
      for (const [board, was] of boards)
        if (was.file === file && !valid.some(f => f.project === project && f.board === board)) {
          boards.delete(board)
          toBoard(project, board, 'pcbjs:assist:focus', { board, handle: null })
        }
      if (!boards.size) endFocused.delete(project)
    }
    for (const f of valid) {
      let boards = endFocused.get(f.project)
      if (!boards) endFocused.set(f.project, (boards = new Map()))
      boards.set(f.board, { file, handle: f.handle })
      toBoard(f.project, f.board, 'pcbjs:assist:focus', { board: f.board, handle: f.handle })
    }
  }

  // --- the tools: an edit transaction per project, one history for every client

  const history = editHistory({
    get root() {
      return h.recent()?.root ?? h.ws.folders[0]
    },
    sources: h.sources,
  })
  const txns = new Map<string, ReturnType<typeof editTxns>>()
  /** The project's transactions; their ids reach a client as `<scope>:<id>`, so each comes back to the project that began it. */
  const txnsOf = (rt: ProjectRuntime) => {
    let t = txns.get(rt.scope.slug)
    if (!t)
      txns.set(
        rt.scope.slug,
        (t = editTxns({
          assist: b => assists.get(rt.root)?.get(b) ?? null,
          root: rt.root,
          board: (name, isolate) => {
            const sel = selectionsOf(rt).get(name)
            return isolate && sel?.isolate?.mode === 'library' && sel.isolate.ref === isolate
              ? (libraryBoards.get(libraryKey(rt, name, sel.target, isolate)) ?? null)
              : boardModel(rt, name)
          },
          entry: name => liveSlots(rt.state.slots).find(sl => sl.compiled!.some(c => c.board.name === name))?.entry.file ?? null,
          run: () => rt.current()?.run ?? null,
          read: h.sources.read,
          lsp: loadLsp,
          write: (files, by) => history.write(files, by),
        })),
      )
    return t
  }
  const outer = (rt: ProjectRuntime, id: string) => `${rt.scope.slug}:${id}`
  const inner = (txn: unknown): { t: ReturnType<typeof editTxns>; id: string } => {
    const at = typeof txn === 'string' ? txn.lastIndexOf(':') : -1
    const t = at > 0 ? txns.get((txn as string).slice(0, at)) : undefined
    if (!t) throw new Error(`no edit ${String(txn)} in this session; it was committed, cancelled or never begun`)
    return { t, id: (txn as string).slice(at + 1) }
  }
  const named = <R extends { txn?: string | null }>(rt: ProjectRuntime | null, r: R): R => (rt && r?.txn ? { ...r, txn: outer(rt, r.txn) } : r)
  const ofTxn = (txn: unknown) => {
    const { t, id } = inner(txn)
    const slug = (txn as string).slice(0, (txn as string).lastIndexOf(':'))
    return { t, id, rt: h.runtimes().find(r => r.scope.slug === slug) ?? null }
  }
  const ownTxn = (txn: unknown, rt: ProjectRuntime | null) => {
    const got = ofTxn(txn)
    if (!rt || got.rt !== rt) throw new Error('the edit belongs to another project; start it again in its own view')
    return got
  }
  const edit = (prefer: () => ProjectRuntime | null): { [M in EditMethod]: (p: Params<M>, by: By | null) => Result<M> | Promise<Result<M>> } => ({
    'session/edit/lock': async p => {
      const rt = runtimeOfBoard(String(p?.board), prefer())
      if (!rt) throw new Error(`no board ${String(p?.board)} in this session`)
      await rt.idle()
      const model = rt.lockModel(p.board, p.view === 'sch' ? 'sch' : 'pcb')
      if (!model) return { locked: false, reason: 'Waiting for the current placement model.' }
      const sel = selectionsOf(rt).get(p.board)
      if (p.isolate && sel?.isolate?.mode === 'library' && sel.isolate.ref === p.isolate) {
        const slot = liveSlots(rt.state.slots).find(s => s.compiled?.some(c => c.board.name === p.board))
        if (!slot) return { locked: false, reason: 'Waiting for the current library layout.' }
        const layout = await rt.compiler().layout(slot.entry, p.board, sel.target, p.isolate)
        if (rt.lockModel(p.board, p.view === 'sch' ? 'sch' : 'pcb') !== model) return { locked: false, reason: 'Waiting for the current library layout.' }
        return txnsOf(rt).lockState(p, layout.board)
      }
      return txnsOf(rt).lockState(p, model)
    },
    // a view drawn from a compile of its views alone is as current as the whole compile that completes it
    'session/edit/begin': async (p, by) => {
      const rt = runtimeOfBoard(String(p?.board), prefer())
      if (!rt) throw new Error(`no board ${String(p?.board)} in this session`)
      const drew = await freshModel(rt, String(p?.board))
      const sel = selectionsOf(rt).get(String(p?.board))
      if (p.isolate && sel?.isolate?.mode === 'library' && sel.isolate.ref === p.isolate) await loadLayout(rt, p.board, sel.target, p.isolate)
      return named(rt, txnsOf(rt).begin(drew && p?.run === drew ? { ...p, run: undefined } : p, by))
    },
    'session/edit/update': p => {
      const { t, id, rt } = ownTxn(p?.txn, prefer())
      return t.update({ ...p, txn: id }).then(r => named(rt, r))
    },
    'session/edit/commit': (p, by) => {
      const { t, id, rt } = ownTxn(p?.txn, prefer())
      return t.commit({ ...p, txn: id }).then(got => {
        const r = named(rt, got)
        if (r.written.length && r.txn) history.name(by, r.txn)
        // an assist pick moves the editor cursor past what it wrote
        const at = r.cursor
        const lsp = h.lsp()
        if (at && lsp) for (const k of lsp.keys()) lsp.select(k, [{ file: at.file, line: at.line, col: at.col, endLine: at.line, endCol: at.col - 1 }], true)
        return r
      })
    },
    'session/edit/cancel': p => {
      const { t, id } = ownTxn(p?.txn, prefer())
      return t.cancel({ ...p, txn: id })
    },
    'session/edit/undo': (p, by) => history.undo(by, typeof p?.txn === 'string' ? p.txn : undefined),
    'session/edit/redo': (p, by) => history.redo(by, typeof p?.txn === 'string' ? p.txn : undefined),
  })
  const byClient =
    <M extends EditMethod>(m: M): Handler<M> =>
    (p, c) => {
      const rt = runtimeOfClient(c)
      if (!rt) throw new Error('the project is no longer available; reload its view')
      if (m !== 'session/edit/cancel' && m !== 'session/edit/lock') {
        const requested = m === 'session/edit/begin' ? (p as Params<'session/edit/begin'>) : null
        const board = requested?.board ?? c.observe?.board
        if (requested && c.observe?.board && requested.board !== c.observe.board)
          throw new Error('the requested board differs from the observed board; switch views before editing')
        const model = boardModel(rt, String(board))
        const first = model?.variant?.name ?? null
        const target = (name: string | null | undefined) => name ?? first
        if (requested?.target !== undefined && c.observe && target(requested.target) !== target(c.observe.target))
          throw new Error('the requested target differs from the observed target; switch targets before editing')
        for (const name of [requested?.target, c.observe?.target]) {
          if (name == null || name === first) continue
          const known = liveSlots(rt.state.slots).some(sl => sl.compiled?.some(c => c.board.name === board && c.board.variant?.name === name))
          if (!known) throw new Error(`unknown target ${name} for board ${String(board)}`)
          throw new Error('This target is read-only. Source editing and assist use the first target; switch to it to edit.')
        }
      }
      return edit(() => rt)[m](p, c.by())
    }

  // --- the editor attached, agents, hover

  const editorAttached = () =>
    !!h
      .lsp()
      ?.servers()
      .some(x => x.server.holder.role === 'editor' && x.server.initialized)
  // an editor attaching or leaving changes where the tools write, so every viewer's banner follows
  let hadEditor = false
  const editorsChanged = () => {
    if (editorAttached() === hadEditor) return
    hadEditor = !hadEditor
    for (const c of h.viewers()) c.event('pcbjs:editor', { attached: hadEditor })
  }
  const clientList = () =>
    (shared.clients?.list() ?? []).map(c => ({
      ...c.by(),
      kind: c.transport.kind,
      mode: c.mode,
      version: c.hello?.version ?? null,
      since: new Date(c.at).toISOString(),
      ...(c.hello?.project ? { root: c.hello.project } : {}),
      ...(c.about.plan ? { plan: c.about.plan } : {}),
      ...(c.about.progress ? { progress: c.about.progress } : {}),
    }))
  // the agents attached, told to the viewers that may send them a selection
  const agentsNow = () => ({
    agents: clientList()
      .filter(c => c.role === 'agent')
      .map(c => ({ client: c.client, name: c.name, since: c.since, ...(c.task ? { task: c.task } : {}), ...(c.root ? { root: c.root } : {}) })),
  })
  const agentsChanged = () => {
    const d = agentsNow()
    for (const c of h.viewers()) if (c.mode === 'rw') c.event('pcbjs:agents', d)
  }
  /** Hover relayed between the viewers of one board, each named by its client id for the others. */
  const relay = (p: Partial<HoverMsg> | null, from: Client) => {
    const board = typeof p?.board === 'string' ? p.board : null
    if (!board) return null
    const out = { board, hover: p!.hover ?? null, from: from.id }
    const root = h.projectOf(from)
    if (root) for (const c of h.viewersOf(root, board)) if (c !== from) c.event('pcbjs:sync:hover', out)
    return null
  }
  /** A viewer said hello: its status, the first compile when nothing started it, the editor and the agents; leaving, it takes its hover along. */
  const greeted = (c: Client) => {
    if (!isViewer(c)) return
    const rt = runtimeOfClient(c)
    c.event('pcbjs:status', h.status(rt?.root ?? null))
    void rt?.compiledOnce()
    c.event('pcbjs:editor', { attached: editorAttached() })
    if (c.mode === 'rw') c.event('pcbjs:agents', agentsNow())
    c.onClose(() => relay({ board: c.observe?.board ?? undefined, hover: null }, c))
  }

  /** `session/observe`: what a view shows. The first says what the page missed since its module was made, a board switch brings that board's selection and assist, and each one the facets the view lacks. */
  const observe = (p: any, c: Client) => {
    const o = observeOf(p)
    if (!o) throw new Error('session/observe needs { board, target, facets, scope?, held?, select? }')
    const first = !c.observe
    const switched = first || c.observe!.board !== o.board || c.observe!.scope !== o.scope || c.observe!.target !== o.target
    c.observe = o
    const rt = runtimeOfClient(c)
    if (first) {
      // the page's virtual module may predate the last compile or the isolated preview, and the editor may have moved before it opened
      if (rt?.state.slots.some(sl => sl.compiled || sl.error)) c.event('pcbjs:boards', h.payload(rt))
      const e = h.focusFor(c)
      if (e) c.event('pcbjs:focus', e)
      h.beatTo(c)
    }
    if (switched && o.board) {
      const sel = rt && p?.select !== false ? selectionsOf(rt).get(o.board) : null
      if (sel) c.event('pcbjs:select', { board: o.board, selection: sel })
      const a = rt ? assists.get(rt.root)?.get(o.board) : null
      if (a || !first) c.event('pcbjs:assist', { board: o.board, assist: a ?? null })
      const f = rt ? endFocused.get(rt.root)?.get(o.board) : null
      if (f || !first) c.event('pcbjs:assist:focus', { board: o.board, handle: f?.handle ?? null })
      if (!first) c.event('pcbjs:grid', { board: o.board, grid: null })
    }
    if (rt && o.board) for (const f of rt.facets.lacking(o.board, o.target, o, hashes(p?.held), false)) c.post(facetFrame(f))
    h.demand()
    return null
  }
  /** The incident of a view out of sync: versions, ids, hashes and numbers, interest, stages, events and the last minute of frames, no file contents. */
  const incidentOf = (d: any, c: Client, rt: ProjectRuntime | null) => {
    const condition: Condition = d?.condition in CONDITIONS ? d.condition : 'unknown'
    const snap = rt?.current() ?? null
    const sid = shared.session.id
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    return {
      condition,
      description: CONDITIONS[condition],
      versions: { cli: ownVersion(), node: process.version },
      session: sid,
      project: rt?.root ?? null,
      board: typeof d?.board === 'string' ? d.board : null,
      target: typeof d?.target === 'string' ? d.target : null,
      run: { session: snap?.run ?? null, view: typeof d?.run === 'number' ? d.run : null },
      seq: { sent: c.seq, expected: num(d?.expected), got: num(d?.got) },
      hashes: { session: snap?.facets ?? {}, view: hashes(d?.held) },
      interest: c.observe,
      stages: h.status(rt?.root ?? null).stages ?? [],
      events: h.events()?.since(cursorOf(sid, 0)).events.slice(-200) ?? [],
      timeline: { session: c.sent, view: timelineOf(d?.timeline, 500) },
    }
  }
  /** `session/resync`: a view out of sync gets everything it holds of its board again, and the incident goes on disk. */
  const resync = (p: any, c: Client) => {
    const rt = runtimeOfClient(c)
    const board = typeof p?.board === 'string' ? p.board : c.observe?.board
    if (rt && board) for (const f of rt.facets.lacking(board, typeof p?.target === 'string' ? p.target : null, c.observe, {}, true)) c.post(facetFrame(f))
    h.beatTo(c)
    const root = rt?.root ?? h.ws.folders[0]
    const body = incidentOf(p, c, rt)
    const file = writeIncident(root, 'desync', body)
    const rel = sourcePath(root, file)
    h.muted(`a view fell out of sync, ${body.description}; it resynced, the incident is ${rel}`)
    return { file: rel, url: issueUrl(JSON.stringify(body, null, 2), rel) }
  }

  return {
    assist,
    // the completion item in focus lights in every view of its board as a hover does, never selecting or writing
    endFocus,
    // a hovered grid position lights its grid in every view of the board
    grid: (project, board, grid) => {
      if (h.runtimes().some(rt => rt.root === project)) toBoard(project, board, 'pcbjs:grid', { board, grid })
    },
    close: file => {
      assist(file, [])
      endFocus(file, null)
    },
    drop: root => {
      for (const board of assists.get(root)?.keys() ?? []) toBoard(root, board, 'pcbjs:assist', { board, assist: null })
      for (const board of endFocused.get(root)?.keys() ?? []) toBoard(root, board, 'pcbjs:assist:focus', { board, handle: null })
      assists.delete(root)
      endFocused.delete(root)
      stores.get(root)?.cancel()
      stores.delete(root)
      const rt = h.runtimes().find(r => r.root === root)
      if (rt) {
        for (const slot of liveSlots(rt.state.slots)) for (const c of slot.compiled!) toBoard(root, c.board.name, 'pcbjs:grid', { board: c.board.name, grid: null })
        txns.delete(rt.scope.slug)
      }
    },
    select: (file, boards, _key, by) => {
      const rt = h.runtimeOfFile(h.realOf(file)) ?? h.recent()
      if (rt) for (const b of boards) editorSelect(rt, b, by)
    },
    editorsChanged,
    agentsChanged,
    greeted,
    clients: clientList,
    atOf: r => atOf(h.recent()?.root ?? h.ws.folders[0], { ...r, place: true }),
    views: {
      'session/select': (p, c) => {
        if (c.mode === 'ro' && 'refs' in p && Array.isArray(p.refs) && p.refs.includes(`board:${p.board}`)) throw new Error('Opening the editor requires read-write access')
        const rt = runtimeOfClient(c)
        if (!rt) throw new Error('the project is no longer available; reload its view')
        return 'selection' in p ? offer(p, c) : select(p, c.by(), c.hello?.role === 'agent' ? 'agent' : isViewer(c) ? 'viewer' : 'sync', rt)
      },
      'session/layout': async (p, c) => {
        if (typeof p?.board !== 'string' || typeof p.ref !== 'string' || (p.target !== null && typeof p.target !== 'string'))
          throw new Error('session/layout needs board, target and ref')
        const rt = runtimeOfClient(c)
        if (!rt) throw new Error('the project is no longer available')
        return (await loadLayout(rt, p.board, p.target, p.ref)).site
      },
      'session/observe': observe,
      'session/resync': resync,
      'session/hover': (p, c) => relay(p, c),
      'session/clients': () => clientList(),
      'session/edit/lock': byClient('session/edit/lock'),
      'session/edit/begin': byClient('session/edit/begin'),
      'session/edit/update': byClient('session/edit/update'),
      'session/edit/commit': byClient('session/edit/commit'),
      'session/edit/cancel': byClient('session/edit/cancel'),
      'session/edit/undo': byClient('session/edit/undo'),
      'session/edit/redo': byClient('session/edit/redo'),
    },
  }
}
