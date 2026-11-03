<script setup lang="ts">
// The command palette on `/`, every command of the key map with its keys and a search, and the key map overlay on `?`.
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { isMac } from './context'
import { useShell } from './shell'
import { KEYS, dispatched, search, shown } from './keys'

const store = useShell()
const ui = store.page
const q = ref('')
const at = ref(0)
const listId = useId()
const keymap = ref<HTMLElement | null>(null)
let previous: HTMLElement | null = null
const input = ref<HTMLInputElement | null>(null)
const found = computed(() =>
  search(
    q.value,
    KEYS.filter(d => dispatched(d) && d.id !== 'palette'),
  ),
)
const scopes = computed(() => [...new Set(KEYS.map(d => d.scope))].map(s => ({ s, defs: KEYS.filter(d => d.scope === s) })))
const keyText = (keys: string[]) => keys.map(k => shown(k, isMac)).join(' or ')

watch(
  () => ui.palette || ui.keymap,
  open => {
    if (open) {
      previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
      q.value = ''
      at.value = 0
      void nextTick(() => (ui.palette ? input.value : keymap.value)?.focus())
    } else void nextTick(() => previous?.isConnected && previous.focus())
  },
)
function modalKey(e: KeyboardEvent) {
  if (!ui.palette && !ui.keymap) return
  store.commands.forwardModal(e, isMac)
  e.stopImmediatePropagation()
  if (e.key === 'Escape') {
    ui.palette = ui.keymap = false
    e.preventDefault()
  } else if (e.key === 'Tab') {
    e.preventDefault()
    ;(ui.palette ? input.value : keymap.value)?.focus()
  } else if (ui.palette) onKey(e)
}
onMounted(() => window.addEventListener('keydown', modalKey, true))
onUnmounted(() => window.removeEventListener('keydown', modalKey, true))
watch(q, () => (at.value = 0))

function run(id: string) {
  ui.palette = false
  void nextTick(() => store.commands.run(id))
}
function onKey(e: KeyboardEvent) {
  const n = found.value.length
  if (e.key === 'Escape') ui.palette = false
  else if (e.key === 'ArrowDown') at.value = n ? (at.value + 1) % n : 0
  else if (e.key === 'ArrowUp') at.value = n ? (at.value + n - 1) % n : 0
  else if (e.key === 'Enter' && found.value[at.value]) run(found.value[at.value].id)
  else return
  e.preventDefault()
  e.stopPropagation()
}
</script>

<template>
  <div v-if="ui.palette" class="palette-back" @pointerdown.self="ui.palette = false">
    <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <input ref="input" v-model="q" placeholder="Search commands" :aria-controls="listId" :aria-activedescendant="found[at] ? `${listId}-${at}` : undefined" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-label="Search commands" />
      <ul :id="listId" role="listbox">
        <li v-for="(d, i) in found" :key="d.id" :id="`${listId}-${i}`" role="option" :aria-selected="i === at" :class="{ on: i === at }" @pointerenter="at = i" @click="run(d.id)">
          <span class="title">{{ d.title }}</span>
          <kbd>{{ keyText(d.keys) }}</kbd>
        </li>
        <li v-if="!found.length" class="none">No command matches</li>
      </ul>
    </div>
  </div>
  <div v-if="ui.keymap" class="palette-back" @pointerdown.self="ui.keymap = false">
    <div ref="keymap" tabindex="-1" class="palette keymap" role="dialog" aria-modal="true" aria-label="Key map">
      <section v-for="g in scopes" :key="g.s">
        <h3>{{ g.s }}</h3>
        <dl>
          <template v-for="d in g.defs" :key="d.id">
            <dt>
              <kbd>{{ keyText(d.keys) }}</kbd>
            </dt>
            <dd>{{ d.title }}</dd>
          </template>
        </dl>
      </section>
    </div>
  </div>
</template>
