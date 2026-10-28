<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onErrorCaptured, ref, watch } from 'vue'
import { checkSummary, clickOf, drcSummary, useStore, type Focus, type SourceKind, type Tab } from './state'
import { ercSummary, failingCount, targetName, withForeign } from './variants'
import { ercTarget, filterSchematic, knownRefs, orderNets, parsePin, pinLabel, schematicPart } from './schematic'
import {
  ancestorKeys,
  buildTree,
  enclosingRange,
  filterTree,
  findInstance,
  hasCircuits,
  instanceNets,
  instanceNodes,
  netLabel,
  partPathLinks,
  pathLabel,
  refsBox,
  type InstanceNode,
  type TreeNode,
} from './circuits'
import Menu from './Menu.vue'
import { clickPlan, rangeFor, rangeLabel, refsOfIds, repoUrl, highlightLabel, sourceTarget, type Located, type SourceTarget } from './source'
import { cssColor, stackupRows } from './stackup'
import { netLengths, netRoles, targetText } from './routes'
import { clearReady } from './ready'
import { bomRowOf, bomTsv, matchedKey, rowMpn, sourceLabel, sourcingEntries, sourcingLine, sourcingTitle, unsourcedCount, unsourcedText, type BomRow } from './sourcing'
import BoardView from './BoardView.vue'
import SchView from './SchView.vue'
import { SCH_LAYERS, layerCounts, schFindingAt, symbolFrame, type SchHit } from './schview'
import Home from './Home.vue'
import ClientOnly from './ClientOnly.vue'
import { hoverScope, inScope } from './scene/focus'
import LoadScreen from './LoadScreen.vue'
import ServerGone from './ServerGone.vue'
import { useLoad } from './load'
import { loadProgress, loadText, step } from './loading'
// the 3D view and its renderer load only when 3D is first chosen, keeping the 2D page light
const View3D = defineAsyncComponent(() => import('./View3D.vue'))

const {
  workspace,
  workspaceHome,
  scopeCards,
  asset,
  boardHref,
  boardTarget,
  homeHref,
  boardView,
  cards,
  clearSourceHighlight,
  current,
  currentError,
  currentGroup,
  go,
  ide,
  embed,
  openSource,
  openTarget,
  siteGroups,
  resolvedTheme,
  route,
  selectTarget,
  showSourceRange,
  source,
  state,
  toggleTheme,
  ui,
} = useStore()
const board = current
const error = currentError
const view = computed(() => boardView(board.value?.name ?? ''))
// the part ?select= frames in both views, until another part is selected
const frameRef = computed(() => (ui.frame && board.value && ui.frame.board === board.value.name ? ui.frame.ref : null))
watch(
  () => view.value.activeRef,
  r => {
    if (ui.frame && r !== ui.frame.ref) ui.frame = null
  },
)
const home = computed(() => route.value.page === 'home')
// a board route whose name matches nothing; with one entry and no board yet the viewer shows the compile state instead
const missing = computed(() => !ide.on && route.value.page === 'board' && !board.value && !state.loading && (!state.single || state.boards.length > 0))
const routeName = computed(() => (route.value.page === 'board' ? route.value.name : null))

// with the focus fade on and something pinned or selected, a hover outside it reaches no other view or panel
const scope = computed(() =>
  hoverScope(
    { net: view.value.pinnedNet, nets: board.value ? netRoles(board.value, view.value.pinnedNet).keys() : undefined, ref: view.value.activeRef, refs: view.value.selectedRefs },
    view.value.fade,
    board.value,
  ),
)
const hoverNet = computed(() => (ui.hoverNet && inScope({ net: ui.hoverNet }, scope.value) ? ui.hoverNet : null))
const hoverRefs = computed(() => ui.hoverRefs.filter(ref => inScope({ ref, body: true }, scope.value)))
const activeNet = computed(() => hoverNet.value ?? view.value.pinnedNet)
// another viewer's hover marks the schematic as a board hover here does
const remoteProbe = computed(() => {
  const h = ui.remote?.board === board.value?.name ? ui.remote?.hover : null
  return h ? { ref: h.refs[0] ?? null, net: h.net, id: h.ids[0] ?? null } : null
})
const part = computed(() => board.value?.footprints.find(f => f.ref === view.value.activeRef) ?? null)
// old data without ERC shows the DRC alone
const drc = computed(() => (board.value ? checkSummary(board.value) : null))
const drcText = computed(() => drc.value?.label ?? '')
// the pill opens the DRC tab, or the ERC tab when only the ERC has findings
const pillTab = computed<Tab>(() => {
  const s = drc.value
  return s && !s.drc.errors && !s.drc.warnings && !s.unconnected && s.erc && s.erc.errors + s.erc.warnings ? 'erc' : 'drc'
})
// the schematic and the ERC are absent from data built before the schematic layer
const erc = computed(() => board.value?.erc ?? null)
const pillOf = (severity: string) => (severity === 'error' ? 'err' : severity === 'info' ? 'info' : 'warn')
const sch = computed(() => board.value?.schematic ?? null)
const schPart = computed(() => schematicPart(sch.value, view.value.activeRef))
function onSwitch(e: Event) {
  go(boardHref((e.target as HTMLSelectElement).value))
}

// the view state is shared by every target of a board
const targets = computed(() => currentGroup.value?.targets ?? [])
const multi = computed(() => targets.value.length > 1)
const targetRows = computed(() => targets.value.map(t => ({ name: targetName(t) ?? t.name, board: t, drc: checkSummary(t), on: t === board.value })))
const stripRows = computed(() =>
  targetRows.value.map(t => {
    const s = view.value.tab === 'erc' ? ercSummary(t.board) : drcSummary(t.board)
    return { ...t, state: s?.state ?? null, text: s?.text ?? 'no ERC data' }
  }),
)
const failing = computed(() => failingCount(targets.value))
const othersFail = computed(() => targetRows.value.some(t => !t.on && t.drc.state === 'err'))
const failingNames = computed(() =>
  targetRows.value
    .filter(t => t.drc.state === 'err')
    .map(t => `${t.name}: ${t.drc.text}`)
    .join('\n'),
)
// target links are real links for middle-click and copy link; a plain click switches in place
function onTargetLink(e: MouseEvent, t: string) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !board.value) return
  e.preventDefault()
  selectTarget(board.value.name, t)
}
const fabTitle = computed(() => (board.value ? (board.value.variant ? `${board.value.variant.name}\n` : '') + board.value.fab.files.join('\n') : ''))

// below 900 px the rails become drawers over the board
const drawer = ref<'layers' | 'panel' | null>(null)
const narrow = () => matchMedia('(max-width: 900px)').matches
function openTab(t: Tab) {
  view.value.tab = t
  if (narrow()) drawer.value = 'panel'
}

const layerList = computed(() => [...(board.value?.layers ?? [])].reverse())
// ids of layers this target lacks stay hidden for the targets that have them
function setHidden(ids: Iterable<string>) {
  view.value.hidden = withForeign(view.value.hidden, board.value?.layers.map(l => l.id) ?? [], ids)
}
function toggle(id: string) {
  const s = new Set(view.value.hidden)
  s.has(id) ? s.delete(id) : s.add(id)
  view.value.hidden = s
}
function solo(id: string) {
  const all = board.value!.layers.map(l => l.id)
  const hiddenHere = all.filter(l => view.value.hidden.has(l)).length
  setHidden(hiddenHere === all.length - 1 && !view.value.hidden.has(id) ? [] : all.filter(l => l !== id))
}
const presets = {
  front: (l: { side: string; kind: string }) => l.side === 'back',
  back: (l: { side: string; kind: string }) => l.side === 'front',
  all: () => false,
  copper: (l: { side: string; kind: string }) => l.kind !== 'copper' && l.kind !== 'edge',
}
type Preset = keyof typeof presets
const presetNames: [Preset, string][] = [
  ['front', 'Front'],
  ['back', 'Back'],
  ['all', 'All'],
  ['copper', 'Copper only'],
]
function applyPreset(p: Preset) {
  setHidden(board.value!.layers.filter(presets[p]).map(l => l.id))
}
const activePreset = computed(() => {
  const ls = board.value?.layers ?? []
  return presetNames.find(([p]) => ls.every(l => presets[p](l) === view.value.hidden.has(l.id)))?.[0] ?? null
})

