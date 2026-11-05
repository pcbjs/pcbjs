<script setup lang="ts">
// Selection badges and separate layout actions; Open placement and definition
// only on a page with no editor attached, where a click and an alt-click cannot jump the editor
import { usePane, type BoardInput } from './board'
import { asRange, rangeLabel } from './source'
import { agentLabel } from './agents'
import { isMac } from './context'
import { computed } from 'vue'
import { layoutGroup, editNodeOf, anchorPart } from './selection'
import { jumpButtons } from './edit-client'
import { useChip, MAX_CHIPS } from './use/chip'
import { useActions } from './use/actions'

const props = defineProps<{ board?: BoardInput }>()
const emit = defineEmits<{ isolate: [string]; open: [string, 'placement' | 'definition'] }>()
const ctx = usePane(props.board, ['meta'])
const { board: store } = ctx
const { site: board, contextNet } = useActions(ctx)
const { sel, label, anchorPath, others, gone, ascend, openPlace, openDef, openAnchor, isoName, chipMenu, sendBox, canSend, agentList, openChipMenu, sendToAgent, submitSend } =
  useChip(ctx)
const hoverNet = computed(() => store.hover.net)
const tools = store.edit
const dropMember = (ref: string) => store.dropMember(ref)
const layout = computed(() => (store.site ? layoutGroup(store.site, sel.value) : null))
const locked = computed(() => {
  const b = board.value
  if (!b) return false
  return ctx.pane.mode === 'sch' ? !!b.schematic.drawing?.symbols.find(s => s.ref === anchorPart(b, sel.value))?.locked : !!editNodeOf(b, sel.value.anchor)?.locked
})
/** an editor is attached: a click jumps it to the placement, an alt-click to the definition, so the chip has no jump buttons */
const writable = computed(() => !!board.value?.dev && tools.mode?.mode === 'rw' && !!tools.client && !tools.mismatch && !board.value?.variant?.index)
const editor = computed(() => writable.value && !jumpButtons(tools.mode))
const sourceLinks = computed(() => writable.value || !!board.value?.repo)
const nameTitle = computed(() => (editor.value ? `click: placement, ${isMac ? 'option' : 'alt'}-click: definition` : undefined))
/** A finding as the anchor: its rule and references, with full text reserved for details. */
const finding = computed(() => {
  const b = board.value,
    a = sel.value.anchor
  return b && a ? ([...b.drc, ...b.erc].find(d => d.id === a) ?? null) : null
})

function open(kind: 'placement' | 'definition') {
  if (sel.value.anchor) emit('open', sel.value.anchor, kind)
  openAnchor(kind)
}
</script>

