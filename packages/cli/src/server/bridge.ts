// The /__pcbjs/open and /__pcbjs/ide endpoints. docs/ide-bridge.md has the protocol.
import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import launch from 'launch-editor'
import type { Connect, ViteDevServer } from 'vite'

export interface SelectEvent {
  file: string
  line: number
  col: number
  endLine: number
  endCol: number
}

/** A path as given by an editor or the viewer, absolute or relative to the root, both ways. */
export function normalizeFile(root: string, file: string): { abs: string; rel: string } {
  const abs = isAbsolute(file) ? resolve(file) : resolve(root, file)
  return { abs, rel: relative(root, abs).split(sep).join('/') }
}

const int = (v: unknown, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : d
}

export interface IdeBridge {
  middleware: Connect.NextHandleFunction
}

export interface BridgeOptions {
  /** what /__pcbjs/ide lists */
  clients?: () => unknown[]
  /** keyed by connection; a session that takes `pcbjs/select` gets it */
  lsp?: {
    select(key: unknown, ranges: SelectEvent[], reveal: boolean, focus?: boolean): boolean
    keys(): unknown[]
    padSource?(board: string, ref: string, num: string): SelectEvent | undefined
  }
  /** a placement element's range narrowed to its `at` value, for `at=1` */
  atOf?(sel: SelectEvent): Promise<SelectEvent>
}

/** The /__pcbjs/{open,ide} middleware. */
export function ideBridge(server: ViteDevServer, rootOf: (req: IncomingMessage) => string, opts: BridgeOptions = {}): IdeBridge {
  // a file the editor may open: inside a directory Vite is allowed to serve, which holds the project root
  const allowed = (root: string, abs: string) => [root, ...server.config.server.fs.allow].some(d => abs === d || abs.startsWith(d.endsWith(sep) ? d : d + sep))

  const middleware: Connect.NextHandleFunction = async (req, res: ServerResponse, next) => {
    // a page's files are relative to the project it shows
    const root = rootOf(req)
    const url = new URL(req.url ?? '/', 'http://localhost')
    const p = url.pathname
    if (p === '/__pcbjs/ide') {
      res.setHeader('content-type', 'application/json')
      const clients = opts.clients?.() ?? []
      res.end(JSON.stringify({ connected: clients.length, clients }))
      return
    }
    if (p === '/__pcbjs/open') {
      const q = url.searchParams
      const f = q.get('file')
      if (!f) {
        res.statusCode = 400
        res.end('file required')
        return
      }
      const { abs } = normalizeFile(root, f)
      if (!allowed(root, abs) || !existsSync(abs)) {
        res.statusCode = 404
        res.end('not found')
        return
      }
      const line = int(q.get('line'), 1),
        col = int(q.get('col'), 1)
      // a pad goes to its key in the part's connect call when the language server finds one
      const pad = /^(.+)\/([^/]+)$/.exec(q.get('pad') ?? '')
      const given: SelectEvent = (pad && opts.lsp?.padSource?.(q.get('board') ?? '', pad[1], pad[2])) || {
        file: abs,
        line,
        col,
        endLine: int(q.get('endLine'), line),
        endCol: int(q.get('endCol'), col),
      }
      const sel = !pad && q.get('at') === '1' && opts.atOf ? await opts.atOf(given).catch(() => given) : given
      // the language clients on session connections, the editor taking focus as an Open asks, else launch-editor
      const lspKeys = opts.lsp?.keys() ?? []
      if (lspKeys.length) {
        for (const k of lspKeys) opts.lsp!.select(k, [sel], true, true)
        res.setHeader('x-pcbjs-opened', 'ide')
      } else {
        // as Vite's /__open-in-editor
        launch(`${sel.file}:${sel.line}:${sel.col}`, (file: string, err: string | null) => {
          server.config.logger.warn(`[pcbjs] could not open ${file} in an editor${err ? ': ' + err : ''}`, { timestamp: true })
        })
        res.setHeader('x-pcbjs-opened', 'editor')
      }
      res.statusCode = 204
      res.end()
      return
    }
    next()
  }

  return { middleware }
}