const focus = ref<Focus | null>(null)
let n = 0
function selectRef(ref: string | null, zoom = false, keepTab = false) {
  view.value.activeRef = ref
  // a part, or nothing, replaces a circuit instance's selection
  if (view.value.activeCircuit || view.value.selectedRefs.length) {
    view.value.activeCircuit = null
    view.value.selectedRefs = []
  }
  if (!ref) return
  if (!keepTab) view.value.tab = 'part'
  if (zoom && view.value.mode === 'sch' && drawing.value) {
    const b = symbolFrame(drawing.value, ref)
    if (b) schFocus.value = { at: [b[0] + b[2] / 2, b[1] + b[3] / 2], r: Math.max(b[2], b[3]) / 4, n: ++n, pulse: false }
    return
  }
  const fp = board.value?.footprints.find(f => f.ref === ref)
  if (fp && zoom) {
    view.value.mode = '2d'
    focus.value = { at: fp.at, r: 4, n: ++n, pulse: false }
  }
}
function gotoDrc(at: [number, number]) {
  view.value.mode = '2d'
  focus.value = { at, r: 2, n: ++n, pulse: true }
  if (narrow()) drawer.value = null
}
// an ERC row: the point when it has one, else the part its message or items name, staying on the ERC tab
function gotoErc(d: { at: [number, number]; message: string; items?: number[]; layer?: string }) {
  const b = board.value
  if (!b) return
  const sch = schFindingAt(d)
  if (sch) {
    gotoSch(sch)
    return
  }
  const t = ercTarget(d, knownRefs(b), d.items?.length ? refsOfIds(b, d.items) : undefined)
  if (t?.kind === 'at') gotoDrc(t.at)
  else if (t) selectRef(t.ref, true, true)
}
// a schematic finding: the sheet pans to its point and pulses there
const schFocus = ref<Focus | null>(null)
function gotoSch(at: [number, number]) {
  view.value.mode = 'sch'
  schFocus.value = { at, r: 2, n: ++n, pulse: true }
  if (narrow()) drawer.value = null
}
const drawing = computed(() => board.value?.schematic?.drawing ?? null)
const schRows = computed(() => {
  const d = drawing.value
  if (!d) return []
  const counts = layerCounts(d, (erc.value ?? []).filter(f => f.layer === 'sch').length)
  const colors = board.value?.schematic.svg?.themes?.[resolvedTheme()]
  return SCH_LAYERS.map(l => ({ ...l, n: counts[l.id] ?? 0, swatch: (l.color && colors?.[l.color]) || 'var(--drc-warn)' }))
})
function toggleSch(id: string) {
  const s = new Set(view.value.schHidden)
  s.has(id) ? s.delete(id) : s.add(id)
  view.value.schHidden = s
}
function soloSch(id: string) {
  const others = SCH_LAYERS.map(l => l.id).filter(l => l !== id)
  view.value.schHidden = others.every(l => view.value.schHidden.has(l)) && !view.value.schHidden.has(id) ? new Set() : new Set(others)
}
// what the pointer is on in the schematic: its net lights up as a hovered net does, its parts as a hovered circuit does
const schHover = ref<SchHit | null>(null)
function onSchHover(h: SchHit | null) {
  schHover.value = h
  const net = h && h.kind !== 'symbol' && h.kind !== 'sheet' ? (h.net ?? null) : null
  if (ui.hoverNet !== net) ui.hoverNet = net
}
const boardHoverRefs = computed(() => (schHover.value?.refs.length ? schHover.value.refs : hoverRefs.value))
function onSchOpen(h: SchHit, kind: SourceKind, quiet: boolean) {
  const b = board.value
  if (!b) return
  const own = h.src
    ? {
        file: h.src.file,
        start: [h.src.line, h.src.col] as [number, number],
        ...(h.src.endLine != null && h.src.endCol != null ? { end: [h.src.endLine, h.src.endCol] as [number, number] } : {}),
      }
    : null
  const part = h.ref ? sourceTarget(b, { ref: h.ref }, kind) : null
  void openTarget(b, kind === 'definition' ? (part ?? own) : (own ?? part), quiet)
}
function onSchCircuit(key: string) {
  if (instanceByKey.value.has(key)) selectCircuit(key)
}

// a circuit instance: its parts become the multi-part selection; in 2D the view frames them
function selectCircuit(key: string | null, zoom = false, keepTab = false) {
  const inst = key ? (instanceByKey.value.get(key) ?? null) : null
  view.value.activeRef = null
  view.value.activeCircuit = inst ? key : null
  view.value.selectedRefs = inst ? [...inst.refs] : []
  ui.hoverRefs = []
  if (!inst) return
  // the tree opens down to the instance, so it shows when the Schematic tab is next opened
  const up = ancestorKeys(inst.circuit.path)
    .slice(0, -1)
    .filter(k => !view.value.expanded.has(k))
  if (up.length) view.value.expanded = new Set([...view.value.expanded, ...up])
  if (!keepTab) view.value.tab = 'part'
  const b = zoom && view.value.mode === '2d' && board.value ? refsBox(board.value.footprints, inst.refs) : null
  if (b) focus.value = { at: b.at, r: Math.max(b.w, b.h, 2) * 0.4, n: ++n, pulse: false }
}
function pin(net: string | null) {
  view.value.pinnedNet = net && view.value.pinnedNet === net ? null : net
}
function pinFromBoard(net: string | null) {
  view.value.pinnedNet = net
}
function unpinNet() {
  view.value.pinnedNet = null
}

// a request the editor posted: pin a net, or pan to a finding in the view this page shows, after switching board
watch(
  () => ide.request,
  async r => {
    if (!r) return
    if (r.board && r.board !== board.value?.name) {
      go(boardHref(r.board))
      await nextTick()
    }
    if (r.kind === 'net') {
      pinFromBoard(r.net)
      return
    }
    const sch = schFindingAt({ at: r.at, layer: r.layer ?? undefined })
    if (view.value.mode === 'sch' && sch) schFocus.value = { at: sch, r: 2, n: ++n, pulse: true }
    else if (view.value.mode === '2d' && !sch) focus.value = { at: r.at, r: 2, n: ++n, pulse: true }
  },
)

// empty until the router reports routes
const lengths = computed(() => (board.value ? netLengths(board.value) : null))
const padCount = computed(() => {
  const m = new Map<string, number>()
  for (const fp of board.value?.footprints ?? []) for (const p of fp.pads) if (p.net) m.set(p.net, (m.get(p.net) ?? 0) + 1)
  return m
})
const netFilter = ref('')
// declaration order when the schematic has nets, else the board's alphabetical list
const nets = computed(() => {
  const q = netFilter.value.trim().toLowerCase()
  return orderNets(board.value?.nets, sch.value)
    .filter(n => !q || n.name.toLowerCase().includes(q) || !!n.class?.toLowerCase().includes(q))
    .map(n => ({ ...n, len: lengths.value?.get(n.name) ?? null }))
})
const schFilter = ref('')
const schView = computed(() => filterSchematic(sch.value, schFilter.value))
const hasSch = computed(() => !!(sch.value?.parts?.length || sch.value?.nets?.length))
const pinRef = (p: string) => parsePin(p)?.ref ?? p
// flat parts on data without circuits; a filter opens the branches with matches
const tree = computed<TreeNode[]>(() => buildTree(sch.value))
const instanceByKey = computed(() => new Map(instanceNodes(tree.value).map(n => [n.key, n] as [string, InstanceNode])))
const treeView = computed(() => filterTree(tree.value, schFilter.value))
// branches the viewer closed while a filter had opened them; a new filter starts over
const filterClosed = ref(new Set<string>())
watch(schFilter, () => {
  filterClosed.value = new Set()
})
function isOpen(key: string) {
  if (schFilter.value.trim() && treeView.value.open.has(key)) return !filterClosed.value.has(key)
  return view.value.expanded.has(key)
}
function toggleOpen(key: string) {
  const flip = (set: Set<string>) => {
    const s = new Set(set)
    s.has(key) ? s.delete(key) : s.add(key)
    return s
  }
  if (schFilter.value.trim() && treeView.value.open.has(key)) filterClosed.value = flip(filterClosed.value)
  else view.value.expanded = flip(view.value.expanded)
}
const treeRows = computed(() => {
  const out: { node: TreeNode; depth: number }[] = []
  const walk = (ns: TreeNode[], depth: number) => {
    for (const node of ns) {
      out.push({ node, depth })
      if (node.kind === 'instance' && isOpen(node.key)) walk(node.children, depth + 1)
    }
  }
  walk(treeView.value.nodes, 0)
  return out
})
const circuits = computed(() => hasCircuits(sch.value))
// the ref column is wide enough for the deepest indented part row; refs and local keys fit 40 px as before
const refWidth = computed(() => 48 + Math.max(0, ...treeRows.value.filter(r => r.node.kind === 'part').map(r => (r.depth ? r.depth * 14 + 18 : 0))))
function hoverCircuit(node: InstanceNode | null) {
  ui.hoverRefs = node ? node.refs : []
}
const circuit = computed(() => (view.value.activeCircuit ? (instanceByKey.value.get(view.value.activeCircuit) ?? null) : null))
const circuitParts = computed(() =>
  (circuit.value?.refs ?? []).map(r => schematicPart(sch.value, r) ?? { ref: r, value: '', local: r, placed: !!board.value?.footprints.some(f => f.ref === r) }),
)
const circuitNets = computed(() => instanceNets(sch.value, circuit.value?.circuit.path))
const circuitRange = computed(() =>
  circuit.value
    ? enclosingRange(
        board.value?.sources,
        circuit.value.refs.filter(r => board.value?.footprints.some(f => f.ref === r)),
      )
    : null,
)
const circuitPlaced = computed(() => !!circuit.value?.refs.some(r => board.value?.footprints.some(f => f.ref === r)))
// Show in source for a circuit instance: the innermost range that made all its parts, else its placed parts alone
function showCircuitSource() {
  const b = board.value,
    c = circuit.value
  if (!b || !c) return
  const r = circuitRange.value
  if (r) {
    showSourceRange(b, r.file, r.range)
    return
  }
  source.highlight = { board: b.name, file: pathLabel(c.circuit.path), line: 0, ids: [], refs: c.refs.filter(x => b.footprints.some(f => f.ref === x)), n: Date.now() }
}
const partPath = computed(() => partPathLinks(schPart.value))

