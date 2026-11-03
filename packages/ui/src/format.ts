// Numbers as the panels print them.
export const mm = (v: number) => +v.toFixed(3)
export const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`)
