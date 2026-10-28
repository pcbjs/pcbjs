// pcbjs doctor and the version skew check of check, build and dev.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { distTag, installRange, doctor, installedPackages, minorOf, versionSkew, warnVersionSkew, UPDATE_COMMAND } from '../dist/doctor.js'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const update = `npm install @pcbjs/pcbjs@${distTag(version)}`
const pkgs = (...vs) => vs.map(([name, version]) => ({ name: `@pcbjs/${name}`, version }))

function project(versions) {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-doctor-'))
  for (const [name, version] of Object.entries(versions)) {
    const dir = join(root, 'node_modules', '@pcbjs', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@pcbjs/${name}`, version }))
  }
  writeFileSync(join(root, 'pcb.config.ts'), "export default { entries: ['pcb.tsx'] }\n")
  writeFileSync(join(root, 'pcb.tsx'), 'export default null\n')
  return root
}

test('minorOf: major.minor, prereleases and patches ignored', () => {
  assert.equal(minorOf('0.0.1'), '0.0')
  assert.equal(minorOf('0.1.0-beta.1'), '0.1')
  assert.equal(minorOf('1.4.12'), '1.4')
})

test('versionSkew: one minor is clean, 0.0.x counts as one minor', () => {
  assert.equal(versionSkew(pkgs(['core', '0.0.1'], ['cli', '0.0.1'], ['lib', '0.0.2'])), null)
  assert.equal(versionSkew(pkgs(['core', '0.0.1-beta.0'], ['cli', '0.0.1-beta.1'], ['lib', '0.0.0'])), null)
  assert.equal(versionSkew(pkgs(['core', '0.1.0-beta.1'], ['cli', '0.1.3'])), null)
  assert.equal(versionSkew([]), null)
})

test('versionSkew: two minors name every version and the fix', () => {
  const line = versionSkew(pkgs(['core', '0.1.0'], ['cli', '0.2.0']))
  assert.match(line, /@pcbjs\/core 0\.1\.0, @pcbjs\/cli 0\.2\.0/)
  assert.ok(line.endsWith(`run ${UPDATE_COMMAND}`))
  assert.notEqual(versionSkew(pkgs(['core', '1.0.0'], ['cli', '0.9.0'])), null)
})

test('distTag: the prerelease name of a version, else latest', () => {
  assert.equal(distTag('0.0.1-beta.0'), 'beta')
  assert.equal(distTag('0.0.2-next.1a2b3c4'), 'next')
  assert.equal(distTag('0.1.0'), 'latest')
  assert.equal(UPDATE_COMMAND, update)
})

test('installRange: the dist-tag of a prerelease, else the minor', () => {
  assert.equal(installRange('0.0.1-beta.0'), 'beta')
  assert.equal(installRange('0.0.1-next.1a2b3c4'), 'next')
  assert.equal(installRange('0.0.1'), '~0.0.0')
  assert.equal(installRange('0.1.3'), '~0.1.0')
})

test('versionSkew: the editor extension is versioned on its own', () => {
  assert.equal(versionSkew(pkgs(['core', '0.1.0'], ['vscode', '0.4.0'])), null)
})

test('installedPackages: reads node_modules/@pcbjs of the project', () => {
  const root = project({ core: '0.1.0', lib: '0.1.2' })
  try {
    assert.deepEqual(
      installedPackages(root).map(p => `${p.name}@${p.version}`),
      ['@pcbjs/core@0.1.0', '@pcbjs/lib@0.1.2'],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('doctor: prints versions, formats and config, exits 1 on a skew', async () => {
  const root = project({ core: '0.1.0', lib: '0.2.0' })
  try {
    const lines = []
    const code = await doctor({ root, log: l => lines.push(l) })
    const out = lines.join('\n')
    assert.equal(code, 1)
    assert.match(out, /^node\s+v\d+/m)
    assert.match(out, /^@pcbjs\/core\s+0\.1\.0/m)
    assert.match(out, /^formats\s+router \S+, tune \S+, reference \d+/m)
    assert.match(out, /^config\s+pcb\.config\.ts/m)
    assert.match(out, /^entries\s+pcb\.tsx/m)
    assert.ok(out.includes(`; run ${update}`), out)
    assert.match(out, /error: @pcbjs packages disagree/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('doctor: the repository tree agrees', async () => {
  const lines = []
  assert.equal(await doctor({ root: new URL('../../../examples/demo', import.meta.url).pathname, log: l => lines.push(l) }), 0, lines.join('\n'))
  assert.match(lines.join('\n'), /versions agree/)
})

test('warnVersionSkew: one warning line per process', () => {
  const root = project({ core: '0.1.0', cli: '0.3.0' })
  try {
    const lines = []
    warnVersionSkew(root, l => lines.push(l))
    warnVersionSkew(root, l => lines.push(l))
    assert.equal(lines.length, 1)
    assert.match(lines[0], /^pcbjs: warning: @pcbjs packages disagree/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
