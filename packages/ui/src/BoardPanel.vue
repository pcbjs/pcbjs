<script setup lang="ts">
// the board's counts, routing, compile times and rules
import { computed } from 'vue'
import { usePane, type BoardInput } from './board'
import { timingRows as rowsOf } from './use/status'
import { ms } from './format'

const props = defineProps<{ board?: BoardInput }>()
const ctx = usePane(props.board, ['meta', 'layers', 'findings', 'fab'])
const board = computed(() => ctx.board.site)
const timingRows = computed(() => rowsOf(board.value))
</script>

<template>
  <template v-if="board">
    <section>
      <h2>Board</h2>
      <dl class="kv">
        <dt>footprints</dt>
        <dd>{{ board.stats.footprints }}</dd>
        <dt>pads</dt>
        <dd>{{ board.stats.pads }}</dd>
        <dt>tracks</dt>
        <dd>{{ board.stats.tracks }}</dd>
        <dt>vias</dt>
        <dd>{{ board.stats.vias }}</dd>
        <dt>zones</dt>
        <dd>{{ board.stats.zones }}</dd>
        <dt>nets</dt>
        <dd>{{ board.stats.nets }}</dd>
        <template v-if="board.keepouts?.length"
          ><dt>keepouts</dt>
          <dd>{{ board.keepouts.length }}</dd></template
        >
      </dl>
    </section>
    <section v-if="board.routing">
      <h2>Routing</h2>
      <dl class="kv">
        <dt>legs</dt>
        <dd>{{ board.routing.legs }}</dd>
        <dt>routed</dt>
        <dd>{{ board.routing.routed }}</dd>
        <dt>failed</dt>
        <dd :class="{ bad: board.routing.failed }">{{ board.routing.failed }}</dd>
        <dt>cached</dt>
        <dd>{{ board.routing.cached }}</dd>
        <dt>held</dt>
        <dd>{{ board.routing.held }}</dd>
        <template v-if="board.routing.shared"
          ><dt>shared by</dt>
          <dd>{{ board.routing.shared.targets.join(', ') }}</dd></template
        >
      </dl>
    </section>
    <section v-if="timingRows.length">
      <h2>Compile time</h2>
      <dl class="kv">
        <template v-for="[k, v] in timingRows" :key="k"
          ><dt>{{ k }}</dt>
          <dd>{{ ms(v) }}</dd></template
        >
      </dl>
    </section>
    <section>
      <h2>Rules, mm</h2>
      <dl class="kv">
        <template v-for="(v, k) in board.rules" :key="k"
          ><dt>{{ k }}</dt>
          <dd>{{ v }}</dd></template
        >
      </dl>
    </section>
  </template>
</template>
