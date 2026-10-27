// Outline fonts end to end: a project with a font in pcb.config.ts and one given by file on the <text>, through check --fab
// and build, the Gerber self check passing, the legend written as regions and the site drawing filled glyphs.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(PKG, 'bin', 'pcbjs.js')
const FONT = resolve(PKG, '..', 'core', 'tests', 'fixtures', 'fonts', 'RobotoSlab-subset.ttf')
const cli = (cwd, ...args) => new Promise(done => {
  execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NODE_ENV: 'production' }, timeout: 180000 }, (err, stdout, stderr) => {
    done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
  })
})

let root
before(() => {
  root = mkdtempSync(join(tmpdir(), 'pcbjs-outline-'))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(resolve(PKG, '..', '..', 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  mkdirSync(join(root, 'fonts'))
  mkdirSync(join(root, 'boards'))
  copyFileSync(FONT, join(root, 'fonts', 'RobotoSlab.ttf'))
  writeFileSync(join(root, 'pcb.config.ts'), [
    "import { defineConfig } from '@pcbjs/core'",
    "export default defineConfig({ entries: ['boards/label.tsx'], fonts: { slab: { file: './fonts/RobotoSlab.ttf', weight: 700 } } })",
  ].join('\n') + '\n')
  writeFileSync(join(root, 'boards', 'label.tsx'), [
    "import PCB from '@pcbjs/core'",
    'export default (',
    '  <PCB name="Label" revision="1">',
    '    <rect layer="Edge.Cuts" x={0} y={0} w={40} h={16} />',
    '    <text layer="F.SilkS" at="20 4" size={2} font="slab">© 2025 Outline</text>',
    "    <text layer=\"B.SilkS\" at=\"20 9\" size={1.4} font={{ file: '../fonts/RobotoSlab.ttf', weight: 700 }}>BACK</text>",
    "    <text layer=\"F.SilkS\" at=\"20 13\" size={1.2} font={{ file: '../fonts/RobotoSlab.ttf', weight: 100 }} thicken>thin</text>",
    '    <text layer="F.Cu" at="6 13" size={1.5} font="slab">CU</text>',
    '  </PCB>',
    ')',
  ].join('\n') + '\n')
})
after(() => { if (root) rmSync(root, { recursive: true, force: true }) })

test('outline text: check --fab is clean, the self check reading the copper text back', async () => {
  const r = await cli(root, 'check', '--fab')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /DRC 0 errors, 0 warnings, 0 unconnected/)
})

test('outline text: without thicken the thin weight is a silk-width warning naming the text', async () => {
  const f = join(root, 'boards', 'label.tsx')
  const src = readFileSync(f, 'utf8')
  writeFileSync(join(root, 'boards', 'thin.tsx'), src.replace(' thicken>', '>').replace('name="Label"', 'name="Thin"'))
  const r = await cli(root, 'check', 'boards/thin.tsx')
  assert.match(r.stdout, /silk-width .*text "thin" on F\.SilkS in Roboto Slab Thin has strokes 0\.0\d+ mm wide, minimum 0\.15 mm/)
  rmSync(join(root, 'boards', 'thin.tsx'))
})

test('outline text: build writes ORDERABLE fab files with the legend as regions and filled glyphs in the site', async () => {
  const r = await cli(root, 'build', '-q')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const fab = join(root, '.pcbjs', 'fab', 'Label')
  const readme = readFileSync(join(fab, 'README-fab.txt'), 'utf8')
  assert.match(readme, /STATUS: ORDERABLE/)
  assert.match(readme, /Gerber self check: passed/)
  assert.match(readme, /Text is filled regions in the outline font Roboto Slab Bold: \d text items?\. Copyright 20\d\d The Roboto Slab Project Authors.*Licence: .*Apache License, Version 2\.0/)
  assert.match(readme, /Text is filled regions in the outline font Roboto Slab Thin: /)
  assert.doesNotMatch(readme, /Hershey Simplex/, 'no stroke text, no stroke font named')
  const gto = readdirSync(fab).find(n => n.endsWith('.gto'))
  const legend = readFileSync(join(fab, gto), 'utf8')
  assert.ok((legend.match(/^G36\*$/gm) ?? []).length >= 10, 'each glyph a region')
  assert.doesNotMatch(legend, /%ADD\d+C,/, 'no stroke aperture on a legend of outline text only')
  const site = readdirSync(join(root, '.pcbjs', 'dist'), { recursive: true }).filter(n => /\.json$/.test(n)).map(n => readFileSync(join(root, '.pcbjs', 'dist', n), 'utf8')).join('')
  assert.match(site, /data-kind=\\"text\\" fill-rule=\\"evenodd\\"/)
})
