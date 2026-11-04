<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePane, type BoardInput } from './board'
import { setReady } from './ready'
import { findingDetails } from './finding-details'
import { findingText } from './finding-markdown'
import type { SiteFinding } from '@pcbjs/core/site-data'

const props = defineProps<{ board?: BoardInput }>()
const ctx = usePane(props.board, ['meta', 'findings'])
const store = ctx.board
const root = ref<HTMLElement | null>(null)
const listOpen = ref(true)
const copied = ref<'' | 'ok' | 'fail'>('')
const board = computed(() => store.site)
const findings = computed(() => [...(board.value?.drc ?? []), ...(board.value?.erc ?? [])])
const index = computed(() => findings.value.findIndex(f => f.id === store.sel.finding))
const current = computed(() => findings.value[index.value] ?? null)
const html = computed(() => findingDetails({ board: board.value?.name ?? store.name, finding: current.value }))
const previous = computed(() => findings.value[index.value < 0 ? findings.value.length - 1 : index.value - 1] ?? null)
const next = computed(() => findings.value[index.value < 0 ? 0 : index.value + 1] ?? null)
let copyTimer: ReturnType<typeof setTimeout> | undefined
let pending: string | null = null
let mounted = false
let selecting = false
let paintedFinding: string | null = null

function focus(f: SiteFinding | null) {
  if (f) store.focusFinding(f)
}
function listKey(event: KeyboardEvent, at: number) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const to =
    event.key === 'ArrowDown'
      ? Math.min(at + 1, findings.value.length - 1)
      : event.key === 'ArrowUp'
        ? Math.max(at - 1, 0)
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? findings.value.length - 1
            : null
  if (to === null) return
  event.preventDefault()
  event.stopPropagation()
  focus(findings.value[to])
  root.value?.querySelectorAll<HTMLButtonElement>('.finding-row')[to]?.focus({ preventScroll: true })
}
function choose(refs: string[]) {
  const f = current.value
  if (!f) return
  const allowed = new Set(f.refs)
  const chosen = [...new Set(refs.filter(ref => allowed.has(ref)))]
  store.setSel({ ...store.sel, finding: f.id, refs: chosen.length ? chosen : [f.id], anchor: chosen.at(-1) ?? f.id })
}
function click(event: MouseEvent) {
  const el = (event.target as Element).closest<HTMLElement>('[data-ref]')
  if (!el || !root.value?.contains(el)) return
  const selection = window.getSelection()
  if (event.detail > 0 && !selection?.isCollapsed) return
  if (event.detail === 0) selection?.removeAllRanges()
  const ref = el.dataset.ref!
  const selected = store.sel.refs.filter(ref => current.value?.refs.includes(ref))
  choose(event.ctrlKey || event.metaKey ? (selected.includes(ref) ? selected.filter(r => r !== ref) : [...selected, ref]) : [ref])
}
function selectRange() {
  selecting = false
  if (!mounted) return
  const selection = window.getSelection()
  const body = root.value?.querySelector('#finding-details')
  if (!selection || selection.isCollapsed || !body || !selection.rangeCount || !body.contains(selection.anchorNode) || !body.contains(selection.focusNode)) return
  const refs = [...body.querySelectorAll<HTMLElement>('[data-ref]')]
    .filter(el => Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)).some(range => range.intersectsNode(el)))
    .map(el => el.dataset.ref!)
  choose(refs)
}
function selectionChanged() {
  if (!selecting) {
    selecting = true
    queueMicrotask(selectRange)
  }
}
function revealIn(container: HTMLElement | null | undefined, item: HTMLElement | null) {
  if (!container || !item) return
  const bounds = container.getBoundingClientRect(),
    rect = item.getBoundingClientRect()
  const top = bounds.top + container.clientTop,
    bottom = top + container.clientHeight
  container.scrollTop += rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0
}
async function paint() {
  await nextTick()
  if (!mounted) return
  let anchor: HTMLElement | null = null
  for (const el of root.value?.querySelectorAll<HTMLElement>('[data-ref]') ?? []) {
    const selected = store.sel.refs.includes(el.dataset.ref!)
    el.classList.toggle('selected', selected)
    el.classList.toggle('anchor', el.dataset.ref === store.sel.anchor)
    el.setAttribute('aria-pressed', String(selected))
    if (el.dataset.ref === store.sel.anchor) anchor = el
  }
  const finding = current.value?.id ?? null
  if (paintedFinding !== finding) {
    const body = root.value?.querySelector<HTMLElement>('.finding-details')
    if (body) body.scrollTop = 0
    paintedFinding = finding
  } else revealIn(root.value?.querySelector<HTMLElement>('.finding-details'), anchor)
  revealIn(root.value?.querySelector<HTMLElement>('#checks-list'), root.value?.querySelector<HTMLElement>('.finding-row.on') ?? null)
  setReady('checks', root.value)
}
function copyResult(ok: boolean) {
  if (!mounted) return
  copied.value = ok ? 'ok' : 'fail'
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => (copied.value = ''), 1800)
}
async function copy() {
  const f = current.value
  if (!f) return
  const text = findingText(f, board.value?.name ?? store.name)
  if (ctx.shell?.ide.on && window.parent !== window) {
    pending = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    window.parent.postMessage({ type: 'pcbjs:copy-markdown', id: pending, text }, '*')
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      pending = null
      copyResult(false)
    }, 5000)
    return
  }
  let ok = false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      ok = true
    }
  } catch {
    /* Plain HTTP can require the document copy fallback. */
  }
  if (!ok) {
    const active = document.activeElement as HTMLElement | null
    const selection = window.getSelection()
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : []
    const area = document.createElement('textarea')
    area.value = text
    area.readOnly = true
    area.style.cssText = 'position:fixed;left:-10000px;top:0'
    document.body.append(area)
    try {
      area.select()
      ok = document.execCommand('copy')
    } catch {
      ok = false
    } finally {
      area.remove()
      active?.focus({ preventScroll: true })
      selection?.removeAllRanges()
      for (const range of ranges) selection?.addRange(range)
    }
  }
  copyResult(ok)
}
function message(event: MessageEvent) {
  const msg = event.data
  if (event.source !== window.parent || !pending || msg?.type !== 'pcbjs:copied-markdown' || msg.id !== pending) return
  pending = null
  copyResult(msg.ok === true)
}
watch(
  () => [current.value?.id, board.value?.variant?.name],
  () => {
    pending = null
    copied.value = ''
    clearTimeout(copyTimer)
  },
)
watch(() => [store.site, store.sel.finding, store.sel.anchor, store.sel.refs.join('\0')], paint)
onMounted(() => {
  mounted = true
  document.addEventListener('selectionchange', selectionChanged)
  window.addEventListener('message', message)
  void paint()
})
onBeforeUnmount(() => {
  mounted = false
  pending = null
  clearTimeout(copyTimer)
  document.removeEventListener('selectionchange', selectionChanged)
  window.removeEventListener('message', message)
})
</script>

