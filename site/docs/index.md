---
title: Docs
description: Every pcbjs topic, the same files `pcbjs docs <topic>` prints in the terminal.
---

<script setup>
import { useData, withBase } from 'vitepress'
const { theme } = useData()
const groups = theme.value.sidebar['/docs/']
</script>

# Docs

Each page is one topic file from `docs/`, the same text `pcbjs docs <topic>` prints. Start with [Basics](./basics), a first board in order; [Advanced](./advanced) indexes the rest.

<template v-for="g in groups" :key="g.text">
  <h2>{{ g.text }}</h2>
  <ul>
    <li v-for="i in g.items.filter(i => i.link)" :key="i.link"><a :href="withBase(i.link)">{{ i.text }}</a></li>
  </ul>
  <template v-for="s in g.items.filter(i => i.items)" :key="s.text">
    <h3>{{ s.text }}</h3>
    <ul>
      <li v-for="i in s.items" :key="i.link"><a :href="withBase(i.link)">{{ i.text }}</a></li>
    </ul>
  </template>
</template>
