// pcbjs check's type check: tsc's errors in project files, one line each, cached against the files the program read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { typecheck, typeErrorLine } from '../dist/project/typecheck.js'

test('typecheck: reports an error as one findings line, caches it, and skips a project without tsconfig.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-tc-'))
  try {
    assert.equal(typecheck(dir, ['main.ts']), null)
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] } }))
    writeFileSync(join(dir, 'main.ts'), 'const n: number = "x"\nexport default n\n')
    const a = typecheck(dir, ['main.ts'])
    assert.equal(a.cached, false)
    assert.equal(a.errors.length, 1)
    assert.equal(typeErrorLine(a.errors[0]), `error    typecheck  main.ts:1:7: TS2322 Type 'string' is not assignable to type 'number'.`)
    const b = typecheck(dir, ['main.ts'])
    assert.equal(b.cached, true)
    assert.deepEqual(b.errors, a.errors)
    writeFileSync(join(dir, 'main.ts'), 'const n: number = 1\nexport default n\n')
    const c = typecheck(dir, ['main.ts'])
    assert.equal(c.cached, false)
    assert.deepEqual(c.errors, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('typecheck: a message is never cut, and the line ends with the innermost reason of the chain, all of it with verbose', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-tc-'))
  try {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] } }))
    const long = Array.from({ length: 30 }, (_, i) => `field${i}: number`).join('; ')
    writeFileSync(
      join(dir, 'main.ts'),
      `const o = { a: { b: 1 }, ${long.replace(/: number/g, ': 1').replace(/;/g, ',')} }\nfunction f(p: { a: { b: string }; ${long} }) { return p }\nexport default f(o)\n`,
    )
    const [e] = typecheck(dir, ['main.ts']).errors
    assert.equal(e.code, 2345)
    assert.ok(e.message.length > 240 && e.message.endsWith('.') && !e.message.endsWith('...'), e.message)
    assert.equal(e.detail.at(-1), "Type 'number' is not assignable to type 'string'.")
    const line = typeErrorLine(e).split('\n')
    assert.equal(line.length, 2)
    assert.match(line[0], /^error    typecheck  main\.ts:3:18: TS2345 Argument of type /)
    assert.equal(line[1], "    Type 'number' is not assignable to type 'string'.")
    assert.equal(typeErrorLine(e, true).split('\n').length, 1 + e.detail.length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('typecheck discards cached success from the old Windows path filter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-tc-'))
  const root = process.platform === 'win32' ? dir.replace(/^[A-Z]:/, drive => drive.toLowerCase()) : dir
  try {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, types: [] } }))
    writeFileSync(join(dir, 'main.ts'), 'export const n: number = "wrong"\n')
    const first = typecheck(root, ['main.ts'])
    assert.equal(first.errors[0]?.code, 2322)
    const path = join(dir, '.pcbjs', 'typecheck.json')
    const stale = JSON.parse(readFileSync(path, 'utf8'))
    const key = JSON.parse(stale.key)
    key[0] = 3
    writeFileSync(path, JSON.stringify({ ...stale, key: JSON.stringify(key), errors: [] }))
    const result = typecheck(root, ['main.ts'])
    assert.equal(result.cached, false)
    assert.equal(result.errors[0]?.code, 2322)
    assert.deepEqual(typecheck(root, ['main.ts']).errors, result.errors)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
