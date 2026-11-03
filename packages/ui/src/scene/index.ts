// A board's item rows by id, part, net and route, built once per layers facet, so a view maps a selection to its drawables without
// scanning the board. Free of three.js and Vue, written as erasable TypeScript so Node imports it in the tests.
import type { SiteData, SiteItem } from '@pcbjs/core/site-data'

export interface BoardIndex {
  item(id: number): SiteItem | undefined
  byRef(ref: string): readonly number[]
  byNet(net: string): readonly number[]
  byRoute(id: string): readonly number[]
  padNo(id: number): string | null
}

const NONE: readonly number[] = []
// keyed on the item rows, which a new layers facet replaces whole
const memo = new WeakMap<readonly SiteItem[], BoardIndex>()

/** The index of a board's items, the same object while its rows are. */
export function boardIndex(site: Pick<SiteData, 'items'>): BoardIndex {
  const rows = site.items ?? []
  let ix = memo.get(rows)
  if (!ix) memo.set(rows, (ix = build(rows)))
  return ix
}

function build(rows: readonly SiteItem[]): BoardIndex {
  const byId = new Map<number, SiteItem>(),
    refs = new Map<string, number[]>(),
    nets = new Map<string, number[]>(),
    routes = new Map<string, number[]>()
  const push = (m: Map<string, number[]>, k: string | undefined, id: number) => {
    if (k === undefined) return
    const l = m.get(k)
    if (l) l.push(id)
    else m.set(k, [id])
  }
  for (const it of rows) {
    byId.set(it.id, it)
    push(refs, it.ref, it.id)
    push(nets, it.net, it.id)
    push(routes, it.route, it.id)
  }
  return {
    item: id => byId.get(id),
    byRef: ref => refs.get(ref) ?? NONE,
    byNet: net => nets.get(net) ?? NONE,
    byRoute: id => routes.get(id) ?? NONE,
    padNo: id => {
      const it = byId.get(id)
      return it?.kind === 'pad' ? (it.pad ?? null) : null
    },
  }
}
