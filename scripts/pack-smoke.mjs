#!/usr/bin/env node
// Installs pcbjs from `npm pack` tarballs into a fresh project and uses it; exits 1 on any problem.
// Flags: --keep keeps the temp folder, --port <n> for shot, --no-shot.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const keep = args.includes('--keep')
const noShot = args.includes('--no-shot')
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : process.env.PACK_SMOKE_PORT
const nodeDir = dirname(process.execPath)
const env = { ...process.env, PATH: `${nodeDir}:${process.env.PATH}` }
for (const k of Object.keys(env)) if (/^npm_(package|lifecycle)_|^INIT_CWD$/.test(k)) delete env[k]

const problems = [],
  warnings = []
const fail = what => {
  problems.push(what)
  console.log(`  FAIL  ${what}`)
}
const warn = what => {
  warnings.push(what)
  console.log(`  warn  ${what}`)
}
const ok = what => console.log(`  ok    ${what}`)
const section = title => console.log(`\n== ${title}`)
const tail = (text, n) =>
  text
    .trim()
    .split('\n')
    .slice(-n)
    .map(l => `        ${l}`)
    .join('\n')

function npm(argv, cwd) {
  const npmCli = process.env.npm_execpath?.endsWith('.js') ? process.env.npm_execpath : null
  const [cmd, full] = npmCli ? [process.execPath, [npmCli, ...argv]] : [join(nodeDir, 'npm'), argv]
  return spawnSync(cmd, full, { cwd, env, encoding: 'utf8', maxBuffer: 64 << 20 })
}

function run(label, cmd, argv, cwd, timeout = 600000) {
  const start = Date.now()
  const r = spawnSync(cmd, argv, { cwd, env, encoding: 'utf8', maxBuffer: 64 << 20, timeout })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const secs = ((Date.now() - start) / 1000).toFixed(1)
  if (r.status !== 0) {
    fail(`${label}: exit ${r.status ?? r.signal} after ${secs} s`)
    console.log(tail(out, 40))
  } else ok(`${label}  ${secs} s`)
  return { status: r.status, out }
}

const work = mkdtempSync(join(tmpdir(), 'pcbjs-pack-smoke-'))
const packs = join(work, 'packs'),
  host = join(work, 'host'),
  apps = join(work, 'apps')
for (const d of [packs, host, apps]) mkdirSync(d)
console.log(`pack smoke in ${work}`)

