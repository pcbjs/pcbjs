<script setup lang="ts">
// the board's layers with presets: a click hides one, a double-click shows it alone
import { computed } from 'vue'
import { usePane, type BoardInput } from './board'
import { useLayers } from './use/layers'

const props = defineProps<{ board?: BoardInput }>()
const ctx = usePane(props.board, ['meta', 'layers'])
const { pane } = ctx
const board = computed(() => ctx.board.site)
const { layerList, solo, presetNames, applyPreset, activePreset, toggleLayer } = useLayers(ctx)
</script>

<template>
  <section v-if="board">
    <h2>Layers</h2>
    <div class="seg presets" role="group" aria-label="Layer presets">
      <button v-for="[p, label] in presetNames" :key="p" :class="{ on: activePreset === p }" @click="applyPreset(p)">{{ label }}</button>
    </div>
    <ul class="layers" title="Double-click a layer to show it alone">
      <li v-for="l in layerList" :key="l.id">
        <label class="layer" :class="{ off: pane.hidden.has(l.id), blank: !l.svg }" @dblclick.prevent="solo(l.id)">
          <input type="checkbox" :checked="!pane.hidden.has(l.id)" @change="toggleLayer(l.id)" />
          <span class="sw" :style="{ background: l.color }"></span>
          <span class="id">{{ l.id }}</span>
          <span class="kind">{{ l.kind }}</span>
        </label>
      </li>
    </ul>
    <p class="hint">Double-click a layer to solo it</p>
  </section>
</template>
