<script setup lang="ts">
import Bubble from './Bubble.vue'
import LockButton from './LockButton.vue'
import { usePlacementLock } from './use/placement-lock'
import { computed, ref } from 'vue'
import type { EditUpdate } from '@pcbjs/core/protocol'
import type { useGesture } from './gesture'
import type { useAssist2d } from './assist2d'
import { injectPane } from './context'
import { typedPoint } from './dots'
import { TRACE_METHODS, gridChoices, lengthValue, angleValue, localPose, worldDelta, segmentIndices } from './edit-toolbar'

const props = defineProps<{ tl: ReturnType<typeof useGesture>; as: ReturnType<typeof useAssist2d>; chip: { x: number; y: number } }>()
const ctx = injectPane()!
const lock = usePlacementLock(ctx)
const store = ctx.board
const edit = store.edit
const node = computed(() => props.tl.node.value)
const trace = computed(() => node.value?.caps.includes('chain') || (props.as.on.value && props.as.ctx.value?.command !== 'at'))
const step = computed(() => {
  const n = node.value
  if (!n?.steps) return null
  const picked = /\/pt:(\d+)$/.exec(store.sel.anchor ?? '')
  const leg = /\/leg:(\d+)$/.exec(store.sel.anchor ?? '')
  const index = picked
    ? +picked[1] - 1
    : leg
      ? (n.steps.map((s, i) => (s.op === 'X' ? i : -1)).filter(i => i >= 0)[+leg[1] - 1] ?? -1)
      : n.steps.findIndex(s => /^[HhVvLlAaXZ]$/.test(s.op))
  return index >= 0 ? { index, command: n.steps[index]?.op ?? 'L', anchor: `${n.ref}/pt:${index + 1}` } : null
})
const command = computed(() => (props.as.on.value ? (props.as.ctx.value?.command ?? 'L') : (step.value?.command ?? 'L')))
const relative = computed(() => /^[hvla]$/.test(command.value))
const methods = computed(() => TRACE_METHODS.map(m => ({ ...m, raw: relative.value && /^[HVLA]$/.test(m.value) ? m.value.toLowerCase() : m.value })))
const layers = computed(() => store.site?.layers.filter(l => l.kind === 'copper') ?? [])
const currentLayer = computed(() => (props.as.on.value ? (props.as.ctx.value?.layer ?? 'F.Cu') : (node.value?.steps?.[step.value?.index ?? 0]?.layer ?? 'F.Cu')))
const literalStep = computed(() => !!step.value && !!node.value?.steps?.[step.value.index]?.src)
const canTrace = computed(
  () =>
    !!edit.client &&
    edit.mode?.mode === 'rw' &&
    (node.value?.caps.includes('chain') ? props.tl.rw.value && literalStep.value && !!props.tl.targets('point').refs.length : props.as.on.value),
)
const segments = computed(() => segmentIndices(node.value?.steps ?? []))
const segmentPosition = computed(() => segments.value.indexOf(step.value?.index ?? -1))
function selectSegment(position: number) {
  const index = segments.value[position]
  if (index === undefined || !node.value) return
  const anchor = `${node.value.ref}/pt:${index + 1}`
  store.setSel({ ...store.sel, refs: [anchor], anchor })
}
async function deleteSegment() {
  if (!step.value || !node.value) return
  const previous = segments.value[segmentPosition.value - 1],
    next = segments.value[segmentPosition.value + 1],
    count = segments.value.length,
    stepCount = node.value.steps!.length
  const route = node.value.ref
  const result = await props.tl.oneShot('point', { remove: true }, step.value.anchor)
  if (!result?.written.some(w => w.applied)) return
  if (!(await props.tl.waitForSteps(route, stepCount - 1))) {
    store.note('Waiting for the updated trace before selecting its next primitive', true)
    return
  }
  const anchor = count <= 1 ? route : `${route}/pt:${previous === undefined ? next : previous + 1}`
  store.setSel({ ...store.sel, refs: [anchor], anchor })
}
const title = computed(() => [edit.note, props.tl.banner.value].filter(Boolean).join('; '))
async function traceEdit(update: EditUpdate) {
  if (!canTrace.value) return
  if (!props.as.on.value) return props.tl.oneShot('point', update, step.value!.anchor)
  const a = props.as.ctx.value!
  const endpoint = update.command ? typedPoint(a) : null
  let txn: string | undefined
  try {
    txn = (
      await edit.client!.begin({
        board: store.name,
        run: store.run,
        tool: 'assist',
        refs: [],
        anchor: 'assist',
        isolate: store.sel.isolate?.mode === 'instance' ? null : store.sel.isolate?.ref,
      })
    ).txn
    await edit.client!.update(txn, { ...update, ...(endpoint ? { point: { at: endpoint } } : {}) })
    const result = await edit.client!.commit(txn)
    if (result.error) store.note(result.error, true)
  } catch (error) {
    if (txn) await edit.client!.cancel(txn).catch(() => {})
    store.note(String(error), true)
  }
}
const chooseMethod = (event: Event) => traceEdit({ command: (event.target as HTMLSelectElement).value as EditUpdate['command'] })
const chooseRelative = (event: Event) =>
  traceEdit({ command: ((event.target as HTMLInputElement).checked ? command.value.toLowerCase() : command.value.toUpperCase()) as EditUpdate['command'] })
