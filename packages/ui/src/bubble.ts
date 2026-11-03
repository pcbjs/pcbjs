// Bubble placement in host pixels, flipped beside the pointer and bounded by both host and viewport.
export function bubbleAt(x: number, y: number, width: number, height: number, bounds: [number, number, number, number]): [number, number] {
  const [left, top, right, bottom] = bounds
  const place = (at: number, size: number, lo: number, hi: number) => Math.max(lo + 8, Math.min(at + 12 + size <= hi - 8 ? at + 12 : at - size - 12, hi - size - 8))
  return [place(x, width, left, right), place(y, height, top, bottom)]
}
