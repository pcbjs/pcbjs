// a prerendered page hydrates the markup in #app marked `data-ssr`; the dev server and relative-base sites mount from scratch
import { createApp, createSSRApp } from 'vue'
import App from './App.vue'
import Boot from './Boot.vue'
import { LOAD, startLoad } from './load'
import { startSync } from './sync-client'
import type { Boot as BootInfo } from './loading'
import { afterMount, createStore, scopeOfPath, startBrowser, STORE, type SiteState, type StoreInit } from './state'
import { parseIdeQuery } from './ide'
import { parseViewQuery } from './query'
import './style.css'

declare global {
  interface Window {
    /** the site data a prerendered page inlines */
    __PCBJS_DATA__?: SiteState
    /** set by a page whose #app holds server-rendered markup, as `data-ssr` on #app does */
    __PCBJS_SSR__?: boolean
    /** the dev server's project and status when it served the page */
    __PCBJS_BOOT__?: BootInfo
  }
}

const el = document.getElementById('app')!
// read before the store starts, so the URLs it writes keep the query
const q = parseIdeQuery(location.search)
// the dev server holds the board module back until the first compile is done; until then the boot screen follows it
const load = import.meta.hot ? startLoad(import.meta.hot, window.__PCBJS_BOOT__ ?? null) : null
const boot = load ? createApp(Boot).provide(LOAD, load) : null
// the server inlines the first paint of the boot screen, see boot.css
const bootEl = boot ? (document.getElementById('pcbjs-boot') ?? Object.assign(document.body.appendChild(document.createElement('div')), { className: 'boot' })) : null
if (boot) boot.mount(bootEl!)

/** The page's data; a workspace dev server with several scopes serves each one under /<scope>/. */
async function siteData(): Promise<{ data: SiteState; init: Partial<StoreInit> }> {
  const { boards, entries, errors, single, workspace } = await import('virtual:pcbjs/board')
  const own: SiteState = window.__PCBJS_DATA__ ?? { boards, single, errors, entries }
  if (!workspace || workspace.single) return { data: own, init: { workspace } }
  const slug =
    scopeOfPath(
      location.pathname,
      workspace.scopes.map(s => s.slug),
    ) ?? (q.ide ? workspace.displayed : null)
  if (!slug) return { data: { boards: [], single: false, errors: {}, entries: {} }, init: { workspace, scope: null } }
  const r = await fetch(`/__pcbjs/scope/${encodeURIComponent(slug)}`)
  const body = r.ok ? await r.json() : { boards: [], single: true, errors: { [slug]: `no such project: ${slug}` }, entries: {} }
  const route = `/${encodeURIComponent(slug)}/`
  if (!location.pathname.startsWith(route)) history.replaceState(null, '', route + location.search)
  return { data: body, init: { workspace: body.workspace ?? workspace, scope: slug, baseUrl: route } }
}

async function start() {
  const { data, init } = await siteData()
  const store = createStore({ ...data, ...init, path: location.pathname, ...(q.ide ? { ide: true, ideTheme: q.theme, ideSearch: location.search } : {}) })
  // an old #/board/<name> hash moves the page, and the markup no longer matches it; nor does ?ide=1, which renders the compact layout
  const moved = startBrowser(store)
  if (import.meta.hot) startSync(store, import.meta.hot, !!parseViewQuery(location.search).select)
  const ssr = !moved && !store.ide.on && (el.hasAttribute('data-ssr') || window.__PCBJS_SSR__ === true)
  const app = (ssr ? createSSRApp : createApp)(App)
  app.provide(STORE, store)
  if (load) app.provide(LOAD, load)
  app.mount(el, ssr)
  boot?.unmount()
  bootEl?.remove()
  // applied after the first render, which the server rendered without them
  afterMount(store, parseViewQuery(location.search))
}
void start()
