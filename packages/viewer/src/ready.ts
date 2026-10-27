// `data-ready` on <html> for `pcbjs shot`; only ever called after mount, never on the server

/** Mark the view as drawn. */
export function setReady(view: '2d' | '3d' | 'sch') {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.ready = view
}

/** Clear the mark, while another view or board draws. */
export function clearReady() {
  if (typeof document === 'undefined') return
  delete document.documentElement.dataset.ready
}