// a pinned net or selected part that vanished in an update is dropped; everything else in the view survives
watch(board, b => {
  if (!b) return
  if (view.value.pinnedNet && !b.nets.includes(view.value.pinnedNet)) view.value.pinnedNet = null
  ui.hoverNet = null
  ui.hoverRefs = []
  // a selected circuit instance keeps its selection with the parts it has now, or goes when it is gone
  const key = view.value.activeCircuit
  if (key) {
    const inst = instanceByKey.value.get(key)
    if (!inst) {
      view.value.activeCircuit = null
      view.value.selectedRefs = []
    } else if (inst.refs.join() !== view.value.selectedRefs.join()) view.value.selectedRefs = [...inst.refs]
  }
})
// another board or the home page: transient things go, the board's own view state stays with it
watch(
  () => board.value?.name,
  () => {
    focus.value = null
    schFocus.value = null
    schHover.value = null
    drawer.value = null
    ui.hoverNet = null
    ui.hoverRefs = []
  },
)
// the ready signal is cleared while another view or board draws; the view that draws next sets it again, see ready.ts
watch(
  () => [view.value.mode, board.value?.name, board.value?.variant?.name, view.value.explode, view.value.separation],
  () => clearReady(),
)
watch(
  () => view.value.mode,
  m => {
    if (m !== 'sch') {
      schFocus.value = null
      onSchHover(null)
    }
  },
)

// a failure inside the 3D view stays there: it is shown in place and never stalls the rest of the viewer
const view3dError = ref<string | null>(null)
onErrorCaptured((err, inst) => {
  if (inst?.$options.__name !== 'View3D' && !inst?.$el?.closest?.('.view3d-host')) return
  console.error(err)
  view3dError.value = String((err as Error)?.message ?? err)
  return false
})
watch(
  () => [view.value.mode, board.value?.name, board.value?.variant?.name, state.updatedAt],
  () => {
    view3dError.value = null
  },
)

const sourceHl = computed(() => (board.value && source.highlight?.board === board.value.name ? source.highlight : null))
const sourceRefs = computed(() => (sourceHl.value ? new Set(sourceHl.value.refs) : null))
const sourceCount = computed(() =>
  sourceHl.value ? sourceHl.value.ids.length + sourceHl.value.refs.length + (sourceHl.value.points?.length ?? 0) + (sourceHl.value.reference ? 1 : 0) : 0,
)
// the Part tab links the footprint's placement, the outermost call, and its definition, the innermost range, when the two differ
const asRange = (t: SourceTarget) => ({ start: t.start, end: t.end ?? t.start })
const partPlace = computed(() => (board.value && part.value ? sourceTarget(board.value, { ref: part.value.ref }, 'placement') : null))
const partDef = computed<SourceTarget | null>(() => {
  const d = board.value && part.value ? sourceTarget(board.value, { ref: part.value.ref }, 'definition') : null
  const p = partPlace.value
  return d && p && (d.file !== p.file || d.start[0] !== p.start[0] || d.start[1] !== p.start[1]) ? d : null
})
// the index range of the placement, for Show in source, else the definition's
const partRange = computed<Located | null>(() => {
  const p = partPlace.value
  const r = p
    ? board.value?.sources?.[p.file]?.find(r => r.start[0] === p.start[0] && r.start[1] === p.start[1] && (!p.end || (r.end[0] === p.end[0] && r.end[1] === p.end[1])))
    : undefined
  return p && r ? { file: p.file, range: r } : part.value ? rangeFor(board.value?.sources, part.value.ref) : null
})
const partRepoUrl = (t: { file: string; start: [number, number]; end?: [number, number] }) => (board.value?.repo ? repoUrl(board.value.repo, t.file, asRange(t)) : null)
function onOpen(item: { id?: number | null; ref?: string | null }, kind: SourceKind = 'placement', quiet = false) {
  if (board.value) void openSource(board.value, item, kind, quiet)
}
type Picked3d = { ref?: string; id: number | null; kind: string; net?: string }
function onSelect3d(p: Picked3d | null) {
  const plan = clickPlan(p, { select: true, open: null })
  if (plan.pin !== undefined) pinFromBoard(plan.pin)
  if (plan.select !== undefined) selectRef(plan.select)
}
// the follow policy decided the click opens: quiet when it also selected
function onOpen3d(ref: string, kind: SourceKind, item: Picked3d & { meta: boolean; shift: boolean; ctrl: boolean }) {
  const plan = clickPlan(item, clickOf({ metaKey: item.meta, ctrlKey: item.ctrl, shiftKey: item.shift }))
  onOpen({ id: item.kind === 'body' ? null : item.id, ref: ref || null }, kind, plan.quiet)
}

const mm = (v: number) => +v.toFixed(3)
// old data has no `sourcing` and no `sourcingTags`
const bom = computed<BomRow[]>(() => (board.value?.bom ?? []) as BomRow[])
const bomLine = computed(() => sourcingLine((board.value as { sourcingTags?: string[] } | null)?.sourcingTags))
const bomMissing = computed(() => unsourcedText(unsourcedCount(bom.value)))
const partSourcing = computed(() => bomRowOf(bom.value, view.value.activeRef)?.sourcing ?? null)
const copied = ref<'' | 'ok' | 'fail'>('')
let copiedTimer: ReturnType<typeof setTimeout> | undefined
async function copyBom() {
  let ok = false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(bomTsv(bom.value))
      ok = true
    }
  } catch {
    ok = false
  }
  copied.value = ok ? 'ok' : 'fail'
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = ''), 1500)
}
// the board's outline for the placeholder the prerendered page shows until the 2D view mounts
const outlinePath = computed(() => board.value?.outline.map(r => 'M' + r.map(p => p.join(' ')).join('L') + 'Z').join('') ?? '')
const stack = computed(() => (board.value?.stackup ? stackupRows(board.value.stackup) : []))
// a board whose last compile failed stays on show, marked stale: in dev the entry's error, in a built site the board's own
const staleText = computed(() => (board.value ? (error.value ?? (board.value.stale ? (board.value.staleError ?? 'the last compile failed') : null)) : null))
const errorText = computed(() => staleText.value ?? error.value ?? '')
// compiled from the editor's unsaved text, with the statements its repair skipped
const draftText = computed(() => {
  const n = board.value?.draft?.skipped
  return n === undefined ? null : n ? `draft, ${n} statement${n > 1 ? 's' : ''} skipped` : 'draft'
})
// the head runs to the first line that says something: Vite's "Transform failed with 1 error:" takes the line after it along
const headLines = computed(() => {
  const ls = errorText.value.split('\n')
  let n = 1
  while (n < ls.length && /:\s*$/.test(ls[n - 1]) && ls[n].trim()) n++
  return n
})
const errorHead = computed(() => errorText.value.split('\n').slice(0, headLines.value).join('\n'))
const errorBody = computed(() => errorText.value.split('\n').slice(headLines.value).join('\n').replace(/^\n+/, ''))