const place = computed(() => props.tl.targets('move').node ?? (node.value?.caps.includes('placed') ? node.value : null))
const canPlace = computed(() => props.tl.rw.value && !!props.tl.targets('move').refs.length)
const coordinates = computed(() => (place.value ? localPose(place.value) : null))
const pitches = computed(() => gridChoices(props.tl.sourceGrid.value.pitch))
const posePending = ref(false)
const poseValue = (axis: 0 | 1 | 2) => `${coordinates.value?.[axis] ?? 0}${axis === 2 ? '°' : 'mm'}`
function resetPose(event: Event, axis: 0 | 1 | 2) {
  const input = event.target as HTMLInputElement
  input.value = poseValue(axis)
  input.setCustomValidity('')
}
async function writePose(tool: 'move' | 'rotate', update: EditUpdate, event: Event, axis: 0 | 1 | 2) {
  const owner = place.value,
    input = event.target as HTMLInputElement
  const restore = () => {
    if (input.isConnected && place.value === owner) resetPose(event, axis)
  }
  posePending.value = true
  try {
    const result = await props.tl.oneShot(tool, update)
    if (!result?.written.some(w => w.applied)) restore()
  } catch (error) {
    store.note(String(error), true)
    restore()
  } finally {
    posePending.value = false
  }
}
function coordinate(axis: 0 | 1, event: Event) {
  const input = event.target as HTMLInputElement,
    value = lengthValue(input.value),
    at = coordinates.value
  if (value === null || !at) {
    input.setCustomValidity('Enter a length such as 10mm or 100mil')
    input.reportValidity()
    return
  }
  input.setCustomValidity('')
  const delta: [number, number] = [0, 0]
  delta[axis] = value - at[axis]
  void writePose('move', { delta: worldDelta(place.value!, delta), free: true }, event, axis)
}
function rotation(event: Event) {
  const input = event.target as HTMLInputElement,
    value = angleValue(input.value),
    at = props.tl.targets('rotate').node?.at
  if (value === null || !at) {
    input.setCustomValidity('Enter an angle such as 90deg or 1.57rad')
    input.reportValidity()
    return
  }
  input.setCustomValidity('')
  void writePose(
    'rotate',
    { angle: (value - (coordinates.value?.[2] ?? at[2])) * (place.value!.m[0] * place.value!.m[3] - place.value!.m[1] * place.value!.m[2] < 0 ? -1 : 1), free: true },
    event,
    2,
  )
}
const gridPending = ref(false)
async function grid(event: Event) {
  const input = event.target as HTMLSelectElement,
    pitch = Number(input.value)
  if (trace.value) {
    props.tl.gridPitch.value = pitch
    props.tl.snapOverride.value = null
    return
  }
  gridPending.value = true
  try {
    await props.tl.oneShot('move', { grid: pitch })
  } finally {
    gridPending.value = false
    input.value = String(props.tl.sourceGrid.value.pitch)
  }
}
function snap(event: Event) {
  props.tl.snapOverride.value = (event.target as HTMLInputElement).checked
}
</script>

