<script setup lang="ts">
// the BOM by value and footprint with part numbers and sources, copied as TSV
import { computed } from 'vue'
import { usePane, type BoardInput } from './board'
import { rowMpn, sourceLabel, sourcingTitle } from './sourcing'
import { useActions } from './use/actions'
import { useBom } from './use/lists'

const props = defineProps<{ board?: BoardInput }>()
const ctx = usePane(props.board, ['meta', 'fab'])
const board = computed(() => ctx.board.site)
const activeRef = computed(() => ctx.board.activeRef)
const { selectRef } = useActions(ctx)
const { bom, bomLine, bomMissing, copied, copyBom } = useBom(ctx)
</script>

<template>
  <div v-if="board?.pending?.includes('fab')" class="panel" role="status">BOM and fabrication output pending for the geometry shown.</div>
  <div v-else-if="board" class="panel bom">
    <div class="bom-head">
      <div class="bom-meta">
        <span v-if="bomLine">{{ bomLine }}</span>
        <span v-if="bomMissing" class="bom-missing">{{ bomMissing }}</span>
      </div>
      <button class="btn" :title="copied === 'fail' ? 'Clipboard not available' : 'Copy the BOM as tab separated values'" @click="copyBom">
        {{ copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy TSV' }}
      </button>
    </div>
    <table class="bom-table">
      <thead>
        <tr>
          <th>Refs</th>
          <th>Value</th>
          <th>Footprint</th>
          <th class="num">Qty</th>
          <th>MPN</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in bom" :key="r.refs.join()" :class="{ unsourced: !rowMpn(r) }">
          <td class="refs">
            <div class="chips">
              <button v-for="ref in r.refs" :key="ref" class="chip" :class="{ on: activeRef === ref }" @click="selectRef(ref, true)">{{ ref }}</button>
            </div>
          </td>
          <td class="value">{{ r.value }}</td>
          <td class="fp" :title="r.footprint">{{ r.footprint.split(':').pop() }}</td>
          <td class="num">{{ r.qty }}</td>
          <td class="mpn" :title="sourcingTitle(r.sourcing) || undefined">
            <span v-if="rowMpn(r)">{{ rowMpn(r) }}</span
            ><span v-else class="dim">none</span>
          </td>
          <td class="src-tag">
            <span v-if="sourceLabel(r.sourcing)" class="tag">{{ sourceLabel(r.sourcing) }}</span
            ><span v-else class="dim">–</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
