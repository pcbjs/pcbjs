// `data-ready` on <html> for `pcbjs shot`; only ever called after mount, never on the server

type View = '2d' | '3d' | 'sch'
const listeners = new Set<(view: View) => void>()
let painted: View | null = null

/** Call `cb` each time a view has painted the board, which may be before it is ready; returns the unsubscribe. */
export function onPainted(cb: (view: View) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
/** The view that last painted since the mark was cleared, null for none. */
export const lastPainted = () => painted

/** The view has painted the board: 2D and the schematic when ready, 3D at the first frame with the board meshes. */
export function setPainted(view: View) {
  painted = view
  for (const cb of listeners) cb(view)
}

/** Mark the view as drawn. */
export function setReady(view: View) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.ready = view
  setPainted(view)
}

/** Clear the mark, while another view or board draws. */
export function clearReady() {
  painted = null
  if (typeof document === 'undefined') return
  delete document.documentElement.dataset.ready
}
