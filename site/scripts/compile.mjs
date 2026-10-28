// Compiles the project in the working directory as `pcbjs check` does and writes, for the gallery, report.json and each board's SVGs, named in its `svg`.
// With --map <entry>, that board keeps its item ids in the SVGs and gets <n>.map.json, its source ranges with a chip label each, and its fab file list.
// With --site <dir> --base <base>, it also builds the project's prerendered board pages into <dir> as pcbjs build does, served at <base>, for the docs site's frames.
// Usage: node compile.mjs <out> [--map <entry>]... [--site <dir> --base <base>]; boards.mjs runs it once per project, since a project's defaults live on globalThis.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { build as viteBuild } from 'vite'
import { resolveConfig } from '@pcbjs/cli/config'
import { pluginState } from '@pcbjs/cli/plugin'
import { compileServer, compileSlots, logLevelFor, reportOf } from '@pcbjs/cli/check'
import { buildPayload, prerenderSite } from '@pcbjs/cli/build'
import { CLIENT_DIR, viteConfig } from '@pcbjs/cli/vite'
import { boardSvg } from '@pcbjs/export/svg'
import { sourceIndex } from '@pcbjs/export/site-data'
import { buildFab } from '@pcbjs/export/fab'
import { schematicMarkup, schematicStyle } from '@pcbjs/export/sch-svg'

const [dir, ...rest] = process.argv.slice(2)
const out = resolve(dir)
const mapped = new Set(rest.filter((a, i) => rest[i - 1] === '--map'))
const flag = name => rest[rest.indexOf(name) + 1]
const siteDir = rest.includes('--site') ? resolve(flag('--site')) : null
// as pcbjs build sets it: the compile server would set development, giving the site Vue's development build
if (siteDir) process.env.NODE_ENV ??= 'production'
// the layers of a top view; the rest of the board SVG is for tools, not for the gallery
const SHOWN = new Set(['B.Cu', 'F.Cu', 'F.SilkS', 'Edge.Cuts', 'holes'])
// 0.01 mm is below a pixel at any size the site draws a board
const coarse = svg => svg.replace(/-?\d+\.\d{3,}/g, n => String(Math.round(Number(n) * 100) / 100))

/** The board in CSS variables, its top view only, without the metadata, the pcb: namespace and the data attributes; `ids` keeps data-id, data-ref and data-pad. */
function pcbSvg(board, ids) {
  const kept = ids ? /^data-(?:id|ref|pad)$/ : /^$/
  return coarse(boardSvg(board, { vars: true }))
    .replace(/^<\?xml[^>]*>\n/, '')
    .replace(/\s*<metadata>[\s\S]*?<\/metadata>/, '')
    .replace(/\s*<g pcb:layer="([^"]+)"[^>]*>[\s\S]*?<\/g>/g, (g, id) => (SHOWN.has(id) ? g : ''))
    .replace(/ (pcb:[a-z]+|data-[a-z]+|xmlns:pcb)="[^"]*"/g, (a, name) => (kept.test(name) ? a : ''))
    .replace(/ width="[^"]*mm" height="[^"]*mm"/, '')
    .replace(/\n\s*\n/g, '\n')
}

/** The schematic in `--sch-*` variables, which the site's themes set; `ids` keeps each symbol's data-ref. */
function schSvg(board, ids) {
  const d = board.schematic.drawing
  const [x0, y0, x1, y1] = d.page
  const marked = ids ? schematicMarkup(d, board).replace(/(<g class="sch-sym"[^>]*?) data-ref=/g, '$1 sym-ref=') : schematicMarkup(d, board)
  const markup = marked.replace(/ data-[a-z]+="[^"]*"/g, '').replace(/ sym-ref=/g, ' data-ref=')
  return coarse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" class="sch-board">\n<style>${schematicStyle()}</style>\n${markup}\n</svg>\n`)
}

