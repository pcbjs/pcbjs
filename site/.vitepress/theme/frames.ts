// The live viewer frames of a page: browsers cap WebGL contexts, so past MAX the oldest frame away from the viewport goes first, else the oldest.
export interface Live {
  near: () => boolean
  drop: () => void
}

const MAX = 6
const live: Live[] = []

/** Counts `f` as live, dropping another frame when that passes MAX. */
export function claim(f: Live): void {
  release(f)
  live.push(f)
  if (live.length <= MAX) return
  const old = live.find(x => x !== f && !x.near()) ?? live[0]
  release(old)
  old.drop()
}

export function release(f: Live): void {
  const i = live.indexOf(f)
  if (i >= 0) live.splice(i, 1)
}
