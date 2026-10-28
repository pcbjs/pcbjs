import { createHash } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import type { Board } from '@pcbjs/core/model'
import type { Finish, Rules } from '@pcbjs/core/types'
import { copperLayers } from '@pcbjs/compile/layers'
import { stackupSum } from '@pcbjs/core/board-spec'
import { excellon } from './excellon.js'
import { VERSION, gerberJob, gerberLayer, type DrillFile, type GerberFile } from './gerber.js'
import { bomCsv, bomRows, cplCsv } from './bom.js'
import { boardSvg } from './svg.js'
import { schematicSvg } from './sch-svg.js'
import { variantSlug } from '@pcbjs/core/variants'
import { boardFindings, formatFindings } from './findings.js'
import { checkFab, type FabCheck } from './fab-check.js'
import { ipc356 } from './ipc356.js'
import { drillMapSvg, drillReport, mapName, type DrillSet } from './drill.js'
import { countModels } from '@pcbjs/core/model-source'
import { bareHole } from '@pcbjs/compile/bare'

/** The fab set's date in UTC: `date`, else `SOURCE_DATE_EPOCH` in seconds, else now, so two builds at one date are byte identical. */
export function fabDate(date?: string, env: Record<string, string | undefined> = process.env): string {
  if (date !== undefined) {
    const d = new Date(/^\d+$/.test(date) ? Number(date) * 1000 : date)
    if (isNaN(d.getTime())) throw new Error(`bad date ${JSON.stringify(date)}: use ISO 8601 such as 2026-01-31 or 2026-01-31T12:00:00Z, or seconds since 1970`)
    return d.toISOString()
  }
  const e = env.SOURCE_DATE_EPOCH
  if (e !== undefined && e !== '') {
    if (!/^\d+$/.test(e.trim())) throw new Error(`SOURCE_DATE_EPOCH must be whole seconds since 1970, got ${JSON.stringify(e)}`)
    return new Date(Number(e.trim()) * 1000).toISOString()
  }
  return new Date().toISOString()
}

/** Every other file of a fab set with its size in bytes and sha256, in name order. */
export function fabManifest(board: Board, files: Record<string, string>, date: string): string {
  const list = Object.keys(files)
    .filter(n => n !== 'manifest.json')
    .sort()
    .map(name => {
      const bytes = strToU8(files[name])
      return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    })
  return (
    JSON.stringify(
      { board: board.name, revision: board.revision || null, ...(board.variant ? { target: board.variant.name } : {}), generator: `pcbjs ${VERSION}`, date, files: list },
      null,
      2,
    ) + '\n'
  )
}

export interface FabSet {
  files: Record<string, string>
  zipName: string
  readme: string
  date: string
}

const FAB_LAYERS = (board: Board) => [...copperLayers(board.copper), 'F.Mask', 'B.Mask', 'F.Paste', 'B.Paste', 'F.SilkS', 'B.SilkS', 'Edge.Cuts']

const RULE_LABELS: [keyof Rules, string][] = [
  ['clearance', 'copper clearance'],
  ['minTrackWidth', 'track width'],
  ['edgeClearance', 'copper to edge'],
  ['holeClearance', 'hole to copper'],
  ['minHoleToHole', 'hole to hole'],
  ['minDrill', 'drill'],
  ['minViaDrill', 'via drill'],
  ['minViaDiameter', 'via diameter'],
  ['minAnnularRing', 'via annular ring'],
  ['minPadAnnularRing', 'pad annular ring'],
  ['maskExpansion', 'mask expansion'],
  ['pasteShrink', 'paste shrink'],
  ['zoneMinWidth', 'zone min width'],
  ['silkMinWidth', 'silk width'],
  ['silkToPad', 'silk to pad'],
  ['maskWeb', 'mask web'],
]
const FINISH_TEXT: Record<Finish, string> = {
  HASL: 'HASL',
  LeadFreeHASL: 'lead-free HASL',
  ENIG: 'ENIG',
  ImmersionSilver: 'immersion silver',
  ImmersionTin: 'immersion tin',
  OSP: 'OSP',
  HardGold: 'hard gold',
}

