// one fresh app and store per page: nothing is shared between two calls and nothing touches a browser global
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import App from './App.vue'
import { createStore, STORE, type SiteState } from './state'

export interface Rendered { html: string; title: string; head: string }

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Render the page at `path`, an absolute URL path under the site's base, from the site data. */
export async function render(path: string, data: SiteState): Promise<Rendered> {
  const store = createStore({ ...data, path })
  store.setPath(path)
  const app = createSSRApp(App)
  app.provide(STORE, store)
  try {
    const html = await renderToString(app)
    const b = store.current.value
    const description = store.route.value.page === 'home'
      ? `${store.cards.value.length} boards`
      : b ? `${b.title || b.name}${b.revision ? ` rev ${b.revision}` : ''}: ${b.copper} layers, ${+b.bbox.w.toFixed(2)} × ${+b.bbox.h.toFixed(2)} mm` : ''
    const head = description ? `<meta name="description" content="${esc(description)}">` : ''
    return { html, title: store.pageTitle.value, head }
  } finally { store.stop() }
}
