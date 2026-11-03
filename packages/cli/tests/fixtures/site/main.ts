// A site of two facet imports: the board for a 2D view of @pcbjs/ui, and its findings for a badge.
import { createApp, h } from 'vue'
import { View2D } from '@pcbjs/ui'
import '@pcbjs/ui/style.css'
import board from './pcb.tsx?pcb:board'
import findings, { header } from './pcb.tsx?pcb:findings'

const errors: number = findings.drc.filter(d => d.severity === 'error').length
// @ts-expect-error the findings facet holds no layers
void findings.layers
const badge = `${header.board}: ${errors ? `${errors} DRC errors` : 'DRC clean'}`

createApp({
  render: () => h('main', [h('p', { id: 'badge' }, badge), h(View2D, { board, style: 'height: 480px' })]),
}).mount('#app')
