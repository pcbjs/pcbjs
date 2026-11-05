<script setup lang="ts">
// the anchor's part: value, footprint, place, fields, source, sourcing and pads or pins
import { computed } from 'vue'
import { usePane, type BoardInput } from './board'
import { asRange, rangeLabel } from './source'
import { matchedKey, sourceLabel, sourcingEntries } from './sourcing'
import { useActions } from './use/actions'
import { usePart } from './use/schematic'
import { mm } from './format'

const props = defineProps<{ board?: BoardInput }>()
const ctx = usePane(props.board, ['meta', 'sch', 'fab', 'model'])
const { hover } = ctx.board
const board = computed(() => ctx.board.site)
const { activeNet, pin } = useActions(ctx)
const { part, schPart, selectCircuit, partPath, partPlace, partDef, partRepoUrl, onOpen, partSourcing } = usePart(ctx)
</script>

<template>
  <div class="panel">
    <div v-if="!part && !schPart" class="empty">Click a footprint on the board or a ref in the BOM</div>
    <template v-else-if="!part && schPart">
      <div class="part-head">
        <h3>{{ schPart.displayRef ?? schPart.ref }}</h3>
        <span class="dim">{{ schPart.value }}</span
        ><span class="tag warn">not placed</span>
      </div>
      <dl class="kv wide-k">
        <template v-if="partPath"
          ><dt>path</dt>
          <dd class="src path-links">
            <template v-for="l in partPath.links" :key="l.key"
              ><a href="#" title="Select the circuit instance" @click.prevent="selectCircuit(l.key)">{{ l.name }}</a
              ><span class="dim"> / </span></template
            >{{ partPath.local }}
          </dd></template
        >
        <dt>footprint</dt>
        <dd>{{ schPart.footprint }}</dd>
      </dl>
    </template>
    <template v-else-if="part">
      <div class="part-head">
        <h3>{{ part.displayRef ?? part.ref }}</h3>
        <span class="dim">{{ part.value }}</span
        ><span v-if="schPart && !schPart.placed" class="tag warn">not placed</span>
      </div>
      <dl class="kv wide-k">
        <template v-if="partPath"
          ><dt>path</dt>
          <dd class="src path-links">
            <template v-for="l in partPath.links" :key="l.key"
              ><a href="#" title="Select the circuit instance" @click.prevent="selectCircuit(l.key)">{{ l.name }}</a
              ><span class="dim"> / </span></template
            >{{ partPath.local }}
          </dd></template
        >
        <dt>footprint</dt>
        <dd>{{ part.id }}</dd>
        <dt>at</dt>
        <dd>{{ mm(part.at[0]) }}, {{ mm(part.at[1]) }} mm</dd>
        <dt>rotation</dt>
        <dd>{{ part.rot }}°</dd>
        <dt>side</dt>
        <dd>{{ part.side === 'F' ? 'front' : 'back' }}</dd>
        <template v-if="part.description"
          ><dt>description</dt>
          <dd>{{ part.description }}</dd></template
        >
        <template v-for="(v, k) in part.fields" :key="k"
          ><dt>{{ k }}</dt>
          <dd>{{ v }}</dd></template
        >
        <template v-if="part.step"
          ><dt>model</dt>
          <dd class="src">{{ part.step.file }}<span v-if="!part.step.mesh" class="tag warn">missing</span></dd></template
        >
        <template v-if="part.step?.issue"
          ><dt></dt>
          <dd class="model-issue" :title="`pcbjs model align ${part.ref}`">{{ part.step.issue }}; try pcbjs model align {{ part.ref }}</dd></template
        >
        <template v-if="partPlace">
          <dt>source</dt>
          <dd class="src src-actions">
            <a v-if="board?.dev && ctx.board.edit.mode?.mode === 'rw'" href="#" title="Open the placement in the editor" @click.prevent="onOpen({ ref: part.ref }, 'placement')">{{
              rangeLabel(partPlace.file, asRange(partPlace))
            }}</a>
            <a v-else-if="partRepoUrl(partPlace)" :href="partRepoUrl(partPlace)!" target="_blank" rel="noopener" title="Open the placement on the repository host">{{
              rangeLabel(partPlace.file, asRange(partPlace))
            }}</a>
            <span v-else>{{ rangeLabel(partPlace.file, asRange(partPlace)) }}</span>
            <template v-if="partDef">
              <a
                v-if="board?.dev && ctx.board.edit.mode?.mode === 'rw'"
                class="src-def"
                href="#"
                :title="`Open the definition, ${rangeLabel(partDef.file, asRange(partDef))}`"
                @click.prevent="onOpen({ ref: part.ref }, 'definition')"
                >definition</a
              >
              <a v-else-if="partRepoUrl(partDef)" class="src-def" :href="partRepoUrl(partDef)!" target="_blank" rel="noopener" :title="rangeLabel(partDef.file, asRange(partDef))"
                >definition</a
              >
            </template>
          </dd>
        </template>
      </dl>
    </template>
    <template v-if="partSourcing && (part || schPart)">
      <h2>Sourcing</h2>
      <div class="sourcing-head">
        <strong v-if="partSourcing.mpn" class="mpn">{{ partSourcing.mpn }}</strong
        ><span v-else class="dim">no part number</span>
        <span v-if="sourceLabel(partSourcing)" class="tag">{{ sourceLabel(partSourcing) }}</span>
      </div>
      <dl v-if="partSourcing.manufacturer || partSourcing.datasheet" class="kv wide-k sourcing-kv">
        <template v-if="partSourcing.manufacturer"
          ><dt>manufacturer</dt>
          <dd>{{ partSourcing.manufacturer }}</dd></template
        >
        <template v-if="partSourcing.datasheet"
          ><dt>datasheet</dt>
          <dd class="src">
            <a :href="partSourcing.datasheet" target="_blank" rel="noopener">{{ partSourcing.datasheet }}</a>
          </dd></template
        >
      </dl>
      <table v-if="sourcingEntries(partSourcing).length" class="pads sourcing">
        <thead>
          <tr>
            <th>key</th>
            <th>value</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[k, v] in sourcingEntries(partSourcing)" :key="k" :class="{ on: k === matchedKey(partSourcing) }">
            <td>{{ k }}</td>
            <td>{{ v }}</td>
          </tr>
        </tbody>
      </table>
    </template>
    <template v-if="schPart">
      <h2>Pins</h2>
      <table class="pads">
        <thead>
          <tr>
            <th>pin</th>
            <th>net</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(p, i) in schPart.pins"
            :key="i"
            :class="{ row: !!p.net, on: !!p.net && activeNet === p.net, nc: p.nc }"
            @mouseenter="hover.net = p.net"
            @mouseleave="hover.net = null"
          >
            <td>{{ p.name }}</td>
            <td>
              <button
                v-if="p.net && !p.nc"
                type="button"
                :aria-pressed="ctx.board.sel.refs.includes(`net:${p.net}`)"
                @focus="hover.net = p.net"
                @blur="hover.net = null"
                @click="pin(p.net)"
              >
                {{ p.net }}</button
              ><span v-else>{{ p.nc ? 'NC' : 'none' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <template v-else-if="part">
      <h2>Pads</h2>
      <table class="pads">
        <thead>
          <tr>
            <th>pad</th>
            <th>name</th>
            <th>net</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in part.pads"
            :key="p.num"
            :class="{ row: !!p.net, on: !!p.net && activeNet === p.net }"
            @mouseenter="hover.net = p.net ?? null"
            @mouseleave="hover.net = null"
          >
            <td>{{ p.num }}</td>
            <td>{{ p.name }}</td>
            <td>
              <button
                v-if="p.net"
                type="button"
                :aria-pressed="ctx.board.sel.refs.includes(`net:${p.net}`)"
                @focus="hover.net = p.net"
                @blur="hover.net = null"
                @click="pin(p.net)"
              >
                {{ p.net }}</button
              ><span v-else>none</span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
