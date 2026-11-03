<script setup lang="ts">
// the nets with their routed length against the target, a hover lights one, a click selects it
import { computed } from 'vue'
import { usePane, type BoardInput } from './board'
import { netLabel } from './circuits'
import { targetText } from './routes'
import { useActions } from './use/actions'
import { useNets } from './use/lists'

const props = defineProps<{ board?: BoardInput }>()
const ctx = usePane(props.board, ['meta', 'layers'])
const { hover } = ctx.board
const board = computed(() => ctx.board.site)
const netMembers = computed(() => ctx.board.netMembers)
const { activeNet, pin } = useActions(ctx)
const { padCount, netFilter, nets } = useNets(ctx)
</script>

<template>
  <div v-if="board" class="panel">
    <input v-model="netFilter" class="filter" type="search" placeholder="Filter nets" aria-label="Filter nets" />
    <ul class="netlist">
      <li v-for="n in nets" :key="n.name">
        <button
          class="net"
          :class="{ on: activeNet === n.name, pinned: netMembers.has(n.name) }"
          @mouseenter="hover.net = n.name"
          @mouseleave="hover.net = null"
          @click="pin(n.name)"
        >
          <span class="name"
            ><span v-if="netLabel(n).prefix" class="owner">{{ netLabel(n).prefix }}</span
            >{{ netLabel(n).name }}<span v-if="n.local" class="tag">local</span><span v-if="n.class" class="cls">{{ n.class }}</span></span
          ><span v-if="n.len" class="len" :class="{ bad: n.len.bad }" :title="n.len.title"
            ><span v-if="n.len.bad" class="mark" aria-label="length outside its target">!</span>{{ +n.len.length.toFixed(2) }} mm<span
              v-if="n.len.target && n.len.routes === 1"
              class="dim"
            >
              / {{ targetText(n.len.target) }}</span
            ></span
          ><span class="dim">{{ padCount.get(n.name) ?? 0 }} pads</span>
        </button>
      </li>
    </ul>
  </div>
</template>
