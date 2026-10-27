<script setup lang="ts">
// the page before the app mounts, while the dev server compiles the first board
import LoadScreen from './LoadScreen.vue'
import ServerGone from './ServerGone.vue'
import { useLoad } from './load'

const v = useLoad()
</script>

<template>
  <ServerGone v-if="v?.load.phase === 'gone'" />
  <LoadScreen v-else />
</template>
