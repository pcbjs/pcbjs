// free of Vue and the DOM so Node imports it in the tests: which side of the board the 2D view puts on top

export type Side = 'F' | 'B'

const stacked = (l: { side: string }) => l.side === 'front' || l.side === 'back' || l.side === 'inner'

/** The 2D draw order, last on top: the stack in the layer table's order from the back outward to the front, reversed for B, then the layers of both sides. */
export function drawOrder<L extends { side: string }>(layers: readonly L[], side: Side): L[] {
  const stack = layers.filter(stacked)
  return [...(side === 'B' ? stack.reverse() : stack), ...layers.filter(l => !stacked(l))]
}