type SiteItemLite = { id: number; kind: string; ref?: string; net?: string; rings: [number, number][][] }
const itemById = computed(() => new Map(((board.value?.items ?? []) as SiteItemLite[]).map(it => [it.id, it])))
function itemCentre(it: SiteItemLite): [number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const r of it.rings)
    for (const [x, y] of r) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  return x0 <= x1 ? [(x0 + x1) / 2, (y0 + y1) / 2] : [0, 0]
}
interface Blocker {
  key: string
  label: string
  ref: string | null
  at: [number, number]
}
function blockersOf(d: { items?: number[] }): Blocker[] {
  const out: Blocker[] = []
  for (const id of d.items ?? []) {
    const it = itemById.value.get(id)
    if (!it) continue
    const at = itemCentre(it)
    let label = it.ref ?? it.kind
    if (it.kind === 'pad' && it.ref) {
      const fp = board.value?.footprints.find(f => f.ref === it.ref)
      const pad = fp?.pads.reduce<{ num: string; d: number } | null>((best, p) => {
        const e = Math.hypot(p.at[0] - at[0], p.at[1] - at[1])
        return !best || e < best.d ? { num: p.num, d: e } : best
      }, null)
      if (pad?.num) label = `${it.ref}.${pad.num}`
    } else if (it.ref) label = `${it.kind} of ${it.ref}`
    if (it.net) label += ` ${it.net}`
    out.push({ key: String(id), label, ref: it.ref ?? null, at })
  }
  return out
}
/** A route-failed message without its list of obstacles, which the row shows as links. */
const failedText = (m: string) => m.replace(/; nearest obstacles: .*$/, '')
function gotoBlocker(b: Blocker) {
  if (b.ref) selectRef(b.ref, true, true)
  else gotoDrc(b.at)
}
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`)
// dev: a recompile keeps the board on show with a line on top and the status in the header, or in IDE mode the pane's button row; the first board is covered until it has drawn
const loadView = useLoad()
const load = computed(() => loadView?.load ?? null)
// the page mounts once the server answered, so no board and no error here means nothing to show until one is chosen
const shownCount = computed(() => state.boards.length + Object.values(state.errors).filter(Boolean).length)
watch(
  shownCount,
  count => {
    if (loadView) loadView.load = step(loadView.load, { kind: 'boards', count })
  },
  { immediate: true },
)
const idleHint = computed(() => (ide.on ? 'or choose one in the Boards view of the pcbjs sidebar' : ''))
const recompiling = computed(() => !!load.value?.shown && load.value.phase === 'compiling')
const loadStatus = computed(() => (recompiling.value ? loadText(load.value!) : ''))
const loadLine = computed(() => (recompiling.value ? loadProgress(load.value!) : null))
const covering = computed(
  () => !!board.value && !!load.value && !load.value.shown && load.value.phase !== 'gone' && !view3dError.value && !(view.value.mode === 'sch' && !drawing.value),
)
const reload = () => location.reload()
const timingRows = computed(() => Object.entries(board.value?.timings ?? {}).filter(([, v]) => typeof v === 'number' && v >= 0.5) as [string, number][])
</script>

<template>
  <div
    class="app"
    :class="{
      page: home || missing,
      'drawer-layers': drawer === 'layers',
      'drawer-panel': drawer === 'panel',
      ide: ide.on,
      bare: ide.on && !ide.panel,
      embed: embed.on,
      'no-tools': embed.on && !embed.tools,
    }"
  >
    <div v-if="recompiling" class="load-line" :class="{ unknown: loadLine === null }" aria-hidden="true"><span :style="{ width: (loadLine ?? 1) * 100 + '%' }"></span></div>
    <ServerGone v-if="load?.phase === 'gone'" />
    <header v-if="!ide.on && !embed.on" class="topbar">
      <button v-if="!home && !missing" class="icon only-narrow" aria-label="Layers" title="Layers" @click="drawer = drawer === 'layers' ? null : 'layers'">
        <svg viewBox="0 0 16 16"><path d="M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3" /></svg>
      </button>
      <template v-if="workspace.info && !workspace.info.single">
        <a class="crumb" :class="{ on: workspaceHome }" href="/" :aria-current="workspaceHome ? 'page' : undefined">Projects</a>
        <span v-if="!workspaceHome" class="sep" aria-hidden="true">/</span>
      </template>
      <template v-if="!state.single && !workspaceHome">
        <a class="crumb" :class="{ on: home }" :href="homeHref" :aria-current="home ? 'page' : undefined">{{ workspace.scope ?? 'Boards' }}</a>
        <span v-if="!home" class="sep" aria-hidden="true">/</span>
      </template>
      <template v-if="home">
        <h1 class="sr-only">pcbjs</h1>
        <div class="meta">
          <span>{{ workspaceHome ? `${scopeCards.length} projects` : `${cards.length} boards` }}</span>
        </div>
      </template>
      <h1 v-else-if="!state.single" class="switch">
        <select aria-label="Board" @change="onSwitch">
          <option v-if="!board" value="" disabled selected>{{ routeName ?? 'board' }}</option>
          <option v-for="g in siteGroups" :key="g.name" :value="g.name" :selected="g.name === board?.name">{{ boardTarget(g)?.title || g.name }}</option>
        </select>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5" /></svg>
      </h1>
      <h1 v-else>{{ board?.title || board?.name || 'pcbjs' }}</h1>
      <Menu v-if="multi && board && !home" class="target-menu" label="Fab target">
        <template #button
          ><span class="dot" :class="drc!.state"></span><span class="name">{{ targetName(board) }}</span
          ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5" /></svg
        ></template>
        <a
          v-for="t in targetRows"
          :key="t.name"
          role="menuitemradio"
          :aria-checked="t.on"
          :class="{ on: t.on }"
          :href="boardHref(board.name, t.name)"
          @click="onTargetLink($event, t.name)"
        >
          <span class="dot" :class="t.drc.state"></span><span class="name">{{ t.name }}</span
          ><span class="dim">{{ t.drc.text }}</span>
        </a>
      </Menu>
      <div class="meta" v-if="board">
        <span v-if="board.title && board.title !== board.name">{{ board.name }}</span>
        <span v-if="board.revision">rev {{ board.revision }}</span>
        <span>{{ mm(board.bbox.w) }} × {{ mm(board.bbox.h) }} mm</span>
        <span class="wide">{{ board.copper }} layers · {{ board.thickness }} mm</span>
        <span v-for="r in board.references ?? []" :key="r.name" class="wide" :title="r.anchor"
          >references <a v-if="r.page" :href="boardHref(r.page)">{{ r.title || r.name }}</a
          ><template v-else>{{ r.title || r.name }}</template></span
        >
      </div>
      <span class="spacer"></span>
      <span v-if="loadStatus" class="load-status" role="status">{{ loadStatus }}</span>
      <template v-if="board">
        <span v-if="error" class="pill err" title="the board shown is the last one that compiled">compile error</span>
        <button v-else class="pill" :class="drc!.state" :title="drc!.title" @click="openTab(pillTab)">{{ drcText }}</button>
        <button v-if="othersFail" class="pill dim wide" :title="failingNames" @click="openTab('drc')">{{ failing }} of {{ targets.length }} targets fail</button>
        <span v-if="board.dev" class="pill dim wide" title="updates without reload when the source changes">dev</span>
        <span v-if="draftText" class="pill dim" title="compiled from the editor's unsaved text; a save compiles the file">{{ draftText }}</span>
        <a class="btn wide" :href="asset(board.svgUrl)" target="_blank" rel="noopener">{{ board.name }}.pcb.svg</a>
        <a class="btn primary" :href="asset(board.fab.url)" :title="fabTitle" download>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10" /></svg>{{ board.fab.name }}
        </a>
      </template>
      <span v-else-if="error && !home && !missing" class="pill err">compile error</span>
      <button
        class="icon"
        :title="resolvedTheme() === 'dark' ? 'Light theme' : 'Dark theme'"
        :aria-label="resolvedTheme() === 'dark' ? 'Light theme' : 'Dark theme'"
        @click="toggleTheme"
      >
        <svg v-if="resolvedTheme() === 'dark'" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
        </svg>
        <svg v-else viewBox="0 0 16 16"><path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z" /></svg>
      </button>
      <button v-if="!home && !missing" class="icon only-narrow" aria-label="Details" title="DRC, BOM, nets and part" @click="drawer = drawer === 'panel' ? null : 'panel'">
        <svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h10" /></svg>
      </button>
    </header>

    <Home v-if="home" />
    <main v-else-if="missing" class="missing">
      <p>
        No such board<template v-if="routeName"
          >: <code>{{ routeName }}</code></template
        >.
      </p>
      <p><a :href="homeHref">All boards</a></p>
    </main>
    <template v-else>
      <aside v-if="!embed.on" class="rail left">
        <template v-if="board && view.mode === 'sch' && drawing">
          <section>
            <h2>Schematic</h2>
            <ul class="layers" title="Double-click a row to show it alone">
              <li v-for="l in schRows" :key="l.id">
                <label class="layer" :class="{ off: view.schHidden.has(l.id), blank: !l.n }" @dblclick.prevent="soloSch(l.id)">
                  <input type="checkbox" :checked="!view.schHidden.has(l.id)" @change="toggleSch(l.id)" />
                  <span class="sw" :style="{ background: l.swatch }"></span>
                  <span class="id">{{ l.name }}</span>
                  <span class="kind">{{ l.n }}</span>
                </label>
              </li>
            </ul>
            <p class="hint">Double-click a row to solo it</p>
          </section>
          <section>
            <h2>Sheet</h2>
            <dl class="kv">
              <dt>page</dt>
              <dd>{{ drawing.paper ? drawing.paper.name : `${Math.round(drawing.page[2] - drawing.page[0])} × ${Math.round(drawing.page[3] - drawing.page[1])} mm` }}</dd>
              <dt>grid</dt>
              <dd>{{ drawing.grid }} mm</dd>
              <dt>symbols</dt>
              <dd>{{ drawing.stats.symbols }}</dd>
              <dt>wired nets</dt>
              <dd>{{ drawing.stats.wired }}</dd>
              <dt>labelled nets</dt>
              <dd>{{ drawing.stats.labelled }}</dd>
              <dt>junctions</dt>
              <dd>{{ drawing.stats.junctions }}</dd>
              <dt>crossings</dt>
              <dd>{{ drawing.stats.crossings }}</dd>
              <dt>wire length</dt>
              <dd>{{ mm(drawing.stats.length) }} mm</dd>
            </dl>
          </section>
        </template>
        <template v-else-if="board">
          <section>
            <h2>Layers</h2>
            <div class="seg presets" role="group" aria-label="Layer presets">
              <button v-for="[p, label] in presetNames" :key="p" :class="{ on: activePreset === p }" @click="applyPreset(p)">{{ label }}</button>
            </div>
            <ul class="layers" title="Double-click a layer to show it alone">
              <li v-for="l in layerList" :key="l.id">
                <label class="layer" :class="{ off: view.hidden.has(l.id), blank: !l.svg }" @dblclick.prevent="solo(l.id)">
                  <input type="checkbox" :checked="!view.hidden.has(l.id)" @change="toggle(l.id)" />
                  <span class="sw" :style="{ background: l.color }"></span>
                  <span class="id">{{ l.id }}</span>
                  <span class="kind">{{ l.kind }}</span>
                </label>
              </li>
            </ul>
            <p class="hint">Double-click a layer to solo it</p>
          </section>
          <section>
            <h2>Board</h2>
            <dl class="kv">
              <dt>footprints</dt>
              <dd>{{ board.stats.footprints }}</dd>
              <dt>pads</dt>
              <dd>{{ board.stats.pads }}</dd>
              <dt>tracks</dt>
              <dd>{{ board.stats.tracks }}</dd>
              <dt>vias</dt>
              <dd>{{ board.stats.vias }}</dd>
              <dt>zones</dt>
              <dd>{{ board.stats.zones }}</dd>
              <dt>nets</dt>
              <dd>{{ board.stats.nets }}</dd>
              <template v-if="board.keepouts?.length"
                ><dt>keepouts</dt>
                <dd>{{ board.keepouts.length }}</dd></template
              >
            </dl>
          </section>
          <section v-if="board.routing">
            <h2>Routing</h2>
            <dl class="kv">
              <dt>legs</dt>
              <dd>{{ board.routing.legs }}</dd>
              <dt>routed</dt>
              <dd>{{ board.routing.routed }}</dd>
              <dt>failed</dt>
              <dd :class="{ bad: board.routing.failed }">{{ board.routing.failed }}</dd>
              <dt>cached</dt>
              <dd>{{ board.routing.cached }}</dd>
              <dt>locked</dt>
              <dd>{{ board.routing.locked }}</dd>
              <template v-if="board.routing.shared"
                ><dt>shared by</dt>
                <dd>{{ board.routing.shared.targets.join(', ') }}</dd></template
              >
            </dl>
          </section>
          <section v-if="timingRows.length">
            <h2>Compile time</h2>
            <dl class="kv">
              <template v-for="[k, v] in timingRows" :key="k"
                ><dt>{{ k }}</dt>
                <dd>{{ ms(v) }}</dd></template
              >
            </dl>
          </section>
          <section>
            <h2>Rules, mm</h2>
            <dl class="kv">
              <template v-for="(v, k) in board.rules" :key="k"
                ><dt>{{ k }}</dt>
                <dd>{{ v }}</dd></template
              >
            </dl>
          </section>
          <section v-if="board.stackup">
            <h2>Stackup, mm</h2>
            <table class="stackup">
              <tbody>
                <tr v-for="(r, i) in stack" :key="i" :class="r.type" :title="r.title">
                  <td class="t" :colspan="r.name ? 1 : 2">{{ r.type }}</td>
                  <td v-if="r.name" class="n">{{ r.name }}</td>
                  <td class="th">{{ r.thickness }}</td>
                  <td class="d"><span v-if="r.color" class="sw" :style="{ background: r.color }"></span>{{ r.detail }}</td>
                </tr>
              </tbody>
            </table>
            <dl class="kv">
              <dt>finish</dt>
              <dd>{{ board.stackup.finish ?? 'none' }}</dd>
              <template v-if="board.stackup.maskColor"
                ><dt>mask</dt>
                <dd>
                  <span v-if="cssColor(board.stackup.maskColor)" class="sw" :style="{ background: cssColor(board.stackup.maskColor)! }"></span>{{ board.stackup.maskColor }}
                </dd></template
              >
              <template v-if="board.stackup.silkColor"
                ><dt>silk</dt>
                <dd>
                  <span v-if="cssColor(board.stackup.silkColor)" class="sw" :style="{ background: cssColor(board.stackup.silkColor)! }"></span>{{ board.stackup.silkColor }}
                </dd></template
              >
              <dt>thickness</dt>
              <dd>{{ board.thickness }}</dd>
            </dl>
          </section>
        </template>
      </aside>

      <main class="stage" :class="{ split: view.mode === 'sch' && view.split && drawing }">
        <template v-if="board">
          <!-- the board views measure the page and draw with pointer events and WebGL: the prerendered page holds a box of the board's shape until hydration -->
          <ClientOnly>
            <BoardView
              v-show="view.mode === '2d' || (view.mode === 'sch' && view.split)"
              :key="board.name"
              :board="board"
              :hidden="view.hidden"
              :active-net="activeNet"
              :active-ref="view.activeRef"
              :selected-refs="view.selectedRefs"
              :hover-refs="boardHoverRefs"
              :focus="focus"
              :beside="view.mode === 'sch'"
              v-model:flipped="view.flipped"
              :source="sourceHl"
              :frame-ref="frameRef"
              :scope="scope"
              @pin="pinFromBoard"
              @select="selectRef($event)"
              @open="onOpen"
            />
            <SchView
              v-if="view.mode === 'sch' && drawing"
              :key="board.name"
              :board="board"
              :drawing="drawing"
              :hidden="view.schHidden"
              :theme="resolvedTheme()"
              :active-net="activeNet"
              :active-ref="view.activeRef"
              :selected-refs="view.selectedRefs"
              :hover-refs="hoverRefs"
              :probe="ui.probe ?? remoteProbe"
              :scope="scope"
              :source="sourceHl"
              :focus="schFocus"
              :frame-ref="frameRef"
              v-model:split="view.split"
              @hover="onSchHover"
              @pin="pinFromBoard"
              @select="selectRef($event)"
              @circuit="onSchCircuit"
              @open="onSchOpen"
            />
            <div v-else-if="view.mode === 'sch'" class="empty">No schematic drawing in this build</div>
            <div v-if="view.mode === '3d'" class="view3d-host">
              <div v-if="view3dError" class="empty">3D view failed: {{ view3dError }}</div>
              <!-- the pinned net, selection and source highlight fade the rest; a hovered net only tints -->
              <View3D
                v-else
                :key="board.name"
                :board="board"
                :hidden="view.hidden"
                :active-net="view.pinnedNet"
                :hover-net="hoverNet"
                :active-ref="view.activeRef"
                :selected-refs="view.selectedRefs"
                :hover-refs="boardHoverRefs"
                :source-ids="sourceHl?.ids ?? null"
                :source-refs="sourceRefs"
                :source-points="sourceHl?.points ?? null"
                :frame-ref="frameRef"
                :from-below="view.flipped"
                :scope="scope"
                v-model:fade="view.fade"
                v-model:explode="view.explode"
                v-model:separation="view.separation"
                @select="onSelect3d"
                @open="onOpen3d"
                @net="ui.hoverNet = $event"
              />
            </div>
            <template #placeholder>
              <div class="board-placeholder" aria-hidden="true">
                <svg :viewBox="board.viewBox.join(' ')" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" :d="outlinePath" /></svg>
              </div>
            </template>
          </ClientOnly>
          <div v-if="ide.on" class="bv-tools ide-tools" role="toolbar" aria-label="Pane">
            <span v-if="loadStatus" class="load-status" role="status">{{ loadStatus }}</span>
            <button
              class="icon"
              :class="{ on: drawer === 'layers' }"
              aria-label="Layers"
              title="Layers, board, rules and stackup"
              @click="drawer = drawer === 'layers' ? null : 'layers'"
            >
              <svg viewBox="0 0 16 16"><path d="M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3" /></svg>
            </button>
            <button
              class="icon"
              :title="resolvedTheme() === 'dark' ? 'Light theme' : 'Dark theme'"
              :aria-label="resolvedTheme() === 'dark' ? 'Light theme' : 'Dark theme'"
              @click="toggleTheme"
            >
              <svg v-if="resolvedTheme() === 'dark'" viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="3" />
                <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
              </svg>
              <svg v-else viewBox="0 0 16 16"><path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z" /></svg>
            </button>
            <button class="icon" aria-label="Reload" title="Reload the pane" @click="reload">
              <svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 11-1.5-3.5M13 2.5v3h-3" /></svg>
            </button>
            <button v-if="ide.panel" class="icon only-narrow" aria-label="Details" title="DRC, BOM, nets and part" @click="drawer = drawer === 'panel' ? null : 'panel'">
              <svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h10" /></svg>
            </button>
          </div>
          <div v-else-if="!embed.on" class="seg mode" role="group" aria-label="View">
            <button :class="{ on: view.mode === '2d' }" :aria-pressed="view.mode === '2d'" @click="view.mode = '2d'">2D</button>
            <button :class="{ on: view.mode === '3d' }" :aria-pressed="view.mode === '3d'" @click="view.mode = '3d'">3D</button>
            <button v-if="drawing" :class="{ on: view.mode === 'sch' }" :aria-pressed="view.mode === 'sch'" @click="view.mode = 'sch'">Schematic</button>
          </div>
          <div v-if="!embed.on && (activeNet || view.activeRef || circuit || sourceHl)" class="chips-bar">
            <button
              v-if="sourceHl"
              class="chip src-chip"
              :title="
                sourceHl.line
                  ? `highlighting what ${highlightLabel(sourceHl)}${sourceHl.seg ? ` ${sourceHl.seg}` : ''} made; click to clear`
                  : `highlighting ${sourceHl.file}; click to clear`
              "
              @click="clearSourceHighlight()"
            >
              {{ sourceHl.label ?? highlightLabel(sourceHl) }}<code v-if="sourceHl.seg" class="cmd">{{ sourceHl.seg }}</code
              ><span>{{ sourceCount }} {{ sourceCount === 1 ? 'item' : 'items' }}</span
              ><span aria-hidden="true">×</span>
            </button>
            <button v-if="activeNet" class="chip net" :title="view.pinnedNet ? 'Unpin net' : ''" @click="unpinNet()">
              {{ activeNet }}<span v-if="view.pinnedNet === activeNet" aria-hidden="true">×</span>
            </button>
            <button v-if="view.activeRef" class="chip" title="Clear selection" @click="selectRef(null)">{{ view.activeRef }}<span aria-hidden="true">×</span></button>
            <button v-if="circuit" class="chip" title="Clear selection" @click="selectCircuit(null)">
              {{ pathLabel(circuit.circuit.path) }}<span class="dim">{{ circuit.refs.length }} {{ circuit.refs.length === 1 ? 'part' : 'parts' }}</span
              ><span aria-hidden="true">×</span>
            </button>
          </div>
        </template>
        <LoadScreen v-else-if="!error && load" :hint="idleHint" />
        <div v-else-if="!error" class="empty">{{ state.loading ? 'Loading…' : 'Compiling…' }}</div>
        <LoadScreen v-if="covering" class="cover" />
        <div v-if="source.toast" :key="source.toast.n" class="toast" :class="{ err: source.toast.err }" role="status">{{ source.toast.text }}</div>
        <div v-if="error && !board" class="error-box" role="alert">
          <div class="error-title"><span class="pill err">compile error</span><span class="dim">no board yet</span></div>
          <div class="error-head">{{ errorHead }}</div>
          <pre v-if="errorBody">{{ errorBody }}</pre>
        </div>
        <div v-else-if="staleText" class="stale-banner" role="alert">
          <div class="stale-title"><span class="pill warn">stale</span><span>the last compile failed; this is the board from the compile before</span></div>
          <div class="stale-head">{{ errorHead }}</div>
          <details v-if="errorBody">
            <summary>details</summary>
            <pre>{{ errorBody }}</pre>
          </details>
        </div>
      </main>

      <aside v-if="!embed.on" class="rail right">
        <template v-if="board">
          <nav class="tabs" role="tablist">
            <button role="tab" :aria-selected="view.tab === 'drc'" :class="{ on: view.tab === 'drc' }" @click="view.tab = 'drc'">
              DRC <span class="count">{{ board.drc.length }}</span>
            </button>
            <button role="tab" :aria-selected="view.tab === 'erc'" :class="{ on: view.tab === 'erc' }" @click="view.tab = 'erc'">
              ERC <span v-if="erc" class="count">{{ erc.length }}</span>
            </button>
            <button role="tab" :aria-selected="view.tab === 'schematic'" :class="{ on: view.tab === 'schematic' }" @click="view.tab = 'schematic'">Schematic</button>
            <button role="tab" :aria-selected="view.tab === 'bom'" :class="{ on: view.tab === 'bom' }" @click="view.tab = 'bom'">
              BOM <span class="count">{{ board.bom.length }}</span>
            </button>
            <button role="tab" :aria-selected="view.tab === 'nets'" :class="{ on: view.tab === 'nets' }" @click="view.tab = 'nets'">
              Nets <span class="count">{{ board.nets.length }}</span>
            </button>
            <button role="tab" :aria-selected="view.tab === 'part'" :class="{ on: view.tab === 'part' }" @click="view.tab = 'part'">{{ circuit ? 'Circuit' : 'Part' }}</button>
          </nav>

          <div class="panel" v-if="view.tab === 'drc' || view.tab === 'erc'">
            <div v-if="multi" class="target-strip" role="group" aria-label="Fab targets">
              <a
                v-for="t in stripRows"
                :key="t.name"
                :class="{ on: t.on }"
                :aria-current="t.on ? 'page' : undefined"
                :href="boardHref(board.name, t.name)"
                @click="onTargetLink($event, t.name)"
              >
                <span class="dot" :class="t.state"></span><span class="name">{{ t.name }}</span
                ><span class="dim">{{ t.text }}</span>
              </a>
            </div>
            <template v-if="view.tab === 'erc'">
              <div v-if="!erc" class="empty">No ERC data in this build</div>
              <div v-else-if="!erc.length" class="empty">No findings</div>
              <button v-for="(d, i) in erc ?? []" :key="i" class="drcrow" @click="gotoErc(d)">
                <span class="line1"
                  ><span class="pill sm" :class="pillOf(d.severity)">{{ d.severity }}</span
                  ><span class="rule">{{ d.rule }}</span
                  ><span v-if="d.layer" class="dim">{{ d.layer }}</span></span
                >
                <span class="msg">{{ d.message }}</span>
                <span v-if="d.at && (d.at[0] || d.at[1])" class="at">{{ mm(d.at[0]) }}, {{ mm(d.at[1]) }} mm</span>
              </button>
            </template>
            <template v-else>
              <div v-if="!board.drc.length" class="empty">
                No findings<template v-if="board.unconnected">, {{ board.unconnected }} unconnected</template>
              </div>
              <template v-for="(d, i) in board.drc" :key="i">
                <div v-if="d.rule === 'route-failed' && d.route" class="drcrow route-failed" role="button" tabindex="0" @click="gotoDrc(d.at)" @keydown.enter.self="gotoDrc(d.at)">
                  <span class="line1"
                    ><span class="pill sm err">{{ d.severity }}</span
                    ><span class="rule">{{ d.rule }}</span
                    ><span v-if="d.route.net" class="dim">{{ d.route.net }}</span
                    ><span v-if="d.route.legs > 1" class="dim">leg {{ d.route.leg }} of {{ d.route.legs }}</span></span
                  >
                  <span class="ends">
                    <button class="link" title="Zoom to this end" @click.stop="gotoDrc([d.route.from.x, d.route.from.y])">
                      {{ mm(d.route.from.x) }}, {{ mm(d.route.from.y) }} {{ d.route.from.layer }}
                    </button>
                    <span class="dim">to</span>
                    <button class="link" title="Zoom to this end" @click.stop="gotoDrc([d.route.to.x, d.route.to.y])">
                      {{ mm(d.route.to.x) }}, {{ mm(d.route.to.y) }} {{ d.route.to.layer }}
                    </button>
                  </span>
                  <span class="msg">{{ failedText(d.message) }}</span>
                  <span v-if="blockersOf(d).length" class="blockers"
                    ><span class="dim">blocked by</span>
                    <button
                      v-for="b in blockersOf(d)"
                      :key="b.key"
                      class="pin"
                      :class="{ on: !!b.ref && view.activeRef === b.ref }"
                      :title="b.ref ? `Select ${b.ref}` : 'Zoom to it'"
                      @click.stop="gotoBlocker(b)"
                    >
                      {{ b.label }}
                    </button>
                  </span>
                </div>
                <button v-else class="drcrow" @click="gotoDrc(d.at)">
                  <span class="line1"
                    ><span class="pill sm" :class="pillOf(d.severity)">{{ d.severity }}</span
                    ><span class="rule">{{ d.rule }}</span
                    ><span v-if="d.layer" class="dim">{{ d.layer }}</span></span
                  >
                  <span class="msg">{{ d.message }}</span>
                  <span class="at">{{ mm(d.at[0]) }}, {{ mm(d.at[1]) }} mm</span>
                </button>
              </template>
            </template>
          </div>

          <div class="panel sch" v-else-if="view.tab === 'schematic'">
            <div v-if="!hasSch" class="empty">No schematic data in this build</div>
            <template v-else>
              <input
                v-model="schFilter"
                class="filter"
                type="search"
                :placeholder="circuits ? 'Filter circuits, parts and nets' : 'Filter parts and nets'"
                :aria-label="circuits ? 'Filter circuits, parts and nets' : 'Filter parts and nets'"
              />
              <h2>
                Parts <span class="count">{{ treeView.parts }}</span>
              </h2>
              <table class="sch-parts">
                <colgroup>
                  <col :style="{ width: refWidth + 'px' }" />
                  <col />
                </colgroup>
                <tbody>
                  <template v-for="{ node, depth } in treeRows" :key="node.key">
                    <tr
                      v-if="node.kind === 'instance'"
                      class="inst"
                      :class="{ on: view.activeCircuit === node.key }"
                      @mouseenter="hoverCircuit(node)"
                      @mouseleave="hoverCircuit(null)"
                    >
                      <td colspan="2" :style="{ paddingLeft: depth * 14 + 'px' }">
                        <div class="line1">
                          <button
                            class="twisty"
                            :class="{ open: isOpen(node.key) }"
                            :aria-expanded="isOpen(node.key)"
                            :aria-label="isOpen(node.key) ? 'Collapse' : 'Expand'"
                            @click="toggleOpen(node.key)"
                          >
                            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
                          </button>
                          <button class="link inst-name" title="Select the circuit instance" @click="selectCircuit(node.key, true, true)">
                            {{ node.circuit.name ?? node.circuit.path.at(-1) }}
                          </button>
                          <span class="dim">{{ node.circuit.circuit }}</span>
                          <span v-if="node.circuit.layout" class="tag">{{ node.circuit.layout }}</span>
                          <span v-if="node.circuit.placed === false" class="tag warn">not placed</span>
                          <span class="dim inst-count">{{ node.refs.length }} {{ node.refs.length === 1 ? 'part' : 'parts' }}</span>
                        </div>
                      </td>
                    </tr>
                    <tr v-else :class="{ on: view.activeRef === node.part.ref }">
                      <td class="ref" :style="depth ? { paddingLeft: depth * 14 + 18 + 'px' } : undefined">
                        <button class="link" :title="node.part.placed ? 'Select and zoom' : 'Select'" @click="selectRef(node.part.ref, true, true)">{{ node.part.ref }}</button
                        ><span v-if="node.part.local && node.part.local !== node.part.ref" class="dim local">{{ node.part.local }}</span>
                      </td>
                      <td class="body">
                        <div class="line1">
                          <span class="value">{{ node.part.value }}</span
                          ><span class="dim fp" :title="node.part.footprint">{{ node.part.footprint?.split(':').pop() }}</span
                          ><span v-if="!node.part.placed" class="tag warn">not placed</span>
                        </div>
                        <div class="pins">
                          <span
                            v-for="(x, i) in node.part.pins"
                            :key="i"
                            class="pin"
                            :class="{ nc: x.nc, none: !x.nc && x.net == null, on: !!x.net && activeNet === x.net }"
                            @mouseenter="ui.hoverNet = x.net"
                            @mouseleave="ui.hoverNet = null"
                            @click="x.net && pin(x.net)"
                            >{{ pinLabel(x) }}</span
                          >
                        </div>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
              <div v-if="!treeRows.length" class="empty">No parts match</div>
              <h2>
                Nets <span class="count">{{ schView.nets.length }}</span>
              </h2>
              <ul class="sch-nets">
                <li v-for="n in schView.nets" :key="n.name" :class="{ on: activeNet === n.name }">
                  <div class="line1">
                    <button
                      class="link name"
                      :class="{ pinned: view.pinnedNet === n.name }"
                      @mouseenter="ui.hoverNet = n.name"
                      @mouseleave="ui.hoverNet = null"
                      @click="pin(n.name)"
                    >
                      <span v-if="netLabel(n).prefix" class="owner">{{ netLabel(n).prefix }}</span
                      >{{ netLabel(n).name }}
                    </button>
                    <span v-if="n.local" class="tag">local</span><span v-if="n.class" class="dim cls">{{ n.class }}</span>
                  </div>
                  <div class="pins">
                    <button v-for="x in n.pins" :key="x" class="pin" :class="{ on: view.activeRef === pinRef(x) }" @click="selectRef(pinRef(x), true, true)">{{ x }}</button>
                  </div>
                </li>
              </ul>
              <div v-if="!schView.nets.length" class="empty">No nets match</div>
            </template>
          </div>

          <div class="panel bom" v-else-if="view.tab === 'bom'">
            <div class="bom-head">
              <div class="bom-meta">
                <span v-if="bomLine">{{ bomLine }}</span>
                <span v-if="bomMissing" class="bom-missing">{{ bomMissing }}</span>
              </div>
              <button class="btn" :title="copied === 'fail' ? 'Clipboard not available' : 'Copy the BOM as tab separated values'" @click="copyBom">
                {{ copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy TSV' }}
              </button>
            </div>
            <table class="bom-table">
              <thead>
                <tr>
                  <th>Refs</th>
                  <th>Value</th>
                  <th>Footprint</th>
                  <th class="num">Qty</th>
                  <th>MPN</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in bom" :key="r.refs.join()" :class="{ unsourced: !rowMpn(r) }">
                  <td class="refs">
                    <div class="chips">
                      <button v-for="ref in r.refs" :key="ref" class="chip" :class="{ on: view.activeRef === ref }" @click="selectRef(ref, true)">{{ ref }}</button>
                    </div>
                  </td>
                  <td class="value">{{ r.value }}</td>
                  <td class="fp" :title="r.footprint">{{ r.footprint.split(':').pop() }}</td>
                  <td class="num">{{ r.qty }}</td>
                  <td class="mpn" :title="sourcingTitle(r.sourcing) || undefined">
                    <span v-if="rowMpn(r)">{{ rowMpn(r) }}</span
                    ><span v-else class="dim">none</span>
                  </td>
                  <td class="src-tag">
                    <span v-if="sourceLabel(r.sourcing)" class="tag">{{ sourceLabel(r.sourcing) }}</span
                    ><span v-else class="dim">–</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="panel" v-else-if="view.tab === 'nets'">
            <input v-model="netFilter" class="filter" type="search" placeholder="Filter nets" aria-label="Filter nets" />
            <ul class="netlist">
              <li v-for="n in nets" :key="n.name">
                <button
                  class="net"
                  :class="{ on: activeNet === n.name, pinned: view.pinnedNet === n.name }"
                  @mouseenter="ui.hoverNet = n.name"
                  @mouseleave="ui.hoverNet = null"
                  @click="pin(n.name)"
                >
                  <span class="name"
                    ><span v-if="netLabel(n).prefix" class="owner">{{ netLabel(n).prefix }}</span
                    >{{ netLabel(n).name }}<span v-if="n.local" class="tag">local</span><span v-if="n.class" class="cls">{{ n.class }}</span></span
                  ><span v-if="n.len" class="len" :class="{ bad: n.len.bad }" :title="n.len.title"
                    ><span v-if="n.len.bad" class="mark" aria-label="length outside its target">!</span>{{ +n.len.length.toFixed(2) }} mm<span
                      v-if="n.len.target && n.len.routes === 1"
                      class="dim"
                    >
                      / {{ targetText(n.len.target) }}</span
                    ></span
                  ><span class="dim">{{ padCount.get(n.name) ?? 0 }} pads</span>
                </button>
              </li>
            </ul>
          </div>

          <div class="panel circuit-panel" v-else-if="circuit">
            <div class="part-head">
              <h3>{{ circuit.circuit.name ?? circuit.circuit.path.at(-1) }}</h3>
              <span class="dim">{{ circuit.circuit.circuit }}</span
              ><span v-if="circuit.circuit.placed === false" class="tag warn">not placed</span>
            </div>
            <dl class="kv wide-k">
              <dt>circuit</dt>
              <dd>{{ circuit.circuit.circuit }}</dd>
              <dt>layout</dt>
              <dd>
                <span v-if="circuit.circuit.layout">{{ circuit.circuit.layout }}</span
                ><span v-else class="dim">none</span>
              </dd>
              <dt>path</dt>
              <dd class="src path-links">
                <template v-for="(l, i) in partPathLinks({ ref: '', path: circuit.circuit.path, local: '' })?.links ?? []" :key="l.key">
                  <span v-if="i" class="dim"> / </span
                  ><a v-if="l.key !== circuit.key" href="#" title="Select this circuit instance" @click.prevent="selectCircuit(l.key)">{{ l.name }}</a
                  ><span v-else>{{ l.name }}</span>
                </template>
              </dd>
              <dt>parts</dt>
              <dd>{{ circuit.refs.length }}</dd>
              <template v-if="circuitPlaced">
                <dt>source</dt>
                <dd class="src src-actions">
                  <button
                    :title="circuitRange ? `Highlight what ${circuitRange.file}:${circuitRange.range.start[0]} made` : 'Highlight the parts of this circuit instance'"
                    @click="showCircuitSource"
                  >
                    Show in source
                  </button>
                </dd>
              </template>
            </dl>
            <h2>Parts</h2>
            <table class="pads">
              <thead>
                <tr>
                  <th>ref</th>
                  <th>local</th>
                  <th>value</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in circuitParts" :key="p.ref" class="row" @click="selectRef(p.ref, true)">
                  <td>{{ p.ref }}</td>
                  <td>{{ p.local || p.ref }}</td>
                  <td>{{ p.value }}<span v-if="!p.placed" class="tag warn">not placed</span></td>
                </tr>
              </tbody>
            </table>
            <template v-if="circuitNets.length">
              <h2>Private nets</h2>
              <ul class="sch-nets">
                <li v-for="x in circuitNets" :key="x.name" :class="{ on: activeNet === x.name }">
                  <div class="line1">
                    <button
                      class="link name"
                      :class="{ pinned: view.pinnedNet === x.name }"
                      @mouseenter="ui.hoverNet = x.name"
                      @mouseleave="ui.hoverNet = null"
                      @click="pin(x.name)"
                    >
                      {{ netLabel(x).name }}
                    </button>
                    <span v-if="x.class" class="dim cls">{{ x.class }}</span>
                  </div>
                  <div class="pins">
                    <button v-for="q in x.pins" :key="q" class="pin" @click="selectRef(pinRef(q), true)">{{ q }}</button>
                  </div>
                </li>
              </ul>
            </template>
          </div>

          <div class="panel" v-else>
            <div v-if="!part && !schPart" class="empty">Click a footprint on the board or a ref in the BOM</div>
            <template v-else-if="!part && schPart">
              <div class="part-head">
                <h3>{{ schPart.ref }}</h3>
                <span class="dim">{{ schPart.value }}</span
                ><span class="tag warn">not placed</span>
              </div>
              <dl class="kv wide-k">
                <template v-if="partPath"
                  ><dt>path</dt>
                  <dd class="src path-links">
                    <template v-for="l in partPath.links" :key="l.key"
                      ><a href="#" title="Select the circuit instance" @click.prevent="selectCircuit(l.key)">{{ l.name }}</a
                      ><span class="dim"> / </span></template
                    >{{ partPath.local }}
                  </dd></template
                >
                <dt>footprint</dt>
                <dd>{{ schPart.footprint }}</dd>
              </dl>
            </template>
            <template v-else-if="part">
              <div class="part-head">
                <h3>{{ part.ref }}</h3>
                <span class="dim">{{ part.value }}</span
                ><span v-if="schPart && !schPart.placed" class="tag warn">not placed</span>
              </div>
              <dl class="kv wide-k">
                <template v-if="partPath"
                  ><dt>path</dt>
                  <dd class="src path-links">
                    <template v-for="l in partPath.links" :key="l.key"
                      ><a href="#" title="Select the circuit instance" @click.prevent="selectCircuit(l.key)">{{ l.name }}</a
                      ><span class="dim"> / </span></template
                    >{{ partPath.local }}
                  </dd></template
                >
                <dt>footprint</dt>
                <dd>{{ part.id }}</dd>
                <dt>at</dt>
                <dd>{{ mm(part.at[0]) }}, {{ mm(part.at[1]) }} mm</dd>
                <dt>rotation</dt>
                <dd>{{ part.rot }}°</dd>
                <dt>side</dt>
                <dd>{{ part.side === 'F' ? 'front' : 'back' }}</dd>
                <template v-if="part.description"
                  ><dt>description</dt>
                  <dd>{{ part.description }}</dd></template
                >
                <template v-for="(v, k) in part.fields" :key="k"
                  ><dt>{{ k }}</dt>
                  <dd>{{ v }}</dd></template
                >
                <template v-if="part.step"
                  ><dt>model</dt>
                  <dd class="src">{{ part.step.file }}<span v-if="!part.step.mesh" class="tag warn">missing</span></dd></template
                >
                <template v-if="part.step?.issue"
                  ><dt></dt>
                  <dd class="model-issue" :title="`pcbjs model align ${part.ref}`">{{ part.step.issue }}; try pcbjs model align {{ part.ref }}</dd></template
                >
                <template v-if="partPlace">
                  <dt>source</dt>
                  <dd class="src src-actions">
                    <a v-if="board.dev" href="#" title="Open the placement in the editor" @click.prevent="onOpen({ ref: part.ref }, 'placement')">{{
                      rangeLabel(partPlace.file, asRange(partPlace))
                    }}</a>
                    <a v-else-if="partRepoUrl(partPlace)" :href="partRepoUrl(partPlace)!" target="_blank" rel="noopener" title="Open the placement on the repository host">{{
                      rangeLabel(partPlace.file, asRange(partPlace))
                    }}</a>
                    <span v-else>{{ rangeLabel(partPlace.file, asRange(partPlace)) }}</span>
                    <template v-if="partDef">
                      <a
                        v-if="board.dev"
                        class="src-def"
                        href="#"
                        :title="`Open the definition, ${rangeLabel(partDef.file, asRange(partDef))}`"
                        @click.prevent="onOpen({ ref: part.ref }, 'definition')"
                        >definition</a
                      >
                      <a
                        v-else-if="partRepoUrl(partDef)"
                        class="src-def"
                        :href="partRepoUrl(partDef)!"
                        target="_blank"
                        rel="noopener"
                        :title="rangeLabel(partDef.file, asRange(partDef))"
                        >definition</a
                      >
                    </template>
                    <button v-if="partRange" title="Highlight what this code made" @click="showSourceRange(board, partRange.file, partRange.range)">Show in source</button>
                  </dd>
                </template>
              </dl>
            </template>
            <template v-if="partSourcing && (part || schPart)">
              <h2>Sourcing</h2>
              <div class="sourcing-head">
                <strong v-if="partSourcing.mpn" class="mpn">{{ partSourcing.mpn }}</strong
                ><span v-else class="dim">no part number</span>
                <span v-if="sourceLabel(partSourcing)" class="tag">{{ sourceLabel(partSourcing) }}</span>
              </div>
              <dl v-if="partSourcing.manufacturer || partSourcing.datasheet" class="kv wide-k sourcing-kv">
                <template v-if="partSourcing.manufacturer"
                  ><dt>manufacturer</dt>
                  <dd>{{ partSourcing.manufacturer }}</dd></template
                >
                <template v-if="partSourcing.datasheet"
                  ><dt>datasheet</dt>
                  <dd class="src">
                    <a :href="partSourcing.datasheet" target="_blank" rel="noopener">{{ partSourcing.datasheet }}</a>
                  </dd></template
                >
              </dl>
              <table v-if="sourcingEntries(partSourcing).length" class="pads sourcing">
                <thead>
                  <tr>
                    <th>key</th>
                    <th>value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="[k, v] in sourcingEntries(partSourcing)" :key="k" :class="{ on: k === matchedKey(partSourcing) }">
                    <td>{{ k }}</td>
                    <td>{{ v }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
            <template v-if="schPart">
              <h2>Pins</h2>
              <table class="pads">
                <thead>
                  <tr>
                    <th>pin</th>
                    <th>net</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(p, i) in schPart.pins"
                    :key="i"
                    :class="{ row: !!p.net, on: !!p.net && activeNet === p.net, nc: p.nc }"
                    @mouseenter="ui.hoverNet = p.net"
                    @mouseleave="ui.hoverNet = null"
                    @click="p.net && pin(p.net)"
                  >
                    <td>{{ p.name }}</td>
                    <td>{{ p.nc ? 'NC' : (p.net ?? 'none') }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
            <template v-else-if="part">
              <h2>Pads</h2>
              <table class="pads">
                <thead>
                  <tr>
                    <th>pad</th>
                    <th>name</th>
                    <th>net</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="p in part.pads"
                    :key="p.num"
                    :class="{ row: !!p.net, on: !!p.net && activeNet === p.net }"
                    @mouseenter="ui.hoverNet = p.net ?? null"
                    @mouseleave="ui.hoverNet = null"
                    @click="p.net && pin(p.net)"
                  >
                    <td>{{ p.num }}</td>
                    <td>{{ p.name }}</td>
                    <td>{{ p.net ?? 'none' }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>
        </template>
      </aside>
      <div class="scrim" :class="{ 'only-narrow': !ide.on || drawer === 'panel' }" v-if="drawer && !embed.on" @click="drawer = null"></div>
    </template>
  </div>
</template>
