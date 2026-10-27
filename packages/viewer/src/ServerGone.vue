<script setup lang="ts">
// the dev server went: the loading screen with how to start it again, while the page keeps trying to reach it
import LoadScreen from './LoadScreen.vue'
import { esc } from './boot-screen.js'
import { RETRY_MS, useLoad } from './load'

const v = useLoad()
const actions = `<div class="load-card"><p>Start it again in <code>${esc(v?.boot?.root ?? 'the project folder')}</code>:</p><pre>${esc(v?.boot?.command ?? 'pcbjs dev')}</pre>`
  + `${v?.boot ? `<p>A running server writes <code>${esc(v.boot.devJson)}</code>.</p>` : ''}<p>Trying again every ${RETRY_MS / 1000} s; the page reloads once it answers.</p></div>`
</script>

<template>
  <LoadScreen v-if="v" class="server-gone" role="alert" :actions="actions" />
</template>
