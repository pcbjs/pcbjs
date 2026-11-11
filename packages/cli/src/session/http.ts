// The session's HTTP routes under /__pcbjs/, docs/workspace.md: the scopes, a scope's boards, an isolated preview's files and a board's
// files. A page names its project by its route, so a board file is the one of the scope the page that asked for it shows.
import type { Connect } from 'vite'
import { zipFab } from '@pcbjs/export/internal/fab'
import { variantSlug } from '@pcbjs/core/internal/variants'
import { errorOf, liveSlots, routeEndpoint, slotName, slugsOf } from '../project/boards.js'
import type { Artifact, Held } from '../project/compiler.js'
import type { Compiled } from '../project/project.js'
import { previewRoute } from '../project/preview.js'
import type { Hub } from './hub.js'

/** A board file of dev the compile thread keeps: the SVG, the fab zip or one fab file; null for any other. */
async function artifactFile(
  c: Held,
  file: string,
  fetch: <K extends Artifact>(kind: K) => Promise<Compiled[K]>,
): Promise<{ type: string; body: string | Buffer; name?: string } | null> {
  const zip = c.site.fab.name
  if (file === `${c.board.name}.pcb.svg`) return { type: 'image/svg+xml', body: (await fetch('svg')) ?? '' }
  if (file === 'fab/latest.zip' || file === `fab/${zip}`) return { type: 'application/zip', body: Buffer.from(zipFab(await fetch('fab'))), name: zip }
  const name = file.slice('fab/'.length)
  if (file.startsWith('fab/') && c.site.fab.files.includes(name)) return { type: 'text/plain; charset=utf-8', body: (await fetch('fab')).files[name] }
  return null
}

export function httpRoutes(h: Hub): Connect.NextHandleFunction {
  const { ws } = h
  const json = (res: Parameters<Connect.NextHandleFunction>[1], body: unknown) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }
  return async (req, res, next) => {
    const url = (req.url ?? '').split('?')[0]
    if (!url.startsWith('/__pcbjs/')) return next()
    if (url === '/__pcbjs/scopes') return json(res, h.workspaceInfo())
    const sm = /^\/__pcbjs\/scope\/([^/]+)\/?$/.exec(url)
    if (sm) {
      const sc = ws.scopes.find(x => x.slug === decodeURIComponent(sm[1]))
      if (!sc) {
        res.statusCode = 404
        res.end('no such scope')
        return
      }
      const rt = await h.show(sc)
      await rt?.compiledOnce()
      const body = rt ? h.payload(rt) : { boards: [], single: true, errors: { [sc.configFile.slice(sc.dir.length + 1)]: sc.error ?? 'not loaded' }, entries: {}, scope: sc.slug }
      return json(res, { ...body, workspace: h.workspaceInfo() })
    }
    const root = h.rootOfRequest(req)
    const pr = previewRoute(url.slice('/__pcbjs/'.length))
    if (pr) {
      const own = h.runtimes().sort((a, b) => Number(b.root === root) - Number(a.root === root))
      const c = own.find(rt => rt.state.preview?.rel === pr.rel)?.state.preview?.compiled ?? null
      if (!c) {
        res.statusCode = 404
        res.end('no preview')
        return
      }
      if (pr.file === 'board.json') return json(res, c.site)
      if (pr.file.endsWith('.pcb.svg')) {
        res.setHeader('content-type', 'image/svg+xml')
        res.end(c.svg)
        return
      }
      if (pr.file === `fab/${c.fab.zipName}`) {
        res.setHeader('content-type', 'application/zip')
        res.end(Buffer.from(zipFab(c.fab)))
        return
      }
      if (pr.file.startsWith('fab/') && c.fab.files[pr.file.slice(4)] !== undefined) {
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.end(c.fab.files[pr.file.slice(4)])
        return
      }
      res.statusCode = 404
      res.end('not found')
      return
    }
    const sc = ws.scopes.find(s => s.dir === root)
    const rt = sc ? await h.load(sc) : null
    await rt?.compiledOnce()
    const settled = rt ? await rt.settle(120_000) : null
    if (rt && (!settled?.snap || settled.stale)) {
      res.statusCode = 503
      res.end('Current board outputs are not ready. Try again after compilation settles.')
      return
    }
    const slots = rt?.state.slots ?? []
    const live = liveSlots(slots)
    const route = routeEndpoint(url.slice('/__pcbjs/'.length), live.map(slotName), slugsOf(slots))
    if (!rt || !route) {
      res.statusCode = live.length ? 404 : 500
      res.end(live.length ? 'no such board' : slots.map(errorOf).filter(Boolean).join('\n\n') || 'not compiled')
      return
    }
    const targets = live.find(l => slotName(l) === route.name)!.compiled!
    const c = targets.find(t => !route.variant || (t.board.variant && variantSlug(t.board.variant.name) === route.variant)) ?? targets[0]
    if (route.file === 'board.json') return json(res, c.site)
    const got = await artifactFile(c, route.file, kind => rt.artifact(c, kind)).catch((e: Error) => e)
    if (settled?.snap && rt.snapshotStale(settled.snap)) {
      res.statusCode = 503
      res.end('The board changed while preparing its outputs. Try again after compilation settles.')
      return
    }
    if (!got || got instanceof Error) {
      res.statusCode = 404
      res.end(got ? got.message : 'not found')
      return
    }
    res.setHeader('content-type', got.type)
    if (got.name) res.setHeader('content-disposition', `attachment; filename="${got.name}"`)
    res.end(got.body)
  }
}
