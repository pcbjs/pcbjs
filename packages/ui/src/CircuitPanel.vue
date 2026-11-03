<script setup lang="ts">
// the circuit instance the selection is in: its circuit, layout, path, parts and private nets
import { computed } from 'vue'
import { usePane, type BoardInput } from './board'
import { asRange, rangeLabel } from './source'
import { netLabel, partPathLinks } from './circuits'
import { defName } from '@pcbjs/core/internal/instances'
import { useActions } from './use/actions'
import { pinRef, useCircuit } from './use/schematic'
import { useChip } from './use/chip'

const props = defineProps<{ board?: BoardInput }>()
const ctx = usePane(props.board, ['meta', 'sch'])
const { hover } = ctx.board
const board = computed(() => ctx.board.site)
const netMembers = computed(() => ctx.board.netMembers)
const { activeNet, selectRef, pin } = useActions(ctx)
const { selectCircuit, circuit, circuitParts, circuitNets, circuitPlaced } = useCircuit(ctx)
const { openPlace, openAnchor } = useChip(ctx)
</script>

<template>
  <div v-if="circuit" class="panel circuit-panel">
    <div class="part-head">
      <h3>{{ circuit.circuit.name ?? circuit.circuit.path.at(-1) }}</h3>
      <span class="dim">{{ circuit.circuit.circuit }}</span
      ><span v-if="circuit.circuit.placed === false" class="tag warn">not placed</span>
    </div>
    <dl class="kv wide-k">
      <dt>circuit</dt>
      <dd>{{ circuit.circuit.circuit }}</dd>
      <dt>layout</dt>
      <dd>
        <span v-if="circuit.circuit.layout">{{ defName(circuit.circuit.layout) }}</span
        ><span v-else class="dim">none</span>
      </dd>
      <dt>path</dt>
      <dd class="src path-links">
        <template v-for="(l, i) in partPathLinks({ ref: '', path: circuit.circuit.path, local: '' })?.links ?? []" :key="l.key">
          <span v-if="i" class="dim"> / </span><a v-if="l.key !== circuit.key" href="#" title="Select this circuit instance" @click.prevent="selectCircuit(l.key)">{{ l.name }}</a
          ><span v-else>{{ l.name }}</span>
        </template>
      </dd>
      <dt>parts</dt>
      <dd>{{ circuit.refs.length }}</dd>
      <template v-if="circuitPlaced && openPlace && board?.dev">
        <dt>source</dt>
        <dd class="src src-actions">
          <button :title="rangeLabel(openPlace.file, asRange(openPlace))" @click="openAnchor('placement')">Open placement</button>
        </dd>
      </template>
    </dl>
    <h2>Parts</h2>
    <table class="pads">
      <thead>
        <tr>
          <th>ref</th>
          <th>local</th>
          <th>value</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in circuitParts" :key="p.ref" class="row" @click="selectRef(p.ref, true)">
          <td>{{ p.displayRef ?? p.ref }}</td>
          <td>{{ p.local || p.ref }}</td>
          <td>{{ p.value }}<span v-if="!p.placed" class="tag warn">not placed</span></td>
        </tr>
      </tbody>
    </table>
    <template v-if="circuitNets.length">
      <h2>Private nets</h2>
      <ul class="sch-nets">
        <li v-for="x in circuitNets" :key="x.name" :class="{ on: activeNet === x.name }">
          <div class="line1">
            <button class="link name" :class="{ pinned: netMembers.has(x.name) }" @mouseenter="hover.net = x.name" @mouseleave="hover.net = null" @click="pin(x.name)">
              {{ netLabel(x).name }}
            </button>
            <span v-if="x.class" class="dim cls">{{ x.class }}</span>
          </div>
          <div class="pins">
            <button v-for="q in x.pins" :key="q" class="pin" @click="selectRef(pinRef(q), true)">{{ q }}</button>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
