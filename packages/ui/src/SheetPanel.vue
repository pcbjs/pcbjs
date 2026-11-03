<script setup lang="ts">
// the schematic's rows, a click hides one, a double-click shows it alone, and the sheet's counts
import { usePane, type BoardInput } from './board'
import { useSheet } from './use/layers'
import { mm } from './format'

const props = defineProps<{ board?: BoardInput }>()
const ctx = usePane(props.board, ['meta', 'sch'])
const { pane } = ctx
const { drawing, schRows, toggleSch, soloSch } = useSheet(ctx)
</script>

<template>
  <template v-if="drawing">
    <section>
      <h2>Schematic</h2>
      <ul class="layers" title="Double-click a row to show it alone">
        <li v-for="l in schRows" :key="l.id">
          <label class="layer" :class="{ off: pane.schHidden.has(l.id), blank: !l.n }" @dblclick.prevent="soloSch(l.id)">
            <input type="checkbox" :checked="!pane.schHidden.has(l.id)" @change="toggleSch(l.id)" />
            <span class="sw" :style="{ background: l.swatch }"></span>
            <span class="id">{{ l.name }}</span>
            <span class="kind">{{ l.n }}</span>
          </label>
        </li>
      </ul>
      <p class="hint">Double-click a row to solo it</p>
    </section>
    <section>
      <h2>Sheet</h2>
      <dl class="kv">
        <dt>page</dt>
        <dd>{{ drawing.paper ? drawing.paper.name : `${Math.round(drawing.page[2] - drawing.page[0])} × ${Math.round(drawing.page[3] - drawing.page[1])} mm` }}</dd>
        <dt>grid</dt>
        <dd>{{ drawing.grid }} mm</dd>
        <dt>symbols</dt>
        <dd>{{ drawing.stats.symbols }}</dd>
        <dt>wired nets</dt>
        <dd>{{ drawing.stats.wired }}</dd>
        <dt>labelled nets</dt>
        <dd>{{ drawing.stats.labelled }}</dd>
        <dt>junctions</dt>
        <dd>{{ drawing.stats.junctions }}</dd>
        <dt>crossings</dt>
        <dd>{{ drawing.stats.crossings }}</dd>
        <dt>wire length</dt>
        <dd>{{ mm(drawing.stats.length) }} mm</dd>
      </dl>
    </section>
  </template>
</template>
