import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { findFootprint, footprintRoots, loadFootprint, readKicadMod } from '@pcbjs/kicad'
import { footprintFileName, footprintModule } from '@pcbjs/kicad/emit'
import { importBoard } from '@pcbjs/kicad/import-board'
import { loadUserConfig } from './config.js'
import { cliVersion, installRange } from './doctor.js'

export interface ImportOptions {
  kind: string
  source: string
  out?: string
  force?: boolean
  cwd?: string
  log?: (line: string) => void
}

const TSCONFIG = {
  compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', jsxImportSource: '@pcbjs/core', strict: true, noEmit: true, skipLibCheck: true, types: [] },
  include: ['*.ts', '*.tsx', 'lib'],
}

/** Write the files, refusing to replace one unless forced. Returns the paths written and the ones kept. */
function writeAll(root: string, files: Map<string, string>, force: boolean): { written: string[]; kept: string[] } {
  const written: string[] = [], kept: string[] = []
  for (const [rel, text] of files) {
    const f = resolve(root, rel)
    if (existsSync(f) && !force) { kept.push(rel); continue }
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, text)
    written.push(rel)
  }
  return { written, kept }
}

export async function importCommand(o: ImportOptions): Promise<number> {
  const cwd = resolve(o.cwd ?? process.cwd())
  const log = o.log ?? (l => console.log(l))
  if (o.kind === 'footprint') {
    // the project's config may list more library folders
    try { await loadUserConfig('build', undefined, cwd) } catch { /* no config is fine for a footprint */ }
    const isFile = o.source.endsWith('.kicad_mod')
    const file = isFile ? resolve(cwd, o.source) : findFootprint(o.source, { root: cwd })
    if (!file || !existsSync(file)) {
      console.error(`pcbjs import: no footprint ${o.source}${isFile ? '' : ` in ${footprintRoots({ root: cwd }).join(', ') || 'any library: install KiCad or set KICAD_FOOTPRINTS'}`}`)
      return 1
    }
    const fp = isFile ? readKicadMod(file) : loadFootprint(file)
    if (!isFile && o.source.includes(':')) fp.lib = o.source.slice(0, o.source.indexOf(':'))
    const out = o.out ?? join('lib', footprintFileName(fp))
    const m = footprintModule(fp, { source: o.source })
    const { written, kept } = writeAll(cwd, new Map([[out, m.code]]), !!o.force)
    if (kept.length) { console.error(`pcbjs import: ${out} exists; pass --force to replace it`); return 1 }
    log(`pcbjs: wrote ${written[0]}: ${m.exportName}, ${fp.pads.length} pads, pins ${m.pins.join(' ') || 'none'}`)
    log(`  import { ${m.exportName} } from './${relative(cwd, resolve(cwd, out)).replace(/\\/g, '/').replace(/\.tsx$/, '')}'`)
    return 0
  }
  if (o.kind === 'board') {
    const file = resolve(cwd, o.source)
    if (!existsSync(file)) { console.error(`pcbjs import: no such board ${o.source}`); return 1 }
    const out = o.out ?? 'pcb.tsx'
    const outDir = resolve(cwd, dirname(out))
    // the project root: the nearest folder from the output up to the working folder with a package.json, else the output's folder
    let root = outDir
    for (let d = outDir; ; d = dirname(d)) {
      if (existsSync(join(d, 'package.json'))) { root = d; break }
      if (d === cwd || dirname(d) === d || !d.startsWith(cwd)) break
    }
    const toRoot = (p: string) => relative(root, join(outDir, p)).split('\\').join('/')
    const res = importBoard(file, { out: relative(outDir, resolve(cwd, out)), outDir, entry: toRoot(relative(outDir, resolve(cwd, out))) })
    // the board's files go next to the output, the config, tsconfig.json and package.json to the project root
    const files = new Map<string, string>()
    for (const [p, text] of res.files) files.set(p === 'pcb.config.ts' ? 'pcb.config.ts' : toRoot(p), text)
    const config = files.get('pcb.config.ts')!
    // package.json and tsconfig.json are never replaced, not even with --force
    const sub = relative(root, outDir).split('\\').join('/')
    const own = new Map<string, string>()
    if (!existsSync(join(root, 'tsconfig.json'))) own.set('tsconfig.json', JSON.stringify({ ...TSCONFIG, include: sub ? ['*.ts', '*.tsx', sub] : TSCONFIG.include }, null, 2) + '\n')
    if (!existsSync(join(root, 'package.json'))) {
      const name = (relative(dirname(root), root) || 'board').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[-.]+/, '') || 'board'
      own.set('package.json', JSON.stringify({ name, private: true, type: 'module', scripts: { dev: 'pcbjs dev', build: 'pcbjs build', preview: 'pcbjs preview' }, devDependencies: Object.fromEntries(['pcbjs', 'core', 'kicad'].map(p => [`@pcbjs/${p}`, installRange(cliVersion())])) }, null, 2) + '\n')
    }
    const { written, kept } = writeAll(root, files, !!o.force)
    written.push(...writeAll(root, own, false).written)
    // the font files of the text, copied as they are; one already there is kept, the board names it by file
    for (const [rel, from] of res.copies ?? []) {
      const p = toRoot(rel), f = resolve(root, p)
      if (existsSync(f) && !o.force) continue
      mkdirSync(dirname(f), { recursive: true })
      copyFileSync(from, f)
      written.push(p)
    }
    const shown = (p: string) => relative(cwd, join(root, p)) || p
    if (kept.filter(k => k !== 'pcb.config.ts').length) {
      console.error(`pcbjs import: ${kept.filter(k => k !== 'pcb.config.ts').map(shown).join(', ')} exist${kept.length === 1 ? 's' : ''}; pass --force to replace them`)
      return 1
    }
    const c = res.counts
    log(`pcbjs: imported ${o.source}: ${c.parts} parts and ${c.plain} plain footprints, ${c.footprints} footprints (${c.kicadLibrary} from the KiCad library, ${c.lib} in lib/), ${c.nets} nets, ${c.chains} route chains of ${c.segments} segments${c.arcs ? ` and ${c.arcs} arcs` : ''}, ${c.vias} vias, ${c.pours} pours, ${c.keepouts} keepouts, ${c.texts} texts, ${c.graphics} graphics${c.sourced ? `, sourcing of ${c.sourced} parts` : ''}`)
    log(`  wrote ${written.map(shown).join(', ')}`)
    if (kept.includes('pcb.config.ts')) {
      const entry = /entries: \[([^\]]*)\]/.exec(config)?.[1] ?? ''
      log(`  kept ${shown('pcb.config.ts')}; add ${entry} to its entries if it is not there; the rules of the board are:\n${config.split('\n').filter(l => l.startsWith('defineDefaultRules')).join('\n')}`)
    }
    for (const n of res.notes) log(`  note: ${n}`)
    log(`  next: pcbjs check --fab${root !== cwd ? ` in ${shown('.')}` : ''}, then refine as the docs topic import says`)
    return 0
  }
  console.error(`pcbjs import: unknown kind ${o.kind}, use footprint or board`)
  return 1
}
