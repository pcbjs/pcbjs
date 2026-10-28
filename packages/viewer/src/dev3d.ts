// dev harness: /dev3d.html?board=Coin&hide=F.SilkS,B.Cu&focus=R1 mounts <View3D> full-screen
import { createApp, defineComponent, h, reactive, ref } from 'vue'
import { boards } from 'virtual:pcbjs/board'
import type { SiteData } from '@pcbjs/core/site-data'
import View3D from './View3D.vue'
import { createStore, STORE } from './state'
import './style.css'

const params = new URLSearchParams(location.search)
const wanted = params.get('board')
const pick = <T extends { name: string }>(list: T[]): T | null => (wanted ? list.find(b => b.name === wanted) : list[0]) ?? null
const state = reactive({ board: pick(boards ?? []) as SiteData | null })
if (import.meta.hot)
  import.meta.hot.on('pcbjs:board', (data: SiteData) => {
    if (data.name === (state.board?.name ?? wanted ?? data.name)) state.board = data
  })
// a built site without the inlined data, as in state.ts: boards.json, then the board's own JSON
if (!state.board && !import.meta.hot)
  fetch('boards.json')
    .then(r => r.json())
    .then(async (idx: { boards: { name: string; file: string }[] }) => {
      const b = pick(idx.boards)
      if (b) state.board = await fetch(b.file).then(r => r.json())
    })
    .catch(() => {})

const hidden = reactive(new Set((params.get('hide') ?? '').split(',').filter(Boolean)))
const hl = reactive({
  activeNet: null as string | null,
  activeRef: null as string | null,
  sourceIds: [] as number[],
  hoverRefs: [] as string[],
  selectedRefs: [] as string[],
  fade: true,
  explode: false,
})
const events = reactive({ select: '', hover: '', open: '', net: '' })
const view3d = ref<InstanceType<typeof View3D>>()

const btn = (label: string, on: () => void, id: string) => h('button', { id, style: 'font-size:12px;padding:2px 8px', onClick: on }, label)
const firstNet = () => state.board?.items?.find(i => i.net && i.kind === 'track')?.net ?? state.board?.nets[0] ?? null
const firstRef = () => state.board?.footprints[0]?.ref ?? null
const firstTrack = () => state.board?.items?.find(i => i.kind === 'track')?.id

const Harness = defineComponent(
  () => () =>
    h('div', { style: 'position:fixed;inset:0' }, [
      state.board
        ? h(View3D, {
            ref: view3d,
            board: state.board,
            hidden,
            ...hl,
            onSelect: (p: unknown) => {
              events.select = JSON.stringify(p)
              const s = p as { ref?: string; net?: string; kind: string } | null
              hl.activeRef = s?.ref ?? null
              hl.activeNet = s && s.kind !== 'body' && !s.ref ? (s.net ?? null) : s?.kind === 'pad' ? (s.net ?? null) : null
            },
            onHover: (p: unknown) => {
              events.hover = JSON.stringify(p)
            },
            onNet: (n: string | null) => {
              events.net = String(n)
            },
            onOpen: (r: string, k: string, item: unknown) => {
              events.open = JSON.stringify([r, k, item])
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
            hl.activeNet = hl.activeNet ? null : firstNet()
          },
          'dev3d-net',
        ),
        btn(
          'ref',
          () => {
            hl.activeRef = hl.activeRef ? null : firstRef()
          },
          'dev3d-ref',
        ),
        btn(
          'source id',
          () => {
            const t = firstTrack()
            hl.sourceIds = hl.sourceIds.length || t === undefined ? [] : [t]
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
            hl.activeNet = null
            hl.activeRef = null
            hl.sourceIds = []
            hl.hoverRefs = []
            hl.selectedRefs = []
          },
          'dev3d-clear',
        ),
        h('span', { id: 'dev3d-state', style: 'opacity:.8' }, `net ${hl.activeNet ?? '-'} ref ${hl.activeRef ?? '-'} src ${hl.sourceIds.join() || '-'}`),
      ]),
      h(
        'div',
        { id: 'dev3d-events', style: 'position:absolute;left:8px;top:8px;font:11px var(--mono);opacity:.75;max-width:55%;white-space:pre-wrap' },
        `select ${events.select}\nhover ${events.hover}\nnet ${events.net}\nopen ${events.open}`,
      ),
    ]),
)

// exposed for poking from the console: __dev3d.hidden.add('F.SilkS'), __dev3d.hl.activeNet = 'GND', __dev3d.focus('R1', [0, -0.3, 1], 4)
;(window as any).__dev3d = {
  state,
  hidden,
  hl,
  events,
  focus: (ref: string, dir?: [number, number, number], dist?: number) => view3d.value?.focus(ref, dir, dist),
  view: (kind: 'fit' | 'top' | 'bottom' | 'iso') => view3d.value?.view(kind),
  stats: () => view3d.value?.stats(),
  bench: (frames?: number) => view3d.value?.bench(frames),
}
createApp(Harness)
  .provide(STORE, createStore({ boards: boards ?? [] }))
  .mount('#dev3d')
const focusRef = params.get('focus')
if (focusRef) setTimeout(() => (window as any).__dev3d.focus(focusRef), 300)
