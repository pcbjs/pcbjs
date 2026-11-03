<script setup lang="ts">
// Selection badges and separate layout actions; Open placement and definition
// only on a page with no editor attached, where a click and an alt-click cannot jump the editor
import { usePane, type BoardInput } from './board'
import { asRange, rangeLabel } from './source'
import { agentLabel } from './agents'
import { isMac } from './context'
import { computed } from 'vue'
import { anchorGroup } from './selection'
import { jumpButtons } from './edit-client'
import { useChip, MAX_CHIPS } from './use/chip'
import { useActions } from './use/actions'

const props = defineProps<{ board?: BoardInput }>()
const emit = defineEmits<{ isolate: [string]; open: [string, 'placement' | 'definition'] }>()
const ctx = usePane(props.board, ['meta'])
const { board: store } = ctx
const { site: board, contextNet } = useActions(ctx)
const { sel, label, anchorPath, others, gone, ascend, openPlace, openDef, openAnchor, isoLabel, chipMenu, sendBox, canSend, agentList, openChipMenu, sendToAgent, submitSend } =
  useChip(ctx)
const hoverNet = computed(() => store.hover.net)
const tools = store.edit
const dropMember = (ref: string) => store.dropMember(ref)
const layout = computed(() => sel.value.isolate ?? sel.value.isolateChoice ?? (board.value ? anchorGroup(board.value, sel.value) : null))
/** an editor is attached: a click jumps it to the placement, an alt-click to the definition, so the chip has no jump buttons */
const editor = computed(() => !jumpButtons(tools.mode))
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
    <span v-if="finding" class="chip finding" :class="finding.severity" role="note" :title="finding.rule"
      ><b>{{ finding.rule }}</b><span v-if="finding.refs?.length" class="dim"> · {{ finding.refs.join(', ') }}</span></span
    >
    <span v-for="r in others.slice(0, MAX_CHIPS - 1)" :key="r" class="chip" :class="{ stale: gone.has(r) }"
      >{{ label(r) }}<button class="x" title="Remove from the selection" aria-label="Remove" @click="dropMember(r)">×</button></span
    >
    <span v-if="others.length > MAX_CHIPS - 1" class="chip dim" :title="others.slice(MAX_CHIPS - 1).map(label).join('\n')">+{{ others.length - MAX_CHIPS + 1 }}</span>
    <span v-if="gone.size" class="chip stale-mark" :title="[...gone].join('\n')">{{ gone.size }} stale</span>
    <span v-if="hoverNet && hoverNet !== contextNet" class="chip net dim">{{ hoverNet }}</span>
    <span v-if="sel.isolate" class="chip layout-state">{{ sel.isolate.mode === 'instance' ? 'Instance layout' : 'Library layout' }}: {{ isoLabel?.def ?? sel.isolate.ref }}</span>
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
  <div v-if="(layout) || (!editor && (openPlace || openDef) && (board?.dev || board?.repo))" class="layout-actions" data-ui="PathChip.LayoutActions" aria-label="Layout editing">
    <button v-if="layout" type="button" class="layout-action" :disabled="sel.isolate?.mode === 'instance'" @click="store.chooseIsolation('instance')" aria-label="Edit instance layout" data-ui-source="packages/ui/src/PathChip.vue"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m10.5 2.5 3 3-8 8-4 1 1-4zM9 4l3 3" /></svg>Instance layout</button>
    <button v-if="layout" type="button" class="layout-action" :disabled="!!sel.isolate && sel.isolate.mode !== 'instance'" @click="store.chooseIsolation('library')" aria-label="Edit library layout" data-ui-source="packages/ui/src/PathChip.vue"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m10.5 2.5 3 3-8 8-4 1 1-4zM9 4l3 3" /></svg>Library layout</button>
    <button v-if="!editor && openPlace && (board?.dev || board?.repo)" class="layout-action" :title="rangeLabel(openPlace.file, asRange(openPlace))" @click="open('placement')">
      Open placement
    </button>
    <button v-if="!editor && openDef && (board?.dev || board?.repo)" class="layout-action" :title="rangeLabel(openDef.file, asRange(openDef))" @click="open('definition')">
      Open definition
    </button>
  </div>
  <div v-if="sel.isolate?.mode === 'library' && store.libraryState === 'loading'" class="selection-status" role="status">Loading library layout…</div>
  <div v-if="sel.isolate?.mode === 'library' && store.libraryState === 'error'" class="selection-status err" role="alert">{{ store.libraryError }} <button type="button" class="layout-action" @click="store.libraryN++">Retry</button></div>
  <div v-if="tools.written" :key="tools.written.n" class="selection-status" :class="{ err: tools.written.err }" :title="tools.written.text" role="status">{{ tools.written.err ? tools.written.text : 'Updated' }}</div>
  </div>
</template>