<template>
  <div class="selection-controls" data-ui="PathChip.Selection" data-ui-source="packages/ui/src/PathChip.vue">
    <div v-if="(board || sel.isolate) && (sel.refs.length || sel.isolate || sel.isolateChoice || hoverNet || tools.written)" class="chips-bar" @contextmenu.prevent="openChipMenu">
      <span
        v-if="sel.anchor"
        class="chip path"
        :class="{ stale: gone.has(sel.anchor) }"
        :title="[sel.by === 'editor' ? 'set from the editor' : '', nameTitle ?? ''].filter(Boolean).join('\n') || undefined"
      >
        <template v-for="(s, i) in anchorPath" :key="s.ref"
          ><span v-if="i" class="dim sep" aria-hidden="true">/</span
          ><button class="seg" :disabled="i === anchorPath.length - 1" :title="i < anchorPath.length - 1 ? `Select ${s.label}` : nameTitle" @click="ascend(s.ref)">
            {{ s.label }}
          </button></template
        ><button class="x" title="Remove from the selection" aria-label="Remove" @click="sel.anchor && dropMember(sel.anchor)">×</button>
      </span>
      <span v-if="locked" class="chip" role="status" title="Placement locked in source">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
          <path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7" />
        </svg>
        Locked
      </span>
      <span v-if="finding" class="chip finding" :class="finding.severity" role="note" :title="finding.rule"
        ><b>{{ finding.rule }}</b
        ><span v-if="finding.refs?.length" class="dim"> · {{ finding.refs.join(', ') }}</span></span
      >
      <span v-for="r in others.slice(0, MAX_CHIPS - 1)" :key="r" class="chip" :class="{ stale: gone.has(r) }"
        >{{ label(r) }}<button class="x" title="Remove from the selection" aria-label="Remove" @click="dropMember(r)">×</button></span
      >
      <span
        v-if="others.length > MAX_CHIPS - 1"
        class="chip dim"
        :title="
          others
            .slice(MAX_CHIPS - 1)
            .map(label)
            .join('\n')
        "
        >+{{ others.length - MAX_CHIPS + 1 }}</span
      >
      <span v-if="gone.size" class="chip stale-mark" :title="[...gone].join('\n')">{{ gone.size }} stale</span>
      <span v-if="hoverNet && hoverNet !== contextNet" class="chip net dim">{{ hoverNet }}</span>
      <span v-if="sel.isolate" class="chip layout-state"
        >{{ !layout ? 'Isolated' : sel.isolate.mode === 'instance' ? 'Instance layout' : 'Library layout' }}: {{ isoName ?? sel.isolate.ref }}</span
      >
      <div v-if="chipMenu" class="menu-list chip-menu" role="menu" @pointerdown.stop>
        <button role="menuitem" :disabled="!canSend" :title="ctx.shell?.agents.list.length ? undefined : 'No agent is attached to the session'" @click="sendToAgent">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3" y="5" width="10" height="8" rx="2" />
            <path d="M8 5V2.5M6 9h0M10 9h0" />
          </svg>
          Send to agent…
        </button>
      </div>
      <form v-if="sendBox" class="send-box" @submit.prevent="submitSend" @keydown.esc="sendBox = null" @contextmenu.stop>
        <select v-if="agentList.length > 1" v-model="sendBox.to" aria-label="Agent">
          <option v-for="a in agentList" :key="a.client" :value="a.client">{{ agentLabel(a, sendBox.now) }}</option>
        </select>
        <span v-else class="dim">{{ agentList[0] ? agentLabel(agentList[0], sendBox.now) : '' }}</span>
        <input v-model="sendBox.comment" placeholder="What should the agent do with this?" aria-label="Comment" autofocus />
        <button type="submit">Send</button>
        <button type="button" @click="sendBox = null">Cancel</button>
      </form>
    </div>
    <div
      v-if="layout || (!editor && (openPlace || openDef) && sourceLinks)"
      class="layout-actions"
      data-ui="PathChip.LayoutActions"
      :aria-label="writable ? 'Layout editing' : 'Layout inspection'"
    >
      <button
        v-if="layout"
        type="button"
        class="layout-action"
        :disabled="sel.isolate?.mode === 'instance'"
        @click="store.chooseIsolation('instance')"
        :aria-label="writable ? 'Edit instance layout' : 'View instance layout'"
        data-ui-source="packages/ui/src/PathChip.vue"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path :d="writable ? 'm10.5 2.5 3 3-8 8-4 1 1-4zM9 4l3 3' : 'M1 8s3-4 7-4 7 4 7 4-3 4-7 4-7-4-7-4zM6 8a2 2 0 1 0 4 0 2 2 0 1 0-4 0'" /></svg
        >{{ writable ? 'Edit instance layout' : 'View instance layout' }}
      </button>
      <button
        v-if="layout"
        type="button"
        class="layout-action"
        :disabled="!!sel.isolate && sel.isolate.mode !== 'instance'"
        @click="store.chooseIsolation('library')"
        :aria-label="writable ? 'Edit library layout' : 'View library layout'"
        data-ui-source="packages/ui/src/PathChip.vue"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path :d="writable ? 'm10.5 2.5 3 3-8 8-4 1 1-4zM9 4l3 3' : 'M1 8s3-4 7-4 7 4 7 4-3 4-7 4-7-4-7-4zM6 8a2 2 0 1 0 4 0 2 2 0 1 0-4 0'" /></svg
        >{{ writable ? 'Edit library layout' : 'View library layout' }}
      </button>
      <button v-if="!editor && openPlace && sourceLinks" class="layout-action" :title="rangeLabel(openPlace.file, asRange(openPlace))" @click="open('placement')">
        {{ writable ? 'Open placement' : 'Placement on repository ↗' }}
      </button>
      <button v-if="!editor && openDef && sourceLinks" class="layout-action" :title="rangeLabel(openDef.file, asRange(openDef))" @click="open('definition')">
        {{ writable ? 'Open definition' : 'Definition on repository ↗' }}
      </button>
    </div>
    <div v-if="sel.isolate?.mode === 'library' && store.libraryState === 'loading'" class="selection-status" role="status">Loading library layout…</div>
    <div v-if="sel.isolate?.mode === 'library' && (store.libraryState === 'error' || store.libraryState === 'unsupported')" class="selection-status err" role="alert">
      {{ store.libraryError }} <button v-if="store.libraryState === 'error'" type="button" class="layout-action" @click="store.libraryN++">Retry</button>
    </div>
    <div v-if="tools.written" :key="tools.written.n" class="selection-status" :class="{ err: tools.written.err }" :title="tools.written.text" role="status">
      {{ tools.written.err ? tools.written.text : 'Updated' }}
    </div>
  </div>
</template>
