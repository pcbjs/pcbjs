// The stage graph through the command line: plugins from the config and from <PCB plugins>, check --verbose printing every stage, and the dependency graph of a demo board.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { board } from './fixtures/workspace.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const plugin = (name, rule) => `{
  name: '${name}',
  version: '1',
  stages: [{ name: 'note', slot: 'beforeChecks', reads: ['copper'], run: (b, ctx) => (ctx.log('${name} saw ' + b.items.filter(i => i.kind === 'track').length + ' track'), { findings: [{ severity: 'warning', rule: '${rule}', message: '${name} was here', at: [1, 1] }], data: { seen: true } }) }],
}`

test('plugins: the config registers before <PCB plugins>, check --verbose prints each stage and its log, the findings reach the report', () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-stages-'))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(
    join(root, 'pcb.config.ts'),
    `import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], plugins: [${plugin('cfg', 'cfg.note')}] })\n`,
  )
  writeFileSync(join(root, 'pcb.tsx'), board('Plug').replace('<PCB name="Plug">', `<PCB name="Plug" plugins={[${plugin('own', 'own.note')}]}>`))
  const r = spawnSync(process.execPath, [BIN, 'check', '--verbose', '--json', 'report.json'], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const stages = r.stdout
    .split('\n')
    .filter(l => l.startsWith('  stage  '))
    .map(l => l.trim().split(/\s+/)[1])
    .filter(n => !n.includes(':'))
  assert.deepEqual(stages, [
    'evaluate',
    'manual',
    'place',
    'schematic',
    'manualCopper',
    'autoroute',
    'placeFollowers',
    'routeFollowers',
    'tune',
    'patches',
    'finish',
    'cfg/note',
    'own/note',
    'checks',
    'exports',
  ])
  assert.match(r.stdout, /\n {4}cfg saw 1 track\n/)
  const [b] = JSON.parse(readFileSync(join(root, 'report.json'), 'utf8')).boards
  assert.deepEqual(
    b.findings.map(f => `${f.rule} ${f.message}`),
    ['cfg.note cfg was here', 'own.note own was here'],
  )
})