<template>
  <div ref="root" class="checks-view" :class="{ 'list-closed': !listOpen }">
    <div class="checks-toolbar">
      <button class="icon" title="Toggle findings" aria-label="Toggle findings" :aria-expanded="listOpen" aria-controls="checks-list" @click="listOpen = !listOpen">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12v10H2zM6 3v10" /></svg>
      </button>
      <span class="checks-title"
        >Checks <span class="dim">{{ findings.length }}</span></span
      >
      <button class="icon" :title="index < 0 ? 'Last finding' : 'Previous finding'" aria-label="Previous finding" :disabled="!previous" @click="focus(previous)">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 3-5 5 5 5" /></svg>
      </button>
      <span class="checks-count">{{ index < 0 ? '—' : index + 1 }} / {{ findings.length }}</span>
      <button class="icon" :title="index < 0 ? 'First finding' : 'Next finding'" aria-label="Next finding" :disabled="!next" @click="focus(next)">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
      </button>
      <button id="copy-markdown" class="icon copy-markdown" title="Copy as Markdown" aria-label="Copy as Markdown" :disabled="!current" :data-status="copied" @click="copy">
        <svg v-if="copied === 'ok'" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg
        ><svg v-else-if="copied === 'fail'" viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6M11 5l-6 6" /></svg
        ><svg v-else class="codicon-copy" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3 5V12.73C2.4 12.38 2 11.74 2 11V5C2 2.79 3.79 1 6 1H9C9.74 1 10.38 1.4 10.73 2H6C4.35 2 3 3.35 3 5ZM11 15H6C4.897 15 4 14.103 4 13V5C4 3.897 4.897 3 6 3H11C12.103 3 13 3.897 13 5V13C13 14.103 12.103 15 11 15ZM12 5C12 4.448 11.552 4 11 4H6C5.448 4 5 4.448 5 5V13C5 13.552 5.448 14 6 14H11C11.552 14 12 13.552 12 13V5Z"
          />
        </svg>
      </button>
      <span class="sr-only" role="status" aria-live="polite">{{ copied === 'ok' ? 'Copied as Markdown.' : copied === 'fail' ? 'Unable to copy Markdown.' : '' }}</span>
    </div>
    <div class="checks-body">
      <nav v-show="listOpen" id="checks-list" aria-label="DRC and ERC findings">
        <p v-if="!findings.length" class="dim checks-empty">No DRC or ERC findings for this target.</p>
        <button
          v-for="(f, at) in findings"
          :key="f.id"
          class="finding-row"
          :tabindex="at === (index < 0 ? 0 : index) ? 0 : -1"
          @keydown="listKey($event, at)"
          :data-finding="f.id"
          :class="{ on: current?.id === f.id }"
          :aria-current="current?.id === f.id ? 'true' : undefined"
          :title="f.rule"
          @click="focus(f)"
        >
          <span class="row-head"
            ><span class="pill sm" :class="f.severity === 'error' ? 'err' : f.severity === 'warning' ? 'warn' : 'info'">{{ f.severity }}</span
            ><strong>{{ f.rule }}</strong
            ><span class="dim">{{ f.kind.toUpperCase() }}</span></span
          ><span v-if="f.refs.length" class="row-refs">{{ f.refs.join(', ') }}</span>
        </button>
      </nav>
      <main id="finding-details" class="finding-details" @click="click">
        <p v-if="!current" class="dim checks-empty">{{ findings.length ? 'Choose a finding, or use Next finding to begin.' : 'No finding is focused.' }}</p>
        <div v-else v-html="html" />
      </main>
    </div>
  </div>
