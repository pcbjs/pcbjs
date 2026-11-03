<script setup lang="ts">
// the stackup layer by layer, with finish, mask, silk and total thickness
import { computed } from 'vue'
import { usePane, type BoardInput } from './board'
import { cssColor } from '@pcbjs/export/internal/scene/colors'
import { stackOf } from './use/status'

const props = defineProps<{ board?: BoardInput }>()
const ctx = usePane(props.board, ['meta'])
const board = computed(() => ctx.board.site)
const stack = computed(() => stackOf(board.value))
</script>

<template>
  <section v-if="board?.stackup">
    <h2>Stackup, mm</h2>
    <table class="stackup">
      <tbody>
        <tr v-for="(r, i) in stack" :key="i" :class="r.type" :title="r.title">
          <td class="t" :colspan="r.name ? 1 : 2">{{ r.type }}</td>
          <td v-if="r.name" class="n">{{ r.name }}</td>
          <td class="th">{{ r.thickness }}</td>
          <td class="d"><span v-if="r.color" class="sw" :style="{ background: r.color }"></span>{{ r.detail }}</td>
        </tr>
      </tbody>
    </table>
    <dl class="kv">
      <dt>finish</dt>
      <dd>{{ board.stackup!.finish ?? 'none' }}</dd>
      <template v-if="board.stackup!.maskColor"
        ><dt>mask</dt>
        <dd>
          <span v-if="cssColor(board.stackup!.maskColor)" class="sw" :style="{ background: cssColor(board.stackup!.maskColor)! }"></span>{{ board.stackup!.maskColor }}
        </dd></template
      >
      <template v-if="board.stackup!.silkColor"
        ><dt>silk</dt>
        <dd>
          <span v-if="cssColor(board.stackup!.silkColor)" class="sw" :style="{ background: cssColor(board.stackup!.silkColor)! }"></span>{{ board.stackup!.silkColor }}
        </dd></template
      >
      <dt>thickness</dt>
      <dd>{{ board.thickness }}</dd>
    </dl>
  </section>
</template>
