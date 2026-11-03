<script setup lang="ts">
// the right rail of a board page: the tabs of the findings, the schematic's tree, the BOM, the nets and the anchor's part or circuit
import { computed } from 'vue'
import { injectPane } from './context'
import { useCircuit } from './use/schematic'
import FindingsList from './FindingsList.vue'
import SchematicPanel from './SchematicPanel.vue'
import BomPanel from './BomPanel.vue'
import NetsPanel from './NetsPanel.vue'
import CircuitPanel from './CircuitPanel.vue'
import PartPanel from './PartPanel.vue'

const ctx = injectPane()!
const { pane: view } = ctx
const board = computed(() => ctx.board.site!)
const erc = computed(() => board.value.erc ?? null)
const { circuit } = useCircuit(ctx)
</script>

<template>
  <nav class="tabs" role="tablist">
    <button role="tab" :aria-selected="view.tab === 'drc'" :class="{ on: view.tab === 'drc' }" @click="view.tab = 'drc'">
      DRC <span class="count">{{ board.drc.length }}</span>
    </button>
    <button role="tab" :aria-selected="view.tab === 'erc'" :class="{ on: view.tab === 'erc' }" @click="view.tab = 'erc'">
      ERC <span v-if="erc" class="count">{{ erc.length }}</span>
    </button>
    <button role="tab" :aria-selected="view.tab === 'schematic'" :class="{ on: view.tab === 'schematic' }" @click="view.tab = 'schematic'">Schematic</button>
    <button role="tab" :aria-selected="view.tab === 'bom'" :class="{ on: view.tab === 'bom' }" @click="view.tab = 'bom'">
      BOM <span class="count">{{ board.bom.length }}</span>
    </button>
    <button role="tab" :aria-selected="view.tab === 'nets'" :class="{ on: view.tab === 'nets' }" @click="view.tab = 'nets'">
      Nets <span class="count">{{ board.nets.length }}</span>
    </button>
    <button role="tab" :aria-selected="view.tab === 'part'" :class="{ on: view.tab === 'part' }" @click="view.tab = 'part'">{{ circuit ? 'Circuit' : 'Part' }}</button>
  </nav>
  <FindingsList v-if="view.tab === 'drc' || view.tab === 'erc'" />
  <SchematicPanel v-else-if="view.tab === 'schematic'" />
  <BomPanel v-else-if="view.tab === 'bom'" />
  <NetsPanel v-else-if="view.tab === 'nets'" />
  <CircuitPanel v-else-if="circuit" />
  <PartPanel v-else />
</template>
