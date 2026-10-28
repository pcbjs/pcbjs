<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { View } from '../../examples.data'
import BoardSvg from './BoardSvg.vue'
import { claim, release, type Live } from './frames'

export interface Hover {
  ids: number[]
  refs: string[]
  net: string | null
}
type Theme = 'light' | 'dark'

// `armed` keeps the frame live to the pointer; otherwise an overlay takes the wheel and hovers until a click arms it. `tools` false hides the viewer's own toolbars.
const props = defineProps<{
  id: string
  viewer: string
  name: string
  view: View
  label: string
  theme?: Theme
  hover?: Hover
  select?: string | null
  poster?: View
  armed?: boolean
  tools?: boolean
}>()
const emit = defineEmits<{ hover: [Hover]; select: [string | null]; view: [View]; ready: [{ board: string; views: View[] }] }>()

const root = ref<HTMLElement | null>(null)
const frame = ref<HTMLIFrameElement | null>(null)
const src = ref('')
const ready = ref(false)
const dark = ref(false)
const clicked = ref(false)
let near = false
let away: ReturnType<typeof setTimeout> | undefined
let observer: IntersectionObserver | undefined
let themes: MutationObserver | undefined

const theme = (): Theme => props.theme ?? (dark.value ? 'dark' : 'light')
const post = (msg: object) => frame.value?.contentWindow?.postMessage(msg, location.origin)
// plain arrays, since a reactive proxy cannot be cloned into a message
const hoverMsg = (h?: Hover) => ({ type: 'pcbjs:hover', ids: [...(h?.ids ?? [])], refs: [...(h?.refs ?? [])], net: h?.net ?? null })

const slot: Live = {
  near: () => near,
  drop: () => {
    src.value = ''
    ready.value = false
  },
}

function mount() {
  if (src.value) return
  const q = new URLSearchParams({ embed: '1', view: props.view, theme: theme() })
  if (props.select) q.set('select', props.select)
  if (props.tools === false) q.set('tools', '0')
  src.value = `${props.viewer}board/${encodeURIComponent(props.name)}/?${q}`
  claim(slot)
}

function unmount() {
  release(slot)
  slot.drop()
}

function disarm() {
  clearTimeout(away)
  clicked.value = false
}

// the pointer away from the frame's card for a second disarms it
const leave = () => {
  clearTimeout(away)
  away = setTimeout(disarm, 1000)
}
const enter = () => clearTimeout(away)
const escape = (e: KeyboardEvent) => e.key === 'Escape' && disarm()
const loaded = () => frame.value?.contentWindow?.addEventListener('keydown', escape)

function receive(e: MessageEvent) {
  if (!frame.value || e.source !== frame.value.contentWindow) return
  const m = e.data
  if (m?.type === 'pcbjs:ready') {
    ready.value = true
    post({ type: 'pcbjs:view', view: props.view })
    post({ type: 'pcbjs:theme', theme: theme() })
    if (props.hover?.ids.length || props.hover?.refs.length) post(hoverMsg(props.hover))
    emit('ready', { board: m.board, views: m.views })
  } else if (m?.type === 'pcbjs:hover') emit('hover', { ids: m.ids ?? [], refs: m.refs ?? [], net: m.net ?? null })
  else if (m?.type === 'pcbjs:select') emit('select', m.ref ?? null)
  else if (m?.type === 'pcbjs:view') emit('view', m.view)
}

watch(
  () => props.view,
  view => post({ type: 'pcbjs:view', view }),
)
watch([() => props.theme, dark], () => post({ type: 'pcbjs:theme', theme: theme() }))
watch(
  () => props.hover,
  h => post(hoverMsg(h)),
)
watch(
  () => props.select,
  ref => post({ type: 'pcbjs:select', ref: ref ?? null }),
)

onMounted(() => {
  const html = document.documentElement
  dark.value = html.classList.contains('dark')
  themes = new MutationObserver(() => (dark.value = html.classList.contains('dark')))
  themes.observe(html, { attributes: true, attributeFilter: ['class'] })
  window.addEventListener('message', receive)
  window.addEventListener('keydown', escape)
  root.value?.parentElement?.addEventListener('pointerenter', enter)
  root.value?.parentElement?.addEventListener('pointerleave', leave)
  observer = new IntersectionObserver(
    entries => {
      near = entries[entries.length - 1].isIntersecting
      near ? mount() : unmount()
    },
    { rootMargin: '200px' },
  )
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  themes?.disconnect()
  window.removeEventListener('message', receive)
  window.removeEventListener('keydown', escape)
  root.value?.parentElement?.removeEventListener('pointerenter', enter)
  root.value?.parentElement?.removeEventListener('pointerleave', leave)
  clearTimeout(away)
  release(slot)
})
</script>

<template>
  <div ref="root" class="board-frame" :class="{ ready }">
    <div class="poster"><BoardSvg :id="id" :view="poster ?? '2d'" :label="label" lazy /></div>
    <iframe v-if="src" ref="frame" :src="src" :title="label" @load="loaded" />
    <button v-if="!armed && !clicked" type="button" class="cover" :aria-label="`Interact with ${label}`" @click="clicked = true"><span>Click to interact</span></button>
  </div>
</template>

<style scoped>
.board-frame {
  position: relative;
  width: 100%;
  height: 100%;
}
.poster {
  position: absolute;
  inset: 0;
  transition: opacity 0.2s;
}
.poster > .board-svg {
  width: 100%;
  height: 100%;
}
.ready .poster {
  opacity: 0;
}
iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  opacity: 0;
  transition: opacity 0.2s;
}
.ready iframe {
  opacity: 1;
}
.cover {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  width: 100%;
  cursor: pointer;
  background: transparent;
}
.cover span {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  opacity: 0;
  transition: opacity 0.15s;
}
.cover:hover span {
  opacity: 1;
}
</style>
