// The schematic panel's circuit tree, the circuit and the part panels: the instances, their parts and nets, and where a part comes from.
import { computed, ref, watch } from 'vue'
import type { PaneContext } from '../context'
import { focusAt } from '../pane'
import { filterSchematic, parsePin, schematicPart } from '../schematic'
import { ancestorKeys, buildTree, filterTree, hasCircuits, instanceNets, instanceNodes, partPathLinks, refsBox, type InstanceNode, type TreeNode } from '../circuits'
import { repoUrl, sourceTarget, type SourceKind, type SourceTarget } from '../source'
import { bomRowOf } from '../sourcing'
import { itemSource } from '../open'
import { selectRefs } from '../selection'

export const pinRef = (p: string) => parsePin(p)?.ref ?? p

/** The circuit instances of the board as a tree, flat parts on data without circuits. */
export function useTree(ctx: PaneContext) {
  const { board: store, pane } = ctx
  const sch = computed(() => (pane.mode === 'checks' ? store.site : store.layoutSite)?.schematic ?? null)
  const tree = computed<TreeNode[]>(() => buildTree(sch.value))
  const instanceByKey = computed(() => new Map(instanceNodes(tree.value).map(n => [n.key, n] as [string, InstanceNode])))
  // a circuit instance or a named group: one member; in 2D the view frames its parts
  function selectCircuit(key: string | null, zoom = false, keepTab = false) {
    const inst = key ? (instanceByKey.value.get(key) ?? null) : null
    store.setSel(inst ? selectRefs({ ...store.sel, level: null }, [key!]) : { ...store.sel, refs: [], anchor: null })
    store.hover.refs = []
    if (!inst) return
    // the tree opens down to the instance, so it shows when the Schematic tab is next opened
    const up = ancestorKeys(inst.circuit.path)
      .slice(0, -1)
      .filter(k => !pane.expanded.has(k))
    if (up.length) pane.expanded = new Set([...pane.expanded, ...up])
    if (!keepTab) pane.tab = 'part'
    const box = zoom && pane.mode === '2d' && store.site ? refsBox(store.site.footprints, inst.refs) : null
    if (box) pane.focus = focusAt(box.at, Math.max(box.w, box.h, 2) * 0.4, false)
  }
  function hoverCircuit(node: InstanceNode | null) {
    store.hover.refs = node ? node.refs : []
  }
  return { sch, tree, instanceByKey, selectCircuit, hoverCircuit }
}

/** The Schematic tab: the tree with a filter, open rows kept per pane, and the nets. */
export function useSchematicPanel(ctx: PaneContext) {
  const { pane } = ctx
  const t = useTree(ctx)
  const schFilter = ref('')
  const schView = computed(() => filterSchematic(t.sch.value, schFilter.value))
  const hasSch = computed(() => !!(t.sch.value?.parts?.length || t.sch.value?.nets?.length))
  const treeView = computed(() => filterTree(t.tree.value, schFilter.value))
  // branches the viewer closed while a filter had opened them; a new filter starts over
  const filterClosed = ref(new Set<string>())
  watch(schFilter, () => {
    filterClosed.value = new Set()
  })
  function isOpen(key: string) {
    if (schFilter.value.trim() && treeView.value.open.has(key)) return !filterClosed.value.has(key)
    return pane.expanded.has(key)
  }
  function toggleOpen(key: string) {
    const flip = (set: Set<string>) => {
      const s = new Set(set)
      s.has(key) ? s.delete(key) : s.add(key)
      return s
    }
    if (schFilter.value.trim() && treeView.value.open.has(key)) filterClosed.value = flip(filterClosed.value)
    else pane.expanded = flip(pane.expanded)
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
  const circuits = computed(() => hasCircuits(t.sch.value))
  // the ref column is wide enough for the deepest indented part row; refs and local keys fit 40 px as before
  const refWidth = computed(() => 48 + Math.max(0, ...treeRows.value.filter(r => r.node.kind === 'part').map(r => (r.depth ? r.depth * 14 + 18 : 0))))
  return { ...t, schFilter, schView, hasSch, treeView, isOpen, toggleOpen, treeRows, circuits, refWidth }
}

/** The circuit instance the selection is in: its parts and private nets. */
export function useCircuit(ctx: PaneContext) {
  const { board: store } = ctx
  const t = useTree(ctx)
  const circuit = computed(() => (store.activeCircuit ? (t.instanceByKey.value.get(store.activeCircuit) ?? null) : null))
  const placed = (r: string) => !!store.site?.footprints.some(f => f.ref === r)
  const circuitParts = computed(() =>
    (circuit.value?.refs ?? []).map(r => schematicPart(t.sch.value, r) ?? { ref: r, displayRef: undefined, value: '', local: r, placed: placed(r) }),
  )
  const circuitNets = computed(() => instanceNets(t.sch.value, circuit.value?.circuit.path))
  const circuitPlaced = computed(() => !!circuit.value?.refs.some(placed))
  return { ...t, circuit, circuitParts, circuitNets, circuitPlaced }
}

/** The anchor's part: its schematic entry, path, source and sourcing. */
export function usePart(ctx: PaneContext) {
  const { board: store } = ctx
  const t = useTree(ctx)
  const sourceSite = computed(() => (ctx.pane.mode !== 'checks' ? store.layoutSite : store.site))
  const part = computed(() => sourceSite.value?.footprints.find(f => f.ref === store.activeRef) ?? null)
  const schPart = computed(() => schematicPart(t.sch.value, store.activeRef))
  const partPath = computed(() => (schPart.value?.displayRef ? null : partPathLinks(schPart.value)))
  const partPlace = computed(() => (sourceSite.value && part.value ? sourceTarget(sourceSite.value, { ref: part.value.ref }, 'placement') : null))
  const partDef = computed<SourceTarget | null>(() => {
    const d = sourceSite.value && part.value ? sourceTarget(sourceSite.value, { ref: part.value.ref }, 'definition') : null
    const p = partPlace.value
    return d && p && (d.file !== p.file || d.start[0] !== p.start[0] || d.start[1] !== p.start[1]) ? d : null
  })
  const partRepoUrl = (s: { file: string; start: [number, number]; end?: [number, number] }) =>
    store.site?.repo ? repoUrl(store.site.repo, s.file, { start: s.start, end: s.end ?? s.start }) : null
  const partSourcing = computed(() => bomRowOf(store.site?.bom ?? [], store.activeRef)?.sourcing ?? null)
  function onOpen(item: { id?: number | null; ref?: string | null }, kind: SourceKind = 'placement', quiet = false) {
    if (sourceSite.value) void ctx.open(itemSource(sourceSite.value, item, kind), quiet)
  }
  return { ...t, part, schPart, partPath, partPlace, partDef, partRepoUrl, partSourcing, onOpen }
}
