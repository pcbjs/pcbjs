// What View2D, View3D and SchView share: the board's store and pane, the props that drive them and the events that report them.
import { computed, ref, watch } from 'vue'
import { usePane, type BoardInput } from './board'
import { refNet } from '@pcbjs/core/ref'
import { VIEW_FACETS } from './pane'
import { useTheme, type ThemeName } from './theme'
import { siteTarget, targetBox, toWire } from './refs'
import { partOfRef } from './selection'

export type View = import('@pcbjs/core/site-facets').DrawingView
export interface Hover {
  uids: string[]
  refs: string[]
  net: string | null
}
export interface ViewProps {
  board?: BoardInput
  target?: string
  theme?: ThemeName
  /** references in the grammar of refs.md, the first the anchor */
  select?: string[]
  /** references lit as a hover: parts and `net:` names */
  highlight?: string[]
  /** a reference or an area in board mm, x, y, width and height, to frame */
  frame?: string | [number, number, number, number] | null
  /** toolbar, scale and readout; default true */
  tools?: boolean
  /** 'click' takes wheel and drag only after a click into the view; default 'always' */
  arm?: 'always' | 'click'
}
export type ViewEmit = {
  (e: 'update:select', refs: string[]): void
  (e: 'hover', h: Hover): void
  (e: 'ready', r: { view: View }): void
}

export function useView(props: ViewProps, emit: ViewEmit, kind: View) {
  const ctx = usePane(props.board, VIEW_FACETS[kind])
  const { board: store, pane } = ctx
  const board = computed(() => store.site)
  const themeAttrs = ctx.shell ? computed(() => ({})) : useTheme(() => props.theme, ctx.prefs)

  /** The selection as references, the anchor first. */
  const selected = () => {
    const s = store.sel
    return s.anchor ? [s.anchor, ...s.refs.filter(r => r !== s.anchor)] : [...s.refs]
  }
  watch(
    () => [props.select?.join(','), board.value?.name] as const,
    ([text]) => {
      const b = board.value
      if (!b || text === undefined || text === selected().join(',')) return
      const why = store.selectRef(text || null, false)
      if (why) console.warn(`pcbjs: select ${text} on ${b.name}: ${why}`)
    },
    { immediate: true },
  )
  watch(
    () => selected().join(','),
    text => text !== (props.select ?? []).join(',') && emit('update:select', text ? text.split(',') : []),
  )

  watch(
    () => [props.highlight?.join(','), board.value?.name] as const,
    () => {
      if (!props.highlight) return
      store.hover.net = props.highlight.map(refNet).find(n => n !== null) ?? null
      const b = board.value
      store.hover.refs = b ? props.highlight.filter(r => refNet(r) === null).map(r => partOfRef(b, r) ?? r) : []
    },
    { immediate: true },
  )

  watch(
    () => [JSON.stringify(props.frame ?? null), board.value?.name] as const,
    () => {
      const b = board.value,
        f = props.frame
      if (!b || f === undefined) return
      if (f === null) store.frame = null
      else if (Array.isArray(f)) store.frame = { ref: null, box: f }
      else {
        try {
          const t = siteTarget(b, f)
          store.frame = { ref: t.kind === 'part' || t.kind === 'pad' ? t.ref : null, box: targetBox(b, t) }
        } catch (e) {
          console.warn(`pcbjs: frame ${f} on ${b.name}: ${(e as Error).message}`)
        }
      }
    },
    { immediate: true },
  )

  watch(
    () => store.hover.item,
    h => {
      const b = board.value
      emit('hover', (b && toWire(b, h)) || { uids: [], refs: [], net: null })
    },
  )

  // armed on click: until then the wheel scrolls the page and a drag does nothing
  const armed = ref(props.arm !== 'click')
  const listeners = {
    onWheelCapture: (e: WheelEvent) => !armed.value && e.stopPropagation(),
    onPointerdownCapture: (e: PointerEvent) => {
      if (armed.value) return
      armed.value = true
      e.stopPropagation()
    },
    onPointerleave: () => {
      if (props.arm === 'click') armed.value = false
    },
    onPcbjsReady: (e: Event) => emit('ready', { view: (e as CustomEvent<{ view: View }>).detail.view }),
  }
  const root = computed(() => ({
    class: ['pcbjs-ui', 'pcbjs-view', 'stage', { 'no-tools': props.tools === false, unarmed: !armed.value }],
    ...themeAttrs.value,
    ...listeners,
  }))
  const poster = computed(() => (store.ref ? (kind === 'sch' ? (store.ref.poster.sch ?? null) : store.ref.poster['2d']) : null))
  return { ctx, store, pane, board, root, poster }
}
