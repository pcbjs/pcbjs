<script setup lang="ts">
// the default slot only in the browser after hydration, the placeholder before and on the server
import { onMounted, ref } from 'vue'
const mounted = ref(false)
onMounted(() => { mounted.value = true })
</script>

<template>
  <slot v-if="mounted" />
  <slot v-else name="placeholder" />
</template>
