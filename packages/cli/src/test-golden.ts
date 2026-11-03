// The built-in test per golden folder: the board's current fab set against `golden/<board>[-<target slug>]/`, see project/golden.ts.
import { test } from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { compareGolden } from './project/golden.js'

const root = process.env.PCBJS_TEST_ROOT
const dir = process.env.PCBJS_TEST_DIR
const golden = root ? join(root, 'golden') : ''

for (const key of root && existsSync(golden) ? readdirSync(golden).filter(d => statSync(join(golden, d)).isDirectory()) : []) {
  test(`golden ${key}`, () => {
    const file = join(dir ?? '', `${key}.fab.json`)
    if (!existsSync(file)) throw new Error(`no board ${key} in this snapshot to compare with golden/${key}`)
    const diffs = compareGolden(join(golden, key), JSON.parse(readFileSync(file, 'utf8')))
    if (diffs.length) throw new Error(`golden/${key} differs; pcbjs test --update takes the new set:\n${diffs.join('\n')}`)
  })
}
