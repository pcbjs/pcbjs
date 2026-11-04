// What every page of the viewer does on load, given the entry of @pcbjs/ui it loaded: the boot screen, the page's data, the Shell and
// its connection, then the app. A prerendered page hydrates the markup in #app marked `data-ssr`; the rest mount from scratch.
import { createApp, createSSRApp, type Component } from 'vue'
import type * as UI from '@pcbjs/ui'
import type { SiteState, StoreInit } from '@pcbjs/ui'
import Boot from './Boot.vue'
import { LOAD, startLoad } from './load'
import { step, type Boot as BootInfo } from './loading'

declare global {
  interface Window {
    /** the boards' facets a prerendered page inlines */
    __PCBJS_DATA__?: SiteState
    /** set by a page whose #app holds server-rendered markup, as `data-ssr` on #app does */
    __PCBJS_SSR__?: boolean
    /** the dev server's project and status when it served the page */
    __PCBJS_BOOT__?: BootInfo
  }
}

/** What a page needs of @pcbjs/ui, which every one of its entries exports. */
export type Ui = Pick<
  typeof UI,
  'STORE' | 'afterMount' | 'configure' | 'connect' | 'createViewer' | 'parseIdeQuery' | 'parseViewQuery' | 'scopeOfPath' | 'sessionSocket' | 'sessionUrl'
>

/** Start the page with `root` as its app, given `props`. */
export async function start(ui: Ui, root: Component, props: Record<string, unknown> = {}) {
  ui.configure({ base: import.meta.env.BASE_URL, dev: import.meta.env.DEV })
  const el = document.getElementById('app')!
  // read before the page starts, so the URLs it writes keep the query
  const q = ui.parseIdeQuery(location.search)
  // in dev the page is a client of its session, on one socket; Vite's own carries only the hot updates of the viewer's source
  const transport = import.meta.hot ? ui.sessionSocket(ui.sessionUrl(location)) : null
  // until the first board draws the boot screen follows the session's status
  const load = transport ? startLoad(transport, window.__PCBJS_BOOT__ ?? null) : null
  const boot = load ? createApp(Boot).provide(LOAD, load) : null
  // the server inlines the first paint of the boot screen, see boot.css
  const bootEl = boot ? (document.getElementById('pcbjs-boot') ?? Object.assign(document.body.appendChild(document.createElement('div')), { className: 'boot' })) : null
  if (boot) boot.mount(bootEl!)

  /** The page's data; a workspace dev server with several scopes serves each one under /<scope>/. */
  async function siteData(): Promise<{ data: SiteState; init: Partial<StoreInit> }> {
    const { boards, entries, errors, single, workspace, run, status } = await import('virtual:pcbjs/board')
    // the module no longer waits for the first compile: the boot screen follows the status it was made under
    if (load && status) load.load = step(load.load, { kind: 'status', status })
    const own: SiteState = window.__PCBJS_DATA__ ?? { boards, single, errors, entries, run }
    if (!workspace || workspace.single) return { data: own, init: { workspace } }
    const slug =
      ui.scopeOfPath(
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

  const { data, init } = await siteData()
  const shell = ui.createViewer({
    ...data,
    ...init,
    path: location.pathname,
    embed: q.embed,
    embedSearch: location.search,
    ...(q.ide ? { ide: true, ideTheme: q.theme, ideSearch: location.search } : {}),
  })
  ui.connect(shell, transport)
  // ?ide=1 and ?embed=1 render a compact layout the markup does not match
  const ssr = !shell.ide.on && !shell.embed.on && (el.hasAttribute('data-ssr') || window.__PCBJS_SSR__ === true)
  const app = (ssr ? createSSRApp : createApp)(root, props)
  app.provide(ui.STORE, shell)
  if (load) app.provide(LOAD, load)
  app.mount(el, ssr)
  boot?.unmount()
  bootEl?.remove()
  // applied after the first render, which the server rendered without them
  ui.afterMount(shell, ui.parseViewQuery(location.search))
}
