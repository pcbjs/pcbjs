<script setup lang="ts">
import { onMounted } from 'vue'
import { withBase } from 'vitepress'
const props = defineProps<{ to: string }>()
onMounted(() => window.location.replace(withBase(props.to) + window.location.search + window.location.hash))
</script>

<template><span hidden aria-hidden="true" /></template>
