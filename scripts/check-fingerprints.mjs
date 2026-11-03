#!/usr/bin/env node
// Checks every example project, then again after a line inserted at the top of each entry, in a copy beside the others: every finding keeps its
// fingerprint, the known findings of examples/README.md are found by fingerprint in both runs, and every message is its rule's template.
// Usage: node scripts/check-fingerprints.mjs [project dir under examples/ ...]
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '..')
const bin = join(root, 'packages/pcbjs/bin/pcbjs.js')
const examples = join(root, 'examples')
const { messageOf, TEMPLATE_RULES } = await import(join(root, 'packages/compile/dist/messages.js'))

const KNOWN = {
  'eth-phy': ['drc silk-over-edge'],
  'motor-stack/driver': ['erc copper-weight'],
  sdram: ['drc length-match'],
}

function projects(dir) {
  if (readdirSync(dir).some(f => /^pcb\.config\.(ts|mts|js|mjs)$/.test(f))) return [dir]
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .flatMap(e => projects(join(dir, e.name)))
}

function report(dir) {
  const file = join(dir, '.pcbjs', 'fingerprints.json')
  spawnSync(process.execPath, [bin, 'check', '--json', file], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 })
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Each board's fingerprints, `<board>[<target>] <kind> <rule> <fingerprint>`, sorted. */
const prints = r => r.boards.flatMap(b => b.findings.map(f => `${b.name}[${b.target ?? ''}] ${f.kind} ${f.rule} ${f.fingerprint}`)).sort()

const args = process.argv.slice(2)
const dirs = args.length ? args.map(a => join(examples, a)) : projects(examples)
let failed = 0
for (const dir of dirs) {
  const name = relative(examples, dir)
  const copy = mkdtempSync(join(dir, '..', `.fp-${name.replaceAll('/', '-')}-`))
  const problems = []
  try {
    cpSync(dir, copy, { recursive: true, filter: src => !/[\\/](shots|node_modules|fingerprints\.json)$/.test(src) })
    const before = report(copy)
    for (const d of before.diagnostics) if (d.kind !== 'type') problems.push(`${d.entry ?? d.kind}: ${d.message}`)
    for (const b of before.boards)
      for (const f of b.findings) {
        if (!TEMPLATE_RULES.includes(f.rule)) problems.push(`${b.name}: ${f.rule} has no template`)
        else if (f.message !== messageOf(f)) problems.push(`${b.name}: ${f.id} is not its template: ${f.message}`)
      }
    for (const entry of new Set(before.boards.map(b => b.entry))) {
      const file = join(copy, entry)
      writeFileSync(file, `// an unrelated line, which moves every range below it\n${readFileSync(file, 'utf8')}`)
    }
    const after = report(copy)
    const a = prints(before),
      b = prints(after)
    for (const p of a.filter(x => !b.includes(x))) problems.push(`lost ${p}`)
    for (const p of b.filter(x => !a.includes(x))) problems.push(`new ${p}`)
    for (const k of KNOWN[name] ?? []) if (!a.some(p => p.includes(` ${k} `)) || !b.some(p => p.includes(` ${k} `))) problems.push(`known ${k} not matched by fingerprint`)
    console.log(
      `${problems.length ? 'FAIL' : 'ok  '}  ${name}  ${a.length} finding${a.length === 1 ? '' : 's'}${a.length ? `: ${a.map(p => p.split(' ').slice(1).join(' ')).join(', ')}` : ''}`,
    )
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
  for (const p of problems) console.log(`      ${p}`)
  if (problems.length) failed++
}
console.log(`${dirs.length - failed} of ${dirs.length} projects keep every fingerprint`)
process.exit(failed ? 1 : 0)