<template>
  <div
    v-if="tl.tools.value.length || as.on.value || lock.visible.value"
    class="bv-edit"
    data-ui="EditBar"
    data-ui-source="packages/ui/src/EditBar.vue"
    role="toolbar"
    :aria-label="trace ? 'Trace' : 'Placement'"
    :title="title"
  >
    <span class="edit-mode"
      ><svg viewBox="0 0 16 16" aria-hidden="true">
        <path v-if="trace" d="M2 12h4l4-8h4" />
        <path v-else d="M8 1v14M1 8h14M8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10" /></svg
      >{{ trace ? 'Trace' : 'Placement' }}</span
    >
    <LockButton v-if="!trace" :control="lock" />
    <template v-if="trace && !as.ends.value">
      <select
        :value="command"
        aria-label="Trace primitive"
        :title="canTrace ? 'Trace primitive; uppercase absolute, lowercase relative' : 'This generated trace has no editable primitive in the source'"
        :disabled="!canTrace"
        @change="chooseMethod"
      >
        <option
          v-for="method in methods"
          :key="method.value"
          :value="method.raw"
          :title="method.description"
          :disabled="method.value === 'Z' && !!step && step.index < (node?.steps?.length ?? 0) - 1"
        >
          {{ method.label.slice(0, -1) + method.raw }}
        </option>
      </select>
      <label title="Lowercase primitives use offsets from the previous endpoint"
        ><input type="checkbox" :checked="relative" :disabled="!canTrace || !/^[HhVvLlAa]$/.test(command)" @change="chooseRelative" />Relative</label
      >
      <select
        :value="currentLayer"
        aria-label="Trace layer"
        title="Layer of this route stage; via transitions delimit stages"
        :disabled="!canTrace"
        @change="traceEdit({ layer: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="layer in layers" :key="layer.id" :value="layer.id">{{ layer.id }}</option>
      </select>
      <template v-if="step && node?.caps.includes('chain')">
        <button class="icon" aria-label="Previous trace segment" title="Previous trace segment" :disabled="segmentPosition <= 0" @click="selectSegment(segmentPosition - 1)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 3-5 5 5 5" /></svg>
        </button>
        <button class="icon" aria-label="Delete trace segment" title="Delete segment; keep the next endpoint in place" :disabled="!canTrace" @click="deleteSegment">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10M7 6v6M9 6v6" /></svg>
        </button>
        <button
          class="icon"
          aria-label="Next trace segment"
          title="Next trace segment"
          :disabled="segmentPosition < 0 || segmentPosition >= segments.length - 1"
          @click="selectSegment(segmentPosition + 1)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
        </button>
      </template>
    </template>
    <template v-else-if="!trace && coordinates">
      <label title="Placement X in its enclosing frame"
        ><span>X</span
        ><input
          class="coordinate"
          :value="poseValue(0)"
          aria-label="Placement X"
          :disabled="posePending || gridPending || !canPlace"
          @input="($event.target as HTMLInputElement).setCustomValidity('')"
          @keydown.esc.stop.prevent="resetPose($event, 0)"
          @change="coordinate(0, $event)"
      /></label>
      <label title="Placement Y in its enclosing frame"
        ><span>Y</span
        ><input
          class="coordinate"
          :value="poseValue(1)"
          aria-label="Placement Y"
          :disabled="posePending || gridPending || !canPlace"
          @input="($event.target as HTMLInputElement).setCustomValidity('')"
          @keydown.esc.stop.prevent="resetPose($event, 1)"
          @change="coordinate(1, $event)"
      /></label>
      <label title="Rotation in degrees or radians"
        ><span aria-hidden="true">↻</span
        ><input
          class="coordinate angle"
          :value="poseValue(2)"
          aria-label="Placement rotation"
          :disabled="posePending || gridPending || !canPlace"
          @input="($event.target as HTMLInputElement).setCustomValidity('')"
          @keydown.esc.stop.prevent="resetPose($event, 2)"
          @change="rotation"
      /></label>
      <select
        v-if="tl.targets('layer').refs.length"
        :value="tl.targets('layer').node?.side ?? 'F'"
        aria-label="Placement side"
        :disabled="posePending || gridPending || !canPlace"
        @change="tl.oneShot('layer', { side: ($event.target as HTMLSelectElement).value as 'F' | 'B' })"
      >
        <option value="F">Front</option>
        <option value="B">Back</option>
      </select>
    </template>
    <label title="Snap to the editing grid"><input type="checkbox" :checked="tl.snapEnabled.value" :disabled="!trace && !canPlace" @change="snap" />Snap</label>
    <select :value="tl.gridPitch.value ?? tl.sourceGrid.value.pitch" aria-label="Editing grid" :disabled="gridPending || (!trace && (posePending || !canPlace))" @change="grid">
      <option v-for="pitch in pitches" :key="pitch" :value="pitch">{{ pitch }}mm</option>
    </select>
    <button class="icon" title="Reset view" aria-label="Reset view" @click="ctx.commands.run('fit')">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4" /></svg>
    </button>
  </div>
  <div v-else-if="tl.why.value" class="bv-edit why" role="status">{{ tl.why.value }}</div>
  <Bubble v-if="as.on.value && as.chip.value" class="bv-dot-chip" :x="chip.x" :y="chip.y">
    <div v-for="(line, i) in as.chip.value" :key="i" :class="{ code: i === 0, bad: !as.ends.value && i > 0 && line !== 'DRC clean' }">{{ line }}</div>
  </Bubble>
</template>

<style scoped>
.bv-edit {
  width: max-content;
  max-width: calc(100% - 24px);
  box-sizing: border-box;
  justify-content: center;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.edit-mode {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  white-space: nowrap;
}
.bv-edit label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.bv-edit .coordinate {
  width: 78px;
  min-width: 0;
}
.bv-edit .angle {
  width: 60px;
}
.bv-edit input,
.bv-edit select {
  font: inherit;
  color: inherit;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 4px;
}
.bv-edit input[type='checkbox'] {
  accent-color: var(--accent);
  margin: 0;
}
.bv-edit select {
  max-width: 180px;
}
.bv-edit .icon {
  min-width: 28px;
  min-height: 28px;
}
.bv-edit input:invalid {
  border-color: var(--drc-err);
  outline-color: var(--drc-err);
}
.bv-edit .icon svg,
.edit-mode svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
