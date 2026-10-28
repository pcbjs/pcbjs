import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import type { BoardsPayload } from './boards.js'
import { variantSlug } from '@pcbjs/core/variants'

/** What the SSR bundle's `render` returns. */
export interface Rendered {
  html: string
  title: string
  head: string
}

/** The routes of a site as decoded segment lists: `[]` for home, `board/<name>` per board, `board/<name>/<slug>` per target. */
export function siteRoutes(data: Pick<BoardsPayload, 'boards'>): string[][] {
  const routes: string[][] = [[]]
  const seen = new Set<string>()
  for (const b of data.boards) {
    if (!seen.has(b.name)) {
      seen.add(b.name)
      routes.push(['board', b.name])
    }
    if (b.variant) routes.push(['board', b.name, variantSlug(b.variant.name)])
  }
  return routes
}

/** True when a name can be a directory of the site: no separators, not `.` or `..`, nothing a file system rejects. */
export const safeSegment = (s: string): boolean => !!s && s !== '.' && s !== '..' && !/[/\\\0]/.test(s)

/** JSON safe to place in an inline <script>: no `</script>`, no line separators JavaScript rejects. */
export const scriptJson = (v: unknown): string => JSON.stringify(v).replace(/[<\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

const escText = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

/** A page from the built index.html with the data inlined as `window.__PCBJS_DATA__`; without `rendered`, the client shell. */
export function pageHtml(template: string, dataJson: string, rendered?: Rendered): string {
  const app = '<div id="app"></div>'
  if (!template.includes(app)) throw new Error('index.html has no <div id="app"></div>')
  const data = `<script>window.__PCBJS_DATA__=${dataJson}</script>`
  let html = template.replace(app, () => (rendered ? `<div id="app" data-ssr>${rendered.html}</div>` : app) + data)
  if (rendered) html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escText(rendered.title)}</title>${rendered.head ? '\n  ' + rendered.head : ''}`)
  return html
}

/** Serve a prerendered site as a static host does: `/board/X` without a trailing slash, 404.html for any other page. */
export function previewPrerendered(outDir: string, base: string): Plugin {
  const b = base.endsWith('/') ? base : base + '/'
  return {
    name: 'pcbjs:preview',
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url ?? '/').split(/(?=\?)/)
        if (!path.startsWith(b) || /\.[a-z0-9]+$/i.test(path)) return next()
        let rel: string
        try {
          rel = decodeURIComponent(path.slice(b.length))
        } catch {
          return next()
        }
        const file = join(outDir, rel, 'index.html')
        if (existsSync(file) && statSync(file).isFile()) req.url = b + path.slice(b.length).replace(/\/?$/, '/') + 'index.html' + (query ?? '')
        next()
      })
      return () => {
        server.middlewares.use((req, res, next) => {
          const page = join(outDir, '404.html')
          const accept = req.headers.accept ?? ''
          if ((req.method !== 'GET' && req.method !== 'HEAD') || !accept.includes('text/html') || !existsSync(page)) return next()
          // a page Vite's fallback found, such as /index.html for /, is served by the handler after this one
          let asked: string
          try {
            asked = join(outDir, decodeURIComponent((req.url ?? '/').split('?')[0]))
          } catch {
            asked = ''
          }
          if (asked && existsSync(asked) && statSync(asked).isFile()) return next()
          res.statusCode = 404
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end(req.method === 'HEAD' ? undefined : readFileSync(page))
        })
      }
    },
  }
}
