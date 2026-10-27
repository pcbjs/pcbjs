// The loading screen's markup, one template for the viewer, the dev server's inlined first paint and the editor extension's pane; boot.css styles it.

/** s from one wave to the next, boot.css's pcbjs-pop */
export const PERIOD = 8
/** cells from the centre that carry a wave; the dots beyond stay still */
const REACH = 17
/** cells around the centre left out, under the mask's calm area */
const CALM = 3
/** s a wave takes to cross one cell */
const STEP = 0.2

/** The dots of each half-cell ring, keyed by its distance in cells; a ring pops as one layer. */
const rings = new Map()
for (let y = -REACH; y <= REACH; y++)
  for (let x = -REACH; x <= REACH; x++) {
    const r = Math.round(Math.hypot(x, y) * 2) / 2
    if (r > CALM && r <= REACH) rings.set(r, (rings.get(r) ?? '') + `<i style="--x:${x};--y:${y}"></i>`)
  }
const waves = [...rings].sort(([a], [b]) => a - b).map(([r, dots]) => `<b style="--d:${(r * STEP).toFixed(2)}s">${dots}</b>`)

/** The still dot grid and the rings of dots that pop as a wave passes, each delayed by its distance from the centre. */
export const DOTS = `<div class="dots" aria-hidden="true"></div><div class="waves" aria-hidden="true">${waves.join('')}</div>`

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** What goes inside `.load-screen`: the dots, the mark, the name, the status with its spinner, a progress bar, a hint and the actions, which are HTML. */
export function screenInner({ mark, name = '', text = '', hint = '', actions = '' }) {
  return DOTS
    + `<div class="load-body"><span class="mark">${mark}</span><div class="load-name">${esc(name)}</div>`
    + `<div class="load-text"><span class="spin" aria-hidden="true"></span><span class="load-msg">${esc(text)}</span></div>`
    + `<div class="load-bar off"><span></span></div></div>`
    + `<div class="load-more"><div class="load-hint">${esc(hint)}</div><div class="load-actions">${actions}</div></div>`
}

/** The whole screen; `state` is loading, idle, stopped, failed or gone, and `busy` shows the spinner. */
export function bootScreen(o) {
  return `<div class="load-screen" data-state="${o.state ?? 'loading'}"${o.busy ? ' data-busy' : ''} role="status" aria-live="polite">${screenInner(o)}</div>`
}

/** Puts a screen's text in place without touching the dots, so their waves and the spinner run on. */
export function fillScreen(el, { name, text, hint, busy, state, progress }) {
  const set = (sel, v) => { const n = el.querySelector(sel); if (n && v !== undefined && n.textContent !== v) n.textContent = v }
  set('.load-name', name)
  set('.load-msg', text)
  set('.load-hint', hint)
  if (busy !== undefined) el.toggleAttribute('data-busy', busy)
  if (state) el.dataset.state = state
  const bar = el.querySelector('.load-bar')
  if (bar && progress !== undefined) {
    bar.classList.toggle('off', progress === null)
    bar.firstElementChild.style.width = `${(progress ?? 0) * 100}%`
  }
}

/** The waves' phase now, as a negative delay, so a screen created later runs in step with one shown before. */
export const phase = () => `${-(Date.now() % (PERIOD * 1000)) / 1000}s`

/** The inline script of a page that shows the screen: the waves keep one phase across pages, and stop while the page is hidden. */
export const SCREEN_SCRIPT = `document.documentElement.style.setProperty('--phase', -(Date.now() % ${PERIOD * 1000}) / 1000 + 's');addEventListener('visibilitychange', () => document.documentElement.toggleAttribute('data-hidden', document.hidden))`
