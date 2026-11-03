// dev harness: /dev3d.html?board=Coin&hide=F.SilkS,B.Cu&focus=R1 mounts <View3D> full-screen
import { createApp, defineAsyncComponent, defineComponent, h, markRaw, reactive, ref } from 'vue'
import { boards } from 'virtual:pcbjs/board'
import type { SiteData } from '@pcbjs/core/site-data'
import { joinSite } from '@pcbjs/core/site-facets'
import { PANE, click, configure, createViewer, drawnOf, emptySelection, loadCanvas3D, selectRefs, sessionSocket, sessionUrl, type Hit, type Mods, type Selection } from '@pcbjs/ui'
import './boot.css'
import './app.css'
import '@pcbjs/ui/style.css'

configure({ base: import.meta.env.BASE_URL, dev: import.meta.env.DEV })
const View3D = defineAsyncComponent(loadCanvas3D)

const params = new URLSearchParams(location.search)
const wanted = params.get('board')
const pick = <T extends { name: string }>(list: T[]): T | null => (wanted ? list.find(b => b.name === wanted) : list[0]) ?? null
const raw = (b: SiteData | null) => (b ? markRaw(b) : null)
const state = reactive({ board: raw(pick((boards ?? []).map(b => joinSite(b.facets)))) })
// each finished compile, as a session client observing the board's meta alone; a harness needs no facet stream
if (import.meta.hot) {
  const t = sessionSocket(sessionUrl(location))
  t.on('pcbjs:boards', p => {
    const b = pick(p.boards.map(s => joinSite(s.facets)))
    if (b) state.board = raw(b)
  })
  void t.request('session/observe', { board: wanted, target: null, facets: ['meta'] })
  t.open()
}
// a built site without the inlined data, as in state.ts: boards.json, then the board's own JSON
if (!state.board && !import.meta.hot)
  fetch('boards.json')
    .then(r => r.json())
    .then(async (idx: { boards: { name: string; file: string }[] }) => {
      const b = pick(idx.boards)
      if (b) state.board = raw(await fetch(b.file).then(r => r.json()))
    })
    .catch(() => {})

const hidden = reactive(new Set((params.get('hide') ?? '').split(',').filter(Boolean)))
const hl = reactive({
  sel: emptySelection(state.board?.name ?? '') as Selection,
  hoverRefs: [] as string[],
  fade: true,
  explode: false,
})
const events = reactive({ pick: '', enter: '', hover: '', net: '' })
const set = (refs: string[]) => {
  hl.sel = selectRefs(hl.sel, refs)
}
const view3d = ref<{ focus(ref: string, dir?: [number, number, number], dist?: number): void; view(kind: string): void; stats(): unknown; bench(frames?: number): unknown }>()

const btn = (label: string, on: () => void, id: string) => h('button', { id, style: 'font-size:12px;padding:2px 8px', onClick: on }, label)
const firstNet = () => state.board?.items?.find(i => i.net && i.kind === 'track')?.net ?? state.board?.nets[0] ?? null
const firstRef = () => state.board?.footprints[0]?.ref ?? null
const firstTrack = () => state.board?.items?.find(i => i.kind === 'track')?.uid

const Harness = defineComponent(
  () => () =>
    h('div', { style: 'position:fixed;inset:0' }, [
      state.board
        ? h(View3D, {
            ref: view3d,
            board: state.board,
            hidden,
            sel: hl.sel,
            drawn: drawnOf(state.board, hl.sel),
            hoverRefs: hl.hoverRefs,
            fade: hl.fade,
            explode: hl.explode,
            onPick: (p: Hit | null, m: Mods) => {
              events.pick = JSON.stringify(p)
              hl.sel = click(hl.sel, state.board!, p, m)
            },
            onEnter: (p: Hit | null) => {
              events.enter = JSON.stringify(p)
            },
            onHover: (p: unknown) => {
              events.hover = JSON.stringify(p)
            },
            onNet: (n: string | null) => {
              events.net = String(n)
            },
            'onUpdate:explode': (v: boolean) => {
              hl.explode = v
            },
            'onUpdate:fade': (v: boolean) => {
              hl.fade = v
            },
          })
        : h('p', { style: 'padding:16px' }, 'no board'),
      h('div', { style: 'position:absolute;left:8px;bottom:8px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;font-size:12px;max-width:70%' }, [
        btn(
          'net',
          () => {
            const n = firstNet()
            set(hl.sel.refs.length || !n ? [] : [`net:${n}`])
          },
          'dev3d-net',
        ),
        btn(
          'ref',
          () => {
            const r = firstRef()
            set(hl.sel.refs.length || !r ? [] : [r])
          },
          'dev3d-ref',
        ),
        btn(
          'item',
          () => {
            const t = firstTrack()
            set(hl.sel.refs.length || !t ? [] : [t])
          },
          'dev3d-src',
        ),
        btn(
          'group',
          () => {
            hl.hoverRefs = hl.hoverRefs.length ? [] : (state.board?.footprints.slice(0, 2).map(f => f.ref) ?? [])
          },
          'dev3d-group',
        ),
        btn(
          'clear',
          () => {
            set([])
            hl.hoverRefs = []
          },
          'dev3d-clear',
        ),
        h('span', { id: 'dev3d-state', style: 'opacity:.8' }, `selection ${hl.sel.refs.join(', ') || '-'}`),
      ]),
      h(
        'div',
        { id: 'dev3d-events', style: 'position:absolute;left:8px;top:8px;font:11px var(--mono);opacity:.75;max-width:55%;white-space:pre-wrap' },
        `pick ${events.pick}\nenter ${events.enter}\nhover ${events.hover}\nnet ${events.net}`,
      ),
    ]),
)

// exposed for poking from the console: __dev3d.hidden.add('F.SilkS'), __dev3d.select(['net:GND']), __dev3d.focus('R1', [0, -0.3, 1], 4)
;(window as any).__dev3d = {
  state,
  hidden,
  hl,
  events,
  select: set,
  focus: (ref: string, dir?: [number, number, number], dist?: number) => view3d.value?.focus(ref, dir, dist),
  view: (kind: 'fit' | 'top' | 'bottom' | 'iso') => view3d.value?.view(kind),
  stats: () => view3d.value?.stats(),
  bench: (frames?: number) => view3d.value?.bench(frames),
}
const shell = createViewer({ boards: boards ?? [] })
createApp(Harness)
  .provide(PANE, shell.context(state.board?.name ?? ''))
  .mount('#dev3d')
const focusRef = params.get('focus')
if (focusRef) setTimeout(() => (window as any).__dev3d.focus(focusRef), 300)
