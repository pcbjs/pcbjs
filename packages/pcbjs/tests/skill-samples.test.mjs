// Every TypeScript and JavaScript sample in the skills of packages/skills compiles: each fenced block is a module of its
// own, and `ts file=lib/pinout.ts` names the path another block of the same file imports it by. Python samples parse.
// The program runs over the scope host of `pcbjs check`, so a board may use the bare names of its schematic module.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scopeHost, sourcePosition } from '@pcbjs/compile/scope'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const skills = join(repo, 'packages', 'skills')
const scripts = new Set(['ts', 'tsx', 'js', 'mjs'])

const markdown = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? (d.name === 'node_modules' ? [] : markdown(join(dir, d.name))) : d.name.endsWith('.md') ? [join(dir, d.name)] : [],
  )

/** The fenced blocks of a markdown file: `{ lang, file, code, line }`, line the 1-based line of the first code line. */
function samples(text) {
  const out = []
  const re = /^```(\w+)([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm
  for (let m; (m = re.exec(text));) {
    out.push({ lang: m[1], file: /\bfile=(\S+)/.exec(m[2])?.[1], code: m[3], line: text.slice(0, m.index).split('\n').length + 1 })
  }
  return out
}

test('skills: every TypeScript and JavaScript sample type checks', async () => {
  const ts = (await import('typescript')).default
  const work = join(here, `.skill-samples-${process.pid}`)
  const origin = new Map()
  try {
    for (const md of markdown(skills)) {
      const dir = join(work, relative(skills, md).replace(/[\\/.]/g, '_'))
      samples(readFileSync(md, 'utf8'))
        .filter(s => scripts.has(s.lang))
        .forEach((s, i) => {
          const file = join(dir, s.file ?? `sample${i}.${s.lang}`)
          mkdirSync(dirname(file), { recursive: true })
          writeFileSync(file, s.code)
          origin.set(file, { md: relative(repo, md), line: s.line })
        })
    }
    assert.ok(origin.size > 10, `only ${origin.size} samples found`)
    const options = {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: '@pcbjs/core',
      allowJs: true,
      checkJs: false,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      types: ['node'],
    }
    const { host, injections } = scopeHost(options, work)
    const program = ts.createProgram([...origin.keys()], options, host)
    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter(d => d.file && origin.has(resolve(d.file.fileName)))
      .map(d => {
        const { md, line } = origin.get(resolve(d.file.fileName))
        const at = sourcePosition(d, injections) ?? { line: 1, col: 1 }
        return `${md}:${line + at.line - 1}:${at.col}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
      })
    assert.deepEqual(errors, [])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('skills: every Python sample parses', t => {
  const blocks = markdown(skills).flatMap(md =>
    samples(readFileSync(md, 'utf8'))
      .filter(s => s.lang === 'python')
      .map(s => ({ ...s, md })),
  )
  const probe = spawnSync('python3', ['-c', 'pass'])
  if (probe.status !== 0) return t.skip('no python3')
  for (const s of blocks) {
    const r = spawnSync('python3', ['-I', '-c', 'import ast, sys; ast.parse(sys.stdin.read())'], { input: s.code, encoding: 'utf8' })
    assert.equal(r.status, 0, `${relative(repo, s.md)}:${s.line}: ${r.stderr}`)
  }
})