section('npm pack')
const workspaces = readdirSync(join(ROOT, 'packages'))
  .sort()
  .map(d => join(ROOT, 'packages', d))
  .filter(d => existsSync(join(d, 'package.json')))
  .map(dir => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')))
  .filter(pkg => !pkg.private)
const tarballs = new Map()
for (const { name } of workspaces) {
  const r = npm(['pack', '--json', '--pack-destination', packs, '-w', name], ROOT)
  let info
  try {
    info = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')))[0]
  } catch {}
  if (r.status !== 0 || !info) {
    fail(`npm pack ${name}: ${tail(r.stderr || r.stdout, 5)}`)
    continue
  }
  tarballs.set(name, join(packs, info.filename))
  ok(`${name}  ${info.entryCount} files  ${(info.size / 1024).toFixed(0)} kB`)
}
// the same spec in dependencies and overrides, so nested @pcbjs deps take the tarballs too
const fileSpecs = Object.fromEntries([...tarballs].map(([n, f]) => [n, `file:${f}`]))
const META = '@pcbjs/pcbjs'
if (!tarballs.has(META)) {
  fail(`${META} was not packed`)
  finish()
}

function install(dir, label) {
  const r = npm(['install', '--no-audit', '--no-fund', '--loglevel=error'], dir)
  if (r.status !== 0) {
    fail(`npm install in ${label}:\n${tail(r.stderr || r.stdout, 15)}`)
    return false
  }
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'))
  const fromRegistry = Object.entries(lock.packages ?? {})
    .filter(([p, v]) => /node_modules\/@pcbjs\/[^/]+$/.test(p) && !v.resolved?.startsWith('file:') && !v.link)
    .map(([p, v]) => `${p} ${v.resolved ?? v.version}`)
  if (fromRegistry.length) fail(`${label}: @pcbjs packages from the registry: ${fromRegistry.join(', ')}`)
  else ok(`npm install in ${label}`)
  return true
}

section('pcbjs create from the packed CLI')
writeFileSync(join(host, 'package.json'), JSON.stringify({ name: 'host', private: true, type: 'module', dependencies: { [META]: fileSpecs[META] }, overrides: fileSpecs }, null, 2))
const app = join(apps, 'smoke')
if (install(host, 'the host folder')) run('pcbjs create smoke', join(host, 'node_modules/.bin/pcbjs'), ['create', 'smoke'], apps)
if (!existsSync(join(app, 'pcb.tsx'))) {
  fail('pcbjs create made no project; copying the template by hand to go on')
  cpSync(join(ROOT, 'packages/cli/templates/board'), app, { recursive: true })
  cpSync(join(app, '_gitignore'), join(app, '.gitignore'))
}

section('install the fresh project from the tarballs')
const appPkgFile = join(app, 'package.json')
const appPkg = JSON.parse(readFileSync(appPkgFile, 'utf8'))
ok(
  `created with ${Object.entries({ ...appPkg.dependencies, ...appPkg.devDependencies })
    .map(([n, v]) => `${n}@${v}`)
    .join(', ')}`,
)
for (const field of ['dependencies', 'devDependencies'])
  for (const n of Object.keys(appPkg[field] ?? {})) {
    if (!n.startsWith('@pcbjs/')) continue
    if (tarballs.has(n)) appPkg[field][n] = fileSpecs[n]
    else {
      fail(`the template depends on ${n}, which no workspace package packs`)
      delete appPkg[field][n]
    }
  }
appPkg.overrides = fileSpecs
writeFileSync(appPkgFile, JSON.stringify(appPkg, null, 2) + '\n')
if (!install(app, 'the fresh project')) finish()

section('static checks of the installed packages')
const nodeModules = join(app, 'node_modules')
const builtins = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`)])
const packageOf = spec =>
  spec
    .split('/')
    .slice(0, spec.startsWith('@') ? 2 : 1)
    .join('/')
const filesUnder = dir =>
  readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    return f === 'node_modules' ? [] : statSync(p).isDirectory() ? filesUnder(p) : [p]
  })
const importRe = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bnew\s+URL\s*\(\s*)(['"`])([^'"`\n]+)\1/g

for (const name of [...tarballs.keys()].sort()) {
  const dir = join(nodeModules, ...name.split('/'))
  if (!existsSync(dir)) {
    ok(`${name}  not installed by the meta package`)
    continue
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const declared = new Set([name, ...['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap(f => Object.keys(pkg[f] ?? {}))])
  const before = problems.length
  const targets = []
  const collect = v => (typeof v === 'string' ? targets.push(v) : v && typeof v === 'object' && Object.values(v).forEach(collect))
  collect(pkg.exports)
  for (const t of targets) if (!existsSync(join(dir, t.split('*')[0]))) fail(`${name}: exports target ${t} is missing`)
  for (const b of Object.values(typeof pkg.bin === 'string' ? { b: pkg.bin } : (pkg.bin ?? {}))) if (!existsSync(join(dir, b))) fail(`${name}: bin ${b} is missing`)
  if (pkg.main && !existsSync(join(dir, pkg.main))) fail(`${name}: main ${pkg.main} is missing`)
  const undeclared = new Map()
  for (const file of filesUnder(dir).filter(f => /\.(m?js|ts|vue)$/.test(f))) {
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const [, , spec] of text.matchAll(importRe)) {
      if (spec.includes('${')) continue
      if (spec.startsWith('.')) {
        const base = resolve(dirname(file), spec.split('?')[0])
        const candidates = [base, `${base}.ts`, `${base}.js`, `${base}.vue`, join(base, 'index.ts'), join(base, 'index.js'), base.replace(/\.js$/, '.ts')]
        if (!candidates.some(c => existsSync(c))) fail(`${name}: ${relative(dir, file)} imports ${spec}, not in the package`)
      } else if (/^[@a-z]/i.test(spec) && !spec.includes(':') && !builtins.has(spec) && !builtins.has(packageOf(spec)) && !/^(virtual|vscode$)/.test(spec)) {
        if (!declared.has(packageOf(spec))) undeclared.set(packageOf(spec), relative(dir, file))
      }
    }
  }
  for (const [dep, file] of undeclared) fail(`${name}: ${file} imports ${dep}, not in its dependencies or peerDependencies`)
  if (!existsSync(join(dir, 'LICENSE')) && !existsSync(join(dir, 'LICENSE.md'))) warn(`${name}: no LICENSE`)
  if (problems.length === before) ok(`${name}@${pkg.version}  exports, bin and imports resolve`)
}

const runtimeFiles = [
  ['@pcbjs/cli', 'docs/quickstart.md', 'the docs pcbjs docs prints'],
  ['@pcbjs/cli', 'templates/board/pcb.tsx', 'the create template'],
  ['@pcbjs/cli', 'templates/board/_gitignore', 'the create template .gitignore'],
  ['@pcbjs/cli', 'vscode/manifest.json', 'the bundled VS Code extension, from npm run package -w @pcbjs/vscode'],
  ['@pcbjs/viewer', 'index.html', 'the viewer page Vite serves'],
  ['@pcbjs/viewer', 'src/main.ts', 'the viewer source Vite serves'],
  ['@pcbjs/lsp', 'dist/index.js', 'the language server'],
  ['occt-import-js', 'dist/occt-import-js.wasm', "the step converter's wasm"],
]
for (const [n, f, what] of runtimeFiles) {
  if (existsSync(join(nodeModules, n, f))) ok(`${what}: ${n}/${f}`)
  else fail(`${what} missing: ${n}/${f}`)
}
const extDir = join(nodeModules, '@pcbjs/cli/vscode')
if (existsSync(join(extDir, 'manifest.json'))) {
  const vsix = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8')).file ?? 'vscode-pcbjs.vsix'
  if (existsSync(join(extDir, vsix))) ok(`the bundled VSIX: @pcbjs/cli/vscode/${vsix}`)
  else fail(`the bundled VSIX missing: @pcbjs/cli/vscode/${vsix}`)
}
const shippedDocs = join(nodeModules, '@pcbjs/cli/docs')
const missingDocs = readdirSync(join(ROOT, 'docs')).filter(f => f.endsWith('.md') && !existsSync(join(shippedDocs, f)))
if (missingDocs.length) fail(`@pcbjs/cli/docs lacks ${missingDocs.join(', ')}`)

section('pcbjs in the fresh project')
const bin = join(nodeModules, '.bin/pcbjs')
if (!existsSync(bin)) {
  fail('the fresh project has no node_modules/.bin/pcbjs')
  finish()
}
const pcbjs = (label, argv, timeout) => run(`pcbjs ${label}`, bin, argv, app, timeout)
const expect = (r, re, what) => {
  if (r.status === 0 && !re.test(r.out)) fail(what)
}

expect(pcbjs('doctor', ['doctor']), /versions agree/, 'doctor: no `versions agree`')
const check = pcbjs('check', ['check'])
expect(check, /DRC ok\s+ERC ok/, 'check: the board line does not say DRC ok ERC ok')
expect(check, /typecheck\s+ok/, 'check: no `typecheck ok` line')
if (pcbjs('build -q', ['build', '-q']).status === 0) {
  const readme = readdirSync(join(app, '.pcbjs/fab'), { recursive: true })
    .map(String)
    .find(f => f.endsWith('README-fab.txt'))
  if (!readme || !readFileSync(join(app, '.pcbjs/fab', readme), 'utf8').includes('STATUS: ORDERABLE')) fail('build: no README-fab.txt with STATUS: ORDERABLE')
  if (!existsSync(join(app, '.pcbjs/dist/index.html'))) fail('build: no .pcbjs/dist/index.html')
}
expect(pcbjs('inspect', ['inspect']), /\bR1\b/, 'inspect: R1 not listed')
pcbjs('inspect R1', ['inspect', 'R1'])
expect(pcbjs('docs cli', ['docs', 'cli']), /^# CLI/, 'docs cli: not the CLI topic')
pcbjs('docs', ['docs'])

const stepFile = join(ROOT, 'examples/highspeed/models/R_0603_1608Metric.step')
if (existsSync(stepFile)) {
  const source = join(work, 'R_0603_1608Metric.step')
  cpSync(stepFile, source)
  pcbjs('model add <step> --ref R1 --write', ['model', 'add', source, '--ref', 'R1', '--write'])
  if (!readFileSync(join(app, 'pcb.tsx'), 'utf8').includes('R_0603_1608Metric.step')) fail('model add --write did not put the model into pcb.tsx')
  expect(pcbjs('model check', ['model', 'check']), /R_0603_1608Metric/, 'model check: the STEP model is not listed')
  pcbjs('check with the model', ['check'])
} else expect(pcbjs('model check', ['model', 'check']), /R1/, 'model check: R1 not listed')

if (noShot) console.log('  skip  shot, --no-shot')
else {
  const chrome = spawnSync(process.execPath, ['--input-type=module', '-e', "console.log((await import('@pcbjs/cli/shot')).findChrome() ?? '')"], {
    cwd: app,
    env,
    encoding: 'utf8',
  })
  if (chrome.status !== 0) fail(`@pcbjs/cli/shot does not load: ${tail(chrome.stderr, 1).trim()}`)
  else if (!chrome.stdout.trim()) console.log('  skip  shot, no Chrome found')
  else {
    const shots = join(work, 'shots')
    if (pcbjs('shot', ['shot', '-o', shots, ...(port ? ['-p', String(port)] : [])], 300000).status === 0) {
      const pngs = existsSync(shots) ? readdirSync(shots).filter(f => f.endsWith('.png')) : []
      if (pngs.length < 2) fail(`shot wrote ${pngs.length} PNGs, expected 2`)
      else ok(`shots: ${pngs.join(', ')}`)
    }
  }
}

finish()

function finish() {
  console.log()
  if (keep) console.log(`kept ${work}`)
  else rmSync(work, { recursive: true, force: true })
  if (warnings.length) console.log(`${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${warnings.join('; ')}`)
  if (problems.length) {
    console.log(`pack smoke FAILED, ${problems.length} problem${problems.length === 1 ? '' : 's'}:`)
    for (const p of problems) console.log(`  - ${p}`)
    process.exit(1)
  }
  console.log('pack smoke ok')
  process.exit(0)
}
