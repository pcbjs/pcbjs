import type { Board } from '@pcbjs/core/model'
import { drillFunction } from './gerber.js'

/** One hole: its centre, or a slot's two end centres, board mm y down. */
export interface DrillHole {
  x: number
  y: number
  end?: [number, number]
  via: boolean
}
export interface DrillTable {
  tools: { d: number; count: number; slots: number; vias: number; holes: DrillHole[] }[]
  text: string
}

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3)

export function excellon(board: Board, plated: boolean, date: string): DrillTable | null {
  type Hole = { x: number; y: number; w: number; h: number; rot: number; via: boolean; end?: [number, number]; start?: [number, number] }
  const holes: Hole[] = []
  for (const it of board.items) {
    if (it.kind === 'via' && plated) holes.push({ x: it.at[0], y: it.at[1], w: it.drill, h: it.drill, rot: 0, via: true })
    else if (it.kind === 'pad' && it.drill && (it.type === 'npth') !== plated) holes.push({ x: it.at[0], y: it.at[1], w: it.drill[0], h: it.drill[1], rot: it.rot, via: false })
  }
  if (!holes.length) return null
  const tools = new Map<number, Hole[]>()
  for (const h of holes) {
    const d = Math.min(h.w, h.h)
    const l = tools.get(d) ?? []
    l.push(h)
    tools.set(d, l)
  }
  const sorted = [...tools.keys()].sort((a, b) => a - b)
  const out = [
    'M48',
    `; DRILL file {pcbjs} date ${date}`,
    '; FORMAT={-:-/ absolute / metric / decimal}',
    `; #@! TF.FileFunction,${drillFunction(board, plated)}`,
    'FMAT,2',
    'METRIC,TZ',
  ]
  sorted.forEach((d, i) => out.push(`T${i + 1}C${f3(d)}`))
  out.push('%', 'G90', 'G05')
  sorted.forEach((d, i) => {
    out.push(`T${i + 1}`)
    for (const h of tools.get(d)!) {
      if (h.w === h.h) out.push(`X${f3(h.x)}Y${f3(-h.y)}`)
      else {
        // slot: route between the two end centres
        const len = Math.abs(h.w - h.h),
          a = (((h.w > h.h ? 0 : 90) - h.rot) * Math.PI) / 180
        const dx = (len / 2) * Math.cos(a),
          dy = (len / 2) * Math.sin(a)
        out.push(`X${f3(h.x - dx)}Y${f3(-(h.y - dy))}G85X${f3(h.x + dx)}Y${f3(-(h.y + dy))}`)
        h.start = [h.x - dx, h.y - dy]
        h.end = [h.x + dx, h.y + dy]
      }
    }
  })
  out.push('T0', 'M30', '')
  return {
    tools: sorted.map(d => {
      const hs = tools.get(d)!
      return {
        d,
        count: hs.length,
        slots: hs.filter(h => h.end).length,
        vias: hs.filter(h => h.via).length,
        holes: hs.map(h => (h.end ? { x: h.start![0], y: h.start![1], end: h.end, via: h.via } : { x: h.x, y: h.y, via: h.via })),
      }
    }),
    text: out.join('\n'),
  }
}
