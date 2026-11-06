// pcbjs doctor and the version skew check of check, build and dev.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { distTag, doctor, versionSkew, UPDATE_COMMAND } from '../dist/doctor.js'

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

test('versionSkew: two minors name every version and the fix', () => {
  const line = versionSkew(pkgs(['core', '0.1.0'], ['cli', '0.2.0']))
  assert.match(line, /@pcbjs\/core 0\.1\.0, @pcbjs\/cli 0\.2\.0/)
  assert.ok(line.endsWith(`run ${UPDATE_COMMAND}`))
  assert.notEqual(versionSkew(pkgs(['core', '1.0.0'], ['cli', '0.9.0'])), null)
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
    assert.match(out, /^formats\s+cache \d+, compile \S+, router \S+, tune \S+, reference \d+, realm \d+/m)
    assert.match(out, /^config\s+pcb\.config\.ts/m)
    assert.match(out, /^entries\s+pcb\.tsx/m)
    assert.ok(out.includes(`; run ${update}`), out)
    assert.match(out, /error: @pcbjs packages disagree/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
