// The browser-compiled variant: the board's module compiled in the page's worker, its facets joined for a 2D view of @pcbjs/ui.
import { createApp, h, shallowRef } from 'vue'
import { View2D } from '@pcbjs/ui'
import '@pcbjs/ui/style.css'
import { compileInBrowser } from '@pcbjs/compile/browser'
import { joinSite, type Facets } from '@pcbjs/core/site-facets'
import type { SiteData } from '@pcbjs/core/site-data'
import module, { header } from './pcb.tsx?pcb:module'

const site = shallowRef<SiteData | null>(null)
const worker = () => new Worker(new URL('./compile-worker.ts', import.meta.url), { type: 'module' })
compileInBrowser(module, { worker, want: ['meta', 'layers', 'findings'] }).then(r => {
  const facets: Record<string, unknown> = {}
  for (const f of r.facets) if (f.board === header.board) facets[f.facet] = f.data
  site.value = joinSite(facets as Facets)
})

createApp({
  render: () => h('main', [h('p', { id: 'state' }, site.value ? 'compiled' : 'compiling'), site.value ? h(View2D, { board: site.value, style: 'height: 480px' }) : null]),
}).mount('#app')
