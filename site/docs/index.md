---
title: Docs
description: Every pcbjs topic, the same files `pcbjs docs <topic>` prints in the terminal.
---

<script setup>
import { useData } from 'vitepress'
const { theme } = useData()
const groups = theme.value.sidebar['/docs/']
</script>

# Docs

Each page is one topic file from `docs/`, the same text `pcbjs docs <topic>` prints. Start with [Quickstart](./quickstart).

<template v-for="g in groups" :key="g.text">
  <h2>{{ g.text }}</h2>
  <ul>
    <li v-for="i in g.items" :key="i.link"><a :href="i.link">{{ i.text }}</a></li>
  </ul>
</template>