</template>

<style scoped>
.checks-view {
  position: absolute;
  inset: 0;
  padding-top: 44px;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  color: var(--fg);
  font: 13px/1.55 var(--font, system-ui);
  min-width: 0;
}
.checks-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
}
.checks-toolbar .icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.checks-toolbar .icon:hover:not(:disabled) {
  background: var(--hover);
}
.checks-toolbar .icon:disabled {
  opacity: 0.35;
  cursor: default;
}
.checks-toolbar .icon svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.25;
}
.checks-toolbar .codicon-copy {
  fill: currentColor !important;
  stroke: none !important;
}
.checks-toolbar .icon:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.checks-title {
  font-weight: 600;
  flex: 1;
  min-width: 0;
}
.checks-title .dim {
  font-weight: 400;
  margin-left: 6px;
}
.checks-count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--dim);
}
.copy-markdown[data-status='ok'] {
  color: var(--ok);
}
.copy-markdown[data-status='fail'] {
  color: var(--err);
}
.checks-body {
  display: grid;
  grid-template-columns: minmax(180px, 250px) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.list-closed .checks-body {
  grid-template-columns: minmax(0, 1fr);
}
#checks-list {
  overflow: auto;
  border-right: 1px solid var(--line);
  padding: 8px;
  min-width: 0;
}
.finding-row {
  display: block;
  text-align: left;
  width: 100%;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.finding-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.finding-row:hover {
  background: var(--hover);
}
.finding-row.on {
  background: var(--accent-bg);
  border-color: var(--accent);
}
.row-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}
.row-head strong {
  font-size: 12px;
  font-weight: 500;
}
.row-head > .dim {
  font-size: 10px;
}
.row-refs {
  display: block;
  margin-top: 5px;
  color: var(--dim);
  font:
    11px/1.5 ui-monospace,
    monospace;
  overflow-wrap: anywhere;
}
.finding-details {
  padding: 26px 28px 48px;
  min-width: 0;
  overflow: auto;
  overflow-wrap: anywhere;
}
.checks-empty {
  padding: 12px;
}
.dim {
  color: var(--dim);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
}
.finding-details :deep(h1) {
  font-size: 23px;
  line-height: 1.25;
  margin: 14px 0 12px;
  font-weight: 600;
}
.finding-details :deep(h2) {
  font-size: 13px;
  margin: 0 0 14px;
  font-weight: 600;
}
.finding-details :deep(h3) {
  font-size: 12px;
  margin: 20px 0 8px;
  font-weight: 600;
}
.finding-details :deep(section) {
  margin-top: 25px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
.finding-details :deep(p) {
  margin: 0 0 12px;
}
.finding-details :deep(.message) {
  white-space: pre-wrap;
  font-size: 14px;
  line-height: 1.7;
}
.finding-details :deep(.muted) {
  color: var(--dim);
  font-size: 12px;
}
.finding-details :deep(.eyebrow) {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--dim);
  font-size: 12px;
}
.finding-details :deep(.severity) {
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 11px;
  background: var(--hover);
}
.finding-details :deep(.severity.error) {
  color: var(--err);
}
.finding-details :deep(.severity.warning) {
  color: var(--warn);
}
.finding-details :deep(dl) {
  display: grid;
  grid-template-columns: minmax(80px, 140px) minmax(0, 1fr);
  gap: 7px 16px;
  margin: 0;
}
.finding-details :deep(dt) {
  color: var(--dim);
}
.finding-details :deep(dd) {
  margin: 0;
  min-width: 0;
}
.finding-details :deep(dd dl) {
  grid-template-columns: minmax(65px, 110px) minmax(0, 1fr);
}
.finding-details :deep(ol) {
  margin: 0;
  padding-left: 20px;
}
.finding-details :deep(li + li) {
  margin-top: 13px;
}
.finding-details :deep(code) {
  font:
    12px/1.6 ui-monospace,
    monospace;
  white-space: pre-wrap;
}
.finding-details :deep(.measurements) {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.finding-details :deep(.measurements > div) {
  min-width: 130px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.finding-details :deep(.measurements span) {
  display: block;
  font-size: 11px;
  color: var(--dim);
}
.finding-details :deep(.measurements strong) {
  display: block;
  font-size: 18px;
  font-weight: 500;
  margin-top: 3px;
}
.finding-details :deep(.entities) {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.finding-details :deep(.entity) {
  user-select: text;
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 7px 11px;
  color: inherit;
  background: var(--hover);
  cursor: pointer;
}
.finding-details :deep(.entity.selected) {
  border-color: var(--accent);
  background: var(--accent-bg);
}
.finding-details :deep(.entity.anchor) {
  box-shadow: inset 0 -2px var(--accent);
}
.finding-details :deep(.entity:focus-visible) {
  outline: 2px solid var(--accent);
}
.finding-details :deep(.table) {
  max-width: 100%;
  overflow-x: auto;
}
.finding-details :deep(table) {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-variant-numeric: tabular-nums;
}
.finding-details :deep(th),
.finding-details :deep(td) {
  padding: 7px 10px;
  border-bottom: 1px solid var(--line);
}
.finding-details :deep(th) {
  font-size: 11px;
  color: var(--dim);
  font-weight: 500;
}
@media (max-width: 600px) {
  .checks-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(90px, 28%) minmax(0, 1fr);
  }
  .list-closed .checks-body {
    grid-template-rows: minmax(0, 1fr);
  }
  #checks-list {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .finding-details {
    padding: 20px 16px 32px;
  }
  .finding-details :deep(dl) {
    grid-template-columns: 90px minmax(0, 1fr);
    gap: 6px 10px;
  }
  .finding-details :deep(dd dl) {
    display: block;
  }
  .checks-toolbar {
    gap: 3px;
    padding: 8px;
  }
  .checks-title .dim {
    display: none;
  }
}
@media (forced-colors: active) {
  .finding-details :deep(.entity.selected),
  .finding-row.on {
    outline: 2px solid Highlight;
  }
}
</style>