export function stackupLines(board: Board): string[] {
  const s = board.stackup
  const t = (v: number | undefined) => (v === undefined ? '' : ` ${Math.round(v * 1e4) / 1e4} mm`)
  const lines = s.layers.map(l => {
    if (l.type === 'copper') return `  ${l.name.padEnd(8)} copper${t(l.thickness)}${l.weight !== undefined ? `, ${l.weight} oz` : ''}`
    if (l.type === 'core' || l.type === 'prepreg')
      return `  ${''.padEnd(8)} ${l.type} ${l.material ?? 'FR4'}${t(l.thickness)}${l.er !== undefined ? `, er ${l.er}` : ''}${l.lossTangent !== undefined ? `, tan d ${l.lossTangent}` : ''}`
    if (!('side' in l)) return ''
    const color = l.color ?? (l.type === 'mask' ? s.maskColor : l.type === 'silk' ? s.silkColor : undefined)
    return `  ${`${l.side}.${l.type === 'silk' ? 'SilkS' : l.type === 'mask' ? 'Mask' : 'Paste'}`.padEnd(8)} ${l.type}${t(l.thickness)}${color ? `, ${color.toLowerCase()}` : ''}`
  })
  return [
    `  ${board.copper} copper layers, ${board.thickness} mm${s.thickness === undefined ? '' : ` nominal, layers add up to ${stackupSum(s)} mm`}`,
    `  finish ${s.finish ? FINISH_TEXT[s.finish] : 'not specified'}${s.maskColor ? `, ${s.maskColor.toLowerCase()} mask` : ''}${s.silkColor ? `, ${s.silkColor.toLowerCase()} legend` : ''}`,
    ...lines,
  ]
}

// as docs/fonts.md gives it; the notice travels with the font data
const STROKE_FONTS: Record<string, { name: string; notice: string }> = {
  hershey: {
    name: 'Hershey Simplex',
    notice:
      'The Hershey fonts were created by Dr. A. V. Hershey at the U.S. National Bureau of Standards; the data format by James Hurt, Cognition, Inc.; converted from Paul Bourke\'s "Hershey Vector Font" page; free to use for any purpose.',
  },
  newstroke: { name: 'NewStroke', notice: 'NewStroke is by Vladimir Uryvaev, made for KiCad, released under CC0 1.0.' },
}

// one per font the text uses, stroke fonts first
export function fontNotes(board: Board): string[] {
  const stroke = new Map<string, { n: number; widths: Set<number> }>(),
    outline = new Map<string, number>()
  for (const it of board.items) {
    if (it.kind !== 'text') continue
    if (it.polys) {
      const f = it.font ?? 'an outline font'
      outline.set(f, (outline.get(f) ?? 0) + 1)
      continue
    }
    const k = it.font === 'newstroke' ? 'newstroke' : 'hershey'
    const s = stroke.get(k) ?? { n: 0, widths: new Set<number>() }
    s.n++
    s.widths.add(it.thickness)
    stroke.set(k, s)
  }
  if (!stroke.size && !outline.size) return ['  No text items.']
  const items = (n: number) => `${n} text item${n === 1 ? '' : 's'}`
  const out: string[] = []
  for (const k of ['hershey', 'newstroke']) {
    const s = stroke.get(k)
    if (!s) continue
    out.push(`  Text is stroked in the ${STROKE_FONTS[k].name} font: ${items(s.n)}, line width ${[...s.widths].sort((a, b) => a - b).join(', ')} mm. ${STROKE_FONTS[k].notice}`)
  }
  for (const [f, n] of [...outline].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const o = board.outlineFonts?.[f]
    const notice = [o?.copyright, o?.license ? `Licence: ${o.license}${o.licenseURL ? ` ${o.licenseURL}` : ''}` : o?.licenseURL ? `Licence: ${o.licenseURL}` : undefined]
      .filter(Boolean)
      .map(s => s!.replace(/\s+/g, ' ').trim())
      .map(s => (/[.!]$/.test(s) ? s : `${s}.`))
    out.push(`  Text is filled regions in the outline font ${f}: ${items(n)}.${notice.length ? ` ${notice.join(' ')}` : ' The font file names no copyright or licence.'}`)
  }
  return out
}

