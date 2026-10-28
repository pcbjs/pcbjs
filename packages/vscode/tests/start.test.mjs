// The Get Started walkthrough, the example picker and the board wizard against the fake editor and a fake spawn.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { FakeChild } from './fake.mjs'
import { ui } from './vscode.mjs'

const require = createRequire(import.meta.url)
const { newFromExample, parseExamples } = require('../dist/examples.cjs')
const { newBoardWizard, sizeError, createFlags, FABS, LAYERS, fabsFor } = require('../dist/wizard.cjs')

const pkgDir = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
const BIN = 'node_modules/@pcbjs/pcbjs/bin/pcbjs.js'
const BUILTIN = ['workbench.action.files.openFolder']

const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pcbjs-start-')))
after(() => rmSync(tmp, { recursive: true, force: true }))
let n = 0
function root() {
  const d = path.join(tmp, `w${n++}`)
  touch(path.join(d, BIN))
  return d
}
function touch(f) {
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, '')
}

function reset(folders) {
  Object.assign(ui, { answers: [], calls: [], folders, files: [], clipboard: [] })
}
const answers = (...a) => ui.answers.push(...a)
const calls = kind => ui.calls.filter(c => c.kind === kind)

/** Children that print the example list for --list-examples and leave a pcb.tsx for create. */
function spawner() {
  const runs = []
  const spawn = (command, args, options) => {
    const child = new FakeChild()
    runs.push({ args: args.slice(1), cwd: options.cwd })
    setImmediate(() => {
      if (args.includes('--list-examples')) child.stdout.write('blinky        three LED channels\ncoin          the smallest board\n')
      else touch(path.join(options.cwd, args[2], 'pcb.tsx'))
      child.exit(0)
    })
    return child
  }
  return { spawn, runs }
}

function host(spawn) {
  const h = { lines: [], done: [], spawn, env: { PATH: '' } }
  Object.assign(h, {
    output: l => h.lines.push(l),
    showOutput() {},
    nodePath: () => process.execPath,
    projectDirs: () => [],
    opened: async (d, f) => void h.done.push([d, f]),
  })
  return h
}

