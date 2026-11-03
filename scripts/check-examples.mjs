#!/usr/bin/env node
// Runs `pcbjs check` in every example project and fails unless its findings are exactly those in KNOWN, the list in examples/README.md, and every board's schematic draws its symbols.
// Vendor models the repository may not carry are fetched first from their `lcsc:<C-number>` line in models/LICENSES.md.
// Usage: node scripts/check-examples.mjs [--fetch] [project dir under examples/ ...]; --fetch only fetches the models and installs the libraries
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

const root = join(import.meta.dirname, '..')
const bin = join(root, 'packages/pcbjs/bin/pcbjs.js')
const examples = join(root, 'examples')

const KNOWN = {
  'eth-phy': ['warning silk-over-edge'],
  'motor-stack/driver': ['warning copper-weight'],
  sdram: ['error length-match'],
}

// each models/LICENSES.md line "- <file>: lcsc:C965555, ..."; model add rewrites that file, so it is restored after
function fetchVendorModels(dir) {
  const notes = join(dir, 'models', 'LICENSES.md')
  if (!existsSync(notes)) return []
  const text = readFileSync(notes, 'utf8')
  const failed = []
  for (const [, file, code] of text.matchAll(/^- `([^`]+)`: lcsc:(C\d+)/gm)) {
    if (existsSync(join(dir, 'models', file))) continue
    const r = spawnSync(process.execPath, [bin, 'model', 'add', `lcsc:${code}`, '--as', file], { cwd: dir, encoding: 'utf8' })
    if (r.status !== 0 || !existsSync(join(dir, 'models', file))) failed.push(`fetch ${file} from lcsc:${code}: ${`${r.stdout}${r.stderr}`.trim().split('\n').at(-1)}`)
    else console.log(`fetched ${relative(examples, join(dir, 'models', file))} from lcsc:${code}`)
  }
  writeFileSync(notes, text)
  return failed
}

// each file: dependency on a library's package folder, such as file:../power/dist: built with pcbjs build --lib in the folder above it
// and copied into node_modules, as npm installs a packed library; a link would leave its files outside node_modules
function installLibraries(dir) {
  const file = join(dir, 'package.json')
  if (!existsSync(file)) return []
  const p = JSON.parse(readFileSync(file, 'utf8'))
  const failed = []
  for (const [name, spec] of Object.entries({ ...p.dependencies, ...p.devDependencies })) {
    if (!String(spec).startsWith('file:')) continue
    const pkg = resolve(dir, String(spec).slice(5))
    const lib = dirname(pkg)
    const r = spawnSync(process.execPath, [bin, 'build', '--lib', '--out-dir', relative(lib, pkg)], { cwd: lib, encoding: 'utf8' })
    if (r.status !== 0) {
      failed.push(`build --lib in ${relative(examples, lib)}: ${`${r.stdout}${r.stderr}`.trim().split('\n').at(-1)}`)
      continue
    }
    const at = join(dir, 'node_modules', name)
    rmSync(at, { recursive: true, force: true })
    mkdirSync(dirname(at), { recursive: true })
    cpSync(pkg, at, { recursive: true })
  }
  return failed
}

function projects(dir) {
  if (readdirSync(dir).some(f => /^pcb\.config\.(ts|mts|js|mjs)$/.test(f))) return [dir]
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .flatMap(e => projects(join(dir, e.name)))
}

const fetchOnly = process.argv.includes('--fetch')
const args = process.argv.slice(2).filter(a => a !== '--fetch')
const dirs = args.length ? args.map(a => join(examples, a)) : projects(examples)
if (fetchOnly) {
  const failed = dirs.flatMap(d => [...fetchVendorModels(d), ...installLibraries(d)])
  for (const f of failed) console.log(`FAIL  ${f}`)
  process.exit(failed.length ? 1 : 0)
}

const out = mkdtempSync(join(tmpdir(), 'pcbjs-check-'))
let failed = 0

for (const dir of dirs) {
  const name = relative(examples, dir)
  const json = join(out, `${name.replaceAll('/', '_')}.json`)
  const start = Date.now()
  const problems = [...fetchVendorModels(dir), ...installLibraries(dir)]
  const r = spawnSync(process.execPath, [bin, 'check', '--json', json], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 })
  const text = `${r.stdout}${r.stderr}`
  if (!existsSync(json)) problems.push(`no report, exit ${r.status}`)
  else {
    const expected = [...(KNOWN[name] ?? [])]
    const report = JSON.parse(readFileSync(json, 'utf8'))
    if (report.schema !== 'pcbjs.check/1') problems.push(`the report is ${report.schema}, not pcbjs.check/1`)
    for (const d of report.diagnostics ?? []) if (d.kind !== 'type') problems.push(`${d.entry ?? d.kind}: ${d.message}`)
    for (const b of report.boards) {
      if (b.counts?.unconnected) problems.push(`${b.name}: ${b.counts.unconnected} unconnected`)
      if (!(b.schematic?.symbols > 0)) problems.push(`${b.name}: the schematic drew no symbols`)
      for (const f of b.findings) {
        const i = expected.indexOf(`${f.severity} ${f.rule}`)
        if (i < 0) problems.push(`${b.name}: ${f.severity} ${f.rule} ${f.message}`)
        else expected.splice(i, 1)
      }
    }
    for (const k of expected) problems.push(`known ${k} no longer found; update KNOWN and examples/README.md`)
  }
  if (/^\s*error\s+typecheck/m.test(text)) problems.push('type errors')
  const secs = ((Date.now() - start) / 1000).toFixed(1)
  if (problems.length) {
    failed++
    console.log(`FAIL  ${name}  ${secs} s`)
    for (const p of problems) console.log(`      ${p}`)
    console.log(
      text
        .trim()
        .split('\n')
        .slice(-30)
        .map(l => `      | ${l}`)
        .join('\n'),
    )
  } else console.log(`ok    ${name}  ${secs} s`)
}

console.log(`${dirs.length - failed} of ${dirs.length} projects clean`)
process.exit(failed ? 1 : 0)