/** `check` reads the Gerbers back, see fab-check.ts, before the README is written; `nest: false` is for that check's tests only. */
export function buildFab(board: Board, date = fabDate(), opts: { root?: string; check?: boolean; nest?: boolean } = {}): FabSet {
  const files: Record<string, string> = {}
  const gerbers: GerberFile[] = []
  const known = new Set(board.layers.map(l => l.id))
  // a paste layer with nothing on it is left out: no SMD pads on that side
  const noPaste: string[] = []
  for (const layer of FAB_LAYERS(board)) {
    if (!known.has(layer)) continue
    const g = gerberLayer(board, layer, date, { nest: opts.nest })
    if (g && g.empty && layer.endsWith('.Paste')) {
      noPaste.push(layer)
      continue
    }
    if (g) {
      gerbers.push(g)
      files[g.name] = g.text
    }
  }
  const pth = excellon(board, true, date),
    npth = excellon(board, false, date)
  const drills: DrillFile[] = [],
    sets: DrillSet[] = []
  if (pth) {
    files[`${board.name}-PTH.drl`] = pth.text
    drills.push({ name: `${board.name}-PTH.drl`, plated: true })
    sets.push({ name: `${board.name}-PTH.drl`, plated: true, table: pth })
  }
  if (npth) {
    files[`${board.name}-NPTH.drl`] = npth.text
    drills.push({ name: `${board.name}-NPTH.drl`, plated: false })
    sets.push({ name: `${board.name}-NPTH.drl`, plated: false, table: npth })
  }
  for (const s of sets) files[mapName(board, s)] = drillMapSvg(board, s)
  files[`${board.name}-drill-report.txt`] = drillReport(board, sets, date)
  files[`${board.name}-job.gbrjob`] = gerberJob(board, gerbers, date, drills)
  files[`${board.name}.ipc`] = ipc356(board, date)
  files['bom.csv'] = bomCsv(board)
  files['cpl.csv'] = cplCsv(board)
  files[`${board.name}.pcb.svg`] = boardSvg(board)
  if (board.schematic.drawing) files[`${board.name}.sch.svg`] = schematicSvg(board)
  let selfCheck: FabCheck | null = null
  if (opts.check) {
    selfCheck = checkFab(board, gerbers)
    // a second build of the same board replaces the findings of the first
    const rest = board.drc.filter(d => d.rule !== 'fab-mismatch')
    board.drc = [...rest, ...selfCheck.findings].sort((a, c) => (a.severity === c.severity ? 0 : a.severity === 'error' ? -1 : 1))
  }
  const errors = board.drc.filter(d => d.severity === 'error')
  const warnings = board.drc.filter(d => d.severity === 'warning')
  const ercErrors = board.erc.filter(d => d.severity === 'error')
  const ercWarnings = board.erc.filter(d => d.severity === 'warning')
  const bom = bomRows(board),
    tags = board.sourcingTags ?? []
  const dnp = board.footprints.filter(fp => fp.dnp).map(fp => fp.ref)
  const models = countModels(board.footprints.map(fp => ({ model: fp.model, height: fp.height ?? (bareHole(board, fp) ? 0 : 1) })))
  const sourcing = `Sourcing: ${tags.length ? `tags ${tags.join(', ')}` : 'no tags, MPN only'}; ${bom.length} row${bom.length === 1 ? '' : 's'}, ${bom.filter(r => r.sourcing.mpn === null).length} without a part number`
  const readme = [
    `${board.name}${board.revision ? ` ${board.revision}` : ''}: fabrication set (pcbjs)`,
    ...(board.variant
      ? [
          `Target ${board.variant.name}${board.variant.fab ? `, fab ${board.variant.fab}` : ''}, ${board.variant.index + 1} of ${board.variant.names.length}: ${board.variant.names.join(', ')}`,
        ]
      : []),
    `Generated ${date} by pcbjs ${VERSION}`,
    '',
    `STATUS: ${errors.length || board.unconnected || ercErrors.length ? `NOT ORDERABLE, ${errors.length} DRC errors, ${board.unconnected} unconnected, ${ercErrors.length} ERC errors; the list is under Checks` : 'ORDERABLE'}`,
    '',
    'Board',
    `  ${board.copper} copper layers, ${board.thickness} mm`,
    `  outline ${(Math.round(board.bbox.w * 100) / 100).toFixed(2)} x ${(Math.round(board.bbox.h * 100) / 100).toFixed(2)} mm`,
    `  ${board.stats.footprints} footprints, ${board.stats.pads} pads, ${board.stats.tracks} tracks, ${board.stats.vias} vias, ${board.stats.zones} zones, ${board.stats.nets} nets`,
    `  3D models: ${models.file} from files, ${models.generated} generated, ${models.missing} with no model`,
    '',
    sourcing,
    '',
    'Stackup',
    ...stackupLines(board),
    '',
    'Rules (mm)',
    ...RULE_LABELS.filter(([k]) => board.rules[k] !== undefined).map(([k, name]) => {
      const r = board.rules,
        hc = r.holeClearanceBy,
        hh = r.minHoleToHoleBy
      return `  ${name.padEnd(18)} ${k === 'holeClearance' && hc ? `outer ${hc.outer}, inner ${hc.inner}${hc.via !== undefined ? `, via hole ${hc.via}` : ''}` : k === 'minHoleToHole' && hh ? `pad ${hh.pad}, via to via ${hh.via}` : k === 'maskWeb' && board.stackup?.maskColor ? `${r[k]}, ${board.stackup.maskColor.toLowerCase()} mask` : r[k]}`
    }),
    '',
    'Holes',
    ...(pth ? pth.tools.map(t => `  ${t.d.toFixed(2)} mm plated x${t.count}`) : ['  none plated']),
    ...(npth ? npth.tools.map(t => `  ${t.d.toFixed(2)} mm non-plated x${t.count}`) : []),
    '',
    'Checks',
    `  DRC: ${errors.length} errors, ${warnings.length} warnings, ${board.unconnected} unconnected`,
    `  ERC: ${ercErrors.length} errors, ${ercWarnings.length} warnings`,
    ...(selfCheck
      ? [
          `  Gerber self check: ${selfCheck.findings.length ? `FAILED, ${selfCheck.findings.length} fab-mismatch error${selfCheck.findings.length === 1 ? '' : 's'}` : 'passed'}, ${selfCheck.layers.length} copper and outline files read back and compared with the board`,
        ]
      : []),
    ...formatFindings([{ findings: boardFindings(board, opts.root ?? '') }], { all: true }),
    '',
    'Files',
    ...[...Object.keys(files), 'README-fab.txt', 'manifest.json'].sort().map(n => `  ${n}`),
    '',
    'Notes',
    ...(board.fabNotes ?? []).map(n => `  ${n}`),
    `  Circular arcs are G02 and G03 arcs; zone fills and other curves are segments (chord error 5 um). Pads other than circles are regions.`,
    `  Silkscreen is cleared from the solder mask openings it overlaps.`,
    `  ${board.name}.ipc is the IPC-D-356A netlist for electrical test; manifest.json lists every other file with its sha256.`,
    `  cpl.csv gives each part's ${(board.cpl?.origin ?? 'footprint') === 'center' ? 'courtyard centre' : 'footprint origin'} as Mid X and Mid Y, y up${dnp.length ? `; DNP parts are left out of it and of bom.csv: ${dnp.join(' ')}` : ''}.`,
    ...(noPaste.length ? [`  No paste file for ${noPaste.map(l => (l.startsWith('F.') ? 'the top' : 'the bottom')).join(' or ')}: no SMD pads with paste on that side.`] : []),
    ...fontNotes(board),
    '',
  ]
    .filter(l => l !== null)
    .join('\n')
  files['README-fab.txt'] = readme
  files['manifest.json'] = fabManifest(board, files, date)
  const label = (board.revision || 'dev').replace(/[^\w.+-]+/g, '_')
  const slug = board.variant ? `-${variantSlug(board.variant.name)}` : ''
  return { files, zipName: `${board.name}-fab-${label}${slug}.zip`, readme, date }
}

export function zipFab(fab: FabSet): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, text] of Object.entries(fab.files)) entries[name] = strToU8(text)
  // entries in name order, stamped with the fab date rather than the clock, so the zip is reproducible
  const sorted: Record<string, Uint8Array> = {}
  for (const name of Object.keys(entries).sort()) sorted[name] = entries[name]
  // zip times are local DOS times: shifted by the zone offset to read the fab date in UTC, and clamped to 1980, a zip's first
  const t = Math.max(Date.parse(fab.date), Date.UTC(1980, 0, 1, 12))
  return zipSync(sorted, { level: 6, mtime: new Date(t + new Date(t).getTimezoneOffset() * 60000) })
}
