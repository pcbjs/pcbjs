<script setup lang="ts">
// the circuit instance tree, or the flat parts, and the nets, with a filter; a click selects and zooms
import { computed } from 'vue'
import { usePane, type BoardInput } from './board'
import { pinLabel } from './schematic'
import { netLabel } from './circuits'
import { defName } from '@pcbjs/core/internal/instances'
import { useActions } from './use/actions'
import { pinRef, useSchematicPanel } from './use/schematic'

const props = defineProps<{ board?: BoardInput }>()
const ctx = usePane(props.board, ['meta', 'sch'])
const { hover } = ctx.board
const board = computed(() => ctx.board.site)
const activeRef = computed(() => ctx.board.activeRef)
const activeCircuit = computed(() => ctx.board.activeCircuit)
const netMembers = computed(() => ctx.board.netMembers)
const { activeNet, selectRef, pin } = useActions(ctx)
const { selectCircuit, schFilter, schView, hasSch, treeView, isOpen, toggleOpen, treeRows, circuits, refWidth, hoverCircuit } = useSchematicPanel(ctx)
</script>

<template>
  <div v-if="board" class="panel sch">
    <div v-if="!hasSch" class="empty">No schematic data in this build</div>
    <template v-else>
      <input
        v-model="schFilter"
        class="filter"
        type="search"
        :placeholder="circuits ? 'Filter circuits, parts and nets' : 'Filter parts and nets'"
        :aria-label="circuits ? 'Filter circuits, parts and nets' : 'Filter parts and nets'"
      />
      <h2>
        Parts <span class="count">{{ treeView.parts }}</span>
      </h2>
      <table class="sch-parts">
        <colgroup>
          <col :style="{ width: refWidth + 'px' }" />
          <col />
        </colgroup>
        <tbody>
          <template v-for="{ node, depth } in treeRows" :key="node.key">
            <tr v-if="node.kind === 'instance'" class="inst" :class="{ on: activeCircuit === node.key }" @mouseenter="hoverCircuit(node)" @mouseleave="hoverCircuit(null)">
              <td colspan="2" :style="{ paddingLeft: depth * 14 + 'px' }">
                <div class="line1">
                  <button
                    class="twisty"
                    :class="{ open: isOpen(node.key) }"
                    :aria-expanded="isOpen(node.key)"
                    :aria-label="isOpen(node.key) ? 'Collapse' : 'Expand'"
                    @click="toggleOpen(node.key)"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
                  </button>
                  <button class="link inst-name" title="Select the circuit instance" @click="selectCircuit(node.key, true, true)">
                    {{ node.circuit.name ?? node.circuit.path.at(-1) }}
                  </button>
                  <span class="dim">{{ node.circuit.circuit }}</span>
                  <span v-if="node.circuit.layout" class="tag">{{ defName(node.circuit.layout) }}</span>
                  <span v-if="node.circuit.placed === false" class="tag warn">not placed</span>
                  <span class="dim inst-count">{{ node.refs.length }} {{ node.refs.length === 1 ? 'part' : 'parts' }}</span>
                </div>
              </td>
            </tr>
            <tr v-else :class="{ on: activeRef === node.part.ref }">
              <td class="ref" :style="depth ? { paddingLeft: depth * 14 + 18 + 'px' } : undefined">
                <button class="link" :title="node.part.placed ? 'Select and zoom' : 'Select'" @click="selectRef(node.part.ref, true, true)">
                  {{ node.part.displayRef ?? node.part.ref }}</button
                ><span v-if="node.part.local && node.part.local !== node.part.ref" class="dim local">{{ node.part.local }}</span>
              </td>
              <td class="body">
                <div class="line1">
                  <span class="value">{{ node.part.value }}</span
                  ><span class="dim fp" :title="node.part.footprint">{{ node.part.footprint?.split(':').pop() }}</span
                  ><span v-if="!node.part.placed" class="tag warn">not placed</span>
                </div>
                <div class="pins">
                  <span
                    v-for="(x, i) in node.part.pins"
                    :key="i"
                    class="pin"
                    :class="{ nc: x.nc, none: !x.nc && x.net == null, on: !!x.net && activeNet === x.net }"
                    @mouseenter="hover.net = x.net"
                    @mouseleave="hover.net = null"
                    @click="x.net && pin(x.net)"
                    >{{ pinLabel(x) }}</span
                  >
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div v-if="!treeRows.length" class="empty">No parts match</div>
      <h2>
        Nets <span class="count">{{ schView.nets.length }}</span>
      </h2>
      <ul class="sch-nets">
        <li v-for="n in schView.nets" :key="n.name" :class="{ on: activeNet === n.name }">
          <div class="line1">
            <button class="link name" :class="{ pinned: netMembers.has(n.name) }" @mouseenter="hover.net = n.name" @mouseleave="hover.net = null" @click="pin(n.name)">
              <span v-if="netLabel(n).prefix" class="owner">{{ netLabel(n).prefix }}</span
              >{{ netLabel(n).name }}
            </button>
            <span v-if="n.local" class="tag">local</span><span v-if="n.class" class="dim cls">{{ n.class }}</span>
          </div>
          <div class="pins">
            <button v-for="x in n.pins" :key="x" class="pin" :class="{ on: activeRef === pinRef(x) }" @click="selectRef(pinRef(x), true, true)">{{ x }}</button>
          </div>
        </li>
      </ul>
      <div v-if="!schView.nets.length" class="empty">No nets match</div>
    </template>
  </div>
</template>
