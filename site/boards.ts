// The boards the site shows: every entry of each project under examples/ and of site/demos, compiled once per process in Node
// for the numbers a page prints before any script runs. The pages draw them through `?pcb:board`, virtual:site-boards in config.mts.
import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { resolveConfig } from '@pcbjs/cli/internal/config'
import { resolveBoard } from '@pcbjs/cli/vite'
import type { Facets } from '@pcbjs/core/site-facets'
import type { SiteMarker } from '@pcbjs/core/site-data'
import { repo } from './.vitepress/topics'

export type View = '2d' | '3d' | 'sch'
export interface Board {
  /** the page id, /examples/<id>: the project and the entry's stem, slugged */
  id: string
  project: string
  /** the entry relative to the project */
  entry: string
  /** absolute, as `?pcb:board` imports it */
  file: string
  name: string
  views: View[]
  counts: { drcErrors: number; drcWarnings: number; ercErrors: number; ercWarnings: number; unconnected: number }
  /** the first DRC finding, for the home page's DRC row */
  drc?: { rule: string; message: string; src: string }
  /** a board of site/demos, drawn on the home page and not in the gallery */
  site?: boolean
}

const examples = join(repo, 'examples')
const demos = join(repo, 'site/demos')

/** Every directory under examples/ with a pcb.config.ts, one level of nesting allowed, then site/demos. */
function projects(): string[] {
  const out: string[] = []
  for (const d of readdirSync(examples, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue
    const dir = join(examples, d.name)
    if (existsSync(join(dir, 'pcb.config.ts'))) out.push(dir)
    else for (const s of readdirSync(dir, { withFileTypes: true })) if (s.isDirectory() && existsSync(join(dir, s.name, 'pcb.config.ts'))) out.push(join(dir, s.name))
  }
  return [...out.sort(), demos]
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const count = (list: SiteMarker[], severity: string) => list.filter(d => d.severity === severity).length

/** `file:line` of the item a finding names, else of its first source. */
function srcText(d: SiteMarker): string {
  const s = d.src?.find(r => r.role === 'item') ?? d.src?.[0]
  return s ? `${s.file}:${s.start[0]}` : ''
}

async function compileOne(dir: string, entry: { file: string; rel: string }): Promise<Board | null> {
  const project = dir === demos ? 'site/demos' : relative(examples, dir).split('\\').join('/')
  try {
    const { header, facets } = await resolveBoard(entry.file, { facets: ['meta', 'findings', 'sch'] })
    const f = facets as Required<Pick<Facets, 'findings' | 'sch'>>
    const drc = f.findings.drc ?? []
    const erc = f.findings.erc ?? []
    const first = drc.find(d => d.severity === 'error')
    return {
      id: slug(`${project}-${entry.rel.replace(/(\.pcb)?\.tsx$/, '').replace(/^pcb$/, '')}`),
      project,
      entry: entry.rel,
      file: entry.file,
      name: header.board,
      views: ['3d', '2d', ...((f.sch as { schematic?: { drawing?: unknown } }).schematic?.drawing ? (['sch'] as const) : [])],
      counts: {
        drcErrors: count(drc, 'error'),
        drcWarnings: count(drc, 'warning'),
        ercErrors: count(erc, 'error'),
        ercWarnings: count(erc, 'warning'),
        unconnected: f.findings.unconnected ?? 0,
      },
      ...(first ? { drc: { rule: first.rule, message: first.message, src: srcText(first) } } : {}),
      ...(dir === demos ? { site: true } : {}),
    }
  } catch (e) {
    console.warn(`site: ${project}/${entry.rel} left out: ${(e as Error).message.split('\n')[0]}`)
    return null
  }
}

async function load(): Promise<Board[]> {
  const started = Date.now()
  const jobs: { dir: string; entry: { file: string; rel: string } }[] = []
  for (const dir of projects()) for (const entry of (await resolveConfig([], 'build', undefined, dir, () => {})).entries) jobs.push({ dir, entry })
  // a few at a time: each compiles in a thread of its own
  const out: (Board | null)[] = []
  for (let i = 0; i < jobs.length; i += 4) out.push(...(await Promise.all(jobs.slice(i, i + 4).map(j => compileOne(j.dir, j.entry)))))
  const boards = out.filter((b): b is Board => !!b)
  console.log(`site: ${boards.length} boards compiled in Node in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  return boards
}

/** The boards, compiled on the first call of the process; the config, the data loaders and the page routes share them. */
export function siteBoards(): Promise<Board[]> {
  const g = globalThis as unknown as Record<symbol, Promise<Board[]> | undefined>
  return (g[Symbol.for('pcbjs.site.boards')] ??= load())
}