/** What the editor's chip would name a source range: the part, the path command or the kind of item and its net. */
function chip(r, board, text) {
  const items = r.ids.map(id => board.items[id - 1]).filter(Boolean)
  const net = items.find(it => it.net)?.net
  const zone = items.find(it => it.kind === 'zone')
  if (r.seg) return `route ${net} · ${r.seg}`
  if (r.refs.length) return r.refs.join(', ')
  const tag = /^<([A-Z]\w*)/.exec(text)?.[1]
  if (tag) return tag
  if (/^route\(/.test(text)) return `route ${net}`
  if (/^via\(/.test(text)) return `via ${net}`
  if (zone) return `pour ${net} ${zone.layer}`
  if (items.every(it => it.kind === 'track' || it.kind === 'via')) return `route ${net} · ${text}`
  if (items.every(it => it.kind === 'text')) return `text ${items[0].text}`
  if (items.every(it => it.layer === 'Edge.Cuts')) return 'outline'
  return [...new Set(items.map(it => it.kind))].join(', ')
}

/** The ranges of the entry file itself, each with its source text's chip; 1-based lines, columns end inclusive. */
function sourceMap(board, entry, root) {
  const file = relative(root, entry)
  const lines = readFileSync(entry, 'utf8').split('\n')
  const textOf = r => (r.start[0] === r.end[0] ? lines[r.start[0] - 1].slice(r.start[1] - 1, r.end[1]) : lines[r.start[0] - 1].slice(r.start[1] - 1))
  const ranges = sourceIndex(board, p => relative(root, resolve(root, p)))[file] ?? []
  return { file, ranges: ranges.map(r => ({ start: r.start, end: r.end, ids: r.ids, refs: r.refs, chip: chip(r, board, textOf(r)) })) }
}

/** The fab set's file names and the STATUS line of its README. */
function fabList(board) {
  const fab = buildFab(board, '2026-01-01')
  return { files: Object.keys(fab.files).sort(), zip: fab.zipName, status: /STATUS: .*/.exec(fab.readme)?.[0] ?? '' }
}

/** The board pages of the viewer site, prerendered at `base` as pcbjs build does, for the docs site's frames: each page carries only its own board, and nothing an embedded page never requests is kept, so no home page, 404 page, target pages, boards/*.json or fab files. */
async function buildSite(cfg, state, dir, base) {
  Object.assign(cfg, { outDir: dir, base })
  const vc = viteConfig(cfg, state, 'build')
  const logLevel = logLevelFor(cfg)
  state.inline = false
  await viteBuild({ ...vc, logLevel, mode: 'production' })
  const ssrDir = join(cfg.root, '.pcbjs', 'cache', 'ssr')
  await viteBuild({
    ...vc,
    mode: 'production',
    logLevel,
    ssr: { ...vc.ssr, noExternal: true },
    build: {
      ...vc.build,
      ssr: join(CLIENT_DIR, 'src', 'entry-server.ts'),
      outDir: ssrDir,
      emptyOutDir: true,
      copyPublicDir: false,
      rollupOptions: { output: { entryFileNames: 'entry-server.mjs', format: 'es' } },
    },
  })
  const template = join(dir, 'index.html')
  const html = readFileSync(template, 'utf8')
  const payload = buildPayload(state)
  // prerenderSite reads its template from index.html and overwrites it with the home page, so each board starts from the template again
  for (const name of new Set(payload.boards.map(b => b.name))) {
    writeFileSync(template, html)
    await prerenderSite(join(ssrDir, 'entry-server.mjs'), dir, base, { ...payload, boards: payload.boards.filter(b => b.name === name) })
    for (const e of readdirSync(join(dir, 'board', name), { withFileTypes: true })) if (e.isDirectory()) rmSync(join(dir, 'board', name, e.name), { recursive: true })
  }
  for (const f of ['index.html', '404.html']) rmSync(join(dir, f), { force: true })
}

const cfg = await resolveConfig([], 'build', undefined, process.cwd(), () => {})
const state = pluginState(cfg)
const server = await compileServer(cfg, state)
try {
  const errors = new Map()
  await compileSlots(server, cfg, state.slots, errors)
  mkdirSync(out, { recursive: true })
  const boards = []
  for (const s of state.slots) {
    const reports = reportOf(cfg, s, errors.get(s))
    reports.forEach((r, i) => {
      const board = s.compiled?.[i]?.board
      if (!board) return boards.push(r)
      const n = boards.length
      const ids = mapped.has(s.entry.rel)
      writeFileSync(join(out, `${n}.pcb.svg`), pcbSvg(board, ids))
      if (board.schematic.drawing) writeFileSync(join(out, `${n}.sch.svg`), schSvg(board, ids))
      if (ids) writeFileSync(join(out, `${n}.map.json`), JSON.stringify({ ...sourceMap(board, s.entry.file, cfg.root), fab: fabList(board) }))
      boards.push({ ...r, svg: { '2d': `${n}.pcb.svg`, ...(board.schematic.drawing ? { sch: `${n}.sch.svg` } : {}) }, ...(ids ? { map: `${n}.map.json` } : {}) })
    })
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify({ boards }))
} finally {
  await server.close()
}
if (siteDir) await buildSite(cfg, state, siteDir, flag('--base'))
