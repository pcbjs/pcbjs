<script setup lang="ts">
// the DRC or ERC findings with pill, rule, refs and place; a click focuses one and the views pan to it
import { computed, watch } from 'vue'
import { usePane, type BoardInput } from './board'
import { BROKEN_ICON, labelOf } from './finding-marks'
import { failedLeg, findingTitle, pillOf, useFindings, useTargets } from './use/findings'
import { mm } from './format'

const props = defineProps<{
  board?: BoardInput
  /** the checks listed; by default the one the viewer's tab shows */
  kinds?: ('drc' | 'erc')[]
  /** the finding in focus, by id */
  focus?: string | null
}>()
const emit = defineEmits<{ 'update:focus': [string | null] }>()
const ctx = usePane(props.board, ['meta', 'findings'])
const { board: store, pane } = ctx
const board = computed(() => store.site)
const activeRef = computed(() => store.activeRef)
const { multi, stripRows, targetHref, onTargetLink } = useTargets(ctx)
const { erc, gotoFinding, gotoDrc, blockersOf, gotoBlocker } = useFindings(ctx)

const shows = (k: 'drc' | 'erc') => (props.kinds ? props.kinds.includes(k) : (k === 'erc') === (pane.tab === 'erc'))
watch(
  () => store.finding?.id ?? null,
  id => id !== (props.focus ?? null) && emit('update:focus', id),
)
watch(
  () => props.focus,
  id => {
    const b = board.value
    const d = id && b ? [...b.drc, ...b.erc].find(m => m.id === id) : null
    if (d && store.finding?.id !== id) gotoFinding(d)
  },
)
</script>

<template>
  <div v-if="board" class="panel">
    <div v-if="multi" class="target-strip" role="group" aria-label="Fab targets">
      <a v-for="t in stripRows" :key="t.name" :class="{ on: t.on }" :aria-current="t.on ? 'page' : undefined" :href="targetHref(t.name)" @click="onTargetLink($event, t.name)">
        <span class="dot" :class="t.state"></span><span class="name">{{ t.name }}</span
        ><span class="dim">{{ t.text }}</span>
      </a>
    </div>
    <template v-if="shows('erc')">
      <div v-if="!erc" class="empty">No ERC data in this build</div>
      <div v-else-if="!erc.length" class="empty">No findings</div>
      <button
        v-for="(d, i) in erc ?? []"
        :key="d.id ?? i"
        class="drcrow"
        :class="{ on: !!d.id && store.finding?.id === d.id, stale: !!d.id && store.stale.findings.has(d.id) }"
        :title="findingTitle(d)"
        @click="gotoFinding(d)"
      >
        <span class="line1"
          ><span class="pill sm" :class="pillOf(d.severity)">{{ d.severity }}</span
          ><span class="rule">{{ d.rule }}</span
          ><span v-if="d.layer" class="dim">{{ d.layer }}</span></span
        >
        <span v-if="d.refs?.length" class="refs">{{ d.refs.join(', ') }}</span>
        <span v-if="d.at && (d.at[0] || d.at[1])" class="at">{{ mm(d.at[0]) }}, {{ mm(d.at[1]) }} mm</span>
      </button>
    </template>
    <template v-if="shows('drc')">
      <div v-if="!board.drc.length" class="empty">
        No findings<template v-if="board.unconnected">, {{ board.unconnected }} unconnected</template>
      </div>
      <template v-for="(d, i) in board.drc" :key="d.id ?? i">
        <div
          v-if="failedLeg(d)"
          class="drcrow route-failed"
          :class="{ on: !!d.id && store.finding?.id === d.id, stale: !!d.id && store.stale.findings.has(d.id) }"
          :title="findingTitle(d)"
          role="button"
          tabindex="0"
          @click="gotoFinding(d)"
          @keydown.enter.self="gotoFinding(d)"
        >
          <span class="line1"
            ><span class="pill sm err">{{ d.severity }}</span
            ><span class="rule">{{ d.rule }}</span
            ><span v-if="failedLeg(d)!.net" class="dim">{{ failedLeg(d)!.net }}</span
            ><span v-if="failedLeg(d)!.leg" class="dim">{{ failedLeg(d)!.leg }}</span></span
          >
          <span class="ends">
            <template v-for="(e, k) in failedLeg(d)!.ends" :key="k"
              ><span v-if="k" class="dim">to</span
              ><button class="link" title="Zoom to this end" @click.stop="gotoDrc(e.at)">{{ mm(e.at[0]) }}, {{ mm(e.at[1]) }} {{ e.layer }}</button></template
            >
          </span>
          <span v-if="blockersOf(d).length" class="blockers"
            ><span class="dim">blocked by</span>
            <button
              v-for="b in blockersOf(d)"
              :key="b.key"
              class="pin"
              :class="{ on: !!b.ref && activeRef === b.ref }"
              :title="b.ref ? `Select ${b.ref}` : 'Zoom to it'"
              @click.stop="gotoBlocker(b)"
            >
              {{ b.label }}
            </button>
          </span>
        </div>
        <button
          v-else
          class="drcrow"
          :class="{ on: !!d.id && store.finding?.id === d.id, stale: !!d.id && store.stale.findings.has(d.id) }"
          :title="findingTitle(d)"
          @click="gotoFinding(d)"
        >
          <span class="line1"
            ><span class="pill sm" :class="pillOf(d.severity)">{{ d.severity }}</span
            ><span v-if="labelOf(d).broken" class="rule broken-net" :class="pillOf(d.severity)" :title="d.rule"
              ><svg viewBox="0 0 12 12" aria-label="unconnected"><path :d="BROKEN_ICON" /></svg>{{ labelOf(d).text }}</span
            ><span v-else class="rule">{{ d.rule }}</span
            ><span v-if="d.layer" class="dim">{{ d.layer }}</span></span
          >
            <span v-if="d.refs?.length" class="refs">{{ d.refs.join(', ') }}</span>
          <span v-if="d.at" class="at">{{ mm(d.at[0]) }}, {{ mm(d.at[1]) }} mm</span>
        </button>
      </template>
    </template>
  </div>
</template>