test('walkthrough: one Get started entry, featured for pcbjs projects, every step with SVG media and real commands', () => {
  const [w, ...rest] = pkg.contributes.walkthroughs
  assert.equal(rest.length, 0)
  assert.equal(w.title, 'Get started with pcbjs')
  assert.ok(w.featuredFor.includes('**/pcb.config.{ts,mts,js,mjs}'))
  assert.deepEqual(
    w.steps.map(s => s.id),
    ['create', 'example', 'preview', 'check', 'edit', 'kicad', 'skills'],
  )
  const contributed = new Set(pkg.contributes.commands.map(c => c.command))
  const src = readdirSync(path.join(pkgDir, 'src'))
    .map(f => readFileSync(path.join(pkgDir, 'src', f), 'utf8'))
    .join('\n')
  for (const s of w.steps) {
    assert.ok(s.title && s.description, s.id)
    assert.ok(s.description.split('\n').length <= 3, `${s.id}: two or three lines`)
    assert.match(s.media.svg, /^assets\/walkthrough\/[a-z]+\.svg$/)
    assert.match(readFileSync(path.join(pkgDir, s.media.svg), 'utf8'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s\S]*<\/svg>\s*$/)
    assert.ok(s.media.altText, s.id)
    const linked = [...s.description.matchAll(/\(command:([\w.]+)/g)].map(m => m[1])
    const events = s.completionEvents.filter(e => e.startsWith('onCommand:')).map(e => e.slice('onCommand:'.length))
    assert.ok(linked.length && s.completionEvents.length, s.id)
    for (const id of [...linked, ...events]) {
      if (BUILTIN.includes(id)) continue
      assert.ok(contributed.has(id), `${s.id}: ${id} is contributed`)
      assert.ok(src.includes(`'${id}'`), `${s.id}: ${id} is registered`)
    }
  }
  for (const id of ['pcbjs.newFromExample', 'pcbjs.newBoardWizard', 'pcbjs.check', 'pcbjs.walkthrough']) assert.ok(contributed.has(id) && src.includes(`'${id}'`), id)
})

test('example picker: the CLI list with a line each, a folder named after the example, then create --example and the preview', async () => {
  const r = root()
  reset([r])
  let shown
  answers(['pick', o => ((shown = o), o.items[1])], ['input', o => o.value])
  const { spawn, runs } = spawner()
  const h = host(spawn)
  assert.equal(await newFromExample(h), path.join(r, 'coin'))
  assert.deepEqual(
    shown.items.map(i => [i.label, i.detail]),
    [
      ['blinky', 'three LED channels'],
      ['coin', 'the smallest board'],
    ],
  )
  assert.equal(calls('input')[0].value, 'coin', 'the folder is not empty, so the example names a new one')
  assert.deepEqual(
    runs.map(x => x.args),
    [
      ['create', '--list-examples'],
      ['create', 'coin', '--example', 'coin'],
    ],
  )
  assert.deepEqual(h.done, [[path.join(r, 'coin'), path.join(r, 'coin', 'pcb.tsx')]])
  assert.deepEqual(parseExamples(['qfn-breakout  a QFN64 to headers', 'noise']), [{ name: 'qfn-breakout', description: 'a QFN64 to headers' }])
})

test('wizard: Enter through every step takes the defaults and creates a 50 x 40 mm JLCPCB 2-Layer board', async () => {
  const r = root()
  reset([r])
  answers(['inputBox', 'accept'], ['quickPick', 'active'], ['quickPick', 'active'], ['quickPick', 'active'], ['inputBox', 'accept'])
  const { spawn, runs } = spawner()
  const h = host(spawn)
  assert.equal(await newBoardWizard(h), path.join(r, 'board'))
  const steps = ui.calls.filter(c => c.kind === 'inputBox' || c.kind === 'quickPick')
  assert.deepEqual(
    steps.map(s => [s.step, s.totalSteps, s.buttons.length]),
    [
      [1, 5, 0],
      [2, 5, 1],
      [3, 5, 1],
      [4, 5, 1],
      [5, 5, 1],
    ],
  )
  assert.equal(steps[0].value, 'board')
  assert.deepEqual(
    [steps[1], steps[2], steps[3]].map(s => s.active[0].label),
    ['2 layers', 'JLCPCB/2-Layer', 'Rounded rectangle'],
  )
  assert.equal(steps[4].value, '50 x 40')
  assert.deepEqual(
    runs.map(x => x.args),
    [['create', 'board', '--layers', '2', '--fab', 'JLCPCB/2-Layer', '--outline', 'rounded:2', '--size', '50x40']],
  )
  assert.deepEqual(h.done, [[path.join(r, 'board'), path.join(r, 'board', 'pcb.tsx')]])
})

test('wizard: Back keeps the answers, a new layer count picks its JLCPCB preset, a circle asks for a diameter; Escape creates nothing', async () => {
  const r = root()
  reset([r])
  const seen = []
  const look = a => o => (seen.push(o), typeof a === 'function' ? a(o) : a)
  answers(
    ['inputBox', look('mine')],
    ['quickPick', look(o => o.items.find(i => i.label === '4 layers'))],
    ['quickPick', look('back')],
    ['quickPick', look('active')],
    ['quickPick', look('active')],
    ['quickPick', look(o => o.items.find(i => i.label === 'Circle'))],
    ['inputBox', look('back')],
    ['quickPick', look('active')],
    ['inputBox', look('30')],
  )
  const { spawn, runs } = spawner()
  assert.equal(await newBoardWizard(host(spawn)), path.join(r, 'mine'))
  assert.equal(seen[3].active[0].label, '4 layers', 'Back shows the layer step with the earlier answer')
  assert.deepEqual(
    seen[4].items.map(i => i.label),
    ['JLCPCB/4-Layer', 'JLCPCB/4-Layer-3313', 'PCBWay/4-Layer', 'OSHPark/4-Layer', 'Eurocircuits/4-Layer', 'AdvancedPCB/4-Layer'],
  )
  assert.equal(seen[4].active[0].label, 'JLCPCB/4-Layer')
  assert.equal(seen[6].value, '40', 'a circle prefills its diameter')
  assert.equal(seen[7].active[0].label, 'Circle')
  assert.deepEqual(
    runs.map(x => x.args),
    [['create', 'mine', '--layers', '4', '--fab', 'JLCPCB/4-Layer', '--outline', 'circle', '--size', '30']],
  )

  reset([r])
  answers(['inputBox', 'accept'], ['quickPick', 'active'], ['quickPick', undefined])
  const s = spawner()
  assert.equal(await newBoardWizard(host(s.spawn)), undefined)
  assert.equal(s.runs.length, 0)
  assert.ok(!existsSync(path.join(r, 'board-2')))
})

test('wizard: the presets are those of @pcbjs/fab, every layer count has a JLCPCB default, sizes the template fits', async () => {
  const fab = await import(path.resolve(pkgDir, '../fab/dist/index.js'))
  assert.deepEqual(FABS, [...fab.FABS])
  for (const l of LAYERS) assert.ok(fabsFor(l).includes(`JLCPCB/${l}-Layer`), String(l))
  assert.equal(sizeError('50 x 40', false), undefined)
  assert.equal(sizeError('50x40', false), undefined)
  assert.match(sizeError('10 x 10', false), /At least 20 x 15/)
  assert.match(sizeError('40 x 30', true), /one diameter/)
  assert.match(sizeError('20', true), /At least 26/)
  assert.match(sizeError('big', false), /width and height/)
  assert.deepEqual(createFlags({ name: 'x', layers: 6, fab: 'JLCPCB/6-Layer', outline: 'rect', size: '60 × 45' }).slice(-2), ['--size', '60x45'])
})
